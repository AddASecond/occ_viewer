# occ_viewer

Occupancy 场景查看器：读已经导出好的 **scene package**（`index.json` + 帧资产），在浏览器里对三维 Occupancy、点云、多相机投影做对照检查，并可导出拼图 MP4。不重新跑推理，也不绑定某一家模型仓库。

当前内置 profile 是 **Robotruck**（分类、默认 ROI、Mongo/盘约定写在 YAML 里）。HTTP 服务 **不连接 Mongo**，只按本地 scene 包提供静态文件与导出 API。操作细节见 [docs/USER_MANUAL.md](docs/USER_MANUAL.md)，包字段见 [docs/SCHEMA.md](docs/SCHEMA.md)。

## 基本功能

| 能力 | 做什么 |
|------|--------|
| 多 clip / 多帧 | `--scenes-root` 下列出带 `index.json` 的 clip；顶栏切换 clip 与 timestamp |
| 三维 Occupancy | 按格子对齐的体素立方体；透明度、间隙、尺寸倍率可调 |
| 三维点云 | 可选；常见为 clip 级 `static_agg`（地图系）+ 本帧动态，经 `ego_pose` 变到车体 |
| 多相机 | 每帧各相机 JPEG；点击可灯箱放大、拖拽平移、滚轮缩放 |
| 投影叠加 | Occ：体素 8 角点 → 凸包；点云：像素级投影；可开关畸变、高度带、类别过滤 |
| ROI | 车体坐标系裁剪显示范围，可画黄框 |
| 着色 | fine 语义色 / 粗类（dynamic·static·freespace·noise）/ lidar id（点云） |
| 导出 MP4 | 服务端 `src/scene_video.py`：多相机拼图 + BEV occ + 类别图例，无需再 infer |

数据流：

```text
scene package (index.json + frames/)  →  serve.py  →  浏览器
                                              └→  Export MP4 →  scene/videos/
```

## 可视化效果

宽屏为三栏：**左侧**颜色 / 图例 / ROI / Occ 参数 / 导出；**中间** Three.js 三维（Occ 体素 + 点云 + 网格 + 车体坐标轴）；**右侧**各相机卡片与投影工具条。

三维约定（与相机图像左右一致）：车体 `+x` 右、`+y` 前、`+z` 上；显示映射为 `(-x, z, y)`。默认相机在车后看向前方时，车体 `+x` 在屏幕右侧。

典型观感：

- **Occ**：实心格子，gap=0 时邻格贴合；可用 ROI 只看前方道路或某一高度带。
- **点云**：静态背景稳定、动态物体随帧变化；lidar 着色可区分雷达 1 / 2 / 14。
- **相机投影**：Occ 以凸包贴在图像上，与三维格子一一对应；点云为着色像素。
- **粗类**：红=动态，蓝=静态，绿=可行驶，灰=噪声（颜色来自 format YAML，可改）。
- **导出视频**：一帧里同时看到全部相机 + 横向 BEV Occupancy + 底部图例。

打开后应能看到顶栏 Clip/Frame、中间网格与坐标轴、右侧相机缩略图。交互与快捷键见手册第 5–12 节。

## 运行

```bash
cd /path/to/occ_viewer
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

# 单个 clip（目录内须有 index.json）
.venv/bin/python serve.py --scene /path/to/occ_scene/<clip>

# 多个 clip 的父目录
.venv/bin/python serve.py --scenes-root /path/to/occ_scenes --host 0.0.0.0 --port 8765
```

浏览器打开打印出的 URL（默认 `http://127.0.0.1:8765/`）。命令行 `--host` / `--port` 会覆盖 YAML 默认值。

## GSS / MongoDB 接入

GSS 挂载本仓库的 `web/`（`ME_CONFIG_OCC_VIEWER_WEB_ROOT`），无需复制源码或启动 `serve.py`。
打开 `/occ-viewer/index.html?source=gss`，在现有 viewer 顶部选择数据库集合、搜索、分页及筛选 train/val。
默认只加载当前帧，OCC 以全部体素中心点显示，相机直接显示 RGB；立方体、投影和整段 Clip aggregate 均可按需切换。
左侧加载详情分别显示相机、OCC 和点云的进度及错误；文件并行读取，单个请求 45 秒超时，可点“重试加载”。切帧会取消旧请求，已加载的同场景聚合点云在内存中复用。
GSS 原数据库页面继续用于文档浏览；`web/gss.js` 只负责目录选择，Mongo 查询和资产读取在 GSS 维护。

同源只读接口：
- `../api/occ/datasets` → `{datasets: [{database, collection, url}]}`，覆盖全部授权数据库。
- `<dataset.url>?search=&offset=0&tag=train` → `{clips: [{id, clip_id, n_frames, url}], total, next_offset}`；`tag` 可省略。
- `<clip.url>/index.json`、index 中的 `meta_uri` 和 `assets.*.uri` 遵循 [SCHEMA.md](docs/SCHEMA.md)。

场景 URL 保存在地址栏，可直接分享。`?source=external&scene=<scene URL>` 也可打开单个同源场景。
外部模式先 best-effort 拉 `/api/config` 作 base profile，再用 scene index 的 taxonomy/defaults 覆盖；两者都缺失时使用 viewer 通用默认值，不维护第二份 profile。
外部模式不调用本地视频接口；普通 `serve.py` 模式保留原功能。

## 配置自定义

配置分两层，改完后**重启** `serve.py`（前端在 `boot()` 时 `GET /api/config` 拉 active format）。

### 1. `config/viewer.yaml` — 服务本身

```yaml
format: robotruck          # 选用 config/formats/<name>.yaml
host: 127.0.0.1
port: 8765
gallery_upstream: http://127.0.0.1:8738   # 可选：/gallery/* 反代到该上游；删掉即关闭
python:                    # 导出 MP4 时依次找可用解释器
  - .venv/bin/python
```

- 换格式：改 `format:` 为新文件名（不含 `.yaml`）；`config/formats/` 下只有一个 YAML 时可省略。
- 改默认监听：改 `host` / `port`，或启动时仍用命令行覆盖。
- 导出找不到 OpenCV：在 `python:` 列表里加上带 `numpy` + `opencv-python-headless` 的解释器路径。

### 2. `config/formats/<name>.yaml` — 某一 occupancy 领域

现成例子：[config/formats/robotruck.yaml](config/formats/robotruck.yaml)。常用可改项：

| 字段 | 作用 | 改了之后 |
|------|------|----------|
| `roi.x/y/z` | 默认三维 ROI（车体坐标，米） | 「Reset default」与启动时的裁剪范围 |
| `voxel` | 默认体素边长（米） | 与包内 `grid.voxel` 一致时显示最整齐 |
| `taxonomy.fine.n` | fine 类别个数 | `label ≥ n` 一律当 noise |
| `taxonomy.<group>` | 任意自定义颜色组：`order` + `colors_rgb` + `fine_ids`（或 `fine_to_coarse`）即成为一个粗类着色模式，组名（如 `coarse5`）出现在 Mode 下拉里；可选 `label` 覆盖下拉显示名 | 可有多组；勾选框按组自动生成 |
| `taxonomy.<group>.raw_ids` | 组名 → 包内原始标签值（用于标签直接存组编码的包，如 0..4 存 coarse5） | 按最大 raw 值自动判定包是 fine 编码还是组编码 |
| `taxonomy_exclude` | 合并 scene 包 index.json 时要丢弃的组 id（如 robotruck 老包里的 4 类 `coarse`） | 该组不出现在 Mode / 图例 / 勾选框，即使 scene 包仍携带 |
| `taxonomy.lidar_ids.colors_rgb` | lidar id → 色 | 点云 lidar 着色与勾选框（按 id 自动生成） |
| `ui.default_color_mode` | 启动着色模式（`fine` / 组名 / `lidar`） | 顶栏 Mode 默认项 |
| `ui.occ_variants` | 包内无 `occupancy_variants` 时的备选 OCC 变体 | 「OCC Algorithm」下拉 |
| `ui.point_filters` | 相机投影点过滤：`value`（`all` 或标签 id）+ `label` + 可选 `highlight_rgb` 单色高亮 | 「Point filter」下拉 |
| `ui.height_range` | 投影高度色带的车体 z 范围 | 「Height z」默认值 |
| `point_preview.*` | clip 聚合点云的步进采样预览：`dir` / `prefix` / `max_points` / `files[].record_bytes`；`enabled: false` 则前端直接读全量 | serve.py 预生成 `<dir>/<prefix>*`，前端改拉预览 |
| `source.camera_fallback.*` | **仅服务端、不下发浏览器**：包里相机 JPEG 缺失时，按 `clips_root` + `index_file` 的 `timestamp_key→cameras_key→md5_key` 查 md5，再按 `path_template`（`{m0}/{m1}/{rest}/{md5}` 占位）在 `volumes` 里找原图 | 整节删除即关闭回退，缺失相机直接 404 |
| `gss.default_dataset` | `source=gss` 且 URL 无 `?dataset=` 时的默认集合（按子串匹配） | GSS 目录下拉默认项 |
| `mongo.*` / `disk.*` | Robotruck 落库约定 | **仅文档/后续 ingest 用**；当前 viewer 不连库、不按这些路径找文件 |
| `scene.occupancy_keys` | 规范包里 occupancy 资产键 | 须与 [docs/SCHEMA.md](docs/SCHEMA.md) 及 `meta.assets.occupancy` 一致 |

**不要改、除非你也改了前端/导出代码：** `assets.occupancy\|points\|cameras` 的 URI 解析规则、凸包投影算法。规范包形状变了，应改导出器对齐 SCHEMA，而不是在 viewer 里解析私有 dump。

### 3. 增加另一种 occupancy（智驾 / 具身等）

1. 把数据导出（或离线转换）成规范 scene 包：`index.json`、`frames[]`、`assets.*.uri`。
2. 复制 `config/formats/robotruck.yaml` → `config/formats/<mydomain>.yaml`，改 `id`、`schema_version`、`taxonomy`、`roi`，并按需调整 `ui` / `point_preview` / `source.camera_fallback` / `gss` 各节（不需要的节整节删除即可，前端与服务端均有通用默认）。
3. 在 `config/viewer.yaml` 设 `format: <mydomain>`，重启服务。

Mongo 字段可以先留空或写成你们自己的库表名，不影响本地浏览。

> **静态部署**：`?source=gss` 等纯静态托管（无 `serve.py`）时 `/api/config` 不可达，浏览器会退回到 `web/format.json`——它是 `serve.py` 启动时按当前 `format` 自动生成的构建产物（与 `/api/config` 内容一致，不含 `source` 节）。改完格式配置后运行一次 `serve.py`（或 `python3 -c "import serve"`）即可刷新，再提交 `web/format.json` 给静态环境使用。

## 目录

| 路径 | 作用 |
|------|------|
| `serve.py` | HTTP、`/api/clips`、`/api/config`、视频任务 |
| `web/` | Three.js 页面（`format.json` 为格式配置的浏览器侧构建产物） |
| `src/scene_video.py` | MP4 导出 |
| `config/` | 服务 + 格式 YAML |
| `docs/` | 手册、SCHEMA、Robotruck Mongo 说明 |

Robotruck 盘符与 `occ_data_*` 表约定：[docs/formats/robotruck_mongo.md](docs/formats/robotruck_mongo.md)。
