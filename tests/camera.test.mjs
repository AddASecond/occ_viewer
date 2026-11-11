import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createCameraProjector, selectCameraImages } from '../web/camera.js';

const fixtures = JSON.parse(readFileSync(new URL('./camera_opencv.json', import.meta.url)));
for (const fixture of fixtures) {
  test(`${fixture.name}: projection agrees with OpenCV, including off-axis rays`, () => {
    const camera = { ...fixture.camera, T_c_v: Array(16).fill(100000) };
    const project = createCameraProjector(camera);
    fixture.points.forEach((point, i) => {
      const out = {};
      assert.equal(project(...point, out), true);
      assert.ok(Math.abs(out.u - fixture.opencv_pixels[i][0]) < 1e-8);
      assert.ok(Math.abs(out.v - fixture.opencv_pixels[i][1]) < 1e-8);
    });
  });
}
test('image switching keeps the complete matching calibration and marks unavailable variants', () => {
  const raw = { name: 'camera1_raw', image: { uri: 'raw.jpg' }, ...fixtures[0].camera };
  const und = { name: 'camera1_undistort', image: { uri: 'und.jpg' }, ...fixtures[1].camera };
  const virtual = { ...und, name: 'camera10_undistort' };
  for (const [variant, expected] of [['raw', raw], ['undistort', und]]) {
    const result = selectCameraImages([und, raw, virtual], variant);
    assert.equal(result.length, 2);
    assert.equal(result[0].image.uri, expected.image.uri);
    assert.deepEqual(result[0].K, expected.K);
    assert.deepEqual(result[0].distortion, expected.distortion);
    assert.equal(result[1].variantUnavailable, variant === 'raw');
  }
});
test('invalid/behind-camera rays are excluded and legacy dist5 remains supported', () => {
  const { distortion, ...camera } = fixtures[2].camera;
  const project = createCameraProjector({ ...camera, dist5: distortion });
  assert.equal(project(0, -1, 0, {}), false);
  assert.equal(project(NaN, 10, 0, {}), false);
  const out = {};
  assert.equal(project(...fixtures[2].points[1], out), true);
  assert.ok(Math.abs(out.u - fixtures[2].opencv_pixels[1][0]) < 1e-8);
});
