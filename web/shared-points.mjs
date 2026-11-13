// Lossless reader for clip-static + per-frame-dynamic point packages.
export const SHARED_POINT_LAYOUT = 'clip_static_plus_frame_dynamic/v1';

export function hasSharedStatic(meta) {
  return meta?.assets?.points?.layout === SHARED_POINT_LAYOUT;
}

export function composeSharedPoints(staticPart, dynamic, descriptor) {
  if (descriptor.layout !== SHARED_POINT_LAYOUT || descriptor.static_ref !== 'index.json#static_agg'
      || descriptor.ordering !== 'static_then_dynamic' || descriptor.point_downsampling !== false
      || descriptor.static_roi_inclusive !== true) throw new Error('Unsupported shared point layout');
  const T = descriptor.T_vehicle_map;
  const roi = descriptor.static_roi;
  if (!Array.isArray(T) || T.length !== 16 || !T.every(Number.isFinite)
      || !['x', 'y', 'z'].every(k => Array.isArray(roi?.[k]) && roi[k].length === 2
        && roi[k].every(Number.isFinite) && roi[k][0] <= roi[k][1])) throw new Error('Invalid shared point transform/ROI');
  const ns = descriptor.static_n, nd = descriptor.n, n = descriptor.logical_n;
  if (![ns, nd, n].every(v => Number.isSafeInteger(v) && v >= 0) || ns + nd !== n
      || staticPart.xyz.length !== staticPart.labels.length * 3
      || staticPart.lidar?.length !== staticPart.labels.length
      || dynamic.xyz.length !== nd * 3 || dynamic.labels.length !== nd || dynamic.lidar?.length !== nd) {
    throw new Error('Shared point count mismatch');
  }
  const xyz = new Float32Array(n * 3), labels = new Uint8Array(n), lidar = new Uint8Array(n);
  let kept = 0;
  for (let i = 0; i < staticPart.labels.length; i++) {
    const x = staticPart.xyz[3 * i], y = staticPart.xyz[3 * i + 1], z = staticPart.xyz[3 * i + 2];
    // Match the exporter's float64 homogeneous transform, then float32 crop.
    const vx = Math.fround(T[0] * x + T[1] * y + T[2] * z + T[3]);
    const vy = Math.fround(T[4] * x + T[5] * y + T[6] * z + T[7]);
    const vz = Math.fround(T[8] * x + T[9] * y + T[10] * z + T[11]);
    if (vx < roi.x[0] || vx > roi.x[1] || vy < roi.y[0] || vy > roi.y[1]
        || vz < roi.z[0] || vz > roi.z[1]) continue;
    if (kept >= ns) throw new Error('Shared static ROI count mismatch');
    xyz[kept * 3] = vx; xyz[kept * 3 + 1] = vy; xyz[kept * 3 + 2] = vz;
    labels[kept] = staticPart.labels[i]; lidar[kept] = staticPart.lidar[i];
    kept++;
  }
  if (kept !== ns) throw new Error('Shared static ROI count mismatch');
  xyz.set(dynamic.xyz, ns * 3); labels.set(dynamic.labels, ns); lidar.set(dynamic.lidar, ns);
  return { xyz, labels, lidar, n };
}
