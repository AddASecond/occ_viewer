#!/usr/bin/env python3
"""Serve occ_viewer + one or more scene packages.

Endpoints:
  GET  /                     viewer
  GET  /api/clips            list available clips
  GET  /scenes/<clip>/...    scene assets (multi-clip)
  GET  /scene/...            alias of default / first clip (compat)
  POST /api/video/export     start export {clip_id?, mode,fps,...}
  GET  /api/video/status
  GET  /api/video/list?clip_id=
  GET  /videos/<clip>/<file> download mp4
"""
from __future__ import annotations

import argparse
import functools
import json
import math
import subprocess
import sys
import threading
import time
import uuid
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import yaml

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
SRC = ROOT / "src"


def _load_yaml(path: Path) -> dict:
    return yaml.safe_load(path.read_text()) or {}


CFG = _load_yaml(ROOT / "config" / "viewer.yaml")


def _load_format(cfg: dict) -> dict:
    """Active format profile: config/formats/<viewer.yaml format>.yaml.

    With no `format:` key, fall back to the only available profile so a
    single-format checkout needs zero configuration.
    """
    name = cfg.get("format")
    formats_dir = ROOT / "config" / "formats"
    if not name:
        candidates = sorted(formats_dir.glob("*.yaml"))
        if len(candidates) == 1:
            name = candidates[0].stem
        else:
            raise SystemExit(
                "config/viewer.yaml: set `format:` to one of "
                + ", ".join(p.stem for p in candidates)
            )
    path = formats_dir / f"{name}.yaml"
    if not path.is_file():
        raise SystemExit(f"format profile not found: {path}")
    return _load_yaml(path)


FMT = _load_format(CFG)

# --- Source-data integration (format-specific, optional; server-side only) ---
_CAM_FB = (FMT.get("source") or {}).get("camera_fallback") or {}
SRC_CLIPS = Path(_CAM_FB["clips_root"]) if _CAM_FB.get("clips_root") else None
CAMERA_VOLUMES = tuple(Path(v) for v in _CAM_FB.get("volumes") or [])
CAM_INDEX_FILE = _CAM_FB.get("index_file") or "frames.jsonl"
CAM_TS_KEY = _CAM_FB.get("timestamp_key") or "timestamp_ns"
CAM_CAMERAS_KEY = _CAM_FB.get("cameras_key") or "cameras"
CAM_MD5_KEY = _CAM_FB.get("md5_key") or "md5"
CAM_PATH_TEMPLATE = _CAM_FB.get("path_template") or "camera/{m0}/{m1}/{rest}.jpg"
CAMERA_FALLBACK_ENABLED = bool(SRC_CLIPS and CAMERA_VOLUMES)

# /gallery/* reverse proxy (viewer.yaml); disabled when unset.
GALLERY_UPSTREAM = str(CFG.get("gallery_upstream") or "").rstrip("/")

_FRAME_INDEX: dict[str, dict[str, dict]] = {}
# Clip discovery is consulted by every static-file request; throttle the scan.
_CLIP_SCAN_TTL = 2.0
_CLIP_SCAN_LOCK = threading.Lock()
_CLIP_SCAN = {"at": 0.0, "root": None, "found": {}}


def find_camera_jpg(md5: str) -> Path | None:
    if not md5 or len(md5) < 5:
        return None
    rel = CAM_PATH_TEMPLATE.format(m0=md5[:2], m1=md5[2:4], rest=md5[4:], md5=md5)
    for volume in CAMERA_VOLUMES:
        path = volume / rel
        if path.is_file():
            return path
    return None


def lookup_source_camera(clip_id: str, frame_ts: str, cam: str) -> Path | None:
    if not CAMERA_FALLBACK_ENABLED:
        return None
    frames = _FRAME_INDEX.get(clip_id)
    if frames is None:
        frames = {}
        src = SRC_CLIPS / clip_id / CAM_INDEX_FILE
        if src.is_file():
            for line in src.read_text().splitlines():
                if not line.strip():
                    continue
                row = json.loads(line)
                frames[str(row.get(CAM_TS_KEY))] = row
        _FRAME_INDEX[clip_id] = frames
    row = frames.get(str(frame_ts))
    if not row:
        return None
    info = (row.get(CAM_CAMERAS_KEY) or {}).get(cam)
    if not info:
        return None
    return find_camera_jpg(info.get(CAM_MD5_KEY) or "")


_PV = FMT.get("point_preview") or {}
PREVIEW_ENABLED = bool(_PV.get("enabled", True)) and bool(_PV.get("files"))
PREVIEW_DIR = _PV.get("dir") or "point_agg"
PREVIEW_PREFIX = _PV.get("prefix") or "preview_"
PREVIEW_MAX_POINTS = int(_PV.get("max_points") or 800_000)
PREVIEW_FILES = tuple(
    (f["name"], int(f["record_bytes"])) for f in (_PV.get("files") or [])
)


def _write_strided_preview(src: Path, dst: Path, count: int, itemsize: int, step: int) -> bool:
    """Keep every step-th record; numpy memmap keeps this O(bytes) with low RAM."""
    try:
        import numpy as np
    except Exception:
        return False
    count = min(count, src.stat().st_size // itemsize)
    kept = count // step
    if kept <= 0:
        return False
    tmp = dst.with_name(dst.name + ".tmp")
    try:
        mm = np.memmap(src, dtype=np.uint8, mode="r", shape=(count, itemsize))
        mm[::step][:kept].tofile(tmp)
    except Exception:
        tmp.unlink(missing_ok=True)
        return False
    tmp.replace(dst)
    return True


def ensure_point_preview(scene: Path) -> None:
    if not PREVIEW_ENABLED:
        return
    agg = scene / PREVIEW_DIR
    # Cheap stats first; only parse index.json when a preview must be rebuilt.
    pending = []
    for name, itemsize in PREVIEW_FILES:
        src = agg / name
        dst = agg / f"{PREVIEW_PREFIX}{name}"
        if not src.is_file():
            continue
        sstat = src.stat()
        if dst.is_file() and dst.stat().st_mtime >= sstat.st_mtime and dst.stat().st_size > 0:
            continue
        pending.append((itemsize, src, dst, sstat))
    if not pending:
        return
    n = 0
    idx_path = scene / "index.json"
    if idx_path.is_file():
        try:
            n = int((json.loads(idx_path.read_text()).get("point_aggregate") or {}).get("n") or 0)
        except Exception:
            n = 0
    for itemsize, src, dst, sstat in pending:
        count = n or (sstat.st_size // itemsize)
        if count <= 0:
            continue
        step = max(1, math.ceil(count / PREVIEW_MAX_POINTS))
        if _write_strided_preview(src, dst, count, itemsize, step):
            continue
        # Fallback: record-at-a-time, no numpy needed.
        kept = count // step
        tmp = dst.with_name(dst.name + ".tmp")
        with src.open("rb") as reader, tmp.open("wb") as writer:
            for i in range(kept):
                reader.seek(i * step * itemsize)
                chunk = reader.read(itemsize)
                if len(chunk) < itemsize:
                    break
                writer.write(chunk)
        tmp.replace(dst)


EXPORT_SCRIPT = SRC / "scene_video.py"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))
try:
    import scene_video as _scene_video_mod
except Exception:
    _scene_video_mod = None


class VideoJob:
    def __init__(self):
        self.lock = threading.Lock()
        self.job_id: str | None = None
        self.state = "idle"  # idle|running|done|error
        self.message = ""
        self.progress = 0.0
        self.frame = 0
        self.n = 0
        self.path: str | None = None
        self.relpath: str | None = None
        self.clip_id: str | None = None
        self.started_at: float | None = None
        self.finished_at: float | None = None
        self.proc: subprocess.Popen | None = None
        self.params: dict = {}

    def snapshot(self) -> dict:
        with self.lock:
            return {
                "job_id": self.job_id,
                "state": self.state,
                "message": self.message,
                "progress": self.progress,
                "frame": self.frame,
                "n": self.n,
                "path": self.path,
                "relpath": self.relpath,
                "clip_id": self.clip_id,
                "started_at": self.started_at,
                "finished_at": self.finished_at,
                "params": self.params,
            }


JOB = VideoJob()


def _python_bin() -> str:
    for cand in CFG.get("python") or []:
        p = Path(cand)
        if not p.is_absolute():
            p = ROOT / p
        if p.is_file():
            return str(p)
    return sys.executable


def discover_clips(scenes_root: Path) -> dict[str, Path]:
    out: dict[str, Path] = {}
    if not scenes_root.is_dir():
        return out
    for p in sorted(scenes_root.iterdir()):
        if p.is_dir() and (p / "index.json").is_file():
            out[p.name] = p.resolve()
    return out


def clip_info(clip_id: str, scene_dir: Path) -> dict:
    n_frames = 0
    schema = None
    try:
        idx = json.loads((scene_dir / "index.json").read_text())
        n_frames = len(idx.get("frames") or [])
        schema = idx.get("schema_version")
    except Exception:
        pass
    return {
        "id": clip_id,
        "clip_id": clip_id,
        "n_frames": n_frames,
        "schema_version": schema,
        "url": f"/scenes/{clip_id}",
    }


def _run_export(scene_dir: Path, clip_id: str, params: dict) -> None:
    import os
    import re

    out_dir = scene_dir / "videos"
    out_dir.mkdir(parents=True, exist_ok=True)
    status_path = out_dir / "job_status.json"
    log_path = out_dir / "job_export.log"

    mode = params.get("mode", "occ")
    fps = float(params.get("fps", 5))
    tile_w = int(params.get("tile_w", 960))
    tile_h = int(params.get("tile_h", 540))
    max_frames = int(params.get("max_frames", 0))

    with JOB.lock:
        JOB.state = "running"
        JOB.message = "starting exporter"
        JOB.progress = 0.0
        JOB.frame = 0
        JOB.n = 0
        JOB.path = None
        JOB.relpath = None
        JOB.clip_id = clip_id
        JOB.started_at = time.time()
        JOB.finished_at = None
        JOB.params = dict(params)
        status_path.write_text(json.dumps(JOB.snapshot(), indent=2))

    # In-process path (same module as EXPORT_SCRIPT).
    if _scene_video_mod is not None:
        try:
            with open(log_path, "w", encoding="utf-8") as logf:
                logf.write(f"in-process scene_video.export_scene_video mode={mode}\n")
                logf.flush()
            result = _scene_video_mod.export_scene_video(
                scene_dir,
                out_path=None,
                mode=str(mode),
                fps=fps,
                tile_w=tile_w,
                tile_h=tile_h,
                max_frames=max_frames,
            )
            out_p = Path(result)
            with JOB.lock:
                JOB.state = "done"
                JOB.message = "done"
                JOB.progress = 1.0
                JOB.path = str(out_p)
                try:
                    JOB.relpath = str(out_p.relative_to(scene_dir))
                except Exception:
                    JOB.relpath = out_p.name
                JOB.finished_at = time.time()
                status_path.write_text(json.dumps(JOB.snapshot(), indent=2))
            return
        except Exception as exc:
            with open(log_path, "a", encoding="utf-8") as logf:
                logf.write(f"in-process failed: {exc}\nfalling back to subprocess\n")

    cmd = [
        _python_bin(),
        str(EXPORT_SCRIPT),
        "--scene",
        str(scene_dir),
        "--mode",
        str(mode),
        "--fps",
        str(fps),
        "--tile-w",
        str(tile_w),
        "--tile-h",
        str(tile_h),
        "--max-frames",
        str(max_frames),
    ]

    env = os.environ.copy()
    env["PYTHONPATH"] = str(ROOT) + (":" + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")

    with open(log_path, "a", encoding="utf-8") as logf:
        logf.write(" ".join(cmd) + "\n\n")
        logf.flush()
        proc = subprocess.Popen(
            cmd,
            cwd=str(ROOT),
            stdout=logf,
            stderr=subprocess.STDOUT,
            env=env,
        )
        with JOB.lock:
            JOB.proc = proc
            JOB.message = "export running"

        while proc.poll() is None:
            try:
                text = log_path.read_text(encoding="utf-8", errors="ignore")
                ms = list(re.finditer(r"\[(\d+)/(\d+)\]", text))
                if ms:
                    a, b = int(ms[-1].group(1)), int(ms[-1].group(2))
                    with JOB.lock:
                        JOB.frame = a
                        JOB.n = b
                        JOB.progress = (a / b) if b else 0.0
                        JOB.message = f"frame {a}/{b}"
                        status_path.write_text(json.dumps(JOB.snapshot(), indent=2))
            except Exception:
                pass
            time.sleep(0.8)

        rc = proc.returncode
        mp4s = sorted(out_dir.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
        with JOB.lock:
            JOB.finished_at = time.time()
            JOB.proc = None
            if rc == 0 and mp4s:
                JOB.state = "done"
                JOB.path = str(mp4s[0])
                JOB.relpath = f"videos/{mp4s[0].name}"
                JOB.progress = 1.0
                JOB.message = f"done → {mp4s[0].name}"
            else:
                JOB.state = "error"
                JOB.message = f"exporter failed rc={rc}; see videos/job_export.log"
            status_path.write_text(json.dumps(JOB.snapshot(), indent=2))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, clips: dict[str, Path], default_clip: str, scenes_root: Path | None = None, **kwargs):
        self.clips = clips
        self.default_clip = default_clip
        self.scenes_root = scenes_root
        super().__init__(*args, directory=str(WEB), **kwargs)

    def _refresh_clips(self) -> None:
        if self.scenes_root is None:
            return
        now = time.monotonic()
        with _CLIP_SCAN_LOCK:
            if (
                _CLIP_SCAN["root"] != self.scenes_root
                or now - _CLIP_SCAN["at"] >= _CLIP_SCAN_TTL
            ):
                _CLIP_SCAN["root"] = self.scenes_root
                _CLIP_SCAN["found"] = discover_clips(self.scenes_root)
                _CLIP_SCAN["at"] = now
            found = _CLIP_SCAN["found"]
        if found:
            self.clips.update(found)
            if self.default_clip not in self.clips:
                self.default_clip = next(iter(self.clips))

    def _scene(self, clip_id: str | None = None) -> Path | None:
        self._refresh_clips()
        cid = clip_id or self.default_clip
        return self.clips.get(cid)

    def _send_json(self, obj: dict, code: int = 200):
        raw = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _read_json_body(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return {}
        raw = self.rfile.read(n)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/video/export":
            body = self._read_json_body()
            clip_id = body.get("clip_id") or self.default_clip
            scene_dir = self._scene(clip_id)
            if scene_dir is None:
                self._send_json({"ok": False, "error": f"unknown clip_id={clip_id}"}, 400)
                return
            with JOB.lock:
                if JOB.state == "running":
                    self._send_json(
                        {"ok": False, "error": "job already running", **JOB.snapshot()},
                        409,
                    )
                    return
                JOB.job_id = uuid.uuid4().hex[:10]
            t = threading.Thread(
                target=_run_export,
                args=(scene_dir, clip_id, body),
                daemon=True,
            )
            t.start()
            self._send_json({"ok": True, **JOB.snapshot()})
            return
        self.send_error(404)

    def _proxy_review(self, path: str, query: str) -> None:
        rest = path[len("/gallery"):] or "/"
        if not rest.startswith("/"):
            rest = "/" + rest
        url = f"{GALLERY_UPSTREAM}{rest}"
        if query:
            url += "?" + query
        req = urllib.request.Request(url, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                self.send_response(resp.status)
                ctype = resp.headers.get("Content-Type") or "application/octet-stream"
                self.send_header("Content-Type", ctype)
                cl = resp.headers.get("Content-Length")
                if cl:
                    self.send_header("Content-Length", cl)
                self.end_headers()
                while True:
                    chunk = resp.read(1024 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except urllib.error.HTTPError as exc:
            body = exc.read()
            self.send_response(exc.code)
            self.send_header("Content-Type", exc.headers.get("Content-Type") or "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as exc:
            self._send_json({"error": f"review proxy: {exc}"}, 502)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        qs = parse_qs(parsed.query)

        if GALLERY_UPSTREAM and (path == "/gallery" or path.startswith("/gallery/")):
            self._proxy_review(path, parsed.query)
            return

        if path == "/api/config":
            # `source` is server-side only (raw-data integration); the rest of
            # the format profile drives the browser (taxonomy, ROI, UI, gss).
            self._send_json({k: v for k, v in FMT.items() if k != "source"})
            return

        if path == "/api/clips":
            self._refresh_clips()
            items = [clip_info(cid, p) for cid, p in self.clips.items()]
            self._send_json(
                {
                    "default_clip": self.default_clip,
                    "clips": items,
                }
            )
            return

        if path == "/api/video/status":
            snap = JOB.snapshot()
            clip_id = qs.get("clip_id", [self.default_clip])[0]
            scene = self._scene(clip_id)
            if snap["state"] == "idle" and scene is not None:
                disk = scene / "videos" / "job_status.json"
                if disk.is_file():
                    try:
                        snap = json.loads(disk.read_text())
                    except Exception:
                        pass
            self._send_json(snap)
            return

        if path == "/api/video/list":
            clip_id = qs.get("clip_id", [self.default_clip])[0]
            scene = self._scene(clip_id)
            items = []
            if scene is not None:
                vdir = scene / "videos"
                if vdir.is_dir():
                    for p in sorted(
                        vdir.glob("*.mp4"), key=lambda x: x.stat().st_mtime, reverse=True
                    ):
                        items.append(
                            {
                                "name": p.name,
                                "relpath": f"videos/{p.name}",
                                "url": f"/videos/{clip_id}/{p.name}",
                                "bytes": p.stat().st_size,
                                "mtime": p.stat().st_mtime,
                                "clip_id": clip_id,
                            }
                        )
            self._send_json({"videos": items, "clip_id": clip_id})
            return

        if path.startswith("/videos/"):
            rest = path[len("/videos/") :]
            parts = rest.split("/", 1)
            if len(parts) == 1:
                clip_id, name = self.default_clip, parts[0]
            else:
                clip_id, name = parts[0], parts[1]
            if "/" in name or name.startswith(".") or ".." in name or ".." in clip_id:
                self.send_error(400)
                return
            scene = self._scene(clip_id)
            if scene is None:
                self.send_error(404)
                return
            target = (scene / "videos" / name).resolve()
            if not str(target).startswith(str(scene / "videos")) or not target.is_file():
                self.send_error(404)
                return
            ctype = "video/mp4" if target.suffix == ".mp4" else "application/octet-stream"
            data = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Content-Disposition", f'attachment; filename="{target.name}"')
            self.end_headers()
            self.wfile.write(data)
            return

        return super().do_GET()

    def translate_path(self, path: str) -> str:
        parsed = urlparse(path)
        p = unquote(parsed.path)

        # /scenes/<clip_id>/...
        if p.startswith("/scenes/"):
            rest = p[len("/scenes/") :]
            if not rest:
                return str(WEB / "index.html")
            parts = rest.split("/", 1)
            clip_id = parts[0]
            rel = parts[1] if len(parts) > 1 else ""
            scene = self._scene(clip_id)
            if scene is None:
                return str(WEB / "index.html")
            target = (scene / rel).resolve() if rel else scene
            if rel and not str(target).startswith(str(scene)):
                return str(WEB / "index.html")
            if PREVIEW_ENABLED and rel.startswith(f"{PREVIEW_DIR}/{PREVIEW_PREFIX}"):
                ensure_point_preview(scene)
                target = (scene / rel).resolve()
            if rel and not target.is_file():
                parts_rel = rel.split("/")
                if (
                    CAMERA_FALLBACK_ENABLED
                    and len(parts_rel) == 4
                    and parts_rel[0] == "frames"
                    and parts_rel[2] == "cameras"
                    and parts_rel[3].endswith(".jpg")
                ):
                    found = lookup_source_camera(clip_id, parts_rel[1], parts_rel[3][:-4])
                    if found is not None:
                        return str(found)
            return str(target)

        # /scene/... → default clip (backward compatible)
        if p.startswith("/scene/") or p == "/scene":
            rel = p[len("/scene/") :] if p.startswith("/scene/") else ""
            scene = self._scene(self.default_clip)
            if scene is None:
                return str(WEB / "index.html")
            target = (scene / rel).resolve() if rel else scene
            if not str(target).startswith(str(scene)):
                return str(WEB / "index.html")
            return str(target)

        return super().translate_path(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--scenes-root",
        default="",
        help="Parent directory containing multiple scene packages",
    )
    ap.add_argument(
        "--scene",
        default="",
        help="Single scene root (compat). If set with --scenes-root, becomes default clip.",
    )
    ap.add_argument("--host", default=str(CFG.get("host") or "127.0.0.1"))
    ap.add_argument("--port", type=int, default=int(CFG.get("port") or 8765))
    args = ap.parse_args()

    clips: dict[str, Path] = {}
    if args.scenes_root:
        clips = discover_clips(Path(args.scenes_root).resolve())
    if args.scene:
        scene = Path(args.scene).resolve()
        if not (scene / "index.json").is_file():
            raise SystemExit(f"missing index.json under {scene}")
        clips[scene.name] = scene
    if not clips:
        raise SystemExit("provide --scenes-root and/or --scene with valid packages")

    default_clip = Path(args.scene).resolve().name if args.scene else next(iter(clips))
    if default_clip not in clips:
        default_clip = next(iter(clips))

    scenes_root = Path(args.scenes_root).resolve() if args.scenes_root else None
    handler = functools.partial(
        Handler, clips=clips, default_clip=default_clip, scenes_root=scenes_root
    )
    httpd = ThreadingHTTPServer((args.host, args.port), handler)
    url = f"http://{args.host}:{args.port}/"
    print(f"clips ({len(clips)}): {', '.join(clips)}")
    print(f"default: {default_clip}")
    print(f"open:  {url}")
    print(f"api:   GET /api/clips")
    httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
