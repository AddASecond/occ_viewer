# Single-frame versus aggregate source fix (v4)

The old `Current frame ROI` option did not select a single sensor frame. It
unconditionally fetched `assets.points`, which is already the full aggregate
in legacy packages; shared-static packages additionally fetched `static_agg`
regardless of the selector. Previous compatibility tests mistakenly used
identical sensor/aggregate fixtures and did not assert network requests.

## Source contract

| Consumer / selection | Source |
|---|---|
| 3D Current frame (deskew) | `assets.frame_sensor_points` |
| Camera Points/Both, Current frame | The same sensor cache |
| 3D aggregate / Camera Points/Both, aggregate, legacy format | Existing full `assets.points`; no second static-file download |
| 3D aggregate / Camera Points/Both, aggregate, shared format | `index.static_agg` + frame dynamic assets, composed with the explicit transform/ROI |
| Camera OCC | Existing occupancy IJK/labels/grid; not controlled by Point source |

The 3D and camera selectors are independent consumers. Camera aggregate
projection previously used static points alone; it now uses the same complete
current-frame aggregate as 3D, **including current dynamic points**. No extra
ego-pose-derived transform is applied to already vehicle-frame point assets.
Image/calibration variant selection and the projection equations are unchanged.

- Default frame/frame selects the sensor assets only. No aggregate binary
  request is made for either legacy or shared packages.
- Aggregate downloads start only when a visible 3D point layer or active
  Points/Both overlay selects aggregate. RGB/OCC-only camera views do not
  activate aggregate point downloads; their Point source input is disabled.
- Both consumers share completed data and in-flight requests. Once neither
  needs aggregate, its unfinished download is cancelled. Late completions
  cannot replace the current source or another frame's buffers.
- Frame changes clear sensor/transformed-aggregate/projection caches. Shared
  map-frame static data may be reused, keyed by scene, variant and asset
  URI/hash/size identity.
- Missing sensor assets are reported, never silently replaced by an aggregate.
- Switching a source does not reload cameras/OCC/frame metadata or reset the
  3D camera. ROI clipping is controlled by its checkbox, not point source.
- Point-source synchronization redraws camera overlays only when their source
  or data changes, avoiding multiple identical large rasterizations when two
  consumers resolve the same cached promise.
- Client-side Rebuild OCC remains an explicit user action and is now labelled
  as a preview from the selected source, not exported GT.

No point sampling, new inference, point/OCC regeneration, Mongo metadata update,
camera rewrite or calibration change is part of this fix. Choosing aggregate
still requires its full data; this change does not claim to solve all aggregate
storage/transfer costs.

## Verification

`tests/browser_shared_static.py --render-checks` now uses genuinely different
sensor and aggregate points, labels and counts. In **both** formats it asserts:

- Zero aggregate requests on initial frame/frame load.
- Correct counts/XYZ for each 3D source, with the 3D camera preserved.
- Independent camera source selection, exact projected point sets, inclusion
  of dynamic labels, and matching thumbnail/lightbox source counts.
- Correct cache reuse (3 legacy aggregate assets, 6 shared assets, not duplicate
  full-frame plus static downloads).
- No aggregate request for RGB/OCC-only projection.
- Source/frame cache invalidation, cancellation, rejection of stale arrivals,
  and no cancellation while the other consumer still needs the shared request.
- Explicit missing-sensor errors, with no fallback download.
- Existing physical-cube, occlusion, no-drift and no-stride rendering checks.

The 11 binary-loader, 4 shared-composition and 3 deployment validation tests
remain applicable and pass.

Real reported frame `009964a3-1ae9-4507-b651-271b2cefebfb` /
`1774493749301238016` was exercised in Chromium/SwiftShader using unchanged
Mongo metadata and object-store binaries through a localhost fixture:

- Default: 165,959 sensor points, **2,323,426 point bytes**, zero aggregate
  requests; 1,247,042 OCC voxels and 11 cameras loaded independently.
- Complete browser XYZ/labels/lidar ID SHA256 matches the sensor assets.
- Explicit 3D aggregate selection: 46,174,226 points; complete array hashes
  match the original aggregate assets, including after an injected disconnect
  and Range resume. Camera projection stays single-frame until changed.
- Switching back to sensor 3D and separately selecting aggregate projection
  uses the cached aggregate, with no additional asset requests. Switching
  projection back restores the sensor data. The 3D camera remains fixed.
- Evidence is in the adjacent rt-data-gen workspace under
  `output/occ_shared_static_20261112/viewer-point-sources-v4/legacy/`, including
  `verification.json`, `frame.png` and `aggregate-projection.png`.

The real shared-static scene is also exercised by `tests/browser_real_scene.py`
with default sensor-only loading followed by explicit full aggregate loading,
full-buffer orbit checks and cached source switching. Hidden point layers do
not recreate GPU geometry merely because their source selector changed.

These are local browser/object-gateway tests. The production GSS hostname still
does not resolve here, so production GSS/Tailscale HTTP access is **not** claimed.
The new immutable entry bundle is `app.point-sources-v4.js`; publish it before
conditionally switching the index and retain v3 for rollback.
