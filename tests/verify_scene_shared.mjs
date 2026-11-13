// Compare the actual JavaScript reader with independent Python reconstruction.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { composeSharedPoints } from '../web/shared-points.mjs';

const verification = JSON.parse(fs.readFileSync(process.argv[2]));
const scene = verification.scene;
const index = JSON.parse(fs.readFileSync(path.join(scene, 'index.json')));
function array(ref, Type) {
  const data = fs.readFileSync(path.join(scene, ref.uri));
  return new Type(data.buffer, data.byteOffset, data.byteLength / Type.BYTES_PER_ELEMENT);
}
const sa = index.static_agg;
const staticPart = { xyz: array(sa.xyz_map, Float32Array), labels: array(sa.labels, Uint8Array),
  lidar: array(sa.lidar_id, Uint8Array) };
for (const [ts, expected] of Object.entries(verification.sample_points_sha256)) {
  const meta = JSON.parse(fs.readFileSync(path.join(scene, 'frames', ts, 'meta.json')));
  const p = meta.assets.points;
  const dynamic = { xyz: array(p.xyz, Float32Array), labels: array(p.labels, Uint8Array),
    lidar: array(p.lidar_id, Uint8Array) };
  const result = composeSharedPoints(staticPart, dynamic, p);
  let maxCoordinateError = 0, differingCoordinates = 0;
  for (const key of ['xyz', 'labels', 'lidar']) {
    const bytes = Buffer.from(result[key].buffer, result[key].byteOffset, result[key].byteLength);
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    if (key === 'xyz' && process.argv[3]) {
      const raw = fs.readFileSync(path.join(process.argv[3], ts + '.xyz.f32.bin'));
      assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), expected[key]);
      const reference = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
      assert.equal(reference.length, result.xyz.length);
      for (let i = 0; i < reference.length; i++) {
        const delta = Math.abs(reference[i] - result.xyz[i]);
        if (delta) differingCoordinates++;
        maxCoordinateError = Math.max(delta, maxCoordinateError);
      }
      // JS and BLAS can differ in fused float64 multiply/add rounding. This
      // tolerance is 1 micrometre, 250000x smaller than an OCC voxel. Every
      // label, lidar id, point index and count must still match exactly.
      assert.ok(maxCoordinateError <= 1e-6, `Coordinate error ${maxCoordinateError}`);
    } else {
      assert.equal(digest, expected[key], `${ts}/${key}`);
    }
  }
  console.log(JSON.stringify({ timestamp: ts, reconstructed_points: result.n, labels_lidar_order_exact: true,
    max_coordinate_error_m: maxCoordinateError, differing_coordinates: differingCoordinates }));
}
