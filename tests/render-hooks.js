// Test-only instrumentation appended by local HTTP fixtures, never deployed.
window.__renderTest = {
  semanticSummary() {
    const g = activeLabelGroup();
    const summarize = labels => {
      inferLabelEncoding(labels);
      const counts = Object.fromEntries(g.order.map(name => [name, 0]));
      const lut = Array.from({length:256}, (_, i) => labelToGroupName(g, i));
      for (const lab of labels || []) counts[lut[lab]]++;
      return counts;
    };
    return {mode: colorModeValue(), points: summarize(ptLabels), occ: summarize(occLabels)};
  },
  state() {
    return {finished: loadFinished, states: [...loadStates.values()], timestamp: currentMeta?.timestamp,
      camera: camera.position.toArray(), target: controls.target.toArray(),
      points: ptLabels?.length, renderedPoints: pointsObj?.geometry.attributes.position.count,
      sensorPoints: framePtLabels?.length || 0, aggregatePoints: aggregateProjection?.labels.length || 0,
      projectionPoints: selectedProjectionPoints()?.labels.length || 0,
      occ: occLabels?.length, style: el.occStyle.value, voxel: activeVoxel,
      cubeSize: occMesh?.geometry.parameters?.width, depthWrite: pointsObj?.material.depthWrite};
  },
  sources() {
    const cloud = selectedProjectionPoints();
    const cam = {width: 1024, height: 768, K: [100,0,512,0,100,384,0,0,1],
      T_c_v: [1,0,0,0,0,0,1,0,0,1,0,0,0,0,0,1]};
    const projected = cloud ? projectVehToImage(cloud.xyz, cloud.labels, cam, cloud.lidar) : [];
    return {frame: framePtLabels?.length || 0, aggregate: aggregateProjection?.labels.length || 0,
      selected: cloud?.labels.length || 0, xyz: Array.from(cloud?.xyz || []),
      uv: projected.map(p => [p.u,p.v,p.lab]),
      canvases: [512,1024].map(width => {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = width*.75;
        return drawProjectionOnCanvas(canvas,null,cam,'points',1);
      })};
  },
  pose() {
    camera.position.set(22, 35, -15);
    controls.target.set(3, 2, 18);
    controls.update();
  },
  settle() { for (let i = 0; i < 90; i++) controls.update(); },
  geometry() {
    const hash = array => {
      if (!array) return null;
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      let h = 2166136261;
      for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 16777619);
      return {bytes: bytes.length, hash: h >>> 0};
    };
    return {points: hash(ptXYZ), pointPositions: hash(pointsObj?.geometry.attributes.position.array),
      ijk: hash(occIjk), centers: hash(occCenters), matrices: hash(occMesh?.instanceMatrix?.array),
      pointMatrix: pointsObj?.matrix.toArray(), occMatrix: occMesh?.matrix.toArray()};
  },
  projectionCounts() {
    const saved = {framePtXYZ, framePtLabels, framePtLidar, currentMeta,
      occProjIjk, occProjLabels, activeVoxel};
    const cam = {width: 1024, height: 768, K: [1000,0,512,0,1000,384,0,0,1],
      T_c_v: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]};
    try {
      framePtXYZ = new Float32Array(200001 * 3);
      framePtLabels = new Uint8Array(200001).fill(13);
      framePtLidar = null;
      for (let i = 0; i < framePtLabels.length; i++) {
        framePtXYZ.set([(i % 500 - 250) / 100, (Math.floor(i / 500) - 200) / 100, 10], i * 3);
      }
      currentMeta = {x_range: [-50,50], y_range: [-25,25.25], z_range: [200,200.25]};
      activeVoxel = .25;
      occProjIjk = new Int32Array(80001 * 3);
      occProjLabels = new Uint8Array(80001).fill(13);
      for (let i = 0; i < occProjLabels.length; i++) occProjIjk.set([i % 400, Math.floor(i / 400), 0], i * 3);
      const result = {};
      for (const mode of ['points', 'occ']) {
        result[mode] = [512,1024].map(width => {
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = width * .75;
          return drawProjectionOnCanvas(canvas, null, cam, mode, 1);
        });
      }
      return result;
    } finally {
      ({framePtXYZ, framePtLabels, framePtLidar, currentMeta, occProjIjk, occProjLabels, activeVoxel} = saved);
    }
  },
  depthPixels() {
    // Real GPU rasterization: near blue then far red, and the reverse view.
    const old = {ptXYZ, ptLabels, ptLidar, position: camera.position.clone(), target: controls.target.clone(),
      mode: el.colorMode.value, size: el.ptSize.value, roi: el.togRoiClip.checked};
    const visibility = scene.children.map(child => [child, child.visible]);
    try {
      for (const [child] of visibility) child.visible = false;
      ptXYZ = new Float32Array([0,5,0, 0,10,0]);
      ptLabels = new Uint8Array([13,0]); ptLidar = new Uint8Array([1,1]);
      el.colorMode.value = 'fine'; el.ptSize.value = '.5'; el.togRoiClip.checked = false;
      buildPoints();
      pointsObj.geometry.attributes.color.setXYZ(0,0,0,1);
      pointsObj.geometry.attributes.color.setXYZ(1,1,0,0);
      pointsObj.geometry.attributes.color.needsUpdate = true;
      const out = [];
      for (const z of [0,15]) {
        camera.position.set(0,0,z); camera.lookAt(0,0,z === 0 ? 10 : 5);
        renderer.render(scene,camera);
        const gl = renderer.getContext();
        const pixel = new Uint8Array(4);
        gl.readPixels(Math.floor(gl.drawingBufferWidth/2),Math.floor(gl.drawingBufferHeight/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
        out.push(Array.from(pixel));
      }
      return out;
    } finally {
      ({ptXYZ, ptLabels, ptLidar} = old);
      el.colorMode.value = old.mode; el.ptSize.value = old.size; el.togRoiClip.checked = old.roi;
      buildPoints();
      for (const [child, visible] of visibility) child.visible = visible;
      camera.position.copy(old.position); controls.target.copy(old.target); controls.update();
      renderPending = true;
    }
  },
  latticeCoverage() {
    const saved = {currentMeta, activeVoxel, occIjk, occLabels,
      position: camera.position.clone(), target: controls.target.clone(), roi: el.togRoiClip.checked};
    const visibility = scene.children.map(child => [child, child.visible]);
    try {
      for (const [child] of visibility) child.visible = false;
      currentMeta = {x_range: [-2,2], y_range: [5,5.25], z_range: [-2,2]};
      activeVoxel = .25; occLabels = new Uint8Array(256).fill(13);
      occIjk = new Int32Array(256 * 3);
      for (let i = 0; i < 256; i++) occIjk.set([i % 16, 0, Math.floor(i / 16)], i * 3);
      el.togRoiClip.checked = false;
      buildOccMesh(); occMesh.visible = true;
      const fractions = [];
      for (const x of [0,4]) {
        camera.position.set(x,0,0); camera.lookAt(0,0,5);
        renderer.render(scene,camera);
        const gl = renderer.getContext(), size = 150;
        const pixels = new Uint8Array(size * size * 4);
        gl.readPixels(Math.floor((gl.drawingBufferWidth-size)/2),Math.floor((gl.drawingBufferHeight-size)/2),
          size,size,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        let covered = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] !== 11 || pixels[i+1] !== 14 || pixels[i+2] !== 19) covered++;
        }
        fractions.push(covered / (size * size));
      }
      return fractions;
    } finally {
      ({currentMeta, activeVoxel, occIjk, occLabels} = saved);
      el.togRoiClip.checked = saved.roi;
      buildOccMesh();
      for (const [child, visible] of visibility) child.visible = visible;
      camera.position.copy(saved.position); controls.target.copy(saved.target); controls.update();
      renderPending = true;
    }
  },
};
