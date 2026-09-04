# occ_viewer

Standalone Robotruck OCC scene viewer (formerly `LitePT/tools/occ_viewer`).

Consumes **OCC scene packages** produced by LitePT export (`robotruck_occ_scene/v1`).  
Does **not** depend on LitePT source or model weights.

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
