# v5 — unambiguous point sources and a cache-independent entry

The user confirmed their live browser was running
`/occ-viewer/app.download-fix-v3.js`, despite the published object-store
`index.html` pointing to v4. Thus the live report of Current frame downloading
the large aggregate was still the pre-v4 bug. We cannot identify whether the
old HTML came from the browser, a proxy, or the GSS mounted filesystem because
the production hostname remains inaccessible from this machine. Object-store
publication alone did not establish which code the user's browser executed.

## Entry and UI changes

- Publish immutable `index.point-sources-v5.html` together with
  `app.point-sources-v5.js`, then conditionally update ordinary `index.html`.
  The unique HTML path avoids reusing the cached old index without overwriting
  v3/v4 bundles. Both HTML entries have exactly the same bytes.
- The running JS, not just the HTML, sets the visible `Viewer v5` badge and
  `document.body.dataset.viewerBuild = 'point-sources-v5'`.
- New-page source selectors explicitly reset to single frame and camera
  **follow 3D**. Browser-restored aggregate selections cannot trigger startup
  downloads. Returning via the back-forward cache also resets to single frame.
- Camera Points/Both follow the left Points selection by default. Explicit
  independent frame/aggregate projection remains available and clearly named.
- The status line shows both active sources, declared point-file sizes and
  whether 3D or camera projection requested the aggregate. Independent aggregate
  projection can intentionally download it while the left view is single-frame.
- `仅单帧／停止聚合下载` resets both consumers and cancels unused in-flight
  aggregate downloads. Existing completed cache is retained, not downloaded again.

## Terminology

The old `帧点云bin` name described the per-frame *file*, not its temporal source.
It is now `聚合点云文件` for legacy full aggregates. Shared-static dynamic files
are `聚合动态点文件`. `单帧传感器点云` exclusively means
`assets.frame_sensor_points` — all sensors at one frame's deskew reference.

For the reported frame `009964a3-1ae9-4507-b651-271b2cefebfb` /
`1774493749301238016`:

| Source | Points | XYZ + labels + lidar ID bytes |
| --- | ---: | ---: |
| Single sensor frame | 165,959 | 2,323,426 |
| Aggregate static + current dynamic | 46,174,226 | 646,439,164 |

The ~278x size difference is temporal aggregation, not compression or point
downsampling. OCC/images are separate downloads. This release does not regenerate
any products or address the separately diagnosed aggregate geometry mismatch.

## Verification

`browser_shared_static.py --render-checks` covers both storage layouts, default
follow switching, explicit independent projection, browser-restored selections,
one-click cancellation while projection alone requests aggregate, stale responses,
frame changes, missing sensor assets, exact source arrays, and prior rendering
regressions. Loader/composition tests and deployment validation remain applicable.

`browser_mongo_frame.py --gss-entry` uses real Mongo metadata/assets and the real
`gss.js` startup through a local read-API fixture at the versioned HTML path.
`--published-web` additionally downloads the published HTML/app and compares
their bytes to the tested source before browser instrumentation. This is **not**
a production GSS/Tailscale browser verification.

Post-publication verification passed on the reported real frame: initial
single-frame point bytes 2,323,426, zero aggregate asset requests, 11/11 images,
and 1,247,042 unchanged OCC voxels. Explicit aggregate loading retained all
46,174,226 points with exact XYZ/label/lidar hashes, including an injected
disconnect and Range resume. Independent projection and cache reuse passed.
Evidence is in the adjacent rt-data-gen workspace:
`output/occ_shared_static_20261112/viewer-point-sources-v5/published/verification.json`.
Both-layout browser regressions, 15 loader/composition tests, four deployment
tests, JS syntax and whitespace checks also passed. The user's live v5 page
confirmation remains separate from these local checks.
