// Display grouping only: never rewrite source labels or infer missing classes.
export const NINE_ORDER = [
  'Drivable', 'undrivable', 'Movable', 'Curb', 'Fence',
  'Vegetation', 'Building', 'Unmovable', 'Noise',
];

const COLORS = {
  Drivable: [51, 217, 77], undrivable: [64, 128, 255], Movable: [255, 51, 38],
  Curb: [255, 230, 50], Fence: [230, 80, 230], Vegetation: [0, 155, 120],
  Building: [155, 125, 255], Unmovable: [255, 158, 0], Noise: [115, 115, 115],
};
const OLD_TO_NEW = {
  drivable: 'Drivable', non_drivable: 'undrivable', dynamic: 'Movable',
  static: 'Unmovable', noise: 'Noise',
};
const normalize = name => String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
const NAMED_CLASSES = new Map(Object.entries({
  Drivable: ['Drivable', 'Road', 'Lane Marker'],
  undrivable: ['undrivable', 'non_drivable', 'Other Ground', 'Walkable', 'Sidewalk'],
  Movable: ['Movable', 'dynamic', 'Car', 'Truck', 'Bus', 'Other Vehicle', 'Motorcyclist',
    'Bicyclist', 'Pedestrian', 'Bicycle', 'Motorcycle'],
  Curb: ['Curb'], Fence: ['Fence'], Vegetation: ['Vegetation', 'Tree Trunk'],
  Building: ['Building'], Unmovable: ['Unmovable', 'static', 'Sign', 'Traffic Light', 'Pole', 'Construction Cone'],
  Noise: ['Noise', 'Unlabeled', 'Unlabelled', 'Unknown'],
}).flatMap(([group, names]) => names.map(name => [normalize(name), group])));
const STATIC_PARTS = new Set(['Curb', 'Fence', 'Vegetation', 'Building']);

/** base is the existing five-class group, with fineSets/rawSets/colors.
 * Existing non-static membership wins; only old static is subdivided.
 * Without named fine labels we keep static in Unmovable, never guess IDs.
 */
export function createNineClassGroup(fineNames = [], base = null) {
  const fine_ids = Object.fromEntries(NINE_ORDER.map(name => [name, []]));
  const colors_rgb = Object.fromEntries(NINE_ORDER.map(name => [name, [...COLORS[name]]]));
  const coarseByFine = new Map();
  const raw_ids = base?.rawSets ? Object.fromEntries(NINE_ORDER.map(name => [name, []])) : null;
  for (const [old, name] of Object.entries(OLD_TO_NEW)) {
    for (const id of base?.fineSets?.get(old) || []) coarseByFine.set(id, name);
    if (raw_ids) raw_ids[name] = [...(base.rawSets.get(old) || [])];
    if (base?.colors?.[old]) colors_rgb[name] = [...base.colors[old]];
  }
  const ids = new Set([...coarseByFine.keys(), ...fineNames.map((_, id) => id)]);
  for (const id of ids) {
    const named = NAMED_CLASSES.get(normalize(fineNames[id] || ''));
    const coarse = coarseByFine.get(id);
    const group = coarse === 'Unmovable' && STATIC_PARTS.has(named) ? named : coarse || named || 'Noise';
    fine_ids[group].push(id);
  }
  const unavailable = [...STATIC_PARTS].filter(name => !fine_ids[name].length);
  const notes = ['仅显示分组，不修改源标签。'];
  if (unavailable.length) notes.push(`源标签未区分 ${unavailable.join(' / ')}，不推断缺失类别。`);
  if (raw_ids) notes.push('若源数据只有 5 类，static 仅显示为 Unmovable，无法还原静态子类。');
  return {label: 'Semantic 9-class（9 类）', order: [...NINE_ORDER], colors_rgb, fine_ids,
    ...(raw_ids ? {raw_ids} : {}), description: notes.join(' ')};
}
