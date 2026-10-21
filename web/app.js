import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

if (location.pathname === "/occ") {
  location.replace("/occ/" + location.search + location.hash);
}
const qs = new URLSearchParams(location.search);
// External scene providers implement the canonical scene contract. They own
// authentication and data access; this viewer remains independent of MongoDB.
const mongoSource = qs.get("source") === "gss";
const externalSource = mongoSource || qs.get("source") === "external";
const OCC_BASE = (location.pathname === "/occ" || location.pathname.startsWith("/occ/")) ? "/occ" : "";
function occUrl(path) {
  if (!path) return path;
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  if (OCC_BASE && path.startsWith("/") && !path.startsWith(`${OCC_BASE}/`) && path !== OCC_BASE) {
    return OCC_BASE + path;
  }
  return path;
}
function clipIdFromScene(root) {
  if (!root) return "";
  const raw = String(root).replace(/\/$/, "");
  const m = raw.match(/(?:^|\/)scenes\/([^/?#]+)/);
  return m ? m[1] : raw.replace(/^\/occ/, "").replace(/^\/scene\/?/, "").replace(/^\//, "");
}
/** Active scene HTTP prefix, e.g. /scenes/<clip_id> or /scene */
let sceneRoot = occUrl((qs.get("scene") || "").replace(/\/$/, ""));
let clipsCatalog = [];
let frameIndex = 0;
let currentOccVariant = "default";

/** Resolve asset URI relative to scene root (Mongo/S3 can swap to absolute later). */
function assetUrl(uri, frameRelFallback = null) {
  if (!uri) return null;
  if (/^(https?:|data:|blob:|gridfs:|s3:)/i.test(uri)) return uri;
  if (uri.startsWith("/")) return occUrl(uri);
  // scene-root relative (v1)
  if (uri.startsWith("frames/")) return `${sceneRoot}/${uri}`;
  // legacy: relative to frame dir
  if (frameRelFallback) return `${sceneRoot}/${frameRelFallback}/${uri}`;
  return `${sceneRoot}/${uri}`;
}

function occAsset(meta, key) {
  const variants = meta.assets && meta.assets.occupancy_variants;
  const group = (variants && variants[currentOccVariant]) || (meta.assets && meta.assets.occupancy);
  const a = group && group[key];
  if (a && a.uri) return assetUrl(a.uri);
  if (meta.occupancy && meta.occupancy[key]) return assetUrl(meta.occupancy[key], frameDir);
  return null;
}

function pointsAsset(meta, key) {
  const a = meta.assets && meta.assets.points && meta.assets.points[key];
  if (a && a.uri) return assetUrl(a.uri);
  if (meta.points && meta.points[key]) return assetUrl(meta.points[key], frameDir);
  return null;
}

function frameSensorPointsAsset(meta, key) {
  const a = meta.assets && meta.assets.frame_sensor_points && meta.assets.frame_sensor_points[key];
  return a && a.uri ? assetUrl(a.uri, frameDir) : null;
}

function camImageUrl(cam) {
  if (cam.image && cam.image.uri) return assetUrl(cam.image.uri);
  if (cam.file) return assetUrl(cam.file, frameDir);
  return null;
}

function camSize(cam, img) {
  const w = Number(cam.width || (cam.image && cam.image.width) || (img && img.naturalWidth) || 1920);
  const h = Number(cam.height || (cam.image && cam.image.height) || (img && img.naturalHeight) || 1080);
  return { w, h };
}

function useClipAggregate() {
  return !el.ptSource || el.ptSource.value === "clip_agg";
}

function egoPoseRecord(ego) {
  if (!ego) return null;
  if (ego.pose && ego.pose.position && ego.pose.orientation) return ego.pose;
  if (ego.position && ego.orientation) return ego;
  return null;
}

const el = {
  frameSelect: document.getElementById("frameSelect"),
  clipSelect: document.getElementById("clipSelect"),
  occVariant: document.getElementById("occVariant"),
  btnPrevFrame: document.getElementById("btnPrevFrame"),
  btnNextFrame: document.getElementById("btnNextFrame"),
  framePos: document.getElementById("framePos"),
  titleMeta: document.getElementById("titleMeta"),
  sceneInfo: document.getElementById("sceneInfo"),
  status: document.getElementById("status"),
  cams: document.getElementById("cams"),
  togOcc: document.getElementById("togOcc"),
  occStyle: document.getElementById("occStyle"),
  togPts: document.getElementById("togPts"),
  ptSource: document.getElementById("ptSource"),
  togOdBoxes: document.getElementById("togOdBoxes"),
  togGrid: document.getElementById("togGrid"),
  togAxes: document.getElementById("togAxes"),
  occOpacity: document.getElementById("occOpacity"),
  occGap: document.getElementById("occGap"),
  occGrow: document.getElementById("occGrow"),
  ptSize: document.getElementById("ptSize"),
  voxelSize: document.getElementById("voxelSize"),
  btnRebuildOcc: document.getElementById("btnRebuildOcc"),
  btnResetOcc: document.getElementById("btnResetOcc"),
  occRebuildHint: document.getElementById("occRebuildHint"),
  projMode: document.getElementById("projMode"),
  projRadius: document.getElementById("projRadius"),
  projRadiusValue: document.getElementById("projRadiusValue"),
  projAlpha: document.getElementById("projAlpha"),
  projAlphaValue: document.getElementById("projAlphaValue"),
  projColorMode: document.getElementById("projColorMode"),
  projClassFilter: document.getElementById("projClassFilter"),
  projHeightMin: document.getElementById("projHeightMin"),
  projHeightMax: document.getElementById("projHeightMax"),
  projPointSource: document.getElementById("projPointSource"),
  projDistortion: document.getElementById("projDistortion"),
  btnRefreshProj: document.getElementById("btnRefreshProj"),
  btnFit: document.getElementById("btnFit"),
  classLegend: document.getElementById("classLegend"),
  colorMode: document.getElementById("colorMode"),
  groupToggles: document.getElementById("groupToggles"),
  lidarToggles: document.getElementById("lidarToggles"),
  colorModeHint: document.getElementById("colorModeHint"),
  roiDefaultHint: document.getElementById("roiDefaultHint"),
  roiX0: document.getElementById("roiX0"),
  roiX1: document.getElementById("roiX1"),
  roiY0: document.getElementById("roiY0"),
  roiY1: document.getElementById("roiY1"),
  roiZ0: document.getElementById("roiZ0"),
  roiZ1: document.getElementById("roiZ1"),
  btnApplyRoi: document.getElementById("btnApplyRoi"),
  btnResetRoi: document.getElementById("btnResetRoi"),
  togRoiBox: document.getElementById("togRoiBox"),
  togRoiClip: document.getElementById("togRoiClip"),
  vidMode: document.getElementById("vidMode"),
  vidFps: document.getElementById("vidFps"),
  vidMaxFrames: document.getElementById("vidMaxFrames"),
  btnExportVid: document.getElementById("btnExportVid"),
  btnRefreshVid: document.getElementById("btnRefreshVid"),
  vidStatus: document.getElementById("vidStatus"),
  vidList: document.getElementById("vidList"),
  wrap: document.getElementById("canvas-wrap"),
  lightbox: document.getElementById("lightbox"),
  lbStage: document.getElementById("lb-stage"),
  lbCanvas: document.getElementById("lb-canvas"),
  lbTitle: document.getElementById("lb-title"),
  lbZoomIn: document.getElementById("lb-zoom-in"),
  lbZoomOut: document.getElementById("lb-zoom-out"),
  lbReset: document.getElementById("lb-reset"),
  lbClose: document.getElementById("lb-close"),
};

let index = null;
let currentMeta = null;
let frameDir = null;
let occMesh = null;
let pointsObj = null;
let odBoxesGroup = null;
let gridHelper = null;
let axesGroup = null;
let classColors = null;
let classNames = null;

let occIjk = null; // Int32 ix,iy,iz
let occLabels = null;
let occCenters = null; // for projection
let occProjLabels = null; // filtered labels parallel to occCenters
let occProjIjk = null; // filtered ijk parallel to occCenters (for neat quads)
let activeVoxel = null;
let exportedOcc = null; // { voxel, ijk: Int32Array, labels: Uint8Array }
let ptXYZ = null;
let ptLabels = null;
let ptLidar = null; // Uint8Array lidar_id per point
let framePtXYZ = null; // current-frame deskew points, before static aggregation
let framePtLabels = null;
let framePtLidar = null;
/** Clip-level static in map frame (same points every frame; only pose changes). */
let staticAgg = null;
let clipAggFitted = false;
let roiHelper = null;
let roi = { x0: -50, x1: 50, y0: -50, y1: 50, z0: -5, z1: 5 };
let nFine = 0;
let Lcol = {};
let lidarIdsList = [];
/** Coarse color modes from taxonomy: any taxonomy key beside fine/lidar_ids
 *  with order + colors_rgb + fine_ids (or fine_to_coarse) becomes one group.
 *  raw_ids maps group names to raw label values for packages exported with
 *  group labels instead of fine ids. */
let labelGroups = [];
let groupById = new Map();
/** Fine ids of the first group's "dynamic" member (clip-aggregate split). */
let dynFineIds = new Set();
/** "fine": labels are fine ids. "raw": labels are a group's raw_ids values. */
let labelEncoding = "fine";
let uiConfig = { default_color_mode: "", occ_variants: [], point_filters: [], height_range: [-3, 3] };
let previewConfig = { enabled: false, prefix: "preview_" };
let gssConfig = {};
let toggleBoxes = new Map(); // groupId -> Map(name -> checkbox)
let lidarBoxes = new Map(); // lidar id -> checkbox
let colorModeDefault = "fine";
let roiDefault = null; // last profile-applied ROI inputs (untouched detection)
let heightRangeDefault = null;

function buildLabelGroup(id, g = {}) {
  const order = g.order || g.names || [];
  const colors = Array.isArray(g.colors_rgb)
    ? Object.fromEntries(order.map((name, i) => [name, g.colors_rgb[i]]))
    : (g.colors_rgb || {});
  let fineSets = null;
  if (g.fine_ids) {
    fineSets = new Map(order.map((name) => [name, new Set(g.fine_ids[name] || [])]));
  } else if (g.fine_to_coarse) {
    fineSets = new Map(order.map((name) => [name, new Set()]));
    g.fine_to_coarse.forEach((gi, fid) => {
      const name = order[gi];
      if (name != null && fineSets.has(name)) fineSets.get(name).add(fid);
    });
  }
  const raw = g.raw_ids || g.raw5_ids || null;
  let rawSets = null;
  let rawMax = -1;
  if (raw) {
    rawSets = new Map(order.map((name) => [name, new Set(raw[name] || [])]));
    for (const set of rawSets.values()) for (const v of set) rawMax = Math.max(rawMax, v);
  }
  return {
    id,
    order,
    colors,
    fineSets,
    rawSets,
    rawMax,
    noiseName: order.includes("noise") ? "noise" : order[order.length - 1],
  };
}

function applyProfile(p = {}) {
  // Format YAML and canonical scene indexes share the same profile shape;
  // each call merges one source over the current state (scene index wins).
  const t = p.taxonomy || {};
  if (t.fine && t.fine.n) nFine = t.fine.n;
  for (const [id, g] of Object.entries(t)) {
    if (id === "fine" || id === "lidar_ids" || !g || typeof g !== "object") continue;
    const group = buildLabelGroup(id, g);
    const i = labelGroups.findIndex((x) => x.id === id);
    if (i >= 0) labelGroups[i] = group;
    else labelGroups.push(group);
  }
  groupById = new Map(labelGroups.map((g) => [g.id, g]));
  const L = t.lidar_ids;
  if (L && L.colors_rgb) {
    Lcol = Array.isArray(L.colors_rgb)
      ? Object.fromEntries((L.ids || []).map((id, i) => [id, L.colors_rgb[i]]))
      : L.colors_rgb;
    lidarIdsList = Object.keys(Lcol).map(Number).sort((a, b) => a - b);
  }
  dynFineIds = new Set();
  for (const g of labelGroups) {
    const set = g.fineSets && g.fineSets.get("dynamic");
    if (set && set.size) {
      dynFineIds = set;
      break;
    }
  }
  const r = p.roi || (p.defaults && p.defaults.roi);
  if (r && r.x && r.y && r.z) {
    roi = { x0: r.x[0], x1: r.x[1], y0: r.y[0], y1: r.y[1], z0: r.z[0], z1: r.z[1] };
  }
  if (p.ui) uiConfig = { ...uiConfig, ...p.ui };
  if (p.point_preview) previewConfig = { ...previewConfig, ...p.point_preview };
  if (p.gss) gssConfig = { ...gssConfig, ...p.gss };
  if (!labelGroups.some((g) => g.rawSets)) labelEncoding = "fine";
  buildFormatUi();
}

function _hasOption(sel, value) {
  return [...sel.options].some((o) => o.value === value);
}

/** Rebuild every config-driven widget: color modes, group/lidar toggles,
 *  hints, point filters, ROI and height-range defaults. User-edited values
 *  survive rebuilds; untouched defaults track the latest profile. */
function buildFormatUi() {
  if (el.colorMode) {
    const sel = el.colorMode;
    const prev = sel.value;
    const prevDefault = colorModeDefault;
    sel.innerHTML = "";
    sel.appendChild(new Option(nFine ? `Fine ${nFine}-class` : "Fine", "fine"));
    for (const g of labelGroups) {
      const name = g.id[0].toUpperCase() + g.id.slice(1);
      sel.appendChild(new Option(`${name} ${g.order.length}-class`, g.id));
    }
    if (lidarIdsList.length) sel.appendChild(new Option("Lidar id (points)", "lidar"));
    const configured = uiConfig.default_color_mode;
    const nextDefault = configured && _hasOption(sel, configured) ? configured : sel.options[0].value;
    sel.value = prev && prev !== prevDefault && _hasOption(sel, prev) ? prev : nextDefault;
    colorModeDefault = nextDefault;
  }
  if (el.groupToggles) {
    const old = toggleBoxes;
    toggleBoxes = new Map();
    el.groupToggles.innerHTML = "";
    for (const g of labelGroups) {
      const div = document.createElement("div");
      div.dataset.group = g.id;
      div.style.marginTop = "8px";
      const boxes = new Map();
      for (const name of g.order) {
        const cb = document.createElement("input");
        cb.type = "checkbox";
        const prev = old.get(g.id) && old.get(g.id).get(name);
        cb.checked = prev ? prev.checked : true;
        const c = g.colors[name] || [160, 160, 160];
        const span = document.createElement("span");
        span.textContent = ` ${name}`;
        span.style.color = `rgb(${c[0]},${c[1]},${c[2]})`;
        const label = document.createElement("label");
        label.className = "ctrl";
        label.append(cb, span);
        div.appendChild(label);
        boxes.set(name, cb);
      }
      el.groupToggles.appendChild(div);
      toggleBoxes.set(g.id, boxes);
    }
  }
  if (el.lidarToggles) {
    const old = lidarBoxes;
    lidarBoxes = new Map();
    el.lidarToggles.innerHTML = "";
    for (const lid of lidarIdsList) {
      const cb = document.createElement("input");
      cb.type = "checkbox";
      const prev = old.get(lid);
      cb.checked = prev ? prev.checked : true;
      const c = Lcol[lid] || [160, 160, 160];
      const span = document.createElement("span");
      span.textContent = ` lidar_${lid}`;
      span.style.color = `rgb(${c[0]},${c[1]},${c[2]})`;
      const label = document.createElement("label");
      label.className = "ctrl";
      label.append(cb, span);
      el.lidarToggles.appendChild(label);
      lidarBoxes.set(lid, cb);
    }
  }
  if (el.colorModeHint) {
    const lines = labelGroups.map((g) => `${g.id}: ${g.order.join(" / ")}`);
    if (lidarIdsList.length) lines.push(`Lidar: ${lidarIdsList.join(" / ")} (points only; occ stays semantic)`);
    el.colorModeHint.innerHTML = lines.join("<br/>");
  }
  if (el.projClassFilter && (uiConfig.point_filters || []).length) {
    const prev = el.projClassFilter.value;
    el.projClassFilter.innerHTML = "";
    for (const f of uiConfig.point_filters) {
      el.projClassFilter.appendChild(new Option(f.label || String(f.value), String(f.value)));
    }
    if (_hasOption(el.projClassFilter, prev)) el.projClassFilter.value = prev;
  }
  const hr = uiConfig.height_range;
  if (el.projHeightMin && el.projHeightMax && Array.isArray(hr) && hr.length === 2) {
    const untouched = !heightRangeDefault ||
      (Number(el.projHeightMin.value) === heightRangeDefault[0] &&
        Number(el.projHeightMax.value) === heightRangeDefault[1]);
    if (untouched) {
      el.projHeightMin.value = hr[0];
      el.projHeightMax.value = hr[1];
    }
    heightRangeDefault = hr;
  }
  if (el.roiX0) {
    const cur = [el.roiX0, el.roiX1, el.roiY0, el.roiY1, el.roiZ0, el.roiZ1].map((i) => Number(i.value));
    const untouched = !roiDefault || roiDefault.every((v, i) => v === cur[i]);
    if (untouched) {
      el.roiX0.value = roi.x0;
      el.roiX1.value = roi.x1;
      el.roiY0.value = roi.y0;
      el.roiY1.value = roi.y1;
      el.roiZ0.value = roi.z0;
      el.roiZ1.value = roi.z1;
    }
    roiDefault = [roi.x0, roi.x1, roi.y0, roi.y1, roi.z0, roi.z1];
    if (el.roiDefaultHint) {
      el.roiDefaultHint.textContent = `Default [${roi.x0},${roi.x1}]×[${roi.y0},${roi.y1}]×[${roi.z0},${roi.z1}]`;
    }
  }
  syncColorModeUi();
  updateRoiHelper();
}

function groupVisible(g, name) {
  const boxes = toggleBoxes.get(g.id);
  const cb = boxes && boxes.get(name);
  return !cb || cb.checked;
}

function lidarVisible(lid) {
  const cb = lidarBoxes.get(lid);
  return !cb || cb.checked;
}

/** Lightbox state */
let lb = { scale: 1, tx: 0, ty: 0, dragging: false, lx: 0, ly: 0, source: null };

const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
renderer.setPixelRatio(1);
renderer.setClearColor(0x0b0e13, 1);
el.wrap.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 3000);
const controls = new OrbitControls(camera, renderer.domElement);
let renderPending = true;
controls.addEventListener("change", () => { renderPending = true; });
for (const event of ["input", "change", "click"]) {
  document.addEventListener(event, () => { renderPending = true; });
}
controls.enableDamping = true;

scene.add(new THREE.AmbientLight(0xffffff, 0.65));
const sun = new THREE.DirectionalLight(0xffffff, 0.85);
sun.position.set(40, 120, -30);
scene.add(sun);

/** Vehicle +x right +y fwd +z up → Three (−x, z, y). */
function vehToThree(x, y, z, out = new THREE.Vector3()) {
  return out.set(-x, z, y);
}

gridHelper = new THREE.GridHelper(400, 80, 0x445066, 0x243041);
scene.add(gridHelper);

function makeAxisArrow(dir, color, length) {
  return new THREE.ArrowHelper(
    dir.clone().normalize(),
    new THREE.Vector3(0, 0.02, 0),
    length,
    color,
    2.0,
    1.2
  );
}

function makeSprite(text, pos, color) {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.font = "bold 30px sans-serif";
  ctx.fillText(text, 6, 42);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const spr = new THREE.Sprite(mat);
  spr.position.copy(pos);
  spr.scale.set(10, 2, 1);
  return spr;
}

function clearOdBoxes() {
  if (!odBoxesGroup) return;
  scene.remove(odBoxesGroup);
  odBoxesGroup.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (obj.material.map) obj.material.map.dispose();
      obj.material.dispose();
    }
  });
  odBoxesGroup = null;
}

function buildOdBoxes(meta) {
  renderPending = true;
  clearOdBoxes();
  odBoxesGroup = new THREE.Group();
  const objects = (meta.od_boxes && meta.od_boxes.objects) || [];
  for (const obj of objects) {
    const c = obj.center_imu || [];
    const s = obj.size || [];
    if (c.length < 3 || s.length < 3) continue;
    const [length, width, height] = s.map(Number);
    const yaw = Number(obj.orientation_imu || 0);
    const ux = [Math.cos(yaw) * length / 2, Math.sin(yaw) * length / 2];
    const uy = [-Math.sin(yaw) * width / 2, Math.cos(yaw) * width / 2];
    const corners = [];
    for (const zSign of [-1, 1]) {
      for (const xSign of [-1, 1]) {
        for (const ySign of [-1, 1]) {
          corners.push(vehToThree(
            Number(c[0]) + xSign * ux[0] + ySign * uy[0],
            Number(c[1]) + xSign * ux[1] + ySign * uy[1],
            Number(c[2]) + zSign * height / 2
          ));
        }
      }
    }
    const edges = [[0,1],[0,2],[1,3],[2,3],[4,5],[4,6],[5,7],[6,7],[0,4],[1,5],[2,6],[3,7]];
    const positions = [];
    for (const [a, b] of edges) positions.push(...corners[a].toArray(), ...corners[b].toArray());
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const matched = obj.display_id !== null && obj.display_id !== undefined;
    const color = matched ? 0xffcc33 : 0xff5c7a;
    odBoxesGroup.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color })));
    const id = matched ? obj.display_id : "unmatched";
    const label = makeSprite(`OD#${obj.od_index} → ${id}`, vehToThree(Number(c[0]), Number(c[1]), Number(c[2]) + height / 2 + 0.8), matched ? "#ffdd55" : "#ff6b86");
    label.scale.set(12, 2.4, 1);
    odBoxesGroup.add(label);
  }
  odBoxesGroup.visible = el.togOdBoxes.checked;
  scene.add(odBoxesGroup);
  return objects.length;
}

function buildAxes() {
  if (axesGroup) scene.remove(axesGroup);
  axesGroup = new THREE.Group();
  // Directions in Three space after vehToThree (vehicle +x → Three −X).
  axesGroup.add(makeAxisArrow(new THREE.Vector3(-1, 0, 0), 0xff4d4d, 20));
  axesGroup.add(makeAxisArrow(new THREE.Vector3(0, 0, 1), 0x3dde6a, 20));
  axesGroup.add(makeAxisArrow(new THREE.Vector3(0, 1, 0), 0x4da3ff, 20));
  axesGroup.add(makeSprite("+X", vehToThree(22, 0, 0.8), "#ff4d4d"));
  axesGroup.add(makeSprite("+Y", vehToThree(0, 22, 0.8), "#3dde6a"));
  axesGroup.add(makeSprite("+Z", vehToThree(0, 0, 22), "#4da3ff"));
  axesGroup.visible = el.togAxes.checked;
  scene.add(axesGroup);
}
buildAxes();

function resize() {
  renderPending = true;
  const w = el.wrap.clientWidth;
  const h = el.wrap.clientHeight;
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
new ResizeObserver(resize).observe(el.wrap);
resize();

function setStatus(msg) {
  el.status.textContent = msg || "";
}

// One request lifecycle for a clip/frame. Switching cancels stale downloads.
let loadController = new AbortController();
let loadStarted = 0;
let loadFinished = true;
let loadElapsedMs = null;
const loadStates = new Map();
const loadProgress = document.getElementById("loadProgress");
function showLoadProgress() {
  loadProgress.textContent = [...loadStates].map(([name, state]) => `${name}: ${state}`).join("\n");
  const elapsedMs = loadFinished ? loadElapsedMs : (performance.now() - loadStarted);
  if (elapsedMs != null) loadProgress.textContent += `\n已用时 ${(elapsedMs / 1000).toFixed(0)} 秒`;
}
setInterval(() => { if (!loadFinished) showLoadProgress(); }, 1000);
function loadState(name, state, signal = loadController.signal) {
  if (signal.aborted) return;
  loadStates.set(name, state);
  showLoadProgress();
}
function beginLoad(message) {
  renderPending = true;
  loadController.abort();
  loadController = new AbortController();
  loadStates.clear();
  loadStarted = performance.now();
  loadFinished = false;
  loadElapsedMs = null;
  setStatus(message);
  clearOcc();
  clearPoints();
  clearOdBoxes();
  currentMeta = null;
  ptXYZ = ptLabels = ptLidar = null;
  framePtXYZ = framePtLabels = framePtLidar = null;
  exportedOcc = null;
  occIjk = occLabels = occProjIjk = occProjLabels = occCenters = null;
  el.cams.replaceChildren();
  closeLightbox();
  el.sceneInfo.textContent = "加载中…";
  showLoadProgress();
  return loadController.signal;
}
function loadFailure(error, signal = loadController.signal) {
  if (signal.aborted) return;
  console.error(error);
  if (loadStarted) loadElapsedMs = performance.now() - loadStarted;
  loadFinished = true;
  loadState("加载", `失败：${error.message}`, signal);
  setStatus(`加载失败：${error.message} · 点击重试`);
}
async function fetchResource(url, type, signal) {
  if (!url) throw new Error("缺少文件地址");
  const timeout = AbortSignal.timeout(300000);
  try {
    const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    if (response.headers.get("content-type")?.includes("text/html")) {
      throw new Error("返回了网页而非数据，请检查登录或数据权限");
    }
    const data = await response[type]();
    signal?.throwIfAborted();
    return data;
  } catch (error) {
    if (timeout.aborted && !signal?.aborted) throw new Error("请求超时（300 秒），请重试");
    throw error;
  }
}
const fetchJson = (url, signal) => fetchResource(url, "json", signal);
async function fetchGroup(name, urls, signal, required = urls.length) {
  const total = urls.filter(Boolean).length;
  if (!total) { loadState(name, "无数据", signal); return null; }
  let done = 0;
  let failed = false;
  loadState(name, `下载中 0/${total}`, signal);
  try {
    return await Promise.all(urls.map(async (url, i) => {
      if (!url) return null;
      const data = await fetchResource(url, "arrayBuffer", signal).catch(error => {
        if (i < required || signal.aborted) throw error;
        loadState(`${name}附加文件`, `失败：${error.message}（保留点云）`, signal);
        return null;
      });
      done++;
      if (!failed) loadState(name, `已下载 ${done}/${total}`, signal);
      return data;
    }));
  } catch (error) {
    failed = true;
    loadState(name, `失败：${error.message}`, signal);
    return null;
  }
}

function quatToRotMat(q) {
  let x = +q.x,
    y = +q.y,
    z = +q.z,
    w = +q.w;
  const n = Math.hypot(x, y, z, w) || 1;
  x /= n;
  y /= n;
  z /= n;
  w /= n;
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - z * w),
    2 * (x * z + y * w),
    2 * (x * y + z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z - x * w),
    2 * (x * z - y * w),
    2 * (y * z + x * w),
    1 - 2 * (x * x + y * y),
  ];
}

/** Row-major 4x4 map←vehicle from ego_pose.pose */
function egoPoseToTMapVehicle(pose) {
  const R = quatToRotMat(pose.orientation);
  const p = pose.position;
  return new Float64Array([
    R[0],
    R[1],
    R[2],
    +p.x,
    R[3],
    R[4],
    R[5],
    +p.y,
    R[6],
    R[7],
    R[8],
    +p.z,
    0,
    0,
    0,
    1,
  ]);
}

function invertRigid4(T) {
  // T = [R|t]; inv = [R^T | -R^T t]
  const R = [
    T[0],
    T[1],
    T[2],
    T[4],
    T[5],
    T[6],
    T[8],
    T[9],
    T[10],
  ];
  const tx = T[3],
    ty = T[7],
    tz = T[11];
  const ix = -(R[0] * tx + R[3] * ty + R[6] * tz);
  const iy = -(R[1] * tx + R[4] * ty + R[7] * tz);
  const iz = -(R[2] * tx + R[5] * ty + R[8] * tz);
  return new Float64Array([
    R[0],
    R[3],
    R[6],
    ix,
    R[1],
    R[4],
    R[7],
    iy,
    R[2],
    R[5],
    R[8],
    iz,
    0,
    0,
    0,
    1,
  ]);
}

function transformPoints(xyz, T) {
  const n = xyz.length / 3;
  const out = new Float32Array(xyz.length);
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const x = xyz[o],
      y = xyz[o + 1],
      z = xyz[o + 2];
    out[o] = T[0] * x + T[1] * y + T[2] * z + T[3];
    out[o + 1] = T[4] * x + T[5] * y + T[6] * z + T[7];
    out[o + 2] = T[8] * x + T[9] * y + T[10] * z + T[11];
  }
  return out;
}

/**
 * Map-frame static_agg → current vehicle frame (optional crop).
 * Same points every frame; only the rigid transform changes.
 */
function staticAggInVehicle(pose, xRange, yRange, zRange) {
  if (!staticAgg || !pose) return null;
  const T_map_v = egoPoseToTMapVehicle(pose);
  const T_v_map = invertRigid4(T_map_v);
  const xyz = transformPoints(staticAgg.xyz, T_v_map);
  const n = staticAgg.n;
  if (!xRange && !yRange && !zRange) return { xyz, labels: staticAgg.labels, lidar: staticAgg.lidar, n };
  // Two passes over the flat buffer: no multi-million-element index array.
  const labels = staticAgg.labels;
  const lidar = staticAgg.lidar;
  const inBox = (o) =>
    !(xRange && (xyz[o] < xRange[0] || xyz[o] > xRange[1])) &&
    !(yRange && (xyz[o + 1] < yRange[0] || xyz[o + 1] > yRange[1])) &&
    !(zRange && (xyz[o + 2] < zRange[0] || xyz[o + 2] > zRange[1]));
  let m = 0;
  for (let i = 0; i < n; i++) if (inBox(i * 3)) m++;
  const outX = new Float32Array(m * 3);
  const outL = new Uint8Array(m);
  const outI = new Uint8Array(m);
  for (let i = 0, k = 0; i < n; i++) {
    const o = i * 3;
    if (!inBox(o)) continue;
    outX[k * 3] = xyz[o];
    outX[k * 3 + 1] = xyz[o + 1];
    outX[k * 3 + 2] = xyz[o + 2];
    outL[k] = labels[i];
    outI[k] = lidar ? lidar[i] : 0;
    k++;
  }
  return { xyz: outX, labels: outL, lidar: outI, n: m };
}

function mergeStaticAndDynamicPoints(staticPart, dynXYZ, dynLab, dynLid) {
  const ns = staticPart ? staticPart.n : 0;
  const nd = dynLab ? dynLab.length : 0;
  const n = ns + nd;
  const xyz = new Float32Array(n * 3);
  const lab = new Uint8Array(n);
  const lid = new Uint8Array(n);
  if (ns) {
    xyz.set(staticPart.xyz);
    lab.set(staticPart.labels);
    lid.set(staticPart.lidar);
  }
  for (let i = 0; i < nd; i++) {
    const o = (ns + i) * 3;
    const s = i * 3;
    xyz[o] = dynXYZ[s];
    xyz[o + 1] = dynXYZ[s + 1];
    xyz[o + 2] = dynXYZ[s + 2];
    lab[ns + i] = dynLab[i];
    lid[ns + i] = dynLid ? dynLid[i] : 0;
  }
  return { xyz, labels: lab, lidar: lid };
}

let staticAggKey = "";
async function loadStaticAggFromIndex(signal) {
  const key = `${sceneRoot}:${currentOccVariant}`;
  if (staticAgg && staticAggKey === key) {
    loadState("聚合点云", `已缓存 ${staticAgg.n.toLocaleString()} 点`, signal);
    return;
  }
  staticAgg = null;
  const pointAgg = index && index.point_aggregate;
  const staticVariants = index && index.static_agg_variants;
  const sa = pointAgg || (staticVariants && staticVariants[currentOccVariant]) ||
    (index && index.static_agg);
  if (!sa || !sa.xyz_map || !sa.labels) { loadState("聚合点云", "无数据", signal); return; }
  const previewName = (uri) => {
    const i = String(uri).lastIndexOf("/") + 1;
    return `${uri.slice(0, i)}${previewConfig.prefix}${uri.slice(i)}`;
  };
  // Local serve.py can serve strided previews of the aggregate (format
  // config `point_preview`); external providers are read as-is.
  const usePreview = !externalSource && previewConfig.enabled;
  const urls = [sa.xyz_map, sa.labels, sa.lidar_id].map(asset =>
    asset?.uri ? assetUrl(usePreview ? previewName(asset.uri) : asset.uri) : null);
  const buffers = await fetchGroup("聚合点云", urls, signal, 2);
  if (!buffers || signal.aborted) return;
  const [xyzBuf, labBuf, lidBuf] = buffers;
  const lid = lidBuf ? new Uint8Array(lidBuf) : null;
  const xyz = new Float32Array(xyzBuf);
  const labels = new Uint8Array(labBuf);
  const n = labels.length;
  if (xyz.length !== n * 3) throw new Error("聚合点坐标与标签数量不匹配");
  staticAgg = {
    xyz,
    labels,
    lidar: lid,
    n,
    voxel: sa.voxel || 0.25,
    full: Boolean(pointAgg),
  };
  staticAggKey = key;
  loadState("聚合点云", `已加载 ${n.toLocaleString()} 点`, signal);
}

function inferLabelEncoding(labels) {
  if (!labels || !labels.length) return labelEncoding;
  const rg = labelGroups.find((g) => g.rawSets);
  if (!rg) {
    labelEncoding = "fine";
    return labelEncoding;
  }
  let max = 0;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] > max) max = labels[i];
    if (max > rg.rawMax) break;
  }
  labelEncoding = max <= rg.rawMax ? "raw" : "fine";
  return labelEncoding;
}

function labelToGroupName(g, lab) {
  const i = lab | 0;
  if (labelEncoding === "raw" && g.rawSets) {
    for (const name of g.order) if (g.rawSets.get(name).has(i)) return name;
    return g.noiseName;
  }
  if (i < 0 || i === 255 || (nFine && i >= nFine)) return g.noiseName;
  if (g.fineSets) for (const name of g.order) if (g.fineSets.get(name).has(i)) return name;
  return g.noiseName;
}

function activeLabelGroup() {
  return groupById.get(colorModeValue()) || null;
}

function colorModeValue() {
  return el.colorMode ? el.colorMode.value : "fine";
}

function readRoiFromInputs() {
  const a = (lo, hi) => {
    let x0 = Number(lo.value);
    let x1 = Number(hi.value);
    if (!(x0 < x1)) {
      const t = x0;
      x0 = x1;
      x1 = t;
    }
    return [x0, x1];
  };
  const [x0, x1] = a(el.roiX0, el.roiX1);
  const [y0, y1] = a(el.roiY0, el.roiY1);
  const [z0, z1] = a(el.roiZ0, el.roiZ1);
  roi = { x0, x1, y0, y1, z0, z1 };
  return roi;
}

function normalizeClassColors(raw) {
  if (!raw || !raw.length) return null;
  const out = [];
  let maxv = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (!c || c.length < 3) {
      out.push([180, 180, 180]);
      continue;
    }
    const r = Number(c[0]),
      g = Number(c[1]),
      b = Number(c[2]);
    out.push([r, g, b]);
    maxv = Math.max(maxv, r, g, b);
  }
  // Some exports store 0..1 floats; CSS/Three need 0..255.
  if (maxv > 0 && maxv <= 1.5) {
    for (let i = 0; i < out.length; i++) {
      out[i] = [
        Math.round(out[i][0] * 255),
        Math.round(out[i][1] * 255),
        Math.round(out[i][2] * 255),
      ];
    }
  } else {
    for (let i = 0; i < out.length; i++) {
      out[i] = [
        Math.round(out[i][0]),
        Math.round(out[i][1]),
        Math.round(out[i][2]),
      ];
    }
  }
  return out;
}

function resolveClassColors(meta) {
  // Prefer scene taxonomy (stable), then per-frame meta.
  const fromTax =
    index && index.taxonomy && index.taxonomy.fine && index.taxonomy.fine.colors_rgb;
  const fromMeta = meta && meta.class_colors_rgb;
  return normalizeClassColors(fromTax || fromMeta);
}

function colorFromLabel(label) {
  const grp = activeLabelGroup();
  if (grp) {
    const c = grp.colors[labelToGroupName(grp, label)] || grp.colors[grp.noiseName] || [160, 160, 160];
    return new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255);
  }
  const i = label | 0;
  if (!classColors || i < 0 || i >= classColors.length || !classColors[i]) {
    return new THREE.Color(0.7, 0.7, 0.7);
  }
  const c = classColors[i];
  return new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255);
}

function colorFromLidar(lid) {
  const c = Lcol[lid] || [160, 160, 160];
  return new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255);
}

function rgbCss(label) {
  const grp = activeLabelGroup();
  if (grp) {
    const c = grp.colors[labelToGroupName(grp, label)] || grp.colors[grp.noiseName] || [160, 160, 160];
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  const i = label | 0;
  if (!classColors || i < 0 || i >= classColors.length || !classColors[i]) {
    return "rgb(180,180,180)";
  }
  const c = classColors[i];
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function rgbCssLidar(lid) {
  const c = Lcol[lid] || [160, 160, 160];
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function syncColorModeUi() {
  const mode = colorModeValue();
  if (el.groupToggles) {
    for (const div of el.groupToggles.children) {
      div.style.display = div.dataset.group === mode ? "block" : "none";
    }
  }
  if (el.lidarToggles) el.lidarToggles.style.display = mode === "lidar" ? "block" : "none";
  renderClassLegend();
}

function renderClassLegend() {
  if (!el.classLegend) return;
  const mode = colorModeValue();
  const grp = activeLabelGroup();
  if (grp) {
    el.classLegend.innerHTML = grp.order.map((name) => {
      const c = grp.colors[name] || [160, 160, 160];
      return `<div class="legend-item" title="${name}">
        <i class="legend-swatch" style="background:rgb(${c[0]},${c[1]},${c[2]})"></i>
        <span>${name}</span>
      </div>`;
    }).join("");
    return;
  }
  if (mode === "lidar") {
    el.classLegend.innerHTML = lidarIdsList
      .map((lid) => {
        const c = Lcol[lid] || [160, 160, 160];
        return `<div class="legend-item" title="lidar_${lid}">
          <i class="legend-swatch" style="background:rgb(${c[0]},${c[1]},${c[2]})"></i>
          <span>lidar_${lid}</span>
        </div>`;
      })
      .join("");
    return;
  }
  if (!classColors || !classColors.length) {
    el.classLegend.innerHTML = `<span class="hint">No class colors in meta</span>`;
    return;
  }
  const names = classNames && classNames.length ? classNames : classColors.map((_, i) => `class ${i}`);
  el.classLegend.innerHTML = names
    .map((name, i) => {
      const c = classColors[i] || [180, 180, 180];
      return `<div class="legend-item" title="${i}: ${name}">
        <i class="legend-swatch" style="background:rgb(${c[0]},${c[1]},${c[2]})"></i>
        <span>${i} ${name}</span>
      </div>`;
    })
    .join("");
}

function updateRoiHelper() {
  if (roiHelper) {
    scene.remove(roiHelper);
    roiHelper.geometry.dispose();
    roiHelper.material.dispose();
    roiHelper = null;
  }
  if (!el.togRoiBox || !el.togRoiBox.checked) return;
  // Box in vehicle frame → Three via vehToThree (center); size along remapped axes.
  const cx = 0.5 * (roi.x0 + roi.x1);
  const cy = 0.5 * (roi.y0 + roi.y1);
  const cz = 0.5 * (roi.z0 + roi.z1);
  const sx = Math.max(1e-3, roi.x1 - roi.x0);
  const sy = Math.max(1e-3, roi.y1 - roi.y0);
  const sz = Math.max(1e-3, roi.z1 - roi.z0);
  const geo = new THREE.BoxGeometry(sx, sz, sy);
  const edges = new THREE.EdgesGeometry(geo);
  geo.dispose();
  const mat = new THREE.LineBasicMaterial({ color: 0xffcc33 });
  roiHelper = new THREE.LineSegments(edges, mat);
  vehToThree(cx, cy, cz, roiHelper.position);
  scene.add(roiHelper);
}

function clearOcc() {
  if (!occMesh) return;
  scene.remove(occMesh);
  occMesh.geometry.dispose();
  occMesh.material.dispose();
  occMesh = null;
}

function clearPoints() {
  if (!pointsObj) return;
  scene.remove(pointsObj);
  pointsObj.geometry.dispose();
  pointsObj.material.dispose();
  pointsObj = null;
}

/**
 * Place cubes on the occupancy lattice:
 *   center = origin + (ijk + 0.5) * voxel
 * not on raw point positions.
 */
function buildOccMesh() {
  renderPending = true;
  clearOcc();
  if (!occIjk || !occLabels || !currentMeta || !activeVoxel) return;
  const v = activeVoxel;
  const origin = [currentMeta.x_range[0], currentMeta.y_range[0], currentMeta.z_range[0]];
  const size = Math.max(1e-4, v * (1 - Number(el.occGap.value)) * Number(el.occGrow.value));
  const mode = colorModeValue();
  inferLabelEncoding(occLabels);
  // Hot loop over every voxel: hoist DOM state, precompute label visibility.
  const roiOn = !useClipAggregate() && !!(el.togRoiClip && el.togRoiClip.checked);
  const rx0 = roi.x0, rx1 = roi.x1, ry0 = roi.y0, ry1 = roi.y1, rz0 = roi.z0, rz1 = roi.z1;
  const ox = origin[0], oy = origin[1], oz = origin[2];
  const grp = activeLabelGroup();
  const vis = new Uint8Array(256);
  if (grp) {
    for (let lab = 0; lab < 256; lab++) vis[lab] = groupVisible(grp, labelToGroupName(grp, lab));
  } else {
    vis.fill(1);
  }
  const keep = [];
  const ijk = occIjk, labs = occLabels;
  for (let i = 0; i < labs.length; i++) {
    const o = i * 3;
    if (roiOn) {
      const x = ox + (ijk[o] + 0.5) * v;
      const y = oy + (ijk[o + 1] + 0.5) * v;
      const z = oz + (ijk[o + 2] + 0.5) * v;
      if (x < rx0 || x > rx1 || y < ry0 || y > ry1 || z < rz0 || z > rz1) continue;
    }
    if (!vis[labs[i]]) continue;
    keep.push(i);
  }
  const n = keep.length;
  occCenters = new Float32Array(n * 3);
  occProjIjk = new Int32Array(n * 3);
  occProjLabels = new Uint8Array(n);
  if (!n) return;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const palette = Array.from({ length: 256 }, (_, label) => {
    if (mode !== "lidar") return colorFromLabel(label);
    const c = classColors?.[label] || [180, 180, 180];
    return new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255);
  });
  for (let k = 0; k < n; k++) {
    const i = keep[k], o = k * 3;
    for (let axis = 0; axis < 3; axis++) {
      occProjIjk[o + axis] = occIjk[i * 3 + axis];
      occCenters[o + axis] = origin[axis] + (occIjk[i * 3 + axis] + 0.5) * v;
    }
    positions[o] = -occCenters[o];
    positions[o + 1] = occCenters[o + 2];
    positions[o + 2] = occCenters[o + 1];
    occProjLabels[k] = occLabels[i];
    palette[occLabels[i]].toArray(colors, o);
  }
  const opacity = pointsObj && el.togPts.checked ? Math.min(Number(el.occOpacity.value), 0.35) : Number(el.occOpacity.value);
  if (el.occStyle.value === "cubes") {
    occMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(size, size, size),
      new THREE.MeshBasicMaterial({ opacity, transparent: opacity < 1 }), n);
    const matrices = occMesh.instanceMatrix.array;
    for (let k = 0; k < n; k++) {
      const m = k * 16, o = k * 3;
      matrices[m] = matrices[m + 5] = matrices[m + 10] = matrices[m + 15] = 1;
      matrices[m + 12] = positions[o];
      matrices[m + 13] = positions[o + 1];
      matrices[m + 14] = positions[o + 2];
    }
    occMesh.instanceMatrix.needsUpdate = true;
    occMesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
  } else {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    occMesh = new THREE.Points(geometry, new THREE.PointsMaterial({
      size, sizeAttenuation: true, vertexColors: true, opacity, transparent: opacity < 1, depthWrite: false,
    }));
  }
  occMesh.frustumCulled = false;
  occMesh.visible = el.togOcc.checked;
  scene.add(occMesh);
}

function voxelizeFromPoints(voxel) {
  if (!ptXYZ || !ptLabels || !currentMeta) {
    throw new Error("Need exported points to rebuild occupancy");
  }
  const v = Math.max(0.05, Number(voxel));
  const x0 = currentMeta.x_range[0];
  const x1 = currentMeta.x_range[1];
  const y0 = currentMeta.y_range[0];
  const y1 = currentMeta.y_range[1];
  const z0 = currentMeta.z_range[0];
  const z1 = currentMeta.z_range[1];
  const nx = Math.max(1, Math.ceil((x1 - x0) / v));
  const ny = Math.max(1, Math.ceil((y1 - y0) / v));
  const nz = Math.max(1, Math.ceil((z1 - z0) / v));

  // key -> { bestLab, bestCnt, counts: Map }
  const cells = new Map();
  const n = ptLabels.length;
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const x = ptXYZ[o];
    const y = ptXYZ[o + 1];
    const z = ptXYZ[o + 2];
    if (x < x0 || x >= x1 || y < y0 || y >= y1 || z < z0 || z >= z1) continue;
    let ix = Math.floor((x - x0) / v);
    let iy = Math.floor((y - y0) / v);
    let iz = Math.floor((z - z0) / v);
    if (ix < 0) ix = 0;
    if (iy < 0) iy = 0;
    if (iz < 0) iz = 0;
    if (ix >= nx) ix = nx - 1;
    if (iy >= ny) iy = ny - 1;
    if (iz >= nz) iz = nz - 1;
    const key = ix + nx * (iy + ny * iz);
    const lab = ptLabels[i];
    let cell = cells.get(key);
    if (!cell) {
      cell = { ix, iy, iz, votes: new Map(), bestLab: lab, bestCnt: 0 };
      cells.set(key, cell);
    }
    const cnt = (cell.votes.get(lab) || 0) + 1;
    cell.votes.set(lab, cnt);
    if (cnt > cell.bestCnt) {
      cell.bestCnt = cnt;
      cell.bestLab = lab;
    }
  }

  const nOcc = cells.size;
  const ijk = new Int32Array(nOcc * 3);
  const labels = new Uint8Array(nOcc);
  let k = 0;
  for (const cell of cells.values()) {
    ijk[k * 3] = cell.ix;
    ijk[k * 3 + 1] = cell.iy;
    ijk[k * 3 + 2] = cell.iz;
    labels[k] = cell.bestLab;
    k += 1;
  }
  return { ijk, labels, voxel: v, nOcc };
}

function applyOccupancy(ijk, labels, voxel, sourceNote) {
  occIjk = ijk;
  occLabels = labels;
  activeVoxel = voxel;
  if (el.voxelSize) el.voxelSize.value = String(voxel);
  buildOccMesh();
  if (el.occRebuildHint) {
    el.occRebuildHint.textContent = `${sourceNote} · voxel=${voxel}m · n=${labels.length.toLocaleString()}`;
  }
  if (currentMeta) {
    const t = `${index.clip}  ·  ts=${currentMeta.timestamp}  ·  voxel=${voxel}m  ·  occ=${labels.length}`;
    el.titleMeta.textContent = t;
    el.titleMeta.title = t;
  }
}

function buildPoints() {
  renderPending = true;
  clearPoints();
  if (!ptXYZ || !ptLabels) return;
  inferLabelEncoding(ptLabels);
  const nAll = ptLabels.length;
  const mode = colorModeValue();
  const palette = Array.from({ length: 256 }, (_, label) => mode === "lidar" ? colorFromLidar(label) : colorFromLabel(label));
  // Hot loop over every point: hoist DOM state, precompute visibility LUTs.
  const roiOn = !useClipAggregate() && !!(el.togRoiClip && el.togRoiClip.checked);
  const rx0 = roi.x0, rx1 = roi.x1, ry0 = roi.y0, ry1 = roi.y1, rz0 = roi.z0, rz1 = roi.z1;
  const grp = activeLabelGroup();
  const vis = new Uint8Array(256);
  if (grp) {
    for (let lab = 0; lab < 256; lab++) vis[lab] = groupVisible(grp, labelToGroupName(grp, lab));
  } else {
    vis.fill(1);
  }
  const lidVis = new Uint8Array(256).fill(1);
  if (mode === "lidar") {
    for (let lid = 0; lid < 256; lid++) lidVis[lid] = lidarVisible(lid);
  }
  const keepIdx = [];
  for (let i = 0; i < nAll; i++) {
    if (roiOn) {
      const o = i * 3;
      const x = ptXYZ[o];
      const y = ptXYZ[o + 1];
      const z = ptXYZ[o + 2];
      if (x < rx0 || x > rx1 || y < ry0 || y > ry1 || z < rz0 || z > rz1) continue;
    }
    if (!vis[ptLabels[i]]) continue;
    if (mode === "lidar" && !lidVis[ptLidar ? ptLidar[i] : 0]) continue;
    keepIdx.push(i);
  }
  const n = keepIdx.length;
  if (n === 0) return;

  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const projXYZ = new Float32Array(n * 3);
  const projLab = new Uint8Array(n);
  const projLid = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const i = keepIdx[k];
    const o = i * 3;
    const pk = k * 3;
    // Display uses vehToThree; proj* stay in vehicle frame for cam projection.
    positions[pk] = -ptXYZ[o];
    positions[pk + 1] = ptXYZ[o + 2];
    positions[pk + 2] = ptXYZ[o + 1];
    projXYZ[pk] = ptXYZ[o];
    projXYZ[pk + 1] = ptXYZ[o + 1];
    projXYZ[pk + 2] = ptXYZ[o + 2];
    projLab[k] = ptLabels[i];
    projLid[k] = ptLidar ? ptLidar[i] : 0;
    const c = palette[mode === "lidar" ? projLid[k] : ptLabels[i]];
    colors[pk] = c.r;
    colors[pk + 1] = c.g;
    colors[pk + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: Number(el.ptSize.value),
    vertexColors: true,
    sizeAttenuation: true,
    depthWrite: false,
  });
  pointsObj = new THREE.Points(geo, mat);
  pointsObj.renderOrder = 2;
  pointsObj.visible = el.togPts.checked;
  pointsObj.userData.projXYZ = projXYZ;
  pointsObj.userData.projLab = projLab;
  pointsObj.userData.projLid = projLid;
  scene.add(pointsObj);
}

function rebuildColoredViews() {
  buildOccMesh();
  buildPoints();
  updateRoiHelper();
  refreshCamProjections();
}

function fitCamera(meta) {
  // Behind ego, elevated, look along +Y (Three +Z). Target ~40m ahead.
  const ahead = Math.min(80, Math.max(30, meta.y_range[1] * 0.15));
  controls.target.set(0, 1.2, ahead);
  camera.position.set(0, 55, -25);
  camera.up.set(0, 1, 0);
  controls.minDistance = 5;
  controls.maxDistance = 800;
  controls.update();
}

const ZERO_DIST5 = [0, 0, 0, 0, 0];

function projectionUsesDistortion() {
  return Boolean(el.projDistortion && el.projDistortion.checked);
}

/**
 * Project each occupied voxel cube onto the image:
 * 8 lattice corners → distorted UV → convex hull silhouette.
 * Skip any cube that is behind the camera, straddles the near plane,
 * or has a corner that flies outside a generous image FOV (avoids the
 * huge warped polygons on side/rear cams).
 */
function projectOccCubes(cam, maxCells = 60000) {
  const labs = occProjLabels || occLabels;
  const ijks = occProjIjk;
  if (!labs || !labs.length || !activeVoxel || !currentMeta || !ijks) return [];

  const v = activeVoxel;
  const x0 = currentMeta.x_range[0];
  const y0 = currentMeta.y_range[0];
  const z0 = currentMeta.z_range[0];
  const n = labs.length;
  let step = 1;
  if (n > maxCells) step = Math.ceil(n / maxCells);
  const { w, h } = camSize(cam);
  // Rectangular image bounds only — do NOT gate on r² (that draws a circle
  // on wide pinhole cams and looks like a wrong fisheye model).
  const uLo = -0.02 * w;
  const uHi = 1.02 * w;
  const vLo = -0.02 * h;
  const vHi = 1.02 * h;
  const nearZ = 1.0;
  const maxSpan = 0.12 * Math.max(w, h);

  // Hoisted projection state; per-corner math writes into one scratch point
  // instead of allocating a {u,v,z} object for each of the 8 corners.
  const useDist = projectionUsesDistortion();
  const T = cam.T_c_v_lidar_ref || cam.T_c_v;
  const K = cam.K;
  const fx = K[0], fy = K[4], cx = K[2], cy = K[5];
  const dist = useDist ? (cam.dist5 || ZERO_DIST5) : ZERO_DIST5;
  const k1 = dist[0] || 0, k2 = dist[1] || 0, p1 = dist[2] || 0, p2 = dist[3] || 0, k3 = dist[4] || 0;
  const fxBound = K[0] || 1000;
  const scratch = { u: 0, v: 0, z: 0 };
  const projectTo = (x, y, z) => {
    const xc = T[0] * x + T[1] * y + T[2] * z + T[3];
    const yc = T[4] * x + T[5] * y + T[6] * z + T[7];
    const zc = T[8] * x + T[9] * y + T[10] * z + T[11];
    if (zc <= 0.3) return false;
    let xn = xc / zc;
    let yn = yc / zc;
    if (useDist) {
      const r2 = xn * xn + yn * yn;
      // Guard extreme radtan (e.g. k3≈-3.8 on some rigs) outside reliable FOV.
      if (r2 > 1.2) return false;
      const r4 = r2 * r2;
      const radial = 1 + k1 * r2 + k2 * r4 + k3 * (r4 * r2);
      if (!Number.isFinite(radial) || Math.abs(radial) > 20) return false;
      const xpp = xn * radial + 2 * p1 * xn * yn + p2 * (r2 + 2 * xn * xn);
      const ypp = yn * radial + p1 * (r2 + 2 * yn * yn) + 2 * p2 * xn * yn;
      if (!Number.isFinite(xpp) || !Number.isFinite(ypp)) return false;
      xn = xpp;
      yn = ypp;
    }
    const u = fx * xn + cx;
    const vv = fy * yn + cy;
    if (!Number.isFinite(u) || !Number.isFinite(vv)) return false;
    scratch.u = u;
    scratch.v = vv;
    scratch.z = zc;
    return true;
  };
  const cornerUV = new Float64Array(16);

  const quads = [];
  for (let i = 0; i < n; i += step) {
    const ix = ijks[i * 3];
    const iy = ijks[i * 3 + 1];
    const iz = ijks[i * 3 + 2];
    const xa = x0 + ix * v;
    const xb = x0 + (ix + 1) * v;
    const ya = y0 + iy * v;
    const yb = y0 + (iy + 1) * v;
    const za = z0 + iz * v;
    const zb = z0 + (iz + 1) * v;
    if (!projectTo(0.5 * (xa + xb), 0.5 * (ya + yb), 0.5 * (za + zb))) continue;
    if (scratch.z < nearZ) continue;
    // Center must land inside the image — otherwise corner hulls become
    // huge radial wings (esp. strong radtan wide cams).
    if (scratch.u < 0 || scratch.u >= w || scratch.v < 0 || scratch.v >= h) continue;

    let zSum = 0;
    let ok = true;
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (let c = 0; c < 8; c++) {
      // All 8 corners must be valid — partial cubes → huge warped shards.
      if (!projectTo(c & 1 ? xb : xa, c & 2 ? yb : ya, c & 4 ? zb : za)) { ok = false; break; }
      const u = scratch.u, vv = scratch.v;
      if (scratch.z < nearZ || u < uLo || u > uHi || vv < vLo || vv > vHi) { ok = false; break; }
      cornerUV[c * 2] = u;
      cornerUV[c * 2 + 1] = vv;
      zSum += scratch.z;
      if (u < uMin) uMin = u;
      if (u > uMax) uMax = u;
      if (vv < vMin) vMin = vv;
      if (vv > vMax) vMax = vv;
    }
    if (!ok) continue;
    if (uMax - uMin > maxSpan || vMax - vMin > maxSpan) continue;
    // Drop cubes whose silhouette is far larger than a voxel at that depth
    // (strong radtan otherwise paints huge wing shards).
    const zMean = zSum / 8;
    const expect = (2.5 * v * fxBound) / Math.max(zMean, nearZ);
    if (uMax - uMin > Math.max(24, 3 * expect) || vMax - vMin > Math.max(24, 3 * expect)) {
      continue;
    }
    const pts = [];
    for (let c = 0; c < 8; c++) pts.push({ u: cornerUV[c * 2], v: cornerUV[c * 2 + 1] });
    const hull = convexHull2D(pts);
    if (hull.length < 3) continue;
    quads.push({
      pts: hull,
      z: zMean,
      lab: labs[i],
    });
  }
  quads.sort((a, b) => b.z - a.z);
  return quads;
}

/** Monotone chain convex hull/** Monotone chain convex hull on {u,v} points (returns CCW). */
function convexHull2D(points) {
  const pts = points.slice().sort((a, b) => (a.u === b.u ? a.v - b.v : a.u - b.u));
  if (pts.length <= 2) return pts;
  const cross = (o, a, b) => (a.u - o.u) * (b.v - o.v) - (a.v - o.v) * (b.u - o.u);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function fillStyleForOccLab(lab) {
  const cmode = colorModeValue();
  if (cmode === "lidar") {
    const i = lab | 0;
    const c =
      classColors && i >= 0 && i < classColors.length && classColors[i]
        ? classColors[i]
        : [180, 180, 180];
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  return rgbCss(lab);
}

function projectVehToImage(xyz, labels, cam, maxN = 120000, lidarIds = null) {
  const K = cam.K;
  const T = cam.T_c_v_lidar_ref || cam.T_c_v;
  const dist = projectionUsesDistortion()
    ? (cam.dist5 || [0, 0, 0, 0, 0])
    : [0, 0, 0, 0, 0];
  const { w, h } = camSize(cam);
  const fx = K[0], fy = K[4], cx = K[2], cy = K[5];
  const k1 = dist[0] || 0, k2 = dist[1] || 0, p1 = dist[2] || 0, p2 = dist[3] || 0, k3 = dist[4] || 0;
  const nAll = labels.length;
  const step = nAll > maxN ? Math.ceil(nAll / maxN) : 1;
  const classFilter = el.projClassFilter ? el.projClassFilter.value : "all";
  const classFilterN = classFilter !== "all" ? Number(classFilter) : null;
  const lidVis = new Uint8Array(256).fill(1);
  if (lidarIds) {
    for (let lid = 0; lid < 256; lid++) lidVis[lid] = lidarVisible(lid);
  }
  const out = [];
  for (let i = 0; i < nAll; i += step) {
    if (lidarIds && !lidVis[lidarIds[i]]) continue;
    if (classFilterN !== null && labels[i] !== classFilterN) continue;
    const o = i * 3;
    const x = xyz[o], y = xyz[o + 1], z = xyz[o + 2];
    const xc = T[0] * x + T[1] * y + T[2] * z + T[3];
    const yc = T[4] * x + T[5] * y + T[6] * z + T[7];
    const zc = T[8] * x + T[9] * y + T[10] * z + T[11];
    if (zc <= 0.3) continue;
    let xn = xc / zc;
    let yn = yc / zc;
    const r2 = xn * xn + yn * yn;
    const r4 = r2 * r2;
    const r6 = r4 * r2;
    const radial = 1 + k1 * r2 + k2 * r4 + k3 * r6;
    const xpp = xn * radial + 2 * p1 * xn * yn + p2 * (r2 + 2 * xn * xn);
    const ypp = yn * radial + p1 * (r2 + 2 * yn * yn) + 2 * p2 * xn * yn;
    const u = fx * xpp + cx;
    const v = fy * ypp + cy;
    if (u < -40 || v < -40 || u >= w + 40 || v >= h + 40) continue;
    out.push({
      u,
      v,
      z: zc,
      lab: labels[i],
      lid: lidarIds ? lidarIds[i] : 0,
      zVeh: z,
      fx,
      fy,
    });
  }
  out.sort((a, b) => b.z - a.z);
  return out;
}

// Deliberately discrete and non-adjacent in RGB space. Smooth ramps hide
// sub-metre objects; these bands make a cone cross several obvious colors.
const HEIGHT_BAND_CSS = [
  "rgb(25,25,210)",
  "rgb(0,120,255)",
  "rgb(0,235,255)",
  "rgb(0,220,80)",
  "rgb(245,245,0)",
  "rgb(255,145,0)",
  "rgb(255,35,20)",
  "rgb(255,0,190)",
];
function heightRgbCss(z, zMin, zMax) {
  const span = Math.max(1e-6, zMax - zMin);
  const t = Math.max(0, Math.min(1, (z - zMin) / span));
  return HEIGHT_BAND_CSS[Math.min(HEIGHT_BAND_CSS.length - 1, Math.floor(t * HEIGHT_BAND_CSS.length))];
}

/**
 * Occupancy: each voxel cube projected as filled faces (8 corners → 6 faces).
 * Points: single image pixels (optional min px from slider)
 * RGB photo is always drawn first; overlays stay semi-transparent.
 */
function drawProjectionOnCanvas(canvas, img, cam, mode, ptMinPx = 1) {
  // RGB thumbnails use the decoded image directly; canvas work is only for overlays.
  if (canvas.classList.contains("thumb")) {
    const rgb = mode === "none" && img?.naturalWidth > 0;
    img.style.display = rgb ? "block" : "none";
    canvas.hidden = rgb;
    if (rgb) return 0;
  }
  const ctx = canvas.getContext("2d");
  const cw = canvas.width;
  const ch = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, cw, ch);
  const { w: camW, h: camH } = camSize(cam, img);
  const scale = Math.min(cw / camW, ch / camH);
  const dw = camW * scale;
  const dh = camH * scale;
  const ox = (cw - dw) / 2;
  const oy = (ch - dh) / 2;
  const hasImg = img && img.complete && img.naturalWidth > 0;
  if (hasImg) {
    ctx.drawImage(img, ox, oy, dw, dh);
  } else {
    ctx.fillStyle = "#222";
    ctx.fillRect(ox, oy, dw, dh);
    ctx.fillStyle = "#888";
    ctx.font = "14px sans-serif";
    ctx.fillText(img?.dataset.error || "图片加载中…", ox + 12, oy + 28);
  }

  if (mode === "none") return 0;
  if (!cam.K || !(cam.T_c_v_lidar_ref || cam.T_c_v)) {
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(ox, oy, Math.min(dw, 360), 30);
    ctx.fillStyle = "#fff";
    ctx.font = "14px sans-serif";
    ctx.fillText("RGB only: projection calibration unavailable", ox + 8, oy + 20);
    return 0;
  }

  const alpha = el.projAlpha ? Number(el.projAlpha.value) : 0.4;
  const maxN = canvas.width >= camW * 0.8 ? 160000 : 70000;

  let n = 0;
  if (mode === "occ" || mode === "both") {
    if (occProjIjk && occProjLabels && occProjLabels.length && activeVoxel) {
      const faces = projectOccCubes(cam, maxN);
      const occStyles = new Array(256);
      for (let lab = 0; lab < 256; lab++) occStyles[lab] = fillStyleForOccLab(lab);
      ctx.globalAlpha = alpha;
      for (const q of faces) {
        ctx.fillStyle = occStyles[q.lab];
        ctx.beginPath();
        ctx.moveTo(ox + q.pts[0].u * scale, oy + q.pts[0].v * scale);
        for (let k = 1; k < q.pts.length; k++) {
          ctx.lineTo(ox + q.pts[k].u * scale, oy + q.pts[k].v * scale);
        }
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      n += faces.length;
    }
  }

  if (mode === "points" || mode === "both") {
    const wantFrame = !el.projPointSource || el.projPointSource.value === "frame";
    const useFrame = wantFrame && framePtXYZ && framePtLabels;
    const useFilt = !useFrame && pointsObj && pointsObj.userData && pointsObj.userData.projXYZ;
    const xyz = useFrame ? framePtXYZ : (useFilt ? pointsObj.userData.projXYZ : ptXYZ);
    const labs = useFrame ? framePtLabels : (useFilt ? pointsObj.userData.projLab : ptLabels);
    const lids = useFrame ? framePtLidar : (useFilt ? pointsObj.userData.projLid : ptLidar);
    if (xyz && labs && labs.length) {
      const pts = projectVehToImage(xyz, labs, cam, maxN, lids);
      const sourcePx = Math.max(1, ptMinPx | 0);
      const px = Math.max(1, sourcePx * scale);
      const cmode = colorModeValue();
      const heightMode = el.projColorMode && el.projColorMode.value === "height";
      const filterValue = el.projClassFilter ? el.projClassFilter.value : "all";
      const activeFilter = (uiConfig.point_filters || []).find((f) => String(f.value) === filterValue);
      const hl = activeFilter && activeFilter.highlight_rgb;
      const highlightCss = hl ? `rgb(${hl[0]},${hl[1]},${hl[2]})` : null;
      const hr = uiConfig.height_range || [-3, 3];
      let zMin = el.projHeightMin ? Number(el.projHeightMin.value) : hr[0];
      let zMax = el.projHeightMax ? Number(el.projHeightMax.value) : hr[1];
      if (!Number.isFinite(zMin)) zMin = hr[0];
      if (!Number.isFinite(zMax)) zMax = hr[1];
      if (zMax <= zMin) zMax = zMin + 0.1;
      // Per-label fill styles are constant for the whole batch — build once
      // instead of re-reading the DOM and formatting strings per point.
      let labStyles = null;
      let lidStyles = null;
      if (cmode === "lidar") {
        lidStyles = new Array(256);
        for (let lid = 0; lid < 256; lid++) lidStyles[lid] = rgbCssLidar(lid);
      } else {
        labStyles = new Array(256);
        for (let lab = 0; lab < 256; lab++) labStyles[lab] = rgbCss(lab);
      }
      ctx.globalAlpha = alpha;
      for (const p of pts) {
        // Do not add hidden opacity: dense full-frame deskew points otherwise
        // cover the RGB image and make a successfully loaded frame look blank.
        ctx.fillStyle = highlightCss
          || (heightMode
            ? heightRgbCss(p.zVeh, zMin, zMax)
            : (cmode === "lidar" ? lidStyles[p.lid || 0] : labStyles[p.lab]));
        ctx.fillRect(
          ox + p.u * scale - px * 0.5,
          oy + p.v * scale - px * 0.5,
          px,
          px
        );
      }
      ctx.globalAlpha = 1;
      n += pts.length;
    }
  }
  return n;
}

function refreshCamProjections() {
  if (!currentMeta) return;
  const mode = el.projMode.value;
  const radius = Number(el.projRadius.value);
  el.cams.querySelectorAll(".cam-card").forEach((card) => {
    const canvas = card.querySelector("canvas.thumb");
    const img = card.querySelector("img.base");
    const cam = card._cam;
    if (!canvas || !cam) return;
    drawProjectionOnCanvas(canvas, img, cam, mode, radius);
  });
  if (el.lightbox.classList.contains("open") && lb.cam && lb.img) {
    drawProjectionOnCanvas(el.lbCanvas, lb.img, lb.cam, mode, radius);
  }
}

function applyLbTransform() {
  const c = el.lbCanvas;
  c.style.transform = `translate(calc(-50% + ${lb.tx}px), calc(-50% + ${lb.ty}px)) scale(${lb.scale})`;
}

function openLightbox(cam, img) {
  lb.img = img;
  lb.cam = cam;
  lb.tx = 0;
  lb.ty = 0;
  el.lbTitle.textContent = cam.name;
  const c = el.lbCanvas;
  // Native-ish resolution so zoom stays sharp
  const { w: lbW, h: lbH } = camSize(cam, img);
  c.width = lbW;
  c.height = lbH;
  drawProjectionOnCanvas(c, img, cam, el.projMode.value, Number(el.projRadius.value));
  // Fit into stage on open (then Zoom+/wheel to enlarge)
  const sw = Math.max(320, el.lbStage.clientWidth - 40);
  const sh = Math.max(240, el.lbStage.clientHeight - 40);
  lb.scale = Math.min(1, sw / lbW, sh / lbH);
  applyLbTransform();
  el.lightbox.classList.add("open");
}

function closeLightbox() {
  el.lightbox.classList.remove("open");
}

el.lbClose.addEventListener("click", closeLightbox);
el.lbZoomIn.addEventListener("click", () => {
  lb.scale = Math.min(8, lb.scale * 1.25);
  applyLbTransform();
});
el.lbZoomOut.addEventListener("click", () => {
  lb.scale = Math.max(0.2, lb.scale / 1.25);
  applyLbTransform();
});
el.lbReset.addEventListener("click", () => {
  lb.tx = 0;
  lb.ty = 0;
  if (lb.cam) {
    const sw = Math.max(320, el.lbStage.clientWidth - 40);
    const sh = Math.max(240, el.lbStage.clientHeight - 40);
    const sz = camSize(lb.cam);
    lb.scale = Math.min(1, sw / sz.w, sh / sz.h);
  } else {
    lb.scale = 1;
  }
  applyLbTransform();
});
el.lbStage.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const f = e.deltaY > 0 ? 0.9 : 1.1;
    lb.scale = Math.min(8, Math.max(0.2, lb.scale * f));
    applyLbTransform();
  },
  { passive: false }
);
el.lbStage.addEventListener("pointerdown", (e) => {
  lb.dragging = true;
  lb.lx = e.clientX;
  lb.ly = e.clientY;
  el.lbStage.classList.add("dragging");
  el.lbStage.setPointerCapture(e.pointerId);
});
el.lbStage.addEventListener("pointermove", (e) => {
  if (!lb.dragging) return;
  lb.tx += e.clientX - lb.lx;
  lb.ty += e.clientY - lb.ly;
  lb.lx = e.clientX;
  lb.ly = e.clientY;
  applyLbTransform();
});
el.lbStage.addEventListener("pointerup", () => {
  lb.dragging = false;
  el.lbStage.classList.remove("dragging");
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeLightbox();
});

async function renderCams(meta, signal) {
  el.cams.innerHTML = "";
  const cameras = meta.assets?.cameras || meta.cameras || [];
  let done = 0, failed = 0;
  const report = () => loadState("相机图片", cameras.length
    ? `成功 ${done}/${cameras.length}${failed ? ` · 失败 ${failed}` : ""}` : "无数据", signal);
  report();
  await Promise.all(cameras.map(async cam => {
    const card = document.createElement("div");
    card.className = "cam-card";
    card._cam = cam;
    const name = document.createElement("div");
    name.className = "name";
    const sz = camSize(cam);
    const cameraName = document.createElement("span");
    cameraName.textContent = cam.name;
    const cameraSize = document.createElement("span");
    cameraSize.textContent = "加载中…";
    name.append(cameraName, cameraSize);
    const stage = document.createElement("div");
    stage.className = "stage";
    const img = document.createElement("img");
    img.className = "base";
    img.crossOrigin = "anonymous";
    img.style.display = "none";
    const canvas = document.createElement("canvas");
    canvas.className = "thumb";
    canvas.width = 1280;
    canvas.height = 720;
    stage.appendChild(img);
    stage.appendChild(canvas);
    stage.addEventListener("click", () => openLightbox(cam, img));
    card.appendChild(name);
    card.appendChild(stage);
    card.addEventListener("click", (e) => {
      if (e.target.closest(".stage")) return;
      [...el.cams.children].forEach((c) => c.classList.remove("active"));
      card.classList.add("active");
    });
    el.cams.appendChild(card);
    drawProjectionOnCanvas(canvas, img, cam, "none");
    let objectUrl;
    try {
      const blob = await fetchResource(camImageUrl(cam), "blob", signal);
      objectUrl = URL.createObjectURL(blob);
      img.src = objectUrl;
      await img.decode();
      signal.throwIfAborted();
      cameraSize.textContent = `${sz.w}×${sz.h} · click to zoom`;
      done++;
    } catch (error) {
      if (signal.aborted) return;
      failed++;
      img.dataset.error = `图片失败：${error.message}`;
      cameraSize.textContent = img.dataset.error;
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
    drawProjectionOnCanvas(canvas, img, cam, el.projMode.value, Number(el.projRadius.value));
    report();
  }));
}

async function loadFrame(frameEntry, signal) {
  loadState("帧信息", "读取中…", signal);
  frameDir =
    frameEntry.dir ||
    (frameEntry.meta_uri ? frameEntry.meta_uri.replace(/\/meta\.json$/, "") : null);
  const metaUrl = frameEntry.meta_uri
    ? assetUrl(frameEntry.meta_uri)
    : `${sceneRoot}/${frameDir}/meta.json`;
  const meta = await fetchJson(metaUrl, signal);
  loadState("帧信息", "已加载", signal);
  currentMeta = meta;
  classColors = resolveClassColors(meta);
  classNames =
    (index && index.taxonomy && index.taxonomy.fine && index.taxonomy.fine.names) ||
    meta.class_names ||
    null;
  renderClassLegend();
  const title = `${index.clip_id || index.clip}  ·  ts=${meta.timestamp}  ·  voxel=${(meta.grid && meta.grid.voxel) || meta.voxel}m  ·  occ=${(meta.stats && meta.stats.n_occ) || meta.n_occ}`;
  el.titleMeta.textContent = title;
  el.titleMeta.title = title;

  // normalize ranges for ROI/grid helpers
  if (meta.grid) {
    meta.voxel = meta.grid.voxel;
    meta.x_range = meta.grid.x_range;
    meta.y_range = meta.grid.y_range;
    meta.z_range = meta.grid.z_range;
    meta.occ_shape = meta.grid.shape;
    meta.n_occ = (meta.stats && meta.stats.n_occ) || meta.n_occ;
  }

  activeVoxel = meta.voxel;
  fitCamera(meta);
  const camerasReady = renderCams(meta, signal)
    .catch(error => loadState("相机图片", `失败：${error.message}`, signal));
  const aggregateReady = useClipAggregate()
    ? loadStaticAggFromIndex(signal).catch(error => loadState("聚合点云", `失败：${error.message}`, signal))
    : Promise.resolve(loadState("聚合点云", "按需加载：选择 Clip aggregate", signal));
  const pointsReady = fetchGroup("帧点云bin", ["xyz", "labels", "lidar_id"].map(key => pointsAsset(meta, key)), signal, 2);
  const sensorReady = fetchGroup("传感器点云", ["xyz", "labels", "lidar_id"].map(key => frameSensorPointsAsset(meta, key)), signal, 2);
  const occupancyReady = (async () => {
    const buffers = await fetchGroup("OCC", [occAsset(meta, "ijk"), occAsset(meta, "labels")], signal);
    if (!buffers || signal.aborted) return;
    try {
      const ijk = new Int32Array(buffers[0]);
      const labels = new Uint8Array(buffers[1]);
      if (ijk.length !== labels.length * 3) throw new Error("体素坐标与标签数量不匹配");
      exportedOcc = { voxel: meta.voxel, ijk, labels };
      applyOccupancy(ijk, labels, meta.voxel, "exported grid");
      loadState("OCC", `已加载 ${labels.length.toLocaleString()} 体素`, signal);
      refreshCamProjections();
    } catch (error) { loadState("OCC", `失败：${error.message}`, signal); }
  })();
  let ptsNote = "not exported";
  let frameDynXYZ = null;
  let frameDynLab = null;
  let frameDynLid = null;

  const buffers = await pointsReady;
  signal.throwIfAborted();
  if (buffers) {
    try {
      const rawXYZ = new Float32Array(buffers[0]);
      const rawLab = new Uint8Array(buffers[1]);
      const rawLid = buffers[2] ? new Uint8Array(buffers[2]) : null;
      if (rawXYZ.length !== rawLab.length * 3) throw new Error("点坐标与标签数量不匹配");
      if (useClipAggregate()) {
        // Keep frame dynamic only — static comes from clip static_agg + ego_pose.
        const dynIdx = [];
        for (let i = 0; i < rawLab.length; i++) {
          if (dynFineIds.has(rawLab[i] | 0)) dynIdx.push(i);
        }
        frameDynXYZ = new Float32Array(dynIdx.length * 3);
        frameDynLab = new Uint8Array(dynIdx.length);
        frameDynLid = new Uint8Array(dynIdx.length);
        for (let k = 0; k < dynIdx.length; k++) {
          const i = dynIdx[k];
          frameDynXYZ[k * 3] = rawXYZ[i * 3];
          frameDynXYZ[k * 3 + 1] = rawXYZ[i * 3 + 1];
          frameDynXYZ[k * 3 + 2] = rawXYZ[i * 3 + 2];
          frameDynLab[k] = rawLab[i];
          frameDynLid[k] = rawLid ? rawLid[i] : 0;
        }
      }
      ptXYZ = rawXYZ;
      ptLabels = rawLab;
      ptLidar = rawLid;
      framePtXYZ = rawXYZ;
      framePtLabels = rawLab;
      framePtLidar = rawLid;
      ptsNote = rawLab.length.toLocaleString();
    } catch (e) {
      ptsNote = "加载失败";
      loadState("帧点云bin", `失败：${e.message}`, signal);
    }
  }

  function displayPoints() {
    if (ptXYZ && ptLabels) {
      inferLabelEncoding(ptLabels);
      try {
        buildPoints();
        loadState("点云显示", `已显示 ${ptLabels.length.toLocaleString()} 点`, signal);
        let xmin = Infinity,
          xmax = -Infinity,
          ymin = Infinity,
          ymax = -Infinity,
          zmin = Infinity,
          zmax = -Infinity;
        for (let i = 0; i < ptXYZ.length; i += 3) {
          xmin = Math.min(xmin, ptXYZ[i]);
          xmax = Math.max(xmax, ptXYZ[i]);
          ymin = Math.min(ymin, ptXYZ[i + 1]);
          ymax = Math.max(ymax, ptXYZ[i + 1]);
          zmin = Math.min(zmin, ptXYZ[i + 2]);
          zmax = Math.max(zmax, ptXYZ[i + 2]);
        }
        document.getElementById("axisHelp").innerHTML = `
          Arrows follow stored numeric signs.<br/>
          <span style="color:var(--x)">+X</span> x∈[${xmin.toFixed(1)}, ${xmax.toFixed(1)}]<br/>
          <span style="color:var(--y)">+Y</span> y∈[${ymin.toFixed(1)}, ${ymax.toFixed(1)}]<br/>
          <span style="color:var(--z)">+Z</span> z∈[${zmin.toFixed(1)}, ${zmax.toFixed(1)}]<br/>
          Three map: (x,z,y) so XY ground stays horizontal.
        `;
      } catch (e) {
        ptsNote = "构建失败";
        loadState("点云显示", `失败：${e.message}`, signal);
      }
    }
    if (pointsObj && el.togPts.checked && occMesh && el.togOcc.checked) {
      occMesh.material.transparent = true;
      occMesh.material.opacity = Math.min(Number(el.occOpacity.value), 0.35);
      occMesh.material.needsUpdate = true;
    }
    syncColorModeUi();
    updateRoiHelper();
    refreshCamProjections();
  }

  // Show the current frame before waiting for any clip-wide or auxiliary data.
  displayPoints();
  if (pointsObj) {
    el.sceneInfo.textContent = `当前帧点云：${ptsNote} 点。`;
    setStatus("当前帧点云可查看；其他资产仍在加载…");
  }
  const sensorBuffers = await sensorReady;
  await aggregateReady;
  signal.throwIfAborted();
  if (sensorBuffers) {
    framePtXYZ = new Float32Array(sensorBuffers[0]);
    framePtLabels = new Uint8Array(sensorBuffers[1]);
    framePtLidar = sensorBuffers[2] ? new Uint8Array(sensorBuffers[2]) : null;
  }

  if (useClipAggregate() && staticAgg && egoPoseRecord(meta.ego_pose)) {
    const xr = meta.x_range;
    const yr = meta.y_range;
    const zr = meta.z_range;
    const st = staticAggInVehicle(
      egoPoseRecord(meta.ego_pose),
      staticAgg.full ? null : [xr[0] * 1.5, xr[1] * 1.5],
      staticAgg.full ? null : yr,
      staticAgg.full ? null : [zr[0] - 2, zr[1] + 5]
    );
    const merged = staticAgg.full
      ? st
      : mergeStaticAndDynamicPoints(st, frameDynXYZ, frameDynLab, frameDynLid);
    if (merged && merged.xyz) {
      ptXYZ = merged.xyz;
      ptLabels = merged.labels;
      ptLidar = merged.lidar;
    }
    if (merged && merged.labels) {
      framePtXYZ = merged.xyz;
      framePtLabels = merged.labels;
      framePtLidar = merged.lidar;
      ptsNote = useClipAggregate()
        ? `${merged.labels.length.toLocaleString()} (clip aggregate → current vehicle)`
        : `${merged.labels.length.toLocaleString()} (vehicle ROI)`;
      displayPoints();
    }
  }

  await Promise.all([occupancyReady, camerasReady]);
  signal.throwIfAborted();
  const odBoxCount = buildOdBoxes(meta);

  el.sceneInfo.innerHTML = `
    <div>occ voxels: <b>${occLabels ? occLabels.length.toLocaleString() : "未加载"}</b></div>
    <div>active voxel: <b>${activeVoxel}m</b> (exported ${meta.voxel}m)</div>
    <div>grid snap: floor((p-origin)/v)</div>
    <div>x: [${meta.x_range.join(", ")}]</div>
    <div>y: [${meta.y_range.join(", ")}]</div>
    <div>z: [${meta.z_range.join(", ")}]</div>
    <div>points: <b>${ptsNote}</b></div>
    <div>OD boxes: <b>${odBoxCount}</b> (yellow=oracle ID matched, red=unmatched)</div>
  `;


  if (loadStarted) loadElapsedMs = performance.now() - loadStarted;
  loadFinished = true;
  showLoadProgress();
  const failed = [...loadStates.values()].some(state => state.includes("失败"));
  setStatus(`${failed ? "部分加载失败，详见左侧，可重试" : "ready"} · occ=${occLabels?.length || 0} · voxel=${activeVoxel}m · points=${ptsNote}`);
}

function updateFramePos() {
  if (!el.framePos || !index || !index.frames) {
    if (el.framePos) el.framePos.textContent = "—";
    return;
  }
  const n = index.frames.length;
  const i = Math.min(Math.max(0, frameIndex), Math.max(0, n - 1));
  el.framePos.textContent = n ? `${i + 1} / ${n}` : "—";
  if (el.btnPrevFrame) el.btnPrevFrame.disabled = i <= 0;
  if (el.btnNextFrame) el.btnNextFrame.disabled = i >= n - 1;
}

async function loadFrameByIndex(i) {
  if (!index || !index.frames || !index.frames.length) return;
  const n = index.frames.length;
  frameIndex = ((i % n) + n) % n;
  const signal = beginLoad("正在加载当前帧…");
  const fr = index.frames[frameIndex];
  if (fr.meta_uri && !fr.dir) {
    fr.dir = fr.meta_uri.replace(/\/meta\.json$/, "");
  }
  if (el.frameSelect) {
    el.frameSelect.value = String(fr.timestamp || fr.frame_id);
  }
  updateFramePos();
  try {
    await loadFrame(fr, signal);
  } catch (error) {
    loadFailure(error, signal);
  }
}

async function loadClip(clipId, root) {
  const entry = clipsCatalog.find((c) => c.id === clipId || c.clip_id === clipId);
  sceneRoot = occUrl((root || entry?.url || `/scenes/${clipId}`).replace(/\/$/, ""));
  // keep URL shareable
  const u = new URL(location.href);
  u.searchParams.set("scene", sceneRoot);
  history.replaceState(null, "", u);
  const signal = beginLoad("正在读取场景…");
  loadState("场景目录", "读取中…", signal);
  clipAggFitted = false;
  index = null;
  try {
    index = await fetchJson(`${sceneRoot}/index.json`, signal);
    if (externalSource) applyProfile(index);
    if (!index.clip && index.clip_id) index.clip = index.clip_id;
    if (el.occVariant) {
      const config = index.occupancy_variants;
      el.occVariant.innerHTML = "";
      const variants = (config && config.variants) ||
        (uiConfig.occ_variants && uiConfig.occ_variants.length
          ? uiConfig.occ_variants
          : [{ id: "default", name: "default" }]);
      for (const variant of variants) {
        const opt = document.createElement("option");
        opt.value = variant.id;
        opt.textContent = variant.name || variant.id;
        el.occVariant.appendChild(opt);
      }
      currentOccVariant = (config && config.default) || variants[0].id;
      el.occVariant.value = currentOccVariant;
    }
    el.frameSelect.innerHTML = "";
    for (const fr of index.frames) {
      const opt = document.createElement("option");
      opt.value = String(fr.timestamp || fr.frame_id);
      opt.textContent = `${fr.timestamp || fr.frame_id}  (occ=${fr.n_occ})`;
      el.frameSelect.appendChild(opt);
    }
    if (!index.frames.length) {
      if (loadStarted) loadElapsedMs = performance.now() - loadStarted;
  loadFinished = true;
      loadState("场景目录", "没有帧");
      setStatus("No frames in index.json");
      updateFramePos();
      return;
    }
    await loadFrameByIndex(0);
    if (typeof refreshVideoList === "function") refreshVideoList();
  } catch (error) { loadFailure(error, signal); }
}

async function boot() {
  applyProfile();
  // Best-effort in every mode: the server format profile is the base layer;
  // an external scene index may still override it later in loadClip.
  let formatConfig = null;
  try { formatConfig = await fetchJson(occUrl("/api/config")); }
  catch (e) { if (!externalSource) setStatus(`config fallback: ${e}`); }
  if (formatConfig) applyProfile(formatConfig);
  if (mongoSource) {
    const { connectGss } = await import("./gss.js");
    await connectGss({ select: el.clipSelect, load: clip => loadClip(clip.id, clip.url), fetchJson, status: setStatus, config: formatConfig });
    return;
  }
  if (externalSource) {
    if (!sceneRoot) throw new Error("An external scene URL is required.");
    const sceneURL = new URL(sceneRoot, location.href);
    if (sceneURL.origin !== location.origin) throw new Error("External scenes must use the same origin.");
    if (el.clipSelect) {
      el.clipSelect.replaceChildren(new Option("Selected scene", "external"));
      el.clipSelect.disabled = true;
    }
    await loadClip("external", sceneRoot);
    return;
  }
  try {
    const cat = await fetchJson(occUrl("/api/clips"));
    clipsCatalog = cat.clips || [];
    const preferred =
      clipIdFromScene(sceneRoot) ||
      cat.default_clip ||
      (clipsCatalog[0] && clipsCatalog[0].id);
    if (el.clipSelect) {
      el.clipSelect.innerHTML = "";
      for (const c of clipsCatalog) {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = `${c.id}  (${c.n_frames} frames)`;
        el.clipSelect.appendChild(opt);
      }
      if (preferred && clipsCatalog.some((c) => c.id === preferred)) {
        el.clipSelect.value = preferred;
      } else if (clipsCatalog.length) {
        el.clipSelect.value = clipsCatalog[0].id;
      }
    }
    if (clipsCatalog.length) {
      await loadClip(el.clipSelect ? el.clipSelect.value : preferred);
      return;
    }
  } catch (e) {
    console.warn(" /api/clips unavailable, fallback single scene", e);
  }
  // Legacy single scenes use the same loading path.
  await loadClip("legacy", sceneRoot || occUrl("/scene"));
}

document.getElementById("btnRetry").addEventListener("click", () => {
  if (index?.frames?.length) loadFrameByIndex(frameIndex);
  else location.reload();
});
el.frameSelect.addEventListener("change", async () => {
  if (!index?.frames) return;
  const i = index.frames.findIndex(
    (f) => String(f.timestamp || f.frame_id) === String(el.frameSelect.value)
  );
  if (i >= 0) await loadFrameByIndex(i);
});
if (el.occVariant) {
  el.occVariant.addEventListener("change", async () => {
    currentOccVariant = el.occVariant.value;
    await loadFrameByIndex(frameIndex);
  });
}
if (el.clipSelect && !mongoSource) {
  el.clipSelect.addEventListener("change", async () => {
    await loadClip(el.clipSelect.value);
  });
}
if (el.btnPrevFrame) {
  el.btnPrevFrame.addEventListener("click", () => loadFrameByIndex(frameIndex - 1));
}
if (el.btnNextFrame) {
  el.btnNextFrame.addEventListener("click", () => loadFrameByIndex(frameIndex + 1));
}
window.addEventListener("keydown", (e) => {
  if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA")) {
    return;
  }
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    loadFrameByIndex(frameIndex - 1);
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    loadFrameByIndex(frameIndex + 1);
  }
});
el.occStyle.addEventListener("change", buildOccMesh);
el.togOcc.addEventListener("change", () => {
  if (occMesh) occMesh.visible = el.togOcc.checked;
});
if (el.ptSource) {
  el.ptSource.addEventListener("change", async () => {
    clipAggFitted = false;
    if (index && index.frames && index.frames.length) {
      await loadFrameByIndex(frameIndex);
    }
  });
}
el.togPts.addEventListener("change", () => {
  if (pointsObj) {
    pointsObj.visible = el.togPts.checked;
    if (occMesh) {
      const op = el.togPts.checked && el.togOcc.checked
        ? Math.min(Number(el.occOpacity.value), 0.35)
        : Number(el.occOpacity.value);
      occMesh.material.opacity = op;
      occMesh.material.transparent = op < 0.999;
      occMesh.material.needsUpdate = true;
    }
    if (el.togPts.checked && el.togOcc.checked) {
      setStatus("Points on · occ auto-dimmed (raise Opacity if needed)");
    }
  } else if (el.togPts.checked) {
    setStatus("No points in this scene — re-export with --export-points");
  }
});
el.togOdBoxes.addEventListener("change", () => {
  if (odBoxesGroup) odBoxesGroup.visible = el.togOdBoxes.checked;
});
el.togGrid.addEventListener("change", () => {
  gridHelper.visible = el.togGrid.checked;
});
el.togAxes.addEventListener("change", () => {
  if (axesGroup) axesGroup.visible = el.togAxes.checked;
});
el.occOpacity.addEventListener("input", () => {
  if (!occMesh) return;
  const op = Number(el.occOpacity.value);
  occMesh.material.opacity = op;
  occMesh.material.transparent = op < 0.999;
  occMesh.material.needsUpdate = true;
});
function rebuildOcc() {
  buildOccMesh();
  refreshCamProjections();
  setStatus(`voxel display size×=${el.occGrow.value} gap=${el.occGap.value}`);
}
el.occGap.addEventListener("input", rebuildOcc);
el.occGrow.addEventListener("input", rebuildOcc);
el.ptSize.addEventListener("input", () => {
  if (pointsObj) {
    pointsObj.material.size = Number(el.ptSize.value);
    pointsObj.material.needsUpdate = true;
  }
});
el.projMode.addEventListener("change", refreshCamProjections);
el.projRadius.addEventListener("input", () => {
  if (el.projRadiusValue) el.projRadiusValue.textContent = `${el.projRadius.value} px`;
  refreshCamProjections();
});
if (el.projAlpha) el.projAlpha.addEventListener("input", () => {
  if (el.projAlphaValue) el.projAlphaValue.textContent = Number(el.projAlpha.value).toFixed(2);
  refreshCamProjections();
});
if (el.projColorMode) el.projColorMode.addEventListener("change", refreshCamProjections);
if (el.projClassFilter) el.projClassFilter.addEventListener("change", refreshCamProjections);
if (el.projHeightMin) el.projHeightMin.addEventListener("input", refreshCamProjections);
if (el.projHeightMax) el.projHeightMax.addEventListener("input", refreshCamProjections);
if (el.projPointSource) el.projPointSource.addEventListener("change", refreshCamProjections);
if (el.projDistortion) el.projDistortion.addEventListener("change", refreshCamProjections);
el.btnRefreshProj.addEventListener("click", () => {
  refreshCamProjections();
  if (el.lightbox.classList.contains("open") && lb.cam && lb.img) {
    drawProjectionOnCanvas(
      el.lbCanvas,
      lb.img,
      lb.cam,
      el.projMode.value,
      Number(el.projRadius.value)
    );
  }
  setStatus(`projection refreshed · mode=${el.projMode.value}`);
});
el.btnRebuildOcc.addEventListener("click", () => {
  try {
    const v = Number(el.voxelSize.value);
    setStatus(`Rebuilding occ @ ${v}m…`);
    const t0 = performance.now();
    const out = voxelizeFromPoints(v);
    applyOccupancy(out.ijk, out.labels, out.voxel, "rebuilt from points");
    refreshCamProjections();
    el.sceneInfo.innerHTML = `
      <div>occ voxels: <b>${out.nOcc.toLocaleString()}</b></div>
      <div>active voxel: <b>${out.voxel}m</b> (exported ${currentMeta.voxel}m)</div>
      <div>grid snap: floor((p-origin)/v)</div>
      <div>x: [${currentMeta.x_range.join(", ")}]</div>
      <div>y: [${currentMeta.y_range.join(", ")}]</div>
      <div>z: [${currentMeta.z_range.join(", ")}]</div>
      <div>points: <b>${ptLabels ? ptLabels.length.toLocaleString() : "—"}</b></div>
    `;
    setStatus(
      `occ rebuilt · voxel=${out.voxel}m · n=${out.nOcc.toLocaleString()} · ${(
        performance.now() - t0
      ).toFixed(0)}ms`
    );
  } catch (e) {
    setStatus(String(e));
  }
});
el.btnResetOcc.addEventListener("click", () => {
  if (!exportedOcc || !currentMeta) {
    setStatus("No exported occupancy loaded");
    return;
  }
  applyOccupancy(
    exportedOcc.ijk,
    exportedOcc.labels,
    exportedOcc.voxel,
    "exported grid"
  );
  refreshCamProjections();
  el.sceneInfo.innerHTML = `
    <div>occ voxels: <b>${exportedOcc.labels.length.toLocaleString()}</b></div>
    <div>active voxel: <b>${exportedOcc.voxel}m</b> (exported ${currentMeta.voxel}m)</div>
    <div>grid snap: floor((p-origin)/v)</div>
    <div>x: [${currentMeta.x_range.join(", ")}]</div>
    <div>y: [${currentMeta.y_range.join(", ")}]</div>
    <div>z: [${currentMeta.z_range.join(", ")}]</div>
    <div>points: <b>${ptLabels ? ptLabels.length.toLocaleString() : "—"}</b></div>
  `;
  setStatus(`reset to exported · voxel=${exportedOcc.voxel}m · n=${exportedOcc.labels.length}`);
});
el.btnFit.addEventListener("click", () => {
  if (currentMeta) fitCamera(currentMeta);
});

function onColorOrFilterChange() {
  syncColorModeUi();
  rebuildColoredViews();
  setStatus(`color=${colorModeValue()} · ROI clip=${el.togRoiClip && el.togRoiClip.checked}`);
}

if (el.colorMode) el.colorMode.addEventListener("change", onColorOrFilterChange);
// Group/lidar checkboxes are built dynamically from the format profile,
// so listen on their containers instead of fixed element ids.
if (el.groupToggles) el.groupToggles.addEventListener("change", onColorOrFilterChange);
if (el.lidarToggles) el.lidarToggles.addEventListener("change", onColorOrFilterChange);
if (el.btnApplyRoi) {
  el.btnApplyRoi.addEventListener("click", () => {
    readRoiFromInputs();
    rebuildColoredViews();
    setStatus(
      `ROI x[${roi.x0},${roi.x1}] y[${roi.y0},${roi.y1}] z[${roi.z0},${roi.z1}]`
    );
  });
}
if (el.btnResetRoi) {
  el.btnResetRoi.addEventListener("click", () => {
    el.roiX0.value = roi.x0;
    el.roiX1.value = roi.x1;
    el.roiY0.value = roi.y0;
    el.roiY1.value = roi.y1;
    el.roiZ0.value = roi.z0;
    el.roiZ1.value = roi.z1;
    readRoiFromInputs();
    rebuildColoredViews();
    setStatus(`ROI reset to default [${roi.x0},${roi.x1}]×[${roi.y0},${roi.y1}]×[${roi.z0},${roi.z1}]`);
  });
}
if (el.togRoiBox) {
  el.togRoiBox.addEventListener("change", () => updateRoiHelper());
}
if (el.togRoiClip) {
  el.togRoiClip.addEventListener("change", () => {
    rebuildColoredViews();
  });
}
syncColorModeUi();
readRoiFromInputs();
updateRoiHelper();

let vidPollTimer = null;
// Video export requires a local scene package and serve.py. An external data
// provider only promises scene reads, so do not offer unavailable operations.
if (externalSource) el.btnExportVid?.closest(".row")?.setAttribute("hidden", "");

function setVidStatus(msg) {
  if (el.vidStatus) el.vidStatus.textContent = msg || "";
}

function currentClipId() {
  if (el.clipSelect && el.clipSelect.value) return el.clipSelect.value;
  const m = String(sceneRoot || "").match(/\/scenes\/([^/]+)/);
  return m ? m[1] : "";
}

async function refreshVideoList() {
  if (externalSource || !el.vidList) return;
  try {
    const cid = currentClipId();
    const r = await fetch(occUrl(`/api/video/list?clip_id=${encodeURIComponent(cid)}`));
    const data = await r.json();
    const vids = data.videos || [];
    if (!vids.length) {
      el.vidList.innerHTML = "No videos yet.";
      return;
    }
    el.vidList.innerHTML = vids
      .map((v) => {
        const mb = (v.bytes / (1024 * 1024)).toFixed(1);
        return `<div><a href="${occUrl(v.url)}" download>${v.name}</a> · ${mb} MB</div>`;
      })
      .join("");
  } catch (e) {
    el.vidList.textContent = String(e);
  }
}

async function pollVideoJob() {
  if (externalSource) return false;
  try {
    const cid = currentClipId();
    const r = await fetch(occUrl(`/api/video/status?clip_id=${encodeURIComponent(cid)}`));
    const s = await r.json();
    const pct = s.n ? Math.round((100 * (s.frame || 0)) / s.n) : Math.round(100 * (s.progress || 0));
    if (s.state === "running") {
      setVidStatus(`exporting… ${s.message || ""} (${pct}%)`);
      return true;
    }
    if (s.state === "done") {
      setVidStatus(`done · ${s.relpath || s.path || "ok"}`);
      await refreshVideoList();
      return false;
    }
    if (s.state === "error") {
      setVidStatus(`error · ${s.message || ""}`);
      return false;
    }
    setVidStatus(s.state || "idle");
    return false;
  } catch (e) {
    setVidStatus(String(e));
    return false;
  }
}

function startVidPoll() {
  if (vidPollTimer) clearInterval(vidPollTimer);
  vidPollTimer = setInterval(async () => {
    const keep = await pollVideoJob();
    if (!keep && vidPollTimer) {
      clearInterval(vidPollTimer);
      vidPollTimer = null;
    }
  }, 1000);
}

if (el.btnExportVid) {
  el.btnExportVid.addEventListener("click", async () => {
    setVidStatus("starting…");
    try {
      const body = {
        clip_id: currentClipId(),
        mode: el.vidMode.value,
        fps: Number(el.vidFps.value) || 5,
        max_frames: Number(el.vidMaxFrames.value) || 0,
        tile_w: 960,
        tile_h: 540,
      };
      const r = await fetch(occUrl("/api/video/export"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) {
        setVidStatus(data.error || JSON.stringify(data));
        return;
      }
      setVidStatus(`started · job=${data.job_id || "?"}`);
      startVidPoll();
    } catch (e) {
      setVidStatus(String(e));
    }
  });
}
if (el.btnRefreshVid) {
  el.btnRefreshVid.addEventListener("click", () => {
    refreshVideoList();
    pollVideoJob();
  });
}
refreshVideoList();
pollVideoJob();

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  if (renderPending) {
    renderPending = false;
    renderer.render(scene, camera);
  }
}
animate();

boot().catch((e) => {
  console.error(e);
  loadFailure(e);
});
