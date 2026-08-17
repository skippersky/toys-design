# Step 5 AI 核心能力证据报告

日期：2026-08-17

## 结论

ComfyUI 未启动及 `COMFYUI_CHECKPOINT_NAME` 未配置的阻塞已解除。本机已通过 DirectML 完成一次真实 512x512 LCM 推理，并由一键启动器同时恢复 ComfyUI 与 Next.js 服务。

AI 服务本身已可用。需要登录态的 Storage 持久化、额度扣减和编辑器自动入画布仍需在浏览器会话中人工终验，本文不以代码存在替代这些证据。

## 功能状态

| 编号 | 实现结果 | 运行时结果 | 证据 |
|---|---|---|---|
| AI-01 | ComfyUI HTTP 排队、WebSocket 进度、SSE 输出、重连、120 秒超时与断开取消 | ✅ PASS | `/system_stats` HTTP 200；真实 prompt 执行成功并生成 PNG |
| AI-02 | 输出上传 Storage，事务写入 `assets`，绑定 `user_id/project_id` | ⚠️ 待登录态终验 | Supabase Step 5 RPC HTTP 200；真实生成文件已产出，资产写入需登录会话触发 |
| AI-03 | 编辑器真实调用、402 提示、成功入画布、额度预留及失败退款 | ⚠️ 待登录态终验 | 未登录 API 返回预期 401；额度充足/不足场景需浏览器人工验证 |
| AI-04 | 3 组模板、自定义 Prompt、尺寸、步数、CFG、Seed | ✅ 代码与单测；⚠️ UI 截图待补 | 本机 LCM 默认步数已调为 4；工作流单测通过 |

## ComfyUI 运行时证据

```text
[Health] HTTP 200
[ComfyUI] version: 0.3.59
[Device] privateuseone / DirectML / LOW_VRAM
[PyTorch] 2.4.1+cpu + torch-directml 0.2.5.dev240914
[Checkpoint] DreamShaper8_LCM.safetensors
[Checkpoint SHA256] A4F3E1526C5DC4FCBE342F5C410D83AE202C7A415FCEFCBB92E0F93FCD0A87C3
[Prompt ID] 01b5a19d-adc8-4e0f-b246-1906f411319d
[Prompt status] success / completed=true
[Prompt duration] 117.89 seconds
[Output] .runtime/comfyui/output/statueforge/runtime-verification_00001_.png
[Output dimensions] 512x512
[Output bytes] 237336
[Output SHA256] 4DD80CB4F0B349CECFC88E25DAC0996721B61390A90F948AA4AE8990DDF34495
```

生成参数：DreamShaper 8 LCM、`lcm` sampler、`sgm_uniform` scheduler、4 steps、CFG 2、seed `20260812`。

## 服务联调证据

```text
[Config] Supabase URL: configured
[Config] Supabase anon key: configured
[Config] ComfyUI checkpoint: DreamShaper8_LCM.safetensors
[Supabase RPC] HTTP 200
[Supabase RPC] {"ok":false,"code":"unauthorized"}
[ComfyUI] HTTP 200
[Local API unauthenticated] HTTP 401
[Local API unauthenticated] {"code":"unauthorized","message":"Authentication is required."}
[One-click app] GET http://127.0.0.1:3000/ -> HTTP 200
```

匿名 RPC 返回 `unauthorized` 和本地生成接口返回 401 均为预期的鉴权防御结果。

## 一键部署

双击项目根目录 `setup-and-start.cmd` 可完成：

1. 安装固定版 Python、ComfyUI 和 DirectML 依赖。
2. 下载并校验 DreamShaper 8 LCM checkpoint。
3. 系统无 Node/pnpm 时安装便携 Node.js 22.16.0 与 pnpm 10.12.1。
4. 官方 Node 源不可达时切换镜像，并使用固定 SHA256 校验归档。
5. 保留 Supabase 凭据，补齐 ComfyUI 环境变量。
6. DirectML 启动失败时自动回退 CPU。
7. 启动 ComfyUI 与 Next.js。

## 自动验证

```text
pnpm run lint    -> PASS，0 issues
pnpm test        -> PASS，18 files / 50 tests
pnpm run build   -> PASS，Next.js production build completed
pnpm qa:step5-ai -> PASS，Supabase/ComfyUI/local API 均返回预期状态
```

## 剩余人工终验

- [ ] 登录编辑器后执行一次额度充足生成，记录 SSE 状态流转和自动入画布截图
- [ ] 查询生成后的 `assets` 行，核对 user_id/project_id/prompt/seed/model metadata
- [ ] 记录 `profiles.credits` 扣减前后对比
- [ ] 额度不足时记录 HTTP 402 与 UI 提示
- [ ] 补充 3 个模板 UI 和参数结果对比截图
