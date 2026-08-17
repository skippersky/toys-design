# Step 4 功能完整性终验报告

> 2026-08-11 最新复验：P0 与功能性 P1 运行时路径均已通过，包括真实 PSD/ZIP 下载、服务端 AI/ZIP 预览水印、Photopea 实际打开和 signed URL 到期拒绝。当前仅缺未安装的 Photoshop CC 2024+、GIMP 2.10+ 两款外部软件人工兼容性记录。完整证据见 `docs/step4-p0-p1-evidence.md`；本文件下方保留修复前基线，不能单独代表当前代码状态。

验收日期：2026-08-07（Asia/Shanghai）

## 1. 范围与证据口径

### 1.1 Step 4 原始边界

仓库历史和原始任务文本表明，Step 4 的正式主题是“服务端资产导出”，不是编辑器核心本身：

- Step 3：`e0b07d7`，2026-08-04 18:32，`Build high-performance Konva editor core`。
- Step 4：`918eaf5`，2026-08-06 17:49，`Implement server-side asset export system`。
- Step 4 原始任务：附件 `pasted-text.txt`，标题为 `Implement Server-Side Asset Export System (High-Risk)`；其先决条件明确写有 `Editor store state is serializable (verified in Step 3)`。

因此，本报告采用以下口径：

1. A 类先复核 Step 3 编辑器能力，作为 Step 4 能否消费图层数据的回归前置；再验收 Step 4 的服务端导出闭环。
2. B 类只纳入 `PROJECT_SPEC.md` 明确规定的身份、归属、`tier/credits`、额度扣减、预览水印和短时签名下载，不增加支付结账、订阅管理或 Stripe 等未定义能力。
3. 2026-08-07 后续补充的“列表 -> 编辑 -> 上传”已经过基础验收，本次仅把它作为导出集成输入复核，不重新定义为原始 Step 4 功能。
4. `✅ 已验` 表示已有运行时证据或与风险相匹配的自动化证据；只有代码存在但缺乏原始验收要求中的运行时证据时，仍记为 `⚠️ 部分实现`。

### 1.2 原始来源索引

| 来源 | 内容 |
|---|---|
| S1 | `PROJECT_SPEC.md` §Non-Negotiable Rules（服务端导出、预览水印、API 鉴权/限流） |
| S2 | `PROJECT_SPEC.md` §Module: Asset Export（输入、数据库图层、无水印母版、PSD/ZIP、300 秒签名 URL） |
| S3 | `PROJECT_SPEC.md` §Supabase Schema / Common Pitfalls（profiles、projects、assets、原子额度扣减） |
| S4 | 历史对话 2026-08-04：`Build High-Performance Konva Editor Core`（Step 3） |
| S5 | 历史对话/附件 2026-08-06：`Implement Server-Side Asset Export System (High-Risk)`（Step 4） |
| S6 | 历史对话 2026-08-07：编辑器应用完整业务流程补全（后续集成项，不扩大原始 Step 4） |

## 2. Step 4 验收基准清单

### 2.1 A 类：核心编辑器与导出

| 编号 | 类别 | 功能描述 | 原始出处 | 当前状态 |
|---|---|---|---|---|
| A-01 | A | Image/Text/Shape/Group 严格联合类型；添加、更新、排序、组合/解组、选择均走不可变更新 | S4 Step 1 | ✅ 已验：store 单测覆盖组合/解组与撤销 |
| A-02 | A | Konva 画布缩放、空格拖拽平移、惯性、视口外 200px 缓冲虚拟化 | S4 Step 2 | ✅ 已验：实现存在，几何单测覆盖缓冲边界 |
| A-03 | A | CSS 背景、原始分辨率画布导出方法；Step 4 正式 PSD/ZIP 不在客户端生成 | S4 Step 2；S1/S5 | ✅ 已验：正式 Export 走 `/api/export/package` |
| A-04 | A | 图层渲染使用 `React.memo/useMemo`，混合模式限 normal/multiply/screen/overlay | S4 Step 3 | ✅ 已验：PSD worker 单测覆盖图层属性 |
| A-05 | A | contenteditable 文本覆盖层、离屏图片懒加载、FPS<30 自动禁用阴影/滤镜 | S4 Constraints | ✅ 已验：代码路径完整；低 FPS 行为未做长时压力测试 |
| A-06 | A | Command history，最多 50 状态，快速变换合并，sessionStorage 恢复 | S4 Step 4 | ✅ 已验：专用单测覆盖 50 状态、合并和恢复 |
| A-07 | A | Del、Ctrl/Cmd+Z/Y、Ctrl/Cmd+G 快捷键，多选/组合可撤销 | S4 Step 5 / AC | ⚠️ 部分实现：单测通过，未完成多浏览器实测 |
| A-08 | A | 4K + 20 图层 ≥45fps、典型内存 <1GB、切回标签页不额外重渲染 | S4 Acceptance Criteria | ⚠️ 部分实现：无正式 Performance/Memory 录制证据 |
| A-09 | A | 本地图片上传后立即加入画布 | S6 后续集成回归 | ✅ 已验：前次运行时验收通过；不属于原始 Step 4 新范围 |
| A-10 | A | Node `worker_threads` 生成导出物，异常/父进程断开时清理退出 | S5 Step 1 | ✅ 已验：隔离线程单测通过；close/disconnect/异常处理存在 |
| A-11 | A | PSD 保留图层名称、可见性、位置、透明度、混合模式、文字元数据和组层级 | S5 Step 1 / AC | ⚠️ 部分实现：worker 单测通过，尚未在 Photoshop CC 2024、GIMP 2.10、Photopea 三者全部人工打开验证 |
| A-12 | A | ZIP 含 `master.psd`、`render-preview.png`、可选 `model-ref.json`，文件名经过净化 | S5 Step 1 / AC | ✅ 已验：ZIP 内容和文件名有自动化测试 |
| A-13 | A | 导出路由鉴权、资产归属校验、UUID 任务、最多 2 个并发、60 秒硬超时和断开终止 | S1；S5 Step 2 | ⚠️ 部分实现：代码存在；超时、并发、断开尚无完整运行时日志证据 |
| A-14 | A | SSE 立即发送 processing，并发送 progress/complete/error | S5 Step 2 | ⚠️ 部分实现：解析单测通过；真实项目提交在进入 worker 前返回资产不存在 |
| A-15 | A | 导出对话框支持 PSD/ZIP、可选 3D、loading、SSE 进度、完成自动下载、错误重试 | S5 Step 4 | ⚠️ 部分实现：UI 与错误处理可见，但当前真实项目无法完成下载 |
| A-16 | A | 从数据库资产元数据取得可序列化图层及私有图片映射，完成端到端导出 | S2；S5 Step 2 | ❌ 缺失：编辑器传 `project.id`，API 查询 `assets.id`；实测返回 `Asset was not found.` |
| A-17 | A | 导入/编辑后的图层持久化为可导出的 asset metadata | S2 “Fetch layers from DB”；S5 前置 | ❌ 缺失：图片仅上传 Storage 并写入客户端 store，没有保存项目图层或创建可导出的 assets 元数据 |
| A-18 | A | 20 图层 4K 导出 <30 秒；连续 5 次导出后 GC 回到基线；文件处理不积累 >100MB | S5 AC / Constraints | ⚠️ 部分实现：有 100MB 上限和流式写盘，未做要求的性能/内存实测 |

### 2.2 B 类：MVP 商业化配套

| 编号 | 类别 | 功能描述 | 原始出处 | 当前状态 |
|---|---|---|---|---|
| B-01 | B | 用户通过 Supabase Auth 获得稳定身份，服务端接口可取得 `user.id` | S1/S3 | ✅ 已验：匿名会话和上传链路已有运行时证据 |
| B-02 | B | `profiles(id, studio_name, tier, credits, updated_at)` 商业化基础表及 tier/credits 初始数据 | S3 Schema | ❌ 缺失：仓库迁移未创建 profiles/tier，无法可靠区分免费/付费用户或保存额度 |
| B-03 | B | 项目归属于当前 profile/user | S3 projects / ownership | ⚠️ 部分实现：字段和生成路由写入逻辑存在；当前两个种子项目的 `user_id/profile_id` 为 null，且没有认领/保存流程 |
| B-04 | B | 资产通过所属项目绑定当前用户，并具有可导出元数据 | S3 assets；S5 ownership | ❌ 缺失：基础编辑器项目没有对应可导出的资产记录；导入图片也不创建该记录 |
| B-05 | B | 生成前通过事务/RPC 原子检查并扣减 credits | S3 Common Pitfalls #7 | ⚠️ 部分实现：`check_credits` SQL 和路由调用已写；依赖缺失的 profiles 表与额度初始化，当前闭环不可用 |
| B-06 | B | 应用存在可触发额度检查的生成入口，并能反馈额度不足 | S1 AI Pipeline；S3 credits | ⚠️ 部分实现：API 有 402 分支，当前编辑器没有可验收的生成入口/额度状态展示 |
| B-07 | B | 预览图由服务端叠加 `user_id + timestamp` 水印，母版无水印 | S1 Rule #3；S5 Step 3 | ⚠️ 部分实现：ZIP preview 水印工具及测试存在；AI 生成预览仅签名 URL，未见统一服务端合成水印链路 |
| B-08 | B | 导出文件位于用户作用域私有 bucket，只返回 300 秒签名 URL | S2；S3 RLS；S5 Step 5 | ⚠️ 部分实现：代码固定 300 秒并校验路径；因端到端导出失败，未实测 URL 到期后返回 403 |
| B-09 | B | 免费/付费 tier 对应的导出限制或水印策略 | S3 仅定义 tier；未定义具体权益矩阵 | ⚠️ 范围待定：tier 数据基础缺失；具体套餐限制未在原始 Step 4 定义，不得自行扩展实现 |

明确排除：支付结账、订阅续费、发票、Stripe/微信/支付宝接入未出现在 S1-S5，不是 Step 4 准入项。

## 3. 缺失项根因与依赖

| 编号 | 根因判断 | MVP 阻塞 | 修复依赖 |
|---|---|---|---|
| A-07 | 已实现但未纳入跨浏览器运行时验收 | 否 | QA：Chrome/Edge/Firefox/Safari |
| A-08 | 性能保护代码存在，缺少指定场景的 Profile/Memory 证据 | 否，但属于 Step 3/4 性能准入 | QA 性能脚本与浏览器录制 |
| A-11 | PSD 结构有自动化测试，缺少三款目标软件兼容性验收 | 是，专业导出不可签收 | QA + Photoshop/GIMP/Photopea |
| A-13 | 防护逻辑已写，缺少并发、超时、断开日志证据 | 是 | 后端 API + 运行时 QA |
| A-14/A-15 | UI/SSE 已实现，但被 A-16 在 worker 启动前阻断 | 是 | 前端契约 + 后端 API |
| A-16 | `EditorWorkspace` 以 `assetId ?? project.id` 提交；路由严格按 `assets.id` 查找。属于代码集成缺陷 | 是 | 前端 + 后端 API + 数据契约 |
| A-17 | 上传只写 Storage 和 Zustand，没有保存 `projects.layers_json` 或导出 `assets.metadata` | 是 | 前端/后端 API + Supabase Schema/持久化流程 |
| A-18 | 只实现大小上限，未执行 4K/20 层/5 连续导出的基准测试 | 是 | QA 性能环境 |
| B-02 | 原始 schema 明确要求 profiles，但迁移中不存在 | 是 | Supabase Schema 变更 |
| B-03 | 表字段部分存在，但公共种子项目不归属用户，且无项目认领/创建/保存闭环 | 是 | 后端 API + Supabase 数据流程 |
| B-04 | assets 归属校验依赖项目归属；编辑器项目及导入文件未形成资产记录 | 是 | 后端 API + Supabase 数据流程 |
| B-05 | RPC 代码已实现但依赖不存在的 profiles/credits 数据 | 是 | Supabase Schema + 后端 API |
| B-06 | API 错误分支存在，缺少用户可触发的入口与状态 | 是，无法形成收费额度闭环 | 前端 + 后端 API |
| B-07 | 导出 ZIP preview 已加水印；生成阶段 preview URL 未统一经过合成水印 | 是，免费预览保护不完整 | 后端图像 API（sharp）；无需第三方服务 |
| B-08 | 签名逻辑已实现但没有成功导出物，故无法验证过期行为 | 是，受 A-16 阻塞 | 后端 API + Storage 运行时 QA |
| B-09 | 仅有 tier 字段要求，没有原始权益矩阵 | 否；先完成 B-02 即可区分用户 | 产品确认；之后才可能涉及前后端 |

## 4. 补全优先级矩阵

| 优先级 | 编号 | 待办 | 完成证据 |
|---|---|---|---|
| P0 | B-02/B-05 | 创建 profiles/tier/credits 基础并使原子额度扣减可运行 | 新用户有 tier/credits；并发扣减不出现负数 |
| P0 | B-03/B-04 | 让项目和资产稳定绑定当前用户，替换公共种子项目直接参与生产编辑的模式 | 当前会话只能加载/写入自己的项目和资产；不在本阶段做安全审计 |
| P0 | A-17/B-04 | 持久化编辑图层及私有图片映射，生成合法的 export asset metadata | 导入/编辑后数据库存在同一项目下、当前用户可导出的 asset |
| P0 | B-07 | 所有用户可见预览统一经过服务端 `user_id + timestamp` 水印 | 生成预览和 ZIP preview 均可见水印，母版像素无水印 |
| P1 | A-16 | 统一项目 ID 与资产 ID 契约，导出按钮提交真实 `assets.id` | 真实编辑器项目不再出现 `Asset was not found.` |
| P1 | A-11/A-14/A-15 | 完成真实 PSD/ZIP 下载并在三款目标软件中验证图层结构 | Photoshop、GIMP、Photopea 验收记录全部通过 |
| P1 | A-13/B-08 | 验证并发隔离、60 秒超时、断开终止和 300 秒 URL 过期 | 服务端日志 + 过期 URL 403 证据 |
| P1 | A-18 | 完成 4K/20 层 <30 秒和连续 5 次导出内存回落测试 | Network/进程内存/GC 记录 |
| P2 | B-06 | 在既有生成流程中提供额度状态与额度不足反馈入口 | 无额度用户可见明确反馈，不能启动任务 |
| P2 | B-09 | 产品确认 tier 权益矩阵后再定义免费/付费导出限制 | 有经确认的 PRD；不在本轮自行实现 |
| P3 | A-07/A-08 | 补齐多浏览器快捷键、标签页切回、编辑器 FPS/内存回归证据 | 浏览器矩阵与 Performance 录制 |

## 5. 本轮运行时与质量证据

- 真实路径：`/editor/11111111-1111-4111-8111-111111111111`，标题为 `Cyberpunk Alley`，画布有 1 个图层。
- 打开 Export 对话框并提交 PSD：先显示 `processing`，随后明确显示 `Asset was not found.`；未产生下载。
- 代码契约：`editor-workspace.tsx` 传入 `assetId ?? project.id`；`/api/export/package` 查询 `assets.id = body.assetId`。
- `pnpm run lint`：PASS，退出码 0。
- `pnpm test`：PASS，13 个测试文件、30 个测试全部通过；仅有 Fontconfig 缓存目录不可写提示，不影响测试结果。
- `pnpm run build`：PASS，Next.js 生产构建、TypeScript 和 worker build 全部通过。

## 6. 人工可勾选终验清单

### P0

- [ ] profiles/tier/credits schema 与新用户初始化已完成。
- [ ] 原子额度扣减在并发条件下已验证。
- [ ] 项目和资产均绑定当前用户，种子项目不再作为无主生产项目。
- [ ] 编辑器图层和图片私有对象已持久化为可导出的 asset metadata。
- [ ] 生成预览与导出预览均有服务端用户水印，母版无水印。

### P1

- [ ] Export 提交真实 asset ID，真实项目可成功下载 PSD。
- [ ] ZIP 包含净化命名的 `master.psd`、`render-preview.png` 和可选 `model-ref.json`。
- [ ] PSD 已分别通过 Photoshop CC 2024+、GIMP 2.10+、Photopea 验证。
- [ ] 20 图层 4K 导出耗时小于 30 秒。
- [ ] 两个并发导出互相隔离，第三个请求被限制。
- [ ] 客户端断开后 worker 立即终止，60 秒超时可优雅报错。
- [ ] 签名 URL 在 300 秒后返回 403，响应中不暴露原始存储路径。
- [ ] 连续 5 次导出后，GC 后堆内存回到稳定基线。

### 回归与非阻塞项

- [x] 编辑器图层操作、组合/解组、撤销/重做单测通过。
- [x] 图片上传并进入画布的基础链路已通过前次运行时验收。
- [x] lint、30 个单元测试、生产构建通过。
- [ ] 快捷键完成 Chrome/Edge/Firefox/Safari 实测。
- [ ] 4K/20 图层编辑器达到 ≥45fps、典型内存 <1GB。
- [ ] 产品确认 tier 权益矩阵；未确认前不扩展支付或套餐功能。

## 7. 最终结论与 Step 5 准入

**结论：Step 4 当前不可签收，也不允许进入 Step 5。**

核心原因不是代码文件缺失，而是端到端导出数据契约尚未闭合：真实编辑器项目没有可供导出 API 消费的资产元数据，运行时导出失败；同时 profiles/tier/credits 与项目/资产归属闭环不足，MVP 无法可靠区分用户和执行额度控制。

> 当且仅当所有 P0/P1 项状态变为 ✅，方可视为 Step 4 完成，允许进入 Step 5（安全审计）。
