// Mongo stays in GSS. This module only connects its read API to the existing viewer.
export async function connectGss({ select, load, fetchJson, status }) {
  const form = document.getElementById("datasetForm");
  const dataset = form.elements.dataset, tag = form.elements.tag, search = form.elements.search;
  const more = document.getElementById("more"), count = document.getElementById("catalogCount");
  const params = new URLSearchParams(location.search);
  const { datasets } = await fetchJson(new URL("../api/occ/datasets", location.href));
  form.hidden = false;
  for (const item of datasets) dataset.add(new Option(`${item.database} / ${item.collection}`, item.url));
  if (!datasets.length) { status("当前可访问的数据库中没有 OCC 数据集。"); return; }
  if (datasets.some(item => item.url === params.get("dataset"))) dataset.value = params.get("dataset");
  else {
    const dft = datasets.find(item => item.url.includes("/occ_data_clips_lidar14_0813/"));
    if (dft) dataset.value = dft.url;
  }
  tag.value = ["train", "val"].includes(params.get("tag")) ? params.get("tag") : "";
  search.value = params.get("search") || "";
  document.getElementById("collectionLink").href = dataset.value.replace(/\/occ\/scenes$/, "");
  // Filtering reloads this same page; there is only one viewer and one selection state.
  dataset.onchange = tag.onchange = () => form.requestSubmit();
  form.onsubmit = () => { if (!tag.value) tag.disabled = true; };
  const clips = new Map();
  let offset = 0, total = 0;
  function add(clip) {
    if (clips.has(clip.id)) return;
    clips.set(clip.id, clip);
    const label = [clip.clip_id, `${clip.n_frames ?? "?"} 帧`, clip.version, clip.run_id].filter(Boolean).join(" · ");
    select.add(new Option(label, clip.id));
    count.textContent = `已加载 ${clips.size} / ${total} 个场景`;
  }
  const show = () => load(clips.get(select.value));
  select.onchange = () => show().catch(error => status(error.message));

  async function page() {
    more.disabled = true;
    try {
      const url = new URL(dataset.value, location.origin);
      url.searchParams.set("offset", offset);
      url.searchParams.set("search", search.value);
      if (tag.value) url.searchParams.set("tag", tag.value);
      const data = await fetchJson(url);
      total = data.total;
      data.clips.forEach(add);
      offset = data.next_offset;
      more.hidden = offset === null;
    } finally { more.disabled = false; }
  }
  more.onclick = () => page().catch(error => status(error.message));
  await page();
  if (!clips.size) { count.textContent = "已加载 0 / 0 个场景"; status("没有匹配的 OCC 场景。"); return; }
  const preferred = params.get("scene");
  if (preferred) {
    // Restore a scene shared from a later page; also accept the old token-only URL.
    const url = preferred.includes("/") ? preferred : `${dataset.value}/${preferred}`;
    if (url.startsWith(`${dataset.value}/`)) {
      const id = url.split("/").pop();
      if (!clips.has(id)) {
        const index = await fetchJson(`${url}/index.json`);
        if (!tag.value || index.tag?.includes(tag.value)) add({ id, clip_id: index.clip_id, n_frames: index.frames.length, url });
      }
      if (clips.has(id)) select.value = id;
    }
  }
  await show();
}
