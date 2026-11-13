# Viewer rendering fix, 2026-11-13

The reported issue was dragging the left 3D viewport, not switching camera
images. The deployed v1 renderer had independently reproducible display bugs:

1. Point clouds and OCC center markers used `depthWrite: false`. Within one
   draw call, later, farther points overwrote earlier, nearer points. Rotating
   changed overlap without proper surface visibility. A GPU pixel test with a
   near blue point followed by a far red point returned red from **both** sides.
2. OCC defaulted to camera-facing `THREE.Points`, not voxel cubes. Three's
   point shader computes diameter as `size * viewportHeight / (2 * depth)`;
   it omits the perspective focal factor that the projected lattice uses.
   With FOV 50°, voxel .25m and old growth 1.02, markers span only
   `1.02 * tan(25°) ≈ 47.6%` of the face-on lattice spacing. A zero Gap slider
   therefore did not mean closed voxel faces. Rotating billboards also does
   not reproduce a physical voxel silhouette.
3. OrbitControls damping continued moving the camera after release. Loading a
   frame or changing point display mode unconditionally reset its position.
4. Separately, camera overlays secretly applied index strides with different
   caps for thumbnails (70,000) and full images (160,000). This changed the
   displayed set when opening a lightbox. It was unrelated to 3D drag but was
   another real Viewer-only sampling defect.

## Changes

- Points write depth. OCC defaults to opaque instanced cubes, side length
  exactly the exported voxel size, Gap 0 and Size× 1. No silent .35 opacity
  when points are visible. Optional center-marker preview is explicitly named
  as non-solid and its size includes the missing focal factor.
- Drag has no inertial tail. Initial clip load and the explicit reset button
  fit the camera; other frame/mode loads preserve it. Shared point-mode switches
  rebuild only the display filters without downloading/recomposing the scene.
- Camera overlays visit every source point/voxel. Points use a native-image
  pixel depth buffer, retaining the closest point at an overlapping pixel;
  this is visibility/rasterization, not source-cloud sampling. Memory is
  bounded by image resolution. Thumbnail and lightbox share the same projected
  result. Existing class, lidar, ROI and projection validity filters remain.
- No model, pose, calibration, data file or Mongo document was modified.

## Verification

`tests/browser_shared_static.py --render-checks` passes with both legacy and
shared-static formats, in both point display modes. Test-only hooks are never
deployed. Reproduced v1 and fixed v2 results:

| Check | v1 | v2 |
|---|---|---|
| GPU near-blue/far-red, views from opposite sides | red / red | blue / red |
| 200,001 distinct projected points: thumbnail / full | 66,667 / 100,001 | 200,001 / 200,001 |
| 80,001 projected voxels: thumbnail / full | 40,001 / 80,001 | 80,001 / 80,001 |
| Camera retained on point-mode switch | no | yes |
| Camera stable after drag release | no | yes |

The physical-cube lattice raster test also checks that the interior of a
contiguous wall has 100% coverage at frontal and oblique angles (no invented
gaps). This does not fill genuinely unoccupied data voxels.

Real clip `0038952f-2da1-4eb1-8b40-83b728debfaa`, first frame
`1783921625601223936`, was tested in Chromium/SwiftShader:

- 35,780,429 source/reconstructed points = 35,780,429 GPU point vertices.
- 674,621 OCC voxels; physical cubes .25m.
- Full-buffer fingerprints for source XYZ, rendered XYZ, OCC IJK, voxel centers
  and all instance matrices were unchanged after point-cloud orbit, point-mode
  switch, and OCC orbit. No data transform is recomputed while orbiting.
- No movement after releasing the pointer; source-mode switch kept the camera.
- All 11 cameras loaded. The interaction test took 141.68s on CPU software
  rendering; this is not a GPU-browser FPS benchmark.

Evidence is in the adjacent rt-data-gen workspace at
`output/occ_shared_static_20261112/viewer-render-fix-v2/`, including
`browser-verification.json` and before/after-orbit screenshots.

## Deployment

New immutable bundle: `occ-viewer/web/app.render-fix-v2.js`.
The prior v1 bundle and all data assets remain intact. The deployment script
requires the expected old index SHA256, validates its script reference, stores
the actual old index under `occ-viewer/deployment-backups/<sha256>/index.html`,
then conditionally updates the entry point. `--dry-run` makes no writes.

The GSS hostname `sakura-gss.tail843345.ts.net` still does not resolve on this
machine. Verification covers the exact bundle locally plus object-storage
publication/byte checks, not an end-to-end HTTP test through that hostname.
