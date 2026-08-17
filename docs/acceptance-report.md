## 验收报告

验收日期：2026-08-07（Asia/Shanghai）

### 前置条件
- [x] `.env.local` 配置完整
  - 文件存在，`NEXT_PUBLIC_SUPABASE_URL` 与 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 均非空。
  - 缺失配置测试结束后已原样恢复。
- [x] 服务器正常运行
  - `GET http://127.0.0.1:3000/` 实际返回 HTTP 200。
  - 验收结束时开发服务器已恢复在 `127.0.0.1:3000` 运行。
- [x] 数据库表/bucket/种子数据就绪
  - 匿名 key 请求 `projects`：HTTP 200，共 2 条记录。
  - 示例记录：`Cyberpunk Alley`，ID `11111111-1111-4111-8111-111111111111`，含 1 个有效图片图层。
  - `GET /storage/v1/bucket/assets`：HTTP 200，`id=assets`，`public=true`。
  - 两条种子数据的 `placehold.co` 缩略图均返回 HTTP 200、`image/png`。
  - SQL 校验：公开种子项目 2 条、项目策略 5 条、Storage 策略 6 条。证据：[SQL 结果](qa-evidence/00-supabase-sql-verification.png)。

### 功能验收结果
| # | 验收项 | 结果 | 证据（DOM截图/Console输出/API响应摘要） |
|---|--------|------|------------------------------------------|
| 1 | 项目列表页渲染 | PASS | `/` 的 DOM 有 2 个 `/editor/` 卡片链接；名称为 `Cyberpunk Alley`、`Neon Sign`，均含 `img` 和 UUID 链接。[截图](qa-evidence/01-project-list.png) |
| 2 | 卡片跳转功能 | PASS | 实际点击第一张卡片后 URL 变为 `/editor/11111111-1111-4111-8111-111111111111`，该 ID 与 REST 返回的真实项目 ID 一致。 |
| 3 | 编辑器数据加载 | PASS | 标题为 `Cyberpunk Alley`；图层面板运行时显示 1 个图层；Konva DOM 有 1 个 `canvas`，尺寸为 3840×2160。Zustand 未暴露全局调试对象，以上为其渲染状态的运行时证据；Console 无错误或警告。[截图](qa-evidence/02-editor-loaded.png) |
| 4 | 工具栏完整性 | PASS | 采用方案 B：空历史时撤销/重做保持 disabled，tooltip 分别为“暂无可撤销操作”“暂无可重做操作”；实际点击“添加文字”后图层数由 1 变为 2，撤销按钮立即 enabled。 |
| 5 | 图片导入链路 | PASS | 编辑器自动建立匿名会话；真实选择 PNG 后提示“图片已添加到画布”，图层数由 1 增至 2，图层面板显示导入文件，撤销立即 enabled，Console 无错误或警告。[截图](qa-evidence/05-upload-success.png) |
| 6 | 数据库迁移完整性 | PASS | REST 可匿名读取 2 个项目；SQL 显示项目策略 5 条、Storage 策略 6 条；bucket 元信息 HTTP 200；认证用户实际上传至 `assets` 并成功取得预览 URL。 |
| 7 | 环境变量防御 | PASS | 临时移走 `.env.local` 并重启后，DOM 显示完整错误文案，`data-state=configuration-error`，项目卡片数为 0；恢复配置后根路由重新显示 2 个 Supabase 项目。 |

### 后端验证输出

```text
[DB Verify] projects HTTP: 200
[DB Verify] projects count: 2
[DB Verify] sample project: {"id":"11111111-1111-4111-8111-111111111111","name":"Cyberpunk Alley","thumbnail_url":"https://placehold.co/600x400/png?text=Cyberpunk+Alley","layers_json":[...1 image layer...]}
[Storage Verify] assets bucket: HTTP 200 {"id":"assets","name":"assets","public":true,"file_size_limit":26214400,...}
[Thumbnail Verify] Cyberpunk Alley: HTTP 200, Content-Type=image/png, Bytes=6570
[Thumbnail Verify] Neon Sign: HTTP 200, Content-Type=image/png, Bytes=7280
```

### 辅助检查
- `pnpm run lint`：PASS，退出码 0。
- `pnpm test`：PASS，13 个测试文件、30 个测试全部通过。
- 测试进程输出了 Fontconfig 缓存目录不可写警告；未导致测试失败，与本次业务验收失败项无关。

### 最终复验输出
```text
[Auth Verify] anonymous session: f113174f-63e0-4f05-8b82-8e2a9294b281
[Upload Verify] layer count after upload: 2
[Env Defense Verify] missing env error panel visible: true
[Toolbar Verify] undo button enabled after edit: true
```

### 阻塞性问题（如有）
- 无。

### 最终结论
✅ 可签收。

项目列表、编辑器加载、匿名会话、图片上传、Storage 写入、环境变量防御和编辑后撤销状态均已通过运行时验证。
