"""Exercise nine-class coloring/filtering on real browser rendering paths."""
import json
import re
from urllib.parse import urlparse
from urllib.request import urlopen

from playwright.sync_api import sync_playwright
from browser_shared_static import packed, ROOT, REMOTE


def main():
    taxonomy = json.loads((ROOT / 'tests/semantic-nine-fixture.json').read_text())
    mode = {'name': 'waymo'}
    requests, errors, cache = [], [], {}
    order = ['Drivable', 'undrivable', 'Movable', 'Curb', 'Fence', 'Vegetation', 'Building', 'Unmovable', 'Noise']
    expected = ['Movable'] * 7 + ['Unmovable'] * 4 + ['Movable'] * 2 + [
        'Building', 'Vegetation', 'Vegetation', 'Curb', 'Drivable', 'Drivable',
        'undrivable', 'undrivable', 'undrivable']

    def labels():
        if mode['name'] == 'raw':
            return [0,1,2,3,4,255]
        if mode['name'] == 'low':
            return [0,1,2]
        return list(range(23 if mode['name'] == 'fence' else 22)) + [254,255]

    def route_request(route):
        path = urlparse(route.request.url).path.lstrip('/')
        requests.append(path)
        labs = labels()
        if path in ('api/config', 'format.json'):
            route.fulfill(json={'taxonomy': taxonomy, 'ui': {'default_color_mode': 'coarse5'}})
        elif path == 'scene/index.json':
            fine = dict(taxonomy['fine'])
            if mode['name'] == 'fence':
                fine = {'n':23, 'names':fine['names'] + ['Fence']}
            route.fulfill(json={'clip_id':'test', 'taxonomy':{'fine':fine},
                'frames':[{'timestamp':'1', 'meta_uri':'frames/1/meta.json'}]})
        elif path == 'scene/frames/1/meta.json':
            def cloud(prefix, n):
                return {'n':n, **{key:{'uri':f'/scene/data/{prefix}/{key}.bin'} for key in ['xyz','labels','lidar_id']}}
            route.fulfill(json={'timestamp':'1', **({'label_encoding':'raw'} if mode['name'] == 'raw' else {}),
                'grid':{'voxel':.25, 'x_range':[-16,16], 'y_range':[20,40], 'z_range':[-.125,2.125], 'shape':[128,80,9]},
                'stats':{'n_occ':len(labs)}, 'assets':{'points':cloud('aggregate',len(labs)*2),
                'frame_sensor_points':cloud('sensor',len(labs)), 'cameras':[],
                'occupancy':{key:{'uri':f'data/occ/{key}.bin'} for key in ['ijk','labels']}}})
        elif path.startswith('scene/data/'):
            prefix, field = path.split('/')[-2:]
            source = labs * (2 if prefix == 'aggregate' else 1)
            if field == 'xyz.bin':
                data = packed([v for i in range(len(source)) for v in [-11 + i % len(labs),20,0]])
            elif field == 'ijk.bin':
                data = packed([v for i in range(len(labs)) for v in [20+i*4,0,0]], 'i')
            else:
                data = bytes(source if field == 'labels.bin' else [1]*len(source))
            route.fulfill(body=data, content_type='application/octet-stream')
        elif path.startswith('app.'):
            data = (ROOT / 'web/app.js').read_text() + (ROOT / 'tests/render-hooks.js').read_text() + (ROOT / 'tests/semantic-hooks.js').read_text()
            route.fulfill(body=data, content_type='text/javascript')
        elif (ROOT / 'web' / path).is_file():
            route.fulfill(body=(ROOT / 'web' / path).read_bytes(),
                content_type='text/html' if path.endswith('.html') else 'text/javascript')
        else:
            if path not in cache:
                with urlopen(REMOTE + path, timeout=30) as response:
                    cache[path] = response.read()
            route.fulfill(body=cache[path], content_type='text/javascript')

    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        page = browser.new_page(viewport={'width':1440,'height':1000})
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('http://nine-test.local/**', route_request)
        page.goto('http://nine-test.local/index.html?source=external&scene=/scene')
        page.wait_for_function('window.__nineTest && window.__renderTest.state().finished')
        assert page.locator('#colorMode').input_value() == 'coarse5'
        page.locator('#togRoiClip').uncheck()
        for scenario in ['waymo','fence','waymo','raw','low']:
            mode['name'] = scenario
            page.evaluate('window.__nineTest.reload()')
            page.wait_for_function('window.__renderTest.state().finished')
            page.locator('#ptSource').select_option('vehicle')
            page.locator('#projPointSource').select_option('follow')
            before = page.evaluate('window.__renderTest.geometry()')
            pose = page.evaluate('window.__renderTest.state()')
            count = len(requests)
            page.locator('#colorMode').select_option('semantic9')
            assert len(requests) == count, requests[count:]
            assert page.evaluate('window.__renderTest.geometry()') == before
            after = page.evaluate('window.__renderTest.state()')
            assert all(after[k] == pose[k] for k in ['camera','target','timestamp','points','occ'])
            assert page.locator('#classLegend .legend-item').count() == 9
            assert page.locator('[data-group="semantic9"] input').count() == 9
            data = page.evaluate('window.__nineTest.state()')
            assert data['order'] == order, data
            groups = (['Movable','Unmovable','Noise','Drivable','undrivable','Noise'] if scenario == 'raw' else
                      ['Movable']*3 if scenario == 'low' else expected + (['Fence'] if scenario == 'fence' else []) + ['Noise','Noise'])
            assert data['mapping'] == {str(lab):group for lab,group in zip(labels(),groups)}, data['mapping']
            colors = [data['colors'][group] for group in groups]
            flat = [value for color in colors for value in color]
            assert data['points'] == data['occ'] == flat, data
            css = sorted({f'rgb({r},{g},{b})' for r,g,b in colors})
            assert data['pointOverlay'] == data['occOverlay'] == css, data
            assert len(data['projected']) == len(labels()), data
            if scenario == 'waymo':
                assert '未区分 Fence' in page.locator('#semanticModeHint').inner_text()
            if scenario == 'fence':
                assert '未区分 Fence' not in page.locator('#semanticModeHint').inner_text()
            # Filtering must update points, OCC and both independent projection sources.
            hide = 'Movable' if scenario in ('raw','low') else 'Building'
            box = page.locator('[data-group="semantic9"] label').filter(has_text=re.compile(r'^\s*' + hide + r'\s*$')).locator('input')
            box.uncheck()
            hidden = page.evaluate('window.__nineTest.state()')
            wanted = [lab for lab,group in zip(labels(),groups) if group != hide]
            assert set(hidden['projected']) == set(wanted), hidden
            assert len(hidden['points']) == len(hidden['occ']) == 3*len(wanted)
            assert len(requests) == count, requests[count:]
            box.check()
            page.locator('#projPointSource').select_option('aggregate')
            page.wait_for_function('window.__renderTest.state().finished && window.__renderTest.state().aggregatePoints > 0')
            agg_count = len(requests)
            box.uncheck()
            assert set(page.evaluate('window.__nineTest.state().projected')) == set(wanted)
            box.check()
            page.locator('#ptSource').select_option('clip_agg')
            assert page.evaluate('window.__nineTest.state().points') == flat * 2
            assert len(requests) == agg_count
            page.locator('#btnCurrentOnly').click()
            print(json.dumps({'scenario':scenario, 'classes':9, 'source_labels':len(labels()),
                'colors_and_filters_match':True, 'color_switch_downloads':0, 'geometry_unchanged':True}), flush=True)
        assert not errors, errors
        browser.close()


if __name__ == '__main__':
    main()
