# occ_viewer

Standalone Robotruck OCC scene viewer (formerly `LitePT/tools/occ_viewer`).

Consumes **OCC scene packages** produced by LitePT export (`robotruck_occ_scene/v1`).  
Does **not** depend on LitePT source or model weights.

The GSS deployment uses the newer bundle in `web/` (imported from its deployed
object-storage snapshot on 2026-11-12); root-level files above are the original
standalone version. `web/app.js` supports the shared-static extension in SCHEMA.md.
`tools/deploy_shared_static.py` publishes versioned JavaScript, backs up the
previous index, verifies bytes, and then switches the GSS index. It does not
rewrite camera images or dataset products. Regression tests are under `tests/`.

GSS sets `ME_CONFIG_OCC_VIEWER_WEB_ROOT` to
`/mnt/buckets/robotruck-perception-data/occ-viewer/web`, backed by the object
prefix `s3://robotruck-perception-data/occ-viewer/web/` and served at
`https://sakura-gss.tail843345.ts.net/occ-viewer/`. The v5 entry is
`index.point-sources-v5.html`, referencing `app.point-sources-v5.js`;
ordinary `index.html` is updated too. This is a static-asset deployment, not a
GSS image rebuild. The publisher overlays an existing initialized web directory:
its `gss.js`, `format.json` and Three.js `vendor/` assets are retained there.

The v2 rendering fix and its GPU/real-scene regression evidence are documented
in [docs/render-fix-v2.md](docs/render-fix-v2.md). Deploy with an explicit immutable
`--bundle-name` and `--expected-index-sha256`; use `--dry-run` to validate first.
Full-resolution streaming, progress and resume behavior (v3) are covered in
[docs/download-fix-v3.md](docs/download-fix-v3.md).
The single-frame/aggregate selection contract and lazy network loading
are described in [docs/point-sources-v4.md](docs/point-sources-v4.md).
The current v5 entry, visible build ID, follow-3D default and stop-aggregate
control are described in [docs/point-sources-v5.md](docs/point-sources-v5.md).

## Run

```bash
cd /home/dev/01develop/occ_viewer
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

# single scene
.venv/bin/python serve.py --scene /path/to/occ_scene/<clip>

# or a scenes root (multi-clip)
.venv/bin/python serve.py --scenes-root /path/to/occ_scenes --port 8765
```

Open the printed URL. Video export uses `scene_video.py` (OpenCV).

## Layout

| File | Role |
|------|------|
| `serve.py` | HTTP server + video job API |
| `index.html` / `app.js` | Three.js UI |
| `scene_video.py` | MP4 from scene package |
| `occ_render.py` | BEV / side / camera OCC panels |
| `SCHEMA.md` | Scene package contract |

## Env

- `ROBOTRUCK_MONGO_URI` — only if you extend tools that talk to Mongo (viewer itself is filesystem-first)
