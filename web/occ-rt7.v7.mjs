// Native RT7 occupancy and Waymo point clouds use separate label encodings.
const REPRESENTATIVES = ['Road', 'Other Ground', 'Car', 'Curb', 'Vegetation', 'Building', 'Sign'];

export function occupancyDisplayLabels(labels, asset, fineNames) {
  if (asset?.label_encoding !== 'rt7-v1') return labels;
  const names = asset.taxonomy?.names;
  if (!names || names.length !== 7 || asset.taxonomy?.mapping_stage !== 'before_voxel_majority') {
    throw new Error('RT7 occupancy taxonomy is missing or invalid');
  }
  const representatives = REPRESENTATIVES.map(name => fineNames?.indexOf(name) ?? -1);
  if (representatives.some(id => id < 0)) throw new Error('RT7 display requires the declared Waymo point taxonomy');
  const display = new Uint8Array(labels.length);
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] >= 7) throw new Error('RT7 occupancy label is outside 0..6');
    display[i] = representatives[labels[i]];
  }
  return display;
}
