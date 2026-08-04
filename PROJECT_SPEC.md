# Project: StatueForge AI SaaS
## Tech Stack Constraints (STRICT)
- Framework: Next.js 14+ (App Router, TypeScript strict mode)
- Styling: Tailwind CSS + shadcn/ui (Dark theme default)
- Canvas Engine: Konva.js + react-konva (NO Fabric.js)
- 3D Viewer: @react-three/fiber + @react-three/drei
- Backend/BFF: Next.js Route Handlers + Server Actions
- AI Orchestration: ComfyUI Client (HTTP/SSE)
- Database: Supabase (PostgreSQL + Auth + Storage)
- State: Zustand (client) + React Query (server state)
- File Processing: ag-psd (server-side PSD gen), sharp, archiver

## Non-Negotiable Rules
1. ALL AI generation tasks MUST use SSE for progress streaming. NO polling.
2. PSD/ZIP export MUST be generated server-side via Worker/Route Handler.
3. Preview images MUST have server-composited watermark (user_id + timestamp).
4. No client-side heavy processing >50ms. Offload to Web Worker or Server.
5. All API routes must have rate limiting and auth middleware.



## Module: AI Generation Pipeline
### Endpoint: POST /api/generate/statue
- Input: { style: enum, ratio: string, ip_ref_url?: string, prompt: string }
- Output: SSE Stream
  - event: progress → data: { step: number, total: number, preview_url?: string }
  - event: complete → data: { asset_id: string, layers: LayerMeta[] }
  - event: error → data: { code: string, message: string }
- Constraint: Timeout 120s. Auto-retry 1x on 5xx.

## Module: Asset Export
### Endpoint: POST /api/export/package
- Input: { asset_id: string, format: 'psd'|'zip', include_3d: boolean }
- Output: Signed OSS URL (expires 300s)
- Server Logic: 
  1. Fetch layers from DB
  2. Composite watermark-free master
  3. Generate PSD via ag-psd OR ZIP via archiver
  4. Upload to private bucket, return presigned URL
  
  
  
## Supabase Schema (MUST follow exactly)
- profiles: id(uuid), studio_name, tier(enum), credits(int), updated_at
- projects: id, profile_id, name, style, ratio, ip_ref_url, status(enum), created_at
- assets: id, project_id, type(enum: draft/model/render/promo), 
          oss_key, metadata(jsonb), version(int), is_final(bool)
- generation_tasks: id, asset_id, comfyui_prompt_id, status, 
                    progress(int), error_msg, started_at, completed_at

## RLS Policies
- Users can ONLY access own projects/assets
- Assets.oss_key is NEVER exposed directly; always via signed URL function  


## AI Coding Assistant Instructions
1. BEFORE writing code: Always check this spec for constraints.
2. WHEN creating components: Use shadcn/ui CLI, never hand-code base UI.
3. FOR canvas operations: Wrap in React.memo + useMemo. Profile render fps.
4. FOR AI integration: Use existing /lib/comfyui-client.ts singleton.
5. ERROR HANDLING: All server actions must return typed Result<T, E>.
6. TESTING: Generate Vitest unit tests for all utility functions.
7. DO NOT: Install unapproved packages. Ask first if unsure.


## Common Pitfalls to Avoid
1. ❌ Never store raw image URLs in database. Store oss_key only.
2. ❌ Never use useEffect for canvas rendering. Use Konva's declarative API.
3. ❌ Never generate PSD on client thread. Will freeze UI.
4. ❌ Never trust user-uploaded filenames. Sanitize with slugify.
5. ✅ Always add loading/error states to every async component.
6. ✅ Always validate SSE connection recovery (auto-reconnect logic).
7. ✅ Always use transactional queries for credit deduction.