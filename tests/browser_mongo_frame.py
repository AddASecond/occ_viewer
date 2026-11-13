"""Read-only test of a real Mongo frame, streaming unchanged S3 assets locally.

This does NOT test the production GSS/Tailscale HTTP path. It tests the exact
Viewer bundle, real metadata/binaries, and optionally a deliberate disconnect.
"""
import argparse
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import socket
from threading import Lock, Thread
import time
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
from pymongo import MongoClient

ROOT = Path(__file__).resolve().parents[1]
GATEWAY = 'http://127.0.0.1:19000/robotruck-perception-data/'


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--clip', required=True)
    ap.add_argument('--timestamp', required=True)
    ap.add_argument('--output', type=Path, required=True)
    ap.add_argument('--disconnect-once', action='store_true')
    ap.add_argument('--check-aggregate', action='store_true')
    ap.add_argument('--gss-entry', action='store_true', help='Exercise real gss.js boot with a local read-API fixture')
    ap.add_argument('--published-web', action='store_true', help='Read the published versioned HTML/JS and verify exact local bytes')
    args = ap.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    with MongoClient('mongodb://100.89.182.77:27017', serverSelectionTimeoutMS=10000) as mongo:
        db = mongo.perception_experiment
        clip = db.main_occ_clips.find_one({'clip_id': args.clip})
        assert clip
        frame = db.main_occ_frames.find_one({'clip_id': args.clip,
            'model.version': clip['model']['version'],
            'timestamp': {'$in': [args.timestamp, int(args.timestamp)]}})
        assert frame
    assets = {}

    def rewrite(value):
        if isinstance(value, list):
            return [rewrite(item) for item in value]
        if not isinstance(value, dict):
            return value
        out = {key: rewrite(item) for key, item in value.items()}
        if value.get('storage') == 's3' and value.get('key'):
            assert value['bucket'] == 'robotruck-perception-data'
            assets[value['key']] = value
            out['uri'] = '/asset/' + value['key']
        return out

    index = rewrite({k: clip[k] for k in ('clip_id', 'taxonomy', 'defaults', 'static_agg',
                                        'point_aggregate', 'static_agg_variants') if k in clip})
    index['frames'] = [{'timestamp': args.timestamp, 'meta_uri': '/frame.json', 'n_occ': frame['stats']['n_occ']}]
    meta = rewrite({k: frame[k] for k in ('grid', 'assets', 'stats', 'ego_pose', 'od_boxes', 'taxonomy') if k in frame})
    meta['timestamp'] = args.timestamp
    entry_name = 'index.occ-rt7-v8.html'
    dataset_url = '/db/perception_experiment/main_occ_clips/occ/scenes'
    point_key = frame['assets']['points']['xyz']['key']
    requests, lock = [], Lock()
    state = {'dropped': False}

    @lru_cache(maxsize=32)
    def web_asset(path):
        with urlopen(GATEWAY + 'occ-viewer/web/' + path, timeout=30) as response:
            return response.read()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *values):
            pass

        def do_GET(self):
            uri = urlparse(self.path).path
            if uri.startswith('/asset/'):
                key = uri[len('/asset/'):]
                if key not in assets:
                    self.send_error(404)
                    return
                headers = {k: self.headers[k] for k in ('Range', 'If-Range') if k in self.headers}
                with lock:
                    drop = args.disconnect_once and key == point_key and not state['dropped']
                    if drop:
                        state['dropped'] = True
                entry = {'key': key, 'range': headers.get('Range'), 'bytes': 0, 'disconnect': drop}
                with lock:
                    requests.append(entry)
                try:
                    with urlopen(Request(GATEWAY + key, headers=headers), timeout=90) as response:
                        entry['status'] = response.status
                        self.send_response(response.status)
                        for name in ('Content-Length', 'Content-Type', 'Content-Range',
                                     'Accept-Ranges', 'ETag', 'Last-Modified'):
                            if response.headers.get(name):
                                self.send_header(name, response.headers[name])
                        self.end_headers()
                        while chunk := response.read(1024**2):
                            self.wfile.write(chunk)
                            entry['bytes'] += len(chunk)
                            if drop and entry['bytes'] >= 8 * 1024**2:
                                self.wfile.flush()
                                self.close_connection = True
                                self.connection.shutdown(socket.SHUT_RDWR)
                                return
                except (BrokenPipeError, ConnectionResetError):
                    return
                return
            if uri == '/api/occ/datasets':
                data, kind = json.dumps({'datasets': [{'database': 'perception_experiment',
                    'collection': 'main_occ_clips', 'url': dataset_url}]}).encode(), 'application/json'
            elif uri == dataset_url:
                data, kind = json.dumps({'clips': [{'id': args.clip, 'clip_id': args.clip,
                    'n_frames': 1, 'url': '/scene'}], 'total': 1, 'next_offset': None}).encode(), 'application/json'
            elif uri == '/scene/index.json':
                data, kind = json.dumps(index).encode(), 'application/json'
            elif uri == '/frame.json':
                data, kind = json.dumps(meta).encode(), 'application/json'
            elif uri.startswith(('/viewer/', '/occ-viewer/')):
                path = uri.split('/', 2)[2]
                if '..' in Path(path).parts:
                    self.send_error(400)
                    return
                if path.startswith('app.') and path.endswith('.js'):
                    base = (ROOT / 'web/app.js').read_bytes()
                    if args.published_web:
                        data = web_asset(path)
                        assert data == base, 'Published app does not match tested source'
                    else:
                        data = base
                    data += (ROOT / 'tests/render-hooks.js').read_bytes()
                    data += b'''\nwindow.__downloadVerify=async()=>{
                      const sha=async array=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',array)),
                        x=>x.toString(16).padStart(2,'0')).join('');
                      return {xyz:await sha(ptXYZ),labels:await sha(ptLabels),lidar_id:await sha(ptLidar)};
                    };'''
                elif path == entry_name:
                    data = web_asset(path) if args.published_web else (ROOT / 'web/index.html').read_bytes()
                    assert data == (ROOT / 'web/index.html').read_bytes(), 'Published entry does not match tested source'
                elif (ROOT / 'web' / path).is_file():
                    data = (ROOT / 'web' / path).read_bytes()
                    if args.published_web and path in ('semantic-nine.v6.mjs', 'shared-points.mjs', 'asset-loader.v3.mjs', 'occ-rt7.v7.mjs'):
                        published = web_asset(path)
                        assert published == data, f'Published helper differs: {path}'
                        data = published
                else:
                    data = web_asset(path)
                kind = 'text/html' if path.endswith('.html') else 'text/javascript'
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', kind)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    started, errors = time.monotonic(), []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        page.set_default_timeout(120000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        route = f'/occ-viewer/{entry_name}?source=gss&dataset={dataset_url}&search={args.clip}' if args.gss_entry else '/viewer/index.html?source=external&scene=/scene'
        page.goto(f'http://127.0.0.1:{server.server_port}{route}', wait_until='domcontentloaded')
        for _ in range(90):
            try:
                page.wait_for_function('window.__renderTest && window.__renderTest.state().finished && window.__renderTest.state().states.length', timeout=10000)
                break
            except PlaywrightTimeout:
                print(f'{time.monotonic()-started:.1f}s: ' + page.locator('#loadProgress').inner_text(), flush=True)
        result = page.evaluate('window.__renderTest.state()')
        assert page.locator('body').get_attribute('data-viewer-build') == 'occ-rt7-v8'
        assert page.locator('#projPointSource').input_value() == 'follow'
        assert page.locator('#pointSourceStatus').get_attribute('data-aggregate-requested-by') == ''
        if args.gss_entry:
            assert page.locator('#datasetForm').is_visible()
            assert page.locator('#dataset').input_value() == dataset_url
        assert result['finished'] and not any('失败' in s for s in result['states']), result
        sensor = frame['assets']['frame_sensor_points']
        assert result['points'] == result['renderedPoints'] == sensor['n'], result
        assert result['projectionPoints'] == sensor['n'] and result['aggregatePoints'] == 0, result
        assert result['occ'] == frame['assets']['occupancy']['n'], result
        native_semantic = None
        if frame['assets']['occupancy'].get('label_encoding') == 'rt7-v1':
            assert page.locator('#colorMode').input_value() == 'rt7'
            assert page.locator('#classLegend .legend-item').count() == 7
            semantic = page.evaluate('window.__renderTest.semanticSummary()')
            assert len(semantic['occ']) == 7 and sum(semantic['occ'].values()) == result['occ']
            native_semantic = semantic
        assert not errors, errors
        digest = page.evaluate('window.__downloadVerify()')
        assert digest == {k: sensor[k]['sha256'] for k in digest}, digest
        aggregate_keys = {v['key'] for v in frame['assets']['points'].values() if isinstance(v,dict) and 'key' in v}
        aggregate_keys.update(v['key'] for v in clip.get('static_agg',{}).values() if isinstance(v,dict) and 'key' in v)
        assert not any(r['key'] in aggregate_keys for r in requests), requests
        initial = {'render': dict(result), 'sha256': digest, 'seconds': time.monotonic()-started,
                   'aggregate_requests': 0,
                   'sensor_bytes': sum(r['bytes'] for r in requests if r['key'] in {sensor[k]['key'] for k in digest})}
        print(json.dumps({'initial': initial}), flush=True)
        before_geometry = page.evaluate('window.__renderTest.geometry()')
        before_requests = len(requests)
        page.locator('#colorMode').select_option('semantic9')
        assert page.locator('#classLegend .legend-item').count() == 9
        assert page.locator('[data-group="semantic9"] input').count() == 9
        assert page.evaluate('window.__renderTest.geometry()') == before_geometry
        assert len(requests) == before_requests, requests[before_requests:]
        semantic = page.evaluate('window.__renderTest.semanticSummary()')
        assert sum(semantic['points'].values()) == sensor['n']
        assert sum(semantic['occ'].values()) == result['occ']
        assert semantic['points']['Fence'] == semantic['occ']['Fence'] == 0
        assert '未区分 Fence' in page.locator('#semanticModeHint').inner_text()
        if native_semantic is not None:
            for name, count in native_semantic['occ'].items():
                assert semantic['occ'][name] == count, (name, semantic, native_semantic)
            assert semantic['occ']['Noise'] == 0
        print(json.dumps({'semantic9':semantic, 'color_switch_downloads':0, 'geometry_unchanged':True}), flush=True)
        if native_semantic is not None:
            page.locator('#colorMode').select_option('rt7')
            assert page.evaluate('window.__renderTest.semanticSummary()') == native_semantic
            assert page.evaluate('window.__renderTest.geometry()') == before_geometry
            assert len(requests) == before_requests
        page.screenshot(path=str(args.output / 'frame.png'), timeout=60000)
        aggregate_checks = None
        if args.check_aggregate:
            before = page.evaluate('window.__renderTest.state()')
            # Explicitly pin the independent projection for this regression;
            # default follow-mode is covered by the compatibility test.
            page.locator('#projPointSource').select_option('frame')
            page.locator('#ptSource').select_option('clip_agg')
            page.wait_for_function('window.__renderTest.state().finished && window.__renderTest.state().aggregatePoints > 0', timeout=600000)
            aggregate_result = page.evaluate('window.__renderTest.state()')
            expected_n = frame['assets']['points'].get('logical_n', frame['assets']['points']['n'])
            assert aggregate_result['points'] == aggregate_result['renderedPoints'] == expected_n, aggregate_result
            assert aggregate_result['projectionPoints'] == sensor['n'], aggregate_result
            assert all(aggregate_result[k] == before[k] for k in ('camera','target','timestamp'))
            if not frame['assets']['points'].get('layout'):
                agg_digest = page.evaluate('window.__downloadVerify()')
                assert agg_digest == {k: frame['assets']['points'][k]['sha256'] for k in agg_digest}, agg_digest
            else:
                agg_digest = None  # Shared composition has its independent real-scene regression.
            n_requests = len(requests)
            page.locator('#ptSource').select_option('vehicle')
            page.wait_for_function(f'window.__renderTest.state().points === {sensor["n"]}')
            # Aggregate camera projection is separately selected, with no new download.
            page.locator('#projPointSource').select_option('aggregate')
            page.wait_for_function(f'window.__renderTest.state().projectionPoints === {expected_n}')
            assert page.evaluate('window.__renderTest.state().points') == sensor['n']
            assert len(requests) == n_requests, requests
            page.screenshot(path=str(args.output / 'aggregate-projection.png'), timeout=180000)
            page.locator('#projPointSource').select_option('frame')
            assert page.evaluate('window.__renderTest.state().projectionPoints') == sensor['n']
            assert len(requests) == n_requests, requests
            aggregate_checks = {'render': aggregate_result, 'sha256': agg_digest, 'projection_independent': True,
                                'switches_reused_cache': True}
        if args.disconnect_once and args.check_aggregate:
            assert state['dropped'] and any(r['key'] == point_key and r['range'] and r['status'] == 206 for r in requests)
        result.update(clip=args.clip, verified=True, sha256=digest, seconds=time.monotonic()-started,
                      native_rt7=native_semantic,
                      build=page.locator('body').get_attribute('data-viewer-build'),
                      published_web=args.published_web, gss_entry_local_fixture=args.gss_entry,
                      initial=initial, aggregate_checks=aggregate_checks, requests=requests,
                      semantic9=semantic,
                      production_gss_http_verified=False, injected_disconnect=state['dropped'])
        (args.output / 'verification.json').write_text(json.dumps(result, indent=2))
        print(json.dumps({k: v for k, v in result.items() if k != 'requests'}), flush=True)
        browser.close()
    server.shutdown()


if __name__ == '__main__':
    main()
