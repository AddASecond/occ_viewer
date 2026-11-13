import { test } from 'node:test';
import assert from 'node:assert/strict';
import { occupancyDisplayLabels } from '../web/occ-rt7.v7.mjs';

const fine = ['Car','Truck','Bus','Other Vehicle','Motorcyclist','Bicyclist','Pedestrian',
  'Sign','Traffic Light','Pole','Construction Cone','Bicycle','Motorcycle','Building',
  'Vegetation','Tree Trunk','Curb','Road','Lane Marker','Other Ground','Walkable','Sidewalk'];
const asset = {label_encoding:'rt7-v1', taxonomy:{names:['Drivable','undrivable','Movable',
  'Curb','Vegetation','Building','Unmovable'],mapping_stage:'before_voxel_majority'}};
test('RT7 display preserves source IDs and uses seven semantic groups', () => {
  const source = new Uint8Array([0,1,2,3,4,5,6]);
  assert.deepEqual([...occupancyDisplayLabels(source,asset,fine)],[17,19,0,16,14,13,7]);
  assert.deepEqual([...source],[0,1,2,3,4,5,6]);
});
test('legacy labels are unchanged and invalid RT7 fails', () => {
  const source = new Uint8Array([0,13,21]);
  assert.equal(occupancyDisplayLabels(source,{},fine),source);
  assert.throws(() => occupancyDisplayLabels(new Uint8Array([7]),asset,fine),/outside/);
});
