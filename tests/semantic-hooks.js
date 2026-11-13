// Test-only hooks; never included in the published bundle.
window.__nineTest = {
  reload: () => loadClip('test', '/scene'),
  state() {
    const g = groupById.get('semantic9');
    inferLabelEncoding(ptLabels);
    const mapping = Object.fromEntries(Array.from(ptLabels || [], lab => [lab, labelToGroupName(g, lab)]));
    const colors = attribute => attribute ? Array.from(attribute.array, n => Math.round(n * 255)) : [];
    const cam = {width: 1024, height: 768, K: [100,0,512,0,100,384,0,0,1],
      T_c_v: [1,0,0,0,0,0,1,0,0,1,0,0,0,0,0,1]};
    const cloud = selectedProjectionPoints();
    const projected = cloud ? projectVehToImage(cloud.xyz, cloud.labels, cam, cloud.lidar) : [];
    const overlayColors = mode => {
      const painted = [];
      const ctx = {setTransform() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
        fillRect() { painted.push(this.fillStyle); }, fill() { painted.push(this.fillStyle); }};
      const canvas = {width:1024, height:768, classList: {contains: () => false}, getContext: () => ctx};
      drawProjectionOnCanvas(canvas, null, cam, mode, 1);
      return [...new Set(painted.filter(c => c.startsWith('rgb(')))].sort();
    };
    return {mapping, colors: g.colors, order: g.order, raw: labelEncoding,
      points: colors(pointsObj?.geometry.attributes.color),
      occ: colors(occMesh?.instanceColor || occMesh?.geometry.attributes.color),
      projected: projected.map(p => p.lab),
      pointOverlay: overlayColors('points'), occOverlay: overlayColors('occ')};
  },
};
