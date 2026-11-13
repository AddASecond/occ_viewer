"""Headless compatibility test of the deployed-style app in both point modes."""
import argparse
import json
from pathlib import Path
import struct
from urllib.parse import urlparse
from urllib.request import urlopen

from playwright.sync_api import sync_playwright, Error as PlaywrightError

ROOT = Path(__file__).resolve().parents[1]
REMOTE = 'http://127.0.0.1:19000/robotruck-perception-data/occ-viewer/web/'


def packed(values, kind='f'):
    return struct.pack('<' + kind * len(values), *values)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--render-checks', action='store_true')
    ap.add_argument('--baseline', action='store_true')
    args = ap.parse_args()
    cache = {}
    errors = []
    requests = []
    sensor_xyz = [-1,5,0, 2,7,0]
    aggregate_xyz = [2,5,0,3,6,0,1,6,1]
    resources = {'static/xyz.bin': packed([0,5,0, 1,6,0, 9,9,0]), 'static/labels.bin': bytes([13,17,13]),
                 'static/lidar.bin': bytes([1,2,1]), 'dynamic/xyz.bin': packed([1,6,1]),
                 'dynamic/labels.bin': bytes([0]), 'dynamic/lidar.bin': bytes([2]),
                 'full/xyz.bin': packed([2,5,0, 3,6,0, 1,6,1]), 'full/labels.bin': bytes([13,17,0]),
                 'full/lidar.bin': bytes([1,2,2]), 'sensor/xyz.bin': packed(sensor_xyz),
                 'sensor/labels.bin': bytes([17,13]), 'sensor/lidar.bin': bytes([1,2]),
                 'occ/ijk.bin': packed([0,0,0], 'i'), 'occ/labels.bin': bytes([13])}
    mode = {'shared': True, 'sensor': True, 'hold': False, 'restored_aggregate': False}
    pending = []
    points = {'layout': 'clip_static_plus_frame_dynamic/v1', 'static_ref': 'index.json#static_agg',
              'ordering': 'static_then_dynamic', 'point_downsampling': False, 'static_roi_inclusive': True,
              'static_n': 2, 'n': 1, 'logical_n': 3,
              'T_vehicle_map': [1,0,0,2,0,1,0,0,0,0,1,0,0,0,0,1],
              'static_roi': {'x': [2,3], 'y': [-10,10], 'z': [-1,1]}}

    def group(prefix, n):
        return {'n': n, **{k: {'uri': f'/scene/{prefix}/{name}.bin'} for k, name in
                          [('xyz', 'xyz'), ('labels', 'labels'), ('lidar_id', 'lidar')]}}

    def route_request(route):
        path = urlparse(route.request.url).path.lstrip('/')
        requests.append(path)
        if path == 'api/config' or path == 'format.json':
            route.fulfill(json={})
        elif path == 'scene/index.json':
            static = group('static', 3)
            static['xyz_map'] = static.pop('xyz')
            route.fulfill(json={'schema_version': 'robotruck_occ_scene/v1', 'clip_id': 'test',
                'taxonomy': {'coarse': {'names': ['dynamic', 'static'], 'fine_to_coarse': [0] + [1] * 21,
                                        'colors_rgb': [[255,0,0], [0,0,255]]}},
                'static_agg': static, 'frames': [{'timestamp': str(i), 'meta_uri': f'frames/{i}/meta.json'} for i in [1,2]]})
        elif path in ('scene/frames/1/meta.json', 'scene/frames/2/meta.json'):
            cloud = {**group('dynamic', 1), **points} if mode['shared'] else group('full', 3)
            timestamp = path.split('/')[-2]
            sensor = group('sensor', 2)
            if timestamp == '2':
                sensor['xyz']['uri'] = '/scene/sensor/second.bin'
            route.fulfill(json={'timestamp': timestamp, 'grid': {'voxel': .25, 'x_range': [-2,2], 'y_range': [-10,10],
                'z_range': [-5,5], 'shape': [16,80,40], 'origin': [-2,-10,-5]}, 'stats': {'n_occ': 1},
                'assets': {'points': cloud, 'frame_sensor_points': sensor if mode['sensor'] else None, 'cameras': [],
                           'occupancy': {'ijk': {'uri': 'occ/ijk.bin'}, 'labels': {'uri': 'occ/labels.bin'}}},
                'ego_pose': {'position': {'x': -2, 'y': 0, 'z': 0}, 'orientation': {'x': 0, 'y': 0, 'z': 0, 'w': 1}}})
        elif path.startswith('scene/') and path[6:] in resources:
            if mode['hold'] and path.startswith(('scene/full/', 'scene/static/', 'scene/dynamic/')):
                pending.append((route, path))
                return
            route.fulfill(body=resources[path[6:]], content_type='application/octet-stream')
        elif path in ('index.html', 'shared-points.mjs', 'asset-loader.v3.mjs', 'semantic-nine.v6.mjs', 'camera.js') or path.startswith('app.'):
            is_app = path.startswith('app.')
            local = ROOT / 'web' / ('app.js' if is_app else path)
            data = local.read_text()
            if path == 'index.html' and mode['restored_aggregate']:
                # Simulate a browser restoring old form selections before the
                # module executes. Startup must reset both point consumers.
                data = data.replace('<script type="importmap">', '''<script>
                  document.querySelector('#ptSource').value='clip_agg';
                  document.querySelector('#projPointSource').value='aggregate';
                </script><script type="importmap">''')
            if is_app:
                data += '\nwindow.__occTest = () => ({points: Array.from(ptXYZ || []), n: ptLabels?.length, finished: loadFinished, states: [...loadStates.values()]});'
                data += (ROOT / 'tests/render-hooks.js').read_text()
            route.fulfill(body=data, content_type='text/html' if path.endswith('.html') else 'text/javascript')
        else:
            if path not in cache:
                with urlopen(REMOTE + path, timeout=30) as response:
                    cache[path] = response.read()
            route.fulfill(body=cache[path], content_type='text/javascript' if path.endswith('.js') else 'application/octet-stream')

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        page.on('pageerror', lambda error: errors.append(str(error)))
        cancelled = []
        page.on('requestfailed', lambda request: cancelled.append(request.url))
        page.route('http://occ-test.local/**', route_request)
        for shared in (True, False):
            mode['shared'] = shared
            requests.clear()
            page.goto('http://occ-test.local/index.html?source=external&scene=/scene')
            page.wait_for_function('window.__occTest && window.__occTest().finished && window.__occTest().n === 2')
            def agg_requests():
                return [p for p in requests if p.startswith(('scene/full/', 'scene/static/', 'scene/dynamic/'))]
            assert not agg_requests(), requests
            assert page.evaluate('window.__occTest().points') == sensor_xyz
            source = page.evaluate('window.__renderTest.sources()')
            assert source['xyz'] == sensor_xyz and source['canvases'] == [2,2], source
            assert source['aggregate'] == 0, source
            assert page.locator('#viewerBuild').inner_text() == 'Viewer v6 · 9 类配色'
            assert page.locator('#projPointSource').input_value() == 'follow'
            assert page.locator('#pointSourceStatus').get_attribute('data-aggregate-requested-by') == ''
            # The default camera source follows the main switch in both
            # directions; no hidden aggregate consumer survives Current frame.
            page.locator('#ptSource').select_option('clip_agg')
            page.wait_for_function('window.__occTest().finished && window.__occTest().n === 3')
            assert page.evaluate('window.__renderTest.sources().xyz') == aggregate_xyz
            page.locator('#ptSource').select_option('vehicle')
            page.wait_for_function('window.__occTest().finished && window.__occTest().n === 2')
            assert page.evaluate('window.__renderTest.sources().xyz') == sensor_xyz
            assert page.locator('#pointSourceStatus').get_attribute('data-aggregate-requested-by') == ''
            # Explicit independent mode is still supported and clearly marked.
            page.locator('#projPointSource').select_option('frame')
            print(json.dumps({'shared': shared, 'initial_aggregate_requests': 0, 'current_points': 2}), flush=True)
            options = page.locator('#ptSource option').evaluate_all('(nodes) => nodes.map(n => n.value)')
            for option in options:
                page.evaluate('window.__renderTest.pose()')
                before = page.evaluate('window.__renderTest.state()')
                page.locator('#ptSource').select_option(option)
                page.wait_for_function('window.__occTest().finished')
                result = page.evaluate('window.__occTest()')
                assert result['points'] == (aggregate_xyz if option == 'clip_agg' else sensor_xyz), result
                source = page.evaluate('window.__renderTest.sources()')
                assert source['xyz'] == sensor_xyz and source['canvases'] == [2,2], source
                assert not any('失败' in state for state in result['states']), result
                if args.render_checks:
                    after = page.evaluate('window.__renderTest.state()')
                    stayed = all(after[k] == before[k] for k in ('camera', 'target', 'timestamp'))
                    print(json.dumps({'shared': shared, 'mode': option, 'camera_preserved': stayed}), flush=True)
                    if not args.baseline:
                        assert stayed, (before, after)
                print(json.dumps({'shared': shared, 'point_mode': option, 'point_count': result['n'], 'passed': True}), flush=True)
            expected_requests = 6 if shared else 3
            assert len(agg_requests()) == expected_requests, requests
            if not shared:
                assert not any(p.startswith('scene/static/') for p in requests), requests
            # Changing the projection source reuses the cached FULL aggregate,
            # including the dynamic point; it never changes the left source.
            page.locator('#projPointSource').select_option('aggregate')
            page.wait_for_function('window.__occTest().finished')
            source = page.evaluate('window.__renderTest.sources()')
            assert source['xyz'] == aggregate_xyz and source['canvases'] == [3,3], source
            assert any(p[2] == 0 for p in source['uv']), source  # dynamic class projects too
            assert len(agg_requests()) == expected_requests, requests
            page.locator('#ptSource').select_option('vehicle')
            page.wait_for_function('window.__occTest().finished')
            assert page.evaluate('window.__occTest().points') == sensor_xyz
            assert page.evaluate('window.__renderTest.sources().xyz') == aggregate_xyz
            assert '右侧相机投影' in page.locator('#pointSourceStatus').inner_text()
            page.locator('#btnCurrentOnly').click()
            page.wait_for_function('window.__occTest().finished && window.__occTest().n === 2')
            assert page.locator('#projPointSource').input_value() == 'follow'
            assert page.evaluate('window.__renderTest.sources().xyz') == sensor_xyz
            assert len(agg_requests()) == expected_requests, requests
            print(json.dumps({'shared': shared, 'independent_projection': True, 'aggregate_includes_dynamic': True,
                              'aggregate_asset_requests': expected_requests, 'cache_reused': True}), flush=True)
            if args.render_checks:
                state = page.evaluate('window.__renderTest.state()')
                depth = page.evaluate('window.__renderTest.depthPixels()')
                coverage = page.evaluate('window.__renderTest.latticeCoverage()')
                counts = page.evaluate('window.__renderTest.projectionCounts()')
                wrap = page.locator('#canvas-wrap').bounding_box()
                x, y = wrap['x'] + wrap['width'] / 2, wrap['y'] + wrap['height'] / 2
                page.mouse.move(x, y)
                page.mouse.down()
                page.mouse.move(x + 50, y + 20, steps=3)
                page.mouse.up()
                stopped = page.evaluate('window.__renderTest.state()')
                page.evaluate('window.__renderTest.settle()')
                settled = page.evaluate('window.__renderTest.state()')
                still = stopped['camera'] == settled['camera']
                print(json.dumps({'shared': shared, 'render': state, 'depth_pixels': depth,
                                  'lattice_coverage': coverage, 'projection_counts': counts, 'no_drag_drift': still}), flush=True)
                if not args.baseline:
                    assert state['style'] == 'cubes' and state['cubeSize'] == .25, state
                    assert state['depthWrite'] is True, state
                    assert depth[0][:3] == [0,0,255] and depth[1][:3] == [255,0,0], depth
                    assert coverage == [1,1], coverage
                    assert counts == {'points': [200001,200001], 'occ': [80001,80001]}, counts
                    assert still, (stopped, settled)

            # Fresh page: selecting aggregate only for camera projection loads
            # the correct cloud without changing or reloading the 3D sensor view.
            requests.clear()
            mode['restored_aggregate'] = True
            page.reload()
            page.wait_for_function('window.__occTest().finished && window.__occTest().n === 2')
            assert not agg_requests(), requests
            assert page.locator('#projPointSource').input_value() == 'follow'
            mode['restored_aggregate'] = False
            page.locator('#projMode').select_option('none')
            assert page.locator('#projPointSource').is_disabled()
            page.evaluate("document.querySelector('#projPointSource').value='aggregate'")
            page.locator('#projMode').select_option('occ')
            assert not agg_requests(), requests  # OCC is not a point aggregate.
            page.locator('#projMode').select_option('points')
            page.wait_for_function('window.__occTest().finished && window.__renderTest.sources().aggregate === 3')
            assert page.evaluate('window.__occTest().points') == sensor_xyz
            assert page.evaluate('window.__renderTest.sources().xyz') == aggregate_xyz
            assert len(agg_requests()) == expected_requests, requests
            page.locator('#projPointSource').select_option('frame')
            # Frame change invalidates both transformed aggregate and projection
            # caches; the next default frame cannot trigger aggregate requests.
            resources['sensor/second.bin'] = packed([10,5,0, 12,7,0])
            requests.clear()
            page.locator('#btnNextFrame').click()
            page.wait_for_function("window.__renderTest.state().finished && window.__renderTest.state().timestamp === '2'")
            assert page.evaluate('window.__occTest().points') == [10,5,0,12,7,0]
            assert page.evaluate('window.__renderTest.sources().xyz') == [10,5,0,12,7,0]
            assert page.evaluate('window.__renderTest.sources().aggregate') == 0
            assert not agg_requests(), requests

            # Cancel a slow aggregate request when neither selector needs it.
            mode['hold'] = True
            pending.clear()
            requests.clear()
            cancelled.clear()
            page.locator('#ptSource').select_option('clip_agg')
            page.wait_for_function('!window.__occTest().finished')
            page.wait_for_timeout(150)
            assert pending, requests
            page.locator('#ptSource').select_option('vehicle')
            page.wait_for_function('window.__occTest().finished && window.__occTest().n === 2')
            page.wait_for_timeout(150)
            assert cancelled, requests
            assert page.evaluate('window.__occTest().points') == [10,5,0,12,7,0]
            for held, path in pending:
                try:
                    held.fulfill(body=resources[path[6:]], content_type='application/octet-stream')
                except PlaywrightError:
                    pass  # Browser has already cancelled the obsolete request.
            pending.clear()
            mode['hold'] = False
            page.wait_for_timeout(100)
            assert page.evaluate('window.__occTest().points') == [10,5,0,12,7,0]
            assert page.evaluate('window.__renderTest.sources().aggregate') == 0
            # Re-request after cancellation succeeds; current-frame data survives.
            page.locator('#projPointSource').select_option('aggregate')
            page.wait_for_function('window.__occTest().finished && window.__renderTest.sources().aggregate === 3')
            assert page.evaluate('window.__occTest().points') == [10,5,0,12,7,0]
            page.locator('#projPointSource').select_option('frame')

            # Both consumers share one in-flight aggregate. Switching only the
            # left view back must NOT cancel the camera's still-required load.
            requests.clear()
            page.reload()
            page.wait_for_function('window.__occTest().finished && window.__occTest().n === 2')
            mode['hold'] = True
            pending.clear()
            cancelled.clear()
            page.locator('#ptSource').select_option('clip_agg')
            page.locator('#projPointSource').select_option('aggregate')
            page.wait_for_timeout(150)
            page.locator('#ptSource').select_option('vehicle')
            page.wait_for_timeout(150)
            assert pending and not cancelled, (requests, cancelled)
            assert len(agg_requests()) == expected_requests, requests
            mode['hold'] = False
            for held, path in pending:
                held.fulfill(body=resources[path[6:]], content_type='application/octet-stream')
            pending.clear()
            page.wait_for_function('window.__occTest().finished && window.__renderTest.sources().aggregate === 3')
            assert page.evaluate('window.__occTest().points') == sensor_xyz
            assert page.evaluate('window.__renderTest.sources().xyz') == aggregate_xyz
            assert len(agg_requests()) == expected_requests, requests
            page.locator('#projPointSource').select_option('frame')

            # One-click single-frame mode cancels a hidden, independent camera
            # aggregate request as well as the default follow-mode request.
            requests.clear()
            page.reload()
            page.wait_for_function('window.__occTest().finished && window.__occTest().n === 2')
            mode['hold'] = True
            pending.clear()
            cancelled.clear()
            page.locator('#projPointSource').select_option('aggregate')
            page.wait_for_timeout(150)
            assert pending and '右侧相机投影' in page.locator('#pointSourceStatus').inner_text()
            page.locator('#btnCurrentOnly').click()
            page.wait_for_function('window.__occTest().finished && window.__occTest().n === 2')
            page.wait_for_timeout(150)
            assert cancelled
            assert page.locator('#projPointSource').input_value() == 'follow'
            assert page.locator('#pointSourceStatus').get_attribute('data-aggregate-requested-by') == ''
            mode['hold'] = False
            for held, path in pending:
                try:
                    held.fulfill(body=resources[path[6:]], content_type='application/octet-stream')
                except PlaywrightError:
                    pass
            pending.clear()
            page.wait_for_timeout(100)
            assert page.evaluate('window.__renderTest.sources().aggregate') == 0
            assert page.evaluate('window.__renderTest.sources().xyz') == sensor_xyz

            # Missing sensor assets must be reported, not silently replaced by
            # the full aggregate. The user can explicitly choose that instead.
            mode['sensor'] = False
            requests.clear()
            page.reload()
            page.wait_for_function('window.__occTest().finished && window.__occTest().states.some(s=>s.includes("失败"))')
            assert not agg_requests(), requests
            assert not page.evaluate('window.__occTest().n')
            assert page.evaluate('window.__renderTest.sources().selected') == 0
            page.locator('#projMode').select_option('none')
            page.locator('#ptSource').select_option('clip_agg')
            page.wait_for_function('window.__occTest().finished && window.__occTest().n === 3')
            assert page.evaluate('window.__occTest().points') == aggregate_xyz
            mode['sensor'] = True
            print(json.dumps({'shared': shared, 'projection_only_lazy_load': True, 'occ_no_aggregate_request': True,
                              'frame_cache_invalidated': True, 'cancelled_obsolete_download': True,
                              'shared_inflight_request': True, 'missing_sensor_no_fallback': True}), flush=True)
        assert not errors, errors
        browser.close()


if __name__ == '__main__':
    main()
