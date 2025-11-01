# 图酷通用采集器（Temu/天猫/淘宝/1688）需求文档 v1.0

> 目标：把现有“采集器”更名为**图酷通用采集器**，支持在 Temu、天猫、淘宝、1688 商品/店铺页面上自动显示“采集到后台”的悬浮按钮；点击后要求先登录公司后台（单点/Token），登录成功才允许采集；采集的结果进入公司后台的**采集列表**，触发后端下载与去重入库。

---

## 1. 名称与范围

* **产品名**：图酷通用采集器（General Collector）
* **支持站点（第一期）**：

  * Temu（商品详情、店铺首页/列表）
  * 天猫（商品详情、店铺首页/列表）
  * 淘宝（商品详情、店铺首页/列表）
  * 1688（商品详情、店铺首页/列表）
* **页面类型**：商品详情页（优先）、店铺首页/列表页（可选，采集当前页曝光的商品卡片与主图）。

## 2. 术语

* **前端采集器**：浏览器扩展（Chrome/Edge，后续可兼容 Firefox），负责在匹配页面注入 UI、解析 DOM、采集元数据并调用公司后台 API。
* **后台**：公司已有的 ERP/内容后台（Django/DRF），新增“采集”模块 API、任务队列（Celery）与文件存储（本地/OSS/Qiniu）。
* **采集任务**：一次从第三方页面发起的采集动作，可能包含 1..N 张图片与元数据。 
* **代码参考** /Users/yuhaowang/project/collect/temu-collector-extension/cankao.md 可以参考这个的 代码里面有登录逻辑与按钮注入的实现。

## 3. 用户角色与权限

* **采集员（普通用户）**：必须登录后才能执行采集；只能查看自己发起的采集任务与结果。
* **运营/管理员**：可查看全量采集任务、审阅、批量入库、删除、拉黑来源等。

## 4. 关键用户故事（User Stories）

1. 作为采集员，我在天猫商品详情页看到“采集到后台”按钮，点击后若未登录会弹出登录窗；登录成功后再次点击，开始采集当前商品的主图、详情长图与核心元数据，后台可见任务进度。
2. 作为管理员，我能在后台“采集列表”中查看来源站点、URL、图片数、状态、重复率（哈希比对）、下载失败重试次数，并可一键入库到“图库/素材库”。
3. 作为采集员，我能在扩展里看到最近 5 条自己的采集任务状态（排队/下载中/成功/失败）。

## 5. 整体架构

* **浏览器扩展**（Manifest v3）

  * Content Script：根据 URL 规则匹配站点 → 注入悬浮“采集到后台”按钮 → 解析页面 DOM/接口响应 → 打包 payload → 调用后台 API。
  * Background Service Worker：持久化登录 Token、跨域请求中转（必要时）、消息路由与重试策略。
  * Options Page：配置后端 API 基址、用户查看 Token/注销、调试开关。
* **后台（Django + DRF + Celery）**

  * API：鉴权、创建采集任务、签名上传（可选）、状态查询。
  * Worker：下载原图、去重（感知哈希/MD5/感知指纹）、存储（本地/OSS）、写“采集记录 + 资源表”。
  * 管理界面：采集列表、筛选、预览、批量入库、失败重试、拉黑规则。

## 6. URL 匹配与按钮显示规则

* **URL 规则**（正则/前缀）：

  * Temu：`https://www\.temu\.com/.*(goods|list).*`
  * 天猫：`https://detail\.tmall\.com/.*`，`https://.*\.tmall\.com/`（店铺/列表）
  * 淘宝：`https://item\.taobao\.com/.*`，`https://.*\.taobao\.com/`（店铺/列表）
  * 1688：`https://detail\.1688\.com/offer/.*`，`https://.*\.1688\.com/page/.*`
* **显示策略**：

  * 命中规则后注入右下角悬浮按钮（圆角、品牌色）。
  * 若当前页无核心商品信息（如仅搜索聚合页），按钮置灰并提示“请进入商品详情页”。

## 7. 采集按钮交互与登录流程

1. 点击按钮 → 检查本地是否有后台 Token：

   * 无 Token：弹出内嵌登录窗（OAuth2/账号密码，跳转后台登录页或扩展内表单）。
   * 有 Token：校验有效性（/auth/verify）。
2. 登录成功：

   * 缓存 Token（扩展安全存储，仅限当前浏览器）。
   * 同步用户信息（id、用户名、角色、配额）。
3. 再次点击“采集到后台” → 调用 **创建任务 API**，立即返回 `task_id`。
4. UI Toast：显示“已提交，正在后台下载…”；提供“查看任务”入口（打开后台采集列表并高亮该任务）。

## 8. 页面解析与数据项（第一期）

* **通用字段**：

  * `source_site`（enum: TEMU/TMALL/TAOBAO/ALI1688）
  * `source_url`
  * `shop_name`、`shop_id`（可选）
  * `item_id`（能解析则填，否则留空）
  * `title`、`subtitle`（可选）
  * `price`（首个展示价）
  * `currency`（CNY/USD，按页面）
  * `images[]`（主图原图 URL 列表，尽量提取大图）
  * `detail_images[]`（详情长图/富媒）
  * `video_urls[]`（若能取到）
  * `attrs`（JSON：颜色、尺寸、材质、重量、SKU 组合等，尽力）
  * `seller_info`（JSON：店铺地址、评分，尽力）
  * `ts_collected_client`（客户端采集时间）
* **解析策略**：

  * 优先读取页面内 JSON 数据块（如 `window.__INIT_DATA__` / `data-spm` / `redux` state）。
  * 退化为 DOM 解析（选择器表按站点维护，可随版本更新）。
  * 统一做 URL 规范化（移除跟踪参数）。

## 9. 后端 API 设计（建议 DRF）

* `POST /api/collector/auth/login`（可选，若不走统一 SSO）

  * Req：`username/password` 或 OAuth code；Rsp：`access_token`, `expires_in`。
* `GET /api/collector/auth/verify`：校验 Token。
* `POST /api/collector/tasks`（创建采集任务，**前端只上传元数据与第三方图片 URL**）

  * Req：见第 8 节字段；`client_version`、`ext_meta`（扩展版本与调试信息）。
  * Rsp：`id`, `status` = `QUEUED`。
* `GET /api/collector/tasks?mine=1&status=&site=&q=`：分页列表。
* `GET /api/collector/tasks/{id}`：详情（含下载日志、指纹、重复匹配情况）。
* `POST /api/collector/tasks/{id}/retry`：失败重试。
* `POST /api/collector/tasks/{id}/approve`：入库/通过。
* `POST /api/collector/tasks/{id}/reject`：驳回/删除。

## 10. 任务状态机

* `QUEUED` → `FETCHING`（Worker 下载第三方图片到临时区）→ `DEDUPE`（生成 MD5 + pHash，库内查重）→ `STORED`（转存到正式存储并落库）→ `DONE`
* 异常：`FAILED_NETWORK`、`FAILED_FORMAT`、`FAILED_FORBIDDEN`（403/防盗链）、`FAILED_PARSE`。

## 11. 存储与去重

* **去重**：

  * 逐图生成 `md5` 与 `phash64`，建立唯一索引（路径/URL 仅作为参考，指纹优先）。
  * 近重复阈值（汉明距离 ≤ 6 视为相似，后台可合并/提示）。
* **存储**：

  * 临时：`/data/collector/tmp/YYYYMM/`；正式：`/data/assets/images/YYYY/MM/DD/` 或 OSS/Qiniu（返回可公网访问的 CDN URL）。
  * 按 `site/item_id/hash.ext` 组织目录，便于清理。

## 12. 反爬与稳定性

* 前端仅上传第三方 URL，**由后端 Worker 负责下载**，便于集中控制：

  * UA 池/重试（3-5 次，指数退避）、限速、代理池（可选）。
  * Referer/Host 伪装（按站点配置），自动跟随 302。
  * 图片实际分辨率校验与自动补取大图（如将 `_60x60.jpg` → 原图规则）。
* 失败任务自动重试（最多 2 次），超出则标为失败并可手动重试。

## 13. 后台界面（最小可用）

* **采集列表**：筛选（站点、状态、日期、发起人）、列（缩略图、标题、图片数、状态、重复率、发起人、时间、操作）。
* **任务详情**：原始元数据、下载日志、相似度匹配 Top-N、图片预览网格（支持放大/复制 URL/下载）。
* **设置**：

  * 站点规则（启用/禁用，Referer、UA、自定义下载头）。
  * 黑名单（域名、店铺、关键词）。
  * 入库目标（素材库/商品库映射规则）。

## 14. 浏览器扩展 UI 细节

* 悬浮按钮：

  * 样式：圆角 pill，文案“采集到后台”。
  * 状态：`可用`/`未登录`/`解析中…`/`已提交`。
  * 可拖拽位置（保存在 `chrome.storage`）。
* 解析进度条（可选）：解析完成即发起 API。
* 最近任务快捷查看：popup 中展示最近 5 条（调用 `/tasks?mine=1&limit=5`）。

## 15. 安全与合规

* 所有 API 需 Bearer Token（JWT，30 天有效，支持刷新）。
* CORS 仅放行扩展 ID / 可信来源；后台开启速率限制（如 60 req/min/用户）。
* 明示用途：后台与扩展展示“仅内部素材收集使用，遵守各平台条款与著作权法规”。

## 16. 数据库模型（建议）

* `CollectorTask`

  * `id` (PK), `user_id`, `source_site`, `source_url`, `item_id`, `title`, `price`, `currency`, `attrs` (JSON), `seller_info` (JSON), `status`, `fail_reason`, `created_at`, `updated_at`
* `CollectorAsset`

  * `id` (PK), `task_id` (FK), `type` (image/video), `source_url`, `stored_url`, `md5`, `phash64`, `width`, `height`, `filesize`, `status`, `created_at`
* 索引：(`md5` unique), (`phash64` btree + 近似比对逻辑由应用层完成)。

## 17. 后端 Worker 伪代码（Celery）

```python
@app.task
def fetch_task(task_id):
    t = CollectorTask.objects.get(id=task_id)
    for url in t.images + t.detail_images:
        try:
            bin = download(url, headers=pick_headers(t.source_site))
            meta = inspect(bin)  # w, h, fmt, md5, phash
            if not Asset.objects.filter(md5=meta.md5).exists():
                stored = save_to_store(bin, make_path(t, meta))
                Asset.create(task=t, source_url=url, stored_url=stored, **meta)
        except Exception as e:
            log_error(task_id, url, e)
    t.status = 'DONE'
    t.save()
```

## 18. 站点解析适配（示例占位）

* **天猫**：

  * 标题：`#J_DetailMeta > ...` 或 `window._DATA_` 中的 `itemDO.title`
  * 主图：DOM 中 `#J_UlThumb > li img[data-src]` → 原图规则替换
* **淘宝**：

  * 标题：`#J_Title h3`
  * 主图：`#J_UlThumb img`
* **1688**：

  * 标题：`h1.d-title`
  * 主图：`div#dt-tab img`
* **Temu**：

  * 基于页面 JSON（React state），定位 `media` 数组

> 实际选择器以联调为准，需建立 `site → selectors` 配置表与灰度开关。

## 19. 开发计划（里程碑）

* **M1（3 天）**：扩展骨架、Options、后台 API 草案、URL 匹配与悬浮按钮注入。
* **M2（4 天）**：四站点最小化解析（标题+主图 5 张以内）、创建任务、Worker 下载与入库。
* **M3（3 天）**：采集列表页面、任务详情、失败重试、指纹去重、相似度提示。
* **M4（2 天）**：黑名单/站点配置、进度优化、日志与告警。

## 20. 验收标准（DoD）

* 命中四站点详情页均能显示按钮；未登录点击提示登录，登录后可直接采集。
* 后台可看到任务，图片在 60 秒内可预览，去重命中率 > 95%。
* 失败重试可用；黑名单生效；相似度展示可用。
* 扩展、后台都提供基础操作日志（含用户、URL、IP、UA）。

## 21. 风险与备选

* **频繁页面改版** → 选择器配置化、优先页面 JSON。
* **防盗链/403** → 后端统一下载带 Referer/UA；必要时代理池。
* **CORS** → 扩展改由后台直连；不从扩展直接下载任何第三方资源。

## 22. 接口示例（简）

```http
POST /api/collector/tasks
Authorization: Bearer <JWT>
Content-Type: application/json
{
  "source_site": "TMALL",
  "source_url": "https://detail.tmall.com/item.htm?id=xxx",
  "title": "示例",
  "images": ["https://img.alicdn.com/imgextra/i1/...jpg"],
  "detail_images": [],
  "attrs": {"color": ["black","white"]}
}
```

---

**版本**：v1.0（初稿）

**后续**：若你给我后台域名/API 前缀与登录方式（SSO or 账号密码），我可以直接补齐接口参数、选择器配置表与扩展代码雏形（content script 与后台交互封装）。



