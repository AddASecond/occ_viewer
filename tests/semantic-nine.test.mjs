import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createNineClassGroup, NINE_ORDER} from '../web/semantic-nine.v6.mjs';

const fixture = JSON.parse(readFileSync(new URL('./semantic-nine-fixture.json', import.meta.url)));
const sets = obj => new Map(Object.entries(obj).map(([key, ids]) => [key, new Set(ids)]));
const base = {fineSets: sets(fixture.coarse5.fine_ids), rawSets: sets(fixture.coarse5.raw_ids),
  colors: fixture.coarse5.colors_rgb};
const group = createNineClassGroup(fixture.fine.names, base);

test('every Waymo fine ID is assigned exactly once; no fabricated Fence labels', () => {
  assert.deepEqual(group.order, NINE_ORDER);
  assert.deepEqual(group.fine_ids, {
    Drivable: [17,18], undrivable: [19,20,21], Movable: [0,1,2,3,4,5,6,11,12],
    Curb: [16], Fence: [], Vegetation: [14,15], Building: [13], Unmovable: [7,8,9,10], Noise: [],
  });
  assert.deepEqual(Object.values(group.fine_ids).flat().sort((a,b) => a-b), Array.from({length:22}, (_,i) => i));
  assert.match(group.description, /未区分 Fence/);
  assert.equal(new Set(Object.values(group.colors_rgb).map(rgb => rgb.join(','))).size, 9);
});

test('raw five-class static is Unmovable, never a made-up static subclass', () => {
  assert.deepEqual(group.raw_ids, {Drivable:[3], undrivable:[4], Movable:[0], Curb:[], Fence:[],
    Vegetation:[], Building:[], Unmovable:[1], Noise:[2]});
});

test('unchanged major classes keep previous membership and colors', () => {
  for (const [old, name] of [['drivable','Drivable'], ['non_drivable','undrivable'], ['dynamic','Movable']]) {
    assert.deepEqual(group.fine_ids[name], fixture.coarse5.fine_ids[old]);
    assert.deepEqual(group.colors_rgb[name], base.colors[old]);
  }
  const overridden = {...base, fineSets: new Map(base.fineSets)};
  overridden.fineSets.set('static', new Set([7,8,9,10,14,15,16]));
  overridden.fineSets.set('dynamic', new Set([0,1,2,3,4,5,6,11,12,13]));
  assert.ok(createNineClassGroup(fixture.fine.names, overridden).fine_ids.Movable.includes(13));
});

test('named labels, not hardcoded IDs, permit reordered/extended taxonomies', () => {
  const named = createNineClassGroup(['Fence', 'Building', 'Curb', 'tree_trunk', 'Noise', 'Mystery']);
  assert.deepEqual(named.fine_ids.Fence, [0]);
  assert.deepEqual(named.fine_ids.Building, [1]);
  assert.deepEqual(named.fine_ids.Curb, [2]);
  assert.deepEqual(named.fine_ids.Vegetation, [3]);
  assert.deepEqual(named.fine_ids.Noise, [4,5]);
  const unknown = createNineClassGroup([], base);
  assert.deepEqual(unknown.fine_ids.Unmovable, fixture.coarse5.fine_ids.static);
  assert.deepEqual(unknown.fine_ids.Curb, []);
  assert.deepEqual(createNineClassGroup().fine_ids.Building, []);
});
