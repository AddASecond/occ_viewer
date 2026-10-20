#!/usr/bin/env node
/**
 * Backfill camera calibration (K / T_c_v / T_v_c / dist5 / width / height)
 * from LitePT occ_scene meta.json into MongoDB occ_data_frames_* collections.
 *
 * Usage:
 *   node backfill_camera_calib.mjs           # dry-run, print stats
 *   node backfill_camera_calib.mjs --write   # actually update MongoDB
 */
import { MongoClient } from '/home/dev/01develop/gss/node_modules/mongodb/lib/index.js';
import fs from 'node:fs';
import path from 'node:path';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://100.89.182.77:27017/?authSource=perception_experiment';
const DB_NAME = process.env.MONGO_DB || 'perception_experiment';
const COLLECTIONS = [
  'occ_data_frames_braking_matrix',
  'occ_data_frames_fp_matrix',
  'occ_data_frames_lidar14_0813',
];
const WRITE = process.argv.includes('--write');

const CALIB_KEYS = ['K', 'T_c_v', 'T_v_c', 'dist5', 'width', 'height'];

const client = new MongoClient(MONGO_URI);
await client.connect();
const db = client.db(DB_NAME);

const sceneCache = new Map();
function loadSceneIndex(sceneDir) {
  if (sceneCache.has(sceneDir)) return sceneCache.get(sceneDir);
  let entry = null;
  try {
    const idxPath = path.join(sceneDir, 'index.json');
    if (fs.existsSync(idxPath)) {
      const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
      const byFrameId = new Map();
      const byTimestamp = new Map();
      for (const f of idx.frames || []) {
        if (f.frame_id != null) byFrameId.set(String(f.frame_id), f);
        if (f.timestamp != null) byTimestamp.set(String(f.timestamp), f);
      }
      entry = { byFrameId, byTimestamp, sceneDir };
    }
  } catch (err) {
    console.warn(`  ! load index failed: ${sceneDir}: ${err.message}`);
  }
  sceneCache.set(sceneDir, entry);
  return entry;
}

function mergeCameras(docCams, metaCams) {
  const metaByName = new Map(metaCams.map(c => [c.name, c]));
  let matched = 0, enriched = 0;
  const merged = docCams.map(dc => {
    const mc = metaByName.get(dc.name);
    if (!mc) return dc;
    matched++;
    const hasAll = CALIB_KEYS.every(k => dc[k] != null);
    if (hasAll) return dc;
    enriched++;
    const out = { ...dc };
    for (const k of CALIB_KEYS) {
      if (mc[k] != null) out[k] = mc[k];
    }
    return out;
  });
  return { merged, matched, enriched, total: docCams.length };
}

const summary = { scanned: 0, updated: 0, already: 0, noScene: 0, noEntry: 0, noMeta: 0, noMatch: 0, errors: 0 };

for (const collName of COLLECTIONS) {
  const coll = db.collection(collName);
  const cursor = coll.find({}, { projection: { timestamp: 1, provenance: 1, 'assets.cameras': 1 } });
  console.log(`\n=== ${collName} ===`);
  let s = { scanned: 0, updated: 0, already: 0, noScene: 0, noEntry: 0, noMeta: 0, noMatch: 0, errors: 0 };
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    s.scanned++; summary.scanned++;
    try {
      const sceneDir = doc.provenance?.intermediate_scene;
      if (!sceneDir || !fs.existsSync(sceneDir)) { s.noScene++; summary.noScene++; continue; }
      const sceneIdx = loadSceneIndex(sceneDir);
      if (!sceneIdx) { s.noScene++; summary.noScene++; continue; }
      const ts = String(doc.timestamp);
      const entry = sceneIdx.byFrameId.get(ts) || sceneIdx.byTimestamp.get(ts);
      if (!entry) { s.noEntry++; summary.noEntry++; continue; }
      const metaPath = path.join(sceneDir, entry.meta_uri || entry.dir + '/meta.json');
      if (!fs.existsSync(metaPath)) { s.noMeta++; summary.noMeta++; continue; }
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const metaCams = meta.assets?.cameras || [];
      const docCams = doc.assets?.cameras || [];
      if (!docCams.length || !metaCams.length) { s.noMatch++; summary.noMatch++; continue; }
      const { merged, matched, enriched } = mergeCameras(docCams, metaCams);
      if (!matched) { s.noMatch++; summary.noMatch++; continue; }
      if (!enriched) { s.already++; summary.already++; continue; }
      if (WRITE) {
        await coll.updateOne({ _id: doc._id }, { $set: { 'assets.cameras': merged } });
      }
      s.updated++; summary.updated++;
    } catch (err) {
      s.errors++; summary.errors++;
      console.warn(`  ! doc ${doc._id}: ${err.message}`);
    }
  }
  console.log(`  scanned=${s.scanned} updated=${s.updated} already=${s.already} noScene=${s.noScene} noEntry=${s.noEntry} noMeta=${s.noMeta} noMatch=${s.noMatch} errors=${s.errors}`);
}

console.log(`\n=== TOTAL (${WRITE ? 'WRITE' : 'DRY'}) ===`);
console.log(JSON.stringify(summary, null, 2));
await client.close();
