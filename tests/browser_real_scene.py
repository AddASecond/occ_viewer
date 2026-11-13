"""Render a real local scene with the same deployed web bundle, no sampling."""
import argparse
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import shutil
from threading import Thread
import time
from urllib.parse import urlparse
from urllib.request import urlopen

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

ROOT = Path(__file__).resolve().parents[1]
REMOTE = 'http://127.0.0.1:19000/robotruck-perception-data/occ-viewer/web/'


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--scene', type=Path, required=True)
    ap.add_argument('--output', type=Path, required=True)
    args = ap.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    scene = args.scene.resolve()
    @lru_cache(maxsize=32)
    def remote_asset(path):
        with urlopen(REMOTE + path, timeout=30) as response:
            return response.read()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass
        def do_GET(self):
            uri = urlparse(self.path).path
            relative = Path(uri.lstrip('/'))
            if '..' in relative.parts:
                self.send_error(400)
                return
            if uri.startswith('/scene/'):
                file = scene / uri[len('/scene/'):]
                if not file.is_file():
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header('Content-Type', mimetypes.guess_type(file.name)[0] or 'application/octet-stream')
                self.send_header('Content-Length', str(file.stat().st_size))
                self.end_headers()
                with file.open('rb') as stream:
                    shutil.copyfileobj(stream, self.wfile, 1024**2)
                return
            if not uri.startswith('/viewer/'):
                self.send_error(404)
                return
            path = uri[len('/viewer/'):]
            if path.startswith('app.') and path.endswith('.js'):
                data = (ROOT / 'web/app.js').read_bytes() + b'\nwindow.__occTest=()=>({n:ptLabels?.length,occ:occLabels?.length,finished:loadFinished,states:[...loadStates.values()]});'
                data += (ROOT / 'tests/render-hooks.js').read_bytes()
            elif (ROOT / 'web' / path).is_file():
                data = (ROOT / 'web' / path).read_bytes()
            else:
                data = remote_asset(path)
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript' if path.endswith(('.js', '.mjs'))
                             else mimetypes.guess_type(path)[0] or 'application/octet-stream')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    index = json.loads((scene / 'index.json').read_text())
    first = json.loads((scene / index['frames'][0]['meta_uri']).read_text())
    started = time.monotonic()
    errors = []
    requested = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        page.set_default_timeout(120000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: requested.append(urlparse(request.url).path))
        page.goto(f'http://127.0.0.1:{server.server_port}/viewer/index.html?source=external&scene=/scene', wait_until='domcontentloaded')
        for _ in range(30):
            try:
                page.wait_for_function('window.__occTest && window.__occTest().finished && window.__occTest().states.length > 0', timeout=10000)
                break
            except PlaywrightTimeout:
                print(f'browser rendering real full-point frame: {time.monotonic()-started:.1f}s', flush=True)
        result = page.evaluate('window.__occTest()')
        assert result['finished'] and result['n'] == first['assets']['frame_sensor_points']['n'], result
        if first['assets']['occupancy'].get('label_encoding') == 'rt7-v1':
            assert page.locator('#colorMode').input_value() == 'rt7'
            assert page.locator('#classLegend .legend-item').count() == 7
            assert page.locator('#classLegend').inner_text().splitlines() == first['assets']['occupancy']['taxonomy']['names']
            semantic = page.evaluate('window.__renderTest.semanticSummary()')
            assert len(semantic['occ']) == 7 and sum(semantic['occ'].values()) == first['assets']['occupancy']['n']
        aggregate_uris = [value['uri'] for group in [first['assets']['points'], index['static_agg']]
                          for value in group.values() if isinstance(value, dict) and 'uri' in value]
        assert not any(path.endswith('/' + uri) for path in requested for uri in aggregate_uris), requested
        page.screenshot(path=str(args.output / 'current-frame.png'), timeout=60000)
        page.locator('#ptSource').select_option('clip_agg')
        page.wait_for_function(f'window.__occTest().finished && window.__occTest().n === {first["assets"]["points"]["logical_n"]}', timeout=300000)
        result = page.evaluate('window.__occTest()')
        assert result['n'] == first['assets']['points']['logical_n'], result
        assert result['occ'] == first['assets']['occupancy']['n'], result
        assert not any('失败' in state for state in result['states']) and not errors, (result, errors)
        page.screenshot(path=str(args.output / 'first-frame.png'), timeout=60000)
        # Full buffers, not a point sample: orbit must only affect the camera.
        before = page.evaluate('window.__renderTest.geometry()')
        state = page.evaluate('window.__renderTest.state()')
        assert state['points'] == state['renderedPoints'] == first['assets']['points']['logical_n'], state
        assert state['style'] == 'cubes' and state['cubeSize'] == .25 and state['depthWrite'], state
        wrap = page.locator('#canvas-wrap').bounding_box()
        x, y = wrap['x'] + wrap['width'] / 2, wrap['y'] + wrap['height'] / 2
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + 150, y + 40, steps=5)
        page.mouse.up()
        stopped = page.evaluate('window.__renderTest.state()')
        page.evaluate('window.__renderTest.settle()')
        settled = page.evaluate('window.__renderTest.state()')
        assert stopped['camera'] == settled['camera'], (stopped, settled)
        assert settled['camera'] != state['camera'], (state, settled)
        assert page.evaluate('window.__renderTest.geometry()') == before
        page.screenshot(path=str(args.output / 'first-frame-orbit.png'), timeout=60000)
        page.locator('#togOcc').check()
        page.locator('#togPts').uncheck()
        page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        page.screenshot(path=str(args.output / 'first-frame-occ.png'), timeout=60000)
        # An entire shared-mode switch must preserve the chosen view/geometry.
        page.locator('#ptSource').select_option('vehicle')
        page.wait_for_function(f'window.__occTest().n === {first["assets"]["frame_sensor_points"]["n"]}')
        page.locator('#ptSource').select_option('clip_agg')
        page.wait_for_function('window.__occTest().finished')
        switched = page.evaluate('window.__renderTest.state()')
        assert all(switched[k] == settled[k] for k in ('camera', 'target', 'timestamp'))
        # Hidden clouds intentionally do not allocate GPU geometry after a
        # source switch. The full cached XYZ and physical OCC must stay exact.
        hidden_geometry = page.evaluate('window.__renderTest.geometry()')
        assert hidden_geometry['pointPositions'] is None
        assert all(hidden_geometry[k] == before[k] for k in ('points','ijk','centers','matrices','occMatrix'))
        # Inspect physical cubes with no point overlay, from another viewpoint.
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x - 220, y + 75, steps=5)
        page.mouse.up()
        page.screenshot(path=str(args.output / 'first-frame-occ-orbit.png'), timeout=60000)
        assert page.evaluate('window.__renderTest.geometry()') == hidden_geometry
        result.update(verified=True, scene=str(scene), browser='Chromium headless/SwiftShader',
                      production_gss_http_verified=False, seconds=time.monotonic()-started,
                      orbit_geometry_unchanged=True, no_drag_drift=True, source_switch_camera_preserved=True,
                      geometry=before, render=state)
        (args.output / 'browser-verification.json').write_text(json.dumps(result, indent=2))
        print(json.dumps(result), flush=True)
        browser.close()
    server.shutdown()


if __name__ == '__main__':
    main()
