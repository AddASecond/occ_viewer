# occ_viewer

Standalone occupancy scene viewer. The UI reads a **canonical scene package** ([docs/SCHEMA.md](docs/SCHEMA.md)), not a specific vendor dump.

Robotruck Mongo / disk / taxonomy live in [config/formats/robotruck.yaml](config/formats/robotruck.yaml) (see [docs/formats/robotruck_mongo.md](docs/formats/robotruck_mongo.md)). Switch `format:` in [config/viewer.yaml](config/viewer.yaml) to add another domain later. The HTTP server does not open Mongo.

## Run

```bash
cd /home/dev/01develop/occ_viewer
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python serve.py --scene /path/to/occ_scene/<clip>
# or: --scenes-root /path/to/occ_scenes --port 8765
```

Open the printed URL. Manual: [docs/USER_MANUAL.md](docs/USER_MANUAL.md).

## Layout

| Path | Role |
|------|------|
| `serve.py` | HTTP + video job API |
| `web/` | Three.js UI |
| `src/scene_video.py` | MP4 from scene package |
| `config/` | viewer + format YAML |
| `docs/` | schema, manual, format notes |
