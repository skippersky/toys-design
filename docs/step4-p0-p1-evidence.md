# Step 4 P0/P1 修复与复验证据

复验日期：2026-08-11（Asia/Shanghai）

## 当前结论

P0 商业化与数据闭环已经通过远端运行时验收：`profiles.user_id`、`assets.user_id` 与 imported metadata 字段探针均返回 HTTP 200；新 `decrement_credits ... FOR UPDATE` RPC 在 20 个并发请求下严格得到 10 次成功、10 次拒绝；认证 `/api/preview` 返回 300 秒签名 URL，下载结果中的 `user_id + timestamp` 水印肉眼可见。P0 已闭环。Step 4 仍保留 Photoshop CC 2024+ 与 GIMP 2.10+ 两项外部人工兼容性复核，未进入 Step 5。

## 人工勾选清单

### P0-1 profiles / tier / credits

- [x] 兼容迁移已创建：将现有 `profiles.id` 原地重命名为主键 `user_id`，`tier` 转为受约束 TEXT，保留数据和旧 RPC 兼容入口。
- [x] `decrement_credits(p_user_id, p_amount)` 已使用 `SELECT ... FOR UPDATE` 和 `auth.uid()` 校验实现。
- [x] 远端迁移已执行；认证 REST 字段探针确认 `profiles(user_id,tier,credits)` 可访问。
- [x] 新行锁 RPC 已完成 20 并发终验：10 次成功、10 次拒绝，无负数、超扣或部分扣减。

```text
[Profile Verify] direct_select=filtered_by_current_access_policy
[Credit Verify] concurrent_attempts=20
[Credit Verify] successful=10 rejected=10
[Profile Verify] final=verified_by_rpc_rejections
```

运行时日志：`docs/qa-evidence/step4-commercial-baseline-runtime.log`。

新迁移：`supabase/migrations/20260811000000_step4_commercial_baseline.sql`。

远端结构证据：

```text
[Remote Schema Verify] authenticated REST probes passed
public.profiles columns: user_id, tier, credits (HTTP 200)
RPC decrement_credits exposed: true (insufficient result=false)
```

截图：`docs/qa-evidence/step4-remote-schema-structure.png`，SHA-256：`2e1abde0f96e616ca58ab342a7aa73579a4e6d4076cd7100823ce86637f9f9d5`。

复现命令：

```powershell
pnpm qa:step4-commercial
node verify-step4-schema.mjs
```

### P0-2 项目与资产归属

- [x] `assets.user_id`、`source_layer_id`、项目所有者同步 trigger 与唯一索引已写入兼容迁移；未修改 RLS。
- [x] 导入图片保存时构造 `{project_id,user_id,oss_key,metadata}` 资产记录，并与项目文档保存放在同一数据库事务 RPC 中。
- [x] `save_editor_document` 同时校验 `projects.user_id/profile_id = auth.uid()` 与 `assets.user_id = auth.uid()`。
- [x] 远端迁移已执行；导入后查询返回直接 `assets.user_id`、`source_layer_id` 与完整 metadata JSON。
- [x] 公共种子项目仅作为模板，首次打开后克隆为当前用户项目。
- [x] `Cyberpunk Alley` 从种子 ID 跳转至真实拥有者 UUID `a01548d4-1658-41d3-86d0-719163877894`。
- [x] 编辑器初始化创建真实 draft asset，并只在获得 `assets.id` 后启用 Export。
- [x] 导入图片写入用户/项目作用域 Storage 路径并保存至 asset metadata。
- [x] 上传后图层数从 1 增至 2；刷新页面后仍为 2，证明已持久化。
- [x] 第二匿名用户查询该项目和资产均返回 0 行。

```text
[Ownership Verify] foreign user: 8f13e8c1-f382-4f5d-a191-793ce7670e7d
[Ownership Verify] foreign project rows: 0
[Ownership Verify] foreign asset rows: 0
```

本轮远端导入资产证据：

```text
[Asset Verify] project_id=10367751-97c5-4a5d-8f47-d2a8622f89ce
[Asset Verify] editor_asset_id=3326c22b-85a3-4ddd-b019-7a2a1423b358
[Asset Verify] imported.user_id=f184edf1-9050-45ab-942d-f98bd5d20658
[Asset Verify] imported.metadata.imported_image=true
[Asset Verify] imported.metadata.width=320 height=180
```

完整资产 JSON：`docs/qa-evidence/step4-commercial-baseline-runtime.log`。

### P0-3 服务端预览水印

- [x] 新增认证 `POST /api/preview`：用 `sharp` 合成 `user_id + timestamp` 水印，上传用户作用域路径并返回 300 秒 signed URL。
- [x] ZIP `render_preview.png` 在 worker 内叠加 `user_id | timestamp` 水印。
- [x] AI 生成路由从 ComfyUI history 解析真实输出，通过 `/view` 下载原图，在服务端合成水印，再上传并返回 300 秒 signed URL。
- [x] PSD/ZIP 的 `master.psd` 不调用水印函数。
- [x] 实际 API ZIP 中的预览可见斜向 `user_id | timestamp` 水印，尺寸和画面内容保持不变。
- [x] 本地 ComfyUI 协议模拟器 + 真实 Next/Supabase 运行时验证：HTTP 200，SSE 顺序为 `progress,progress,progress,complete`，预览下载 HTTP 200。
- [x] AI 预览尺寸 1200x675，水印肉眼可见，SHA-256 为 `53823D3FA027C936F07FB1CAF766FA4DBC993AC3F80263787679785346DE22A1`。
- [x] `/api/preview` 真实请求 HTTP 200、下载 HTTP 200、TTL 300 秒；原图/水印并排对比已保存。
- [x] 本轮 `/api/preview` 水印文件 SHA-256：`7ebdeb6c101eae903cca20d0a17a2499178ae3fdb8781c6cf11d0d05d2fbf489`。
- [x] 对照原图 SHA-256：`0c5ae5e8e76873a03378b131f50a1ba52b684211bbf8345d60c72dcd0262a1e7`，与水印结果不同。

证据：

- `docs/qa-evidence/step4-render-preview-watermarked.png`
- `docs/qa-evidence/step4-api-render-preview.png`（由真实 API ZIP 解包取得）
- `docs/qa-evidence/step4-generation-preview-watermarked.png`（由真实生成 API 的 300 秒 signed URL 下载）
- `docs/qa-evidence/step4-generation-preview-runtime.log`（包含本次临时 signed URL；按设计 300 秒后失效）
- `docs/qa-evidence/step4-preview-original.png`
- `docs/qa-evidence/step4-preview-api-watermarked.png`
- `docs/qa-evidence/step4-preview-comparison.png`
- `docs/qa-evidence/step4-preview-api-runtime.log`（包含 300 秒 signed URL）

复现命令（两个终端，编辑器 AI 按钮仍保持占位）：

```powershell
node verify-comfyui-preview.mjs
node verify-generation-preview.mjs
```

本轮服务端修复代码位于 `src/lib/comfyui-client.ts` 与 `src/app/api/generate/statue/route.ts`，核心数据流为：

```ts
const history = await comfyui.getHistory(promptId);
const outputImage = comfyui.getFirstOutputImage(history, promptId);
const previewSource = await comfyui.downloadImage(outputImage);
const previewUrl = await createPreviewUrl(
  supabase,
  Buffer.from(previewSource),
  userId,
  promptId,
);
```

该修复不需要 SQL，也未改变编辑器 AI 占位入口。

### P1-4 A-16 资产 ID 契约

- [x] `EditorWorkspace` 不再以 `project.id` 作为 asset fallback。
- [x] 导入、自动保存和导出提交同一个真实 `assets.id`。
- [x] 本轮真实请求中 `project.id=630a7f37-25ba-4944-81be-04a88eed8ba2`，提交的是独立的 `assets.id=5499102a-3b64-435d-81cf-dbdb0ccbec6f`。
- [x] PSD 与 ZIP 路由、私有 bucket 上传、signed URL 下载全部返回 HTTP 200。
- [x] PSD SSE：`progress -> progress -> progress -> progress -> complete`；ZIP SSE 多一个 `packaging` progress 后 complete。
- [x] 两个完整 SSE 响应和服务器日志中 `Asset was not found` 出现次数为 0。
- [x] API PSD SHA-256：`038423308f132a27655b4e5d221ef22cbe25514fe9d45738afcd1419b50e643b`。
- [x] API ZIP SHA-256：`66e961a42bcab57cf6f336c4334621545901944ce5a2b76b56ec44398f2e5f3f`。

人工复核哈希：

```powershell
Get-FileHash docs/qa-evidence/step4-api-export-current.psd -Algorithm SHA256
Get-FileHash docs/qa-evidence/step4-api-export-current.zip -Algorithm SHA256
```

运行时响应截图：`docs/qa-evidence/step4-export-api-response.png`，SHA-256：`1248b547d831bbe48660bfbd56107609b6c61e1f5e6a448b7d0219c259098130`。

完整日志：`docs/qa-evidence/step4-export-api-runtime.log`、`docs/qa-evidence/step4-export-api-server.log`。

### P1-5 右键菜单与 AI 入口

- [x] 工具栏 AI 生成按钮可见，按本轮范围显示占位反馈且不调用模型。
- [x] 画布右键菜单运行时可见：复制、置顶、置底、锁定、AI 生成、删除。
- [x] 添加文字后图层数从 1 增至 2，撤销按钮立即启用。
- [x] 执行撤销后图层恢复为 1，重做按钮立即启用。
- [x] Cookie 刷新边界已修复；新标签编辑器加载后 Console 为零错误。

### P1-6 PSD / ZIP

- [x] 生成真实 3840x2160、20 图层 PSD，大小 893,364 bytes。
- [x] `ag-psd` 回读确认 20 个图层，首层名为 `QA Layer 20`。
- [x] 生成真实 ZIP，包含 `master.psd`、`render_preview.png`、`model_ref.json`。
- [x] 本地 4K/20 图层 PSD 用时 275ms，小于 30 秒标准。
- [x] 本轮真实 API PSD：路由 200、下载 200、481,944 bytes；ZIP：路由 200、下载 200、72,722 bytes。
- [x] API PSD 回读：2 个根图层，名称为 `QA Text Group`、`QA Vector Badge`；组内文字层内容为 `StatueForge QA`。
- [x] 形状层不再仅有栅格回退；PSD 回读确认 `vectorMask=true`，并包含 vector fill/stroke 元数据。
- [x] API ZIP 包含 `master.psd` 与带水印的 `render_preview.png`；本次请求未勾选 3D，因此不包含可选的 `model_ref.json`，行为符合契约。
- [x] Photopea 通过 300 秒私有 signed URL 实际打开本轮 API PSD。
- [x] Photopea 运行时把文字从 `StatueForge QA` 修改为 `StatueForge QA EDITED`，返回 `Text editable PASS`。
- [x] Photopea 运行时识别形状层为 `kind=3 / SOLIDFILL=true`，返回 `Vector editable PASS`。
- [ ] Photoshop CC 2024+：当前机器未安装，兼容性人工截图待补。
- [ ] GIMP 2.10+：当前机器未安装，兼容性人工截图待补。

图层数量/命名对照：

| 编辑器层级                       | API PSD 回读                              | Photopea 运行时                                       | 结果 |
| -------------------------------- | ----------------------------------------- | ----------------------------------------------------- | ---- |
| 根层 `QA Vector Badge`（shape）  | 根层 `QA Vector Badge`，`vectorMask=true` | `QA Vector Badge [VECTOR EDITABLE]`，`SOLIDFILL=true` | PASS |
| 根组 `QA Text Group`             | 根组 `QA Text Group`                      | 根组 `QA Text Group`                                  | PASS |
| 子层 `QA Editable Title`（text） | 组内文字 `StatueForge QA`                 | 实际改为 `StatueForge QA EDITED`                      | PASS |
| 根层数量 2                       | 根层数量 2                                | 根层数量 2                                            | PASS |

证据：

- `docs/qa-evidence/step4-export-sample.psd`
- `docs/qa-evidence/step4-export-sample.zip`
- `docs/qa-evidence/step4-api-export-current.psd`
- `docs/qa-evidence/step4-api-export-current.zip`
- `docs/qa-evidence/step4-photopea-interop.png`
- `docs/qa-evidence/step4-photopea-interop-runtime.json`

Photopea 本轮截图 SHA-256：`56e8ebe05ead13a76bfbbaf775ed914efff1b8452f027b6240a11a5fdfe25da0`。临时 PSD 位于私有 `exports` bucket，验证后自动删除。

### P1-7 并发 / 超时 / 断开 / URL 到期

- [x] 同一真实用户同时提交 3 个导出请求，HTTP 状态为 `200,200,429`，严格允许 2 个、拒绝 1 个。
- [x] 断开测试先收到 HTTP 200 与 worker `rendering` 事件，再主动中止；服务器记录 `Export SSE abandoned`。
- [x] 断开后新增 `statueforge-export-*` 临时目录数量为 0。
- [x] 从 `src/lib/export-coordinator.ts` 实时编译并运行同一 deadline 实现：配置 60,000ms，实际 60,014ms 触发。
- [x] 连续 5 次导出后 GC heap delta 为 `-1,480,424` bytes。
- [x] 真实导出 URL 的 `expiresAt=2026-08-12T08:56:09.073Z`；在 `08:56:11.077Z` 复查时远端返回 HTTP 400、`InvalidJWT`、`"exp" claim timestamp check failed`。

运行时证据：

- `docs/qa-evidence/step4-export-guards-runtime.log`
- `docs/qa-evidence/step4-export-guards-server.log`
- `docs/qa-evidence/step4-export-guards-runtime.png`

证据 SHA-256：运行时日志 `808614aa0a7129cdf9b5229c610b29f570251ba2a90c340e19179abffcc448e3`；服务器日志 `ec28a1a48e2e48dec19c9c0338c4d00b9f560d6d19a706b0ef57b5483d81f52f`；截图 `dfdc929a6485500e0744d01047c0c89fe34d760bbf3841d95cc7bb8e6d0341b5`。

## 真实 API 导出证据

使用真实匿名会话、归属项目和资产完成端到端导出：

```text
[API Verify] project=630a7f37-25ba-4944-81be-04a88eed8ba2
[API Verify] asset=5499102a-3b64-435d-81cf-dbdb0ccbec6f
[API Verify] submitted assetId matches assets.id=true

[Export Verify] PSD route=200 download=200
[Export Verify] PSD sha256=038423308f132a27655b4e5d221ef22cbe25514fe9d45738afcd1419b50e643b
[PSD Verify] root layers=2
[PSD Verify] names=QA Text Group, QA Vector Badge
[PSD Verify] text=StatueForge QA
[PSD Verify] shape vectorMask=true

[Export Verify] ZIP route=200 download=200
[Export Verify] ZIP sha256=66e961a42bcab57cf6f336c4334621545901944ce5a2b76b56ec44398f2e5f3f
[ZIP Verify] master_psd=true preview=true model_ref=false

[Contract Verify] Asset was not found occurrences=0
```

API ZIP 的 `render_preview.png` 已解包并目视核验，斜向水印内容为本次会话 user UUID 与 UTC 时间戳；母版 PSD 回读正常。

## 剩余外部人工阻塞与复核步骤

后端迁移、下载、Photopea 和到期验证均不再阻塞。安装目录、命令路径与 Windows 卸载注册表均未发现 Photoshop 或 GIMP，因此二者不能在本机伪造通过。该项不需要产品代码或 SQL 修复，只需要目标软件人工打开同一证据文件。

Photoshop CC 2024+ 人工步骤：

1. 打开 `docs/qa-evidence/step4-api-export-current.psd`。
2. 确认图层面板含 `QA Vector Badge`、`QA Text Group/QA Editable Title`。
3. 用文字工具修改 `StatueForge QA`，用路径/形状工具选中 `QA Vector Badge` 并改变填充色。
4. 将文字编辑前后和形状路径/属性面板截图保存为 `docs/qa-evidence/step4-photoshop-compatibility.png`。

GIMP 2.10+ 人工步骤：

1. 打开 `docs/qa-evidence/step4-api-export-current.psd`，保留“将图层导入为图像”的默认行为。
2. 确认图层数量、名称和画布渲染正确；记录 GIMP 对 PSD 文字/矢量层的导入语义。
3. 尝试修改文字和形状路径，截图记录实际可编辑能力或格式降级行为。
4. 保存为 `docs/qa-evidence/step4-gimp-compatibility.png`。

当前机器复核命令：

```powershell
Get-Command photoshop*,gimp* -ErrorAction SilentlyContinue
```

环境检查日志：`docs/qa-evidence/step4-external-app-check.log`（Photoshop/GIMP 均为 `False`）。

## 质量门槛

```text
[Lint] PASS - 0 issues
[Test] PASS - 16 files, 41 tests
[Build] PASS - Next.js production build and TypeScript worker build
[Dev] PASS - http://127.0.0.1:3000/ returns HTTP 200
```

## P0 远端完成记录

- [x] 用户已在 Supabase SQL Editor 执行 `supabase/migrations/20260811000000_step4_commercial_baseline.sql`，结果为 `Success. No rows returned`。
- [x] `pnpm qa:step4-commercial` 远端运行时验证通过，生成并发扣减和 imported asset 完整日志。
- [x] `node verify-step4-schema.mjs` 通过认证 REST 字段探针和无扣减 RPC 探针，生成远端结构截图。
- [x] `node verify-preview-api.mjs` 真实请求、下载、TTL、水印目视检查与 SHA-256 验证通过。

仅有 Fontconfig 缓存目录不可写提示，不影响测试或构建。

P0 已完成。补齐 Photoshop CC 2024+、GIMP 2.10+ 人工打开记录后，Step 4 方可最终签收并允许进入 Step 5。
