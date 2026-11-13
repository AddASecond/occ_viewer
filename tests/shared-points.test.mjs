import test from 'node:test';
import assert from 'node:assert/strict';
import { composeSharedPoints, hasSharedStatic, SHARED_POINT_LAYOUT } from '../web/shared-points.mjs';

const descriptor = () => ({ layout: SHARED_POINT_LAYOUT, static_ref: 'index.json#static_agg',
  ordering: 'static_then_dynamic', point_downsampling: false, static_roi_inclusive: true,
  static_n: 2, n: 1, logical_n: 3,
  T_vehicle_map: [1,0,0,2, 0,1,0,0, 0,0,1,0, 0,0,0,1],
  static_roi: { x: [2,3], y: [-10,10], z: [-1,1] } });
const staticPart = { xyz: new Float32Array([0,5,0, 1,6,0, 9,9,0]),
  labels: new Uint8Array([13,17,13]), lidar: new Uint8Array([1,2,1]) };
const dynamic = { xyz: new Float32Array([1,6,1]), labels: new Uint8Array([0]), lidar: new Uint8Array([2]) };

test('reconstructs static then dynamic, retaining inclusive ROI boundaries', () => {
  const result = composeSharedPoints(staticPart, dynamic, descriptor());
  assert.deepEqual([...result.xyz], [2,5,0, 3,6,0, 1,6,1]);
  assert.deepEqual([...result.labels], [13,17,0]);
  assert.deepEqual([...result.lidar], [1,2,2]);
  assert.equal(result.n, 3);
});
test('legacy scenes do not enable composition', () => {
  assert.equal(hasSharedStatic({ assets: { points: { n: 3 } } }), false);
  assert.equal(hasSharedStatic({ assets: { points: descriptor() } }), true);
});
test('rejects missing/mismatched assets instead of displaying sampled data', () => {
  assert.throws(() => composeSharedPoints(staticPart, dynamic, { ...descriptor(), static_n: 3, logical_n: 4 }));
  assert.throws(() => composeSharedPoints(staticPart, dynamic, { ...descriptor(), point_downsampling: true }));
  assert.throws(() => composeSharedPoints(staticPart, { ...dynamic, lidar: null }, descriptor()));
});
test('zero dynamic points and zero static ROI are valid', () => {
  const empty = { xyz: new Float32Array(), labels: new Uint8Array(), lidar: new Uint8Array() };
  assert.equal(composeSharedPoints(staticPart, empty, { ...descriptor(), n: 0, logical_n: 2 }).n, 2);
  assert.equal(composeSharedPoints(staticPart, dynamic, { ...descriptor(), static_n: 0, logical_n: 1,
    static_roi: { x: [50,51], y: [50,51], z: [50,51] } }).n, 1);
});
