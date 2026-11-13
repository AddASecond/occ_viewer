# Semantic 9-class color mode

Select **Color mode → Semantic 9-class（9 类）**. Fine, Coarse 5-class and Lidar
modes remain available; the default remains the configured Coarse 5-class mode.
The new mode applies to current-frame and aggregate points, OCC, and camera
overlays when Point color is Semantic/Lidar. Height coloring stays independent.
The nine checkboxes filter both 3D and camera overlays, including an independently
selected aggregate projection. Switching color modes never requests point assets.

## Current Waymo-22 mapping

| Display class | Source fine labels |
| --- | --- |
| Drivable | 17 Road, 18 Lane Marker |
| undrivable | 19 Other Ground, 20 Walkable, 21 Sidewalk |
| Movable | 0–6, 11 Bicycle, 12 Motorcycle (previous dynamic) |
| Curb | 16 Curb |
| Fence | No separate label in Waymo-22 |
| Vegetation | 14 Vegetation, 15 Tree Trunk |
| Building | 13 Building |
| Unmovable | 7 Sign, 8 Traffic Light, 9 Pole, 10 Construction Cone |
| Noise | Unmapped/invalid labels, including 255 |

The five static subclasses together equal the previous static group. Drivable,
undrivable and Movable keep the old five-class group's membership and palette.
Mapping uses fine **names**, not a guessed numeric label based on class count.
If a future source declares a Fence fine label it can be shown; Waymo-22 cannot
recover Fence predictions from its other labels. The UI explicitly warns about
missing static subclasses. This feature does not perform annotation or inference.

For legacy raw five-class packages, dynamic/static/noise/drivable/non_drivable
remain Movable/Unmovable/Noise/Drivable/undrivable. Raw static cannot be split back
into five subclasses. A scene index or frame can explicitly declare
`label_encoding: "raw"` or `"fine"`; a frame declaration wins. A named fine
taxonomy otherwise disambiguates low-valued fine labels (Car/Truck/etc.) from raw
coarse IDs. Old metadata without names retains value-based encoding detection;
255 is treated as a noise sentinel in both encodings.

## Release and verification

GSS uses the same static root as v5:
`/mnt/buckets/robotruck-perception-data/occ-viewer/web`, backed by
`s3://robotruck-perception-data/occ-viewer/web/`.

New immutable assets are `app.color-nine-v6.js`, `semantic-nine.v6.mjs`, and
`index.color-nine-v6.html`. The normal `index.html` references v6 too. Older
versioned assets are not overwritten; use the new HTML URL to bypass an old tab
or HTML cache. No GSS service/image rebuild, Mongo writes, point/OCC regeneration,
downsampling, frame skipping, or pose/calibration changes are involved.

Tests:

```bash
node --test tests/*.test.mjs
python -m unittest discover -s tests -p 'test_*.py'
python tests/browser_semantic_nine.py
python tests/browser_shared_static.py --render-checks
python tests/browser_mongo_frame.py --clip 009964a3-1ae9-4507-b651-271b2cefebfb \
  --timestamp 1774493749301238016 --gss-entry --published-web --output /tmp/viewer-nine-check
```

Synthetic browser checks cover every fine label and noise, optional Fence labels,
scene switches, old raw labels, low-ID fine clouds, consistent point/OCC/overlay
colors, filters on both point sources, zero color-switch downloads and unchanged
geometry/camera. Existing tests retain full-point rendering and lazy-loading checks.
The real-frame test verifies original binary hashes, nine-class counts, unchanged
geometry, no aggregate download on initial load, and byte-identical published
assets. Its GSS read API is a local fixture: it does **not** verify the production
Tailscale HTTP path, whose hostname is not resolvable from this machine.

Validated on 2026-11-13: 19 Node tests, 4 publisher tests, five synthetic taxonomy
scenarios and both legacy/shared loading/rendering regressions passed. The
published real-frame run verified all 165,959 sensor points, 46,174,226 aggregate
points and 1,247,042 OCC voxels, matching the original binary hashes. Initial
aggregate requests and color-switch downloads were both zero. The mounted HTML,
app and helper hashes match the published objects; the v5 bundle is unchanged.
Evidence in the companion rt-data-gen workspace:
`output/viewer-color-nine-v6/deploy.json` and
`output/viewer-color-nine-v6/published/verification.json`.
