# Full-point download timeout fix, 2026-11-13

Reported frame: clip `009964a3-1ae9-4507-b651-271b2cefebfb`, timestamp
`1774493749301238016`, 1,247,042 OCC voxels at .25m.

Read-only Mongo inspection found that this is still the legacy full-per-frame
point layout, last updated 2026-11-11. It is not the single shared-static clip
`0038952f-2da1-4eb1-8b40-83b728debfaa` previously refreshed and verified.

| Asset | Bytes |
|---|---:|
| Frame aggregate XYZ (46,174,226 points) | 554,090,712 |
| Labels | 46,174,226 |
| Lidar IDs | 46,174,226 |
| Total full point data | 646,439,164 |
| Separate current sensor XYZ + labels + IDs | 2,323,426 |

`stats.n_static_roi` is 46,174,030. The frame file already includes the static
aggregate; not downloading the separate clip static file does not mean that
this point display is single-frame-only. The old progress wording obscured this.

## Confirmed loading defects and fixes

- All binary requests shared `AbortSignal.timeout(300000)`, an absolute deadline
  covering the entire download. A healthy but slower-than-~2.15 MB/s transfer of
  the three point assets could hit the deadline. This proves a client-side
  failure condition, not the precise bandwidth/bottleneck on the user's route.
- Binary downloads now use a 90s **inactivity** timeout, reset whenever bytes
  arrive. A continuously progressing download has no total time limit.
- Interrupted/stalled responses resume at the number of bytes actually received,
  with up to 3 retries. Content-Range, declared lengths and ETags are checked.
  Express's weak ETags are not sent as If-Range: Last-Modified is used instead.
  Ignored ranges restart safely; malformed ranges/changed objects fail explicitly.
- Progress shows received/total MB, transfer rate and resume retries. It no
  longer sits at file-count-only progress while downloading 554 MB of XYZ.
- Sensor/camera projection becomes available independently, without waiting
  behind the huge 3D point transfer. It never substitutes sensor points for the
  full aggregate in the left 3D viewport.
- The separate-static progress line now explains when the current frame file
  already contains static aggregate points.

There was no downsampling, new inference, re-voxelization, Mongo update, data
rewrite, or conversion of this clip to shared-static storage. The legacy file
size and physical bandwidth cost remain; this fix does not claim to eliminate
them or promise a particular download time on the user's Tailscale path.

## Verification

- 11 loader tests cover long-running active streams, disconnect/stall resume,
  strong/weak ETags, user cancellation, ignored/invalid ranges, unknown lengths,
  bounded range responses, changed ETags, HTTP errors and finite retry exhaustion.
- Shared/legacy scene browser rendering regressions in both point modes pass,
  retaining the v2 depth/physical-cube fixes. 4 shared composition and 3
  deployment validation tests pass.
- `tests/browser_mongo_frame.py` read the exact reported frame and streamed its
  unchanged S3 assets through a localhost-only fixture. The XYZ stream was
  intentionally severed after 8 MiB. Chromium issued a Range retry, received a
  206 response, and completed all 646,439,164 point bytes.
- All 46,174,226 points became GPU vertices. All 1,247,042 OCC voxels and all 11
  cameras loaded. SHA256 of the **complete browser-resident XYZ, labels and lidar
  ID arrays** exactly matched the Mongo asset hashes; no missing or duplicated
  bytes at the resume boundary. Viewer marked ready at about 29s and the full
  fixture/hash/screenshot test finished in 42.91s. These are **local object
  gateway test timings**, not measurements of production GSS.
- Evidence: adjacent rt-data-gen workspace,
  `output/occ_shared_static_20261112/viewer-download-fix-v3/verification.json`
  and `frame.png`. The final code also clarifies the static-aggregate status text
  after this real-frame run; the loading and rendering code is unchanged.

## Publication and limitation

Publish `app.download-fix-v3.js` and `asset-loader.v3.mjs` as immutable new
objects, then conditionally switch the index from v2 SHA256
`f9f52b1e6cf79aa818dc70458f0724f68db4da3c6aa0be0e437c6e1665e8ef8e`.
Retain the previous index/bundles for rollback and verify remote bytes.

The user's `sakura-gss.tail843345.ts.net` hostname still does not resolve on
this machine. Its exact GSS/mounted-storage/Tailscale path could not be tested;
do not describe the localhost test as successful end-to-end production access.
