/** Choose the image and its calibration together; never mix camera variants. */
export function selectCameraImages(cameras, variant) {
  const groups = new Map();
  for (const camera of cameras) {
    const id = camera.camera_id || camera.name.replace(/_(raw|undistort)$/, "");
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(camera);
  }
  return [...groups.values()].map(group => {
    const kind = camera => camera.image_variant || (camera.name.endsWith("_undistort") ? "undistort" : "raw");
    const camera = group.find(camera => kind(camera) === variant) || group[0];
    return { ...camera, image_variant: kind(camera), variantUnavailable: kind(camera) !== variant };
  });
}

/** OpenCV pinhole/radtan/rational projection, with row-major transforms. */
export function createCameraProjector(camera) {
  const K = camera.K;
  const T = camera.T_c_v_lidar_ref || camera.T_c_v;
  const d = camera.distortion || camera.dist5 || [];
  if (!K || K.length !== 9 || !T || T.length !== 16 || ![0, 4, 5, 8].includes(d.length)
      || (camera.camera_model && camera.camera_model !== "pinhole")) return () => false;
  const distorted = d.some(value => value !== 0);
  const [k1 = 0, k2 = 0, p1 = 0, p2 = 0, k3 = 0, k4 = 0, k5 = 0, k6 = 0] = d;
  return (x, y, z, out) => {
    const xc = T[0] * x + T[1] * y + T[2] * z + T[3];
    const yc = T[4] * x + T[5] * y + T[6] * z + T[7];
    const zc = T[8] * x + T[9] * y + T[10] * z + T[11];
    if (zc <= 0.3) return false;
    let xn = xc / zc, yn = yc / zc;
    if (distorted) {
      const r2 = xn * xn + yn * yn, r4 = r2 * r2, r6 = r4 * r2;
      const denominator = 1 + k4 * r2 + k5 * r4 + k6 * r6;
      if (Math.abs(denominator) < 1e-12) return false;
      const radial = (1 + k1 * r2 + k2 * r4 + k3 * r6) / denominator;
      const xd = xn * radial + 2 * p1 * xn * yn + p2 * (r2 + 2 * xn * xn);
      yn = yn * radial + p1 * (r2 + 2 * yn * yn) + 2 * p2 * xn * yn;
      xn = xd;
    }
    out.u = K[0] * xn + K[1] * yn + K[2];
    out.v = K[3] * xn + K[4] * yn + K[5];
    out.z = zc;
    return Number.isFinite(out.u) && Number.isFinite(out.v);
  };
}
