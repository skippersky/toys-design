"use client";

import {
  AlertTriangle,
  Eye,
  EyeOff,
  Group as GroupIcon,
  ImageIcon,
  Layers3,
  LoaderCircle,
  PanelRightClose,
  PanelRightOpen,
  Redo2,
  Shapes,
  Trash2,
  Type,
  Undo2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";

import { CanvasCore } from "@/components/editor/canvas-core";
import { ExportDialog } from "@/components/editor/export-dialog";
import { Button } from "@/components/ui/button";
import { uploadProjectImage } from "@/lib/project-image-upload";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { cn } from "@/lib/utils";
import {
  type EditorLayer,
  type TextLayer,
  useEditorStore,
} from "@/store/editor-store";
import { useGenerationStore } from "@/store/generation-store";
import type { EditorProject } from "@/types/project";

const DOCUMENT_WIDTH = 3840;
const DOCUMENT_HEIGHT = 2160;

type SessionState = "loading" | "ready" | "error";

interface EditorWorkspaceProps {
  project: EditorProject;
}

function ConfigurationError() {
  return (
    <main
      className="grid min-h-dvh place-items-center bg-background px-6 text-foreground"
      data-component="editor-workspace"
      data-editor-workspace
      data-state="configuration-error"
    >
      <section
        className="w-full max-w-xl rounded-md border border-red-500/30 bg-zinc-950 p-6 shadow-2xl"
        role="alert"
      >
        <AlertTriangle className="mb-4 size-8 text-red-400" aria-hidden="true" />
        <h1 className="text-lg font-semibold">Supabase 配置缺失</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-300">
          缺少 Supabase 环境变量，请复制 .env.local.example 为 .env.local
          并填入真实凭据后重启开发服务器
        </p>
      </section>
    </main>
  );
}

function SessionLoading() {
  return (
    <main
      className="grid min-h-dvh place-items-center bg-background text-foreground"
      data-component="editor-workspace"
      data-editor-workspace
      data-state="session-loading"
      aria-busy="true"
    >
      <div className="flex items-center gap-3 text-sm text-zinc-400" role="status">
        <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
        正在加载 Supabase 会话...
      </div>
    </main>
  );
}

function SessionError() {
  return (
    <main
      className="grid min-h-dvh place-items-center bg-background px-6 text-foreground"
      data-component="editor-workspace"
      data-editor-workspace
      data-state="session-error"
    >
      <section
        className="w-full max-w-xl rounded-md border border-red-500/30 bg-zinc-950 p-6"
        role="alert"
      >
        <AlertTriangle className="mb-4 size-8 text-red-400" aria-hidden="true" />
        <h1 className="text-lg font-semibold">Supabase 会话加载失败</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-300">
          请检查 .env.local 中的项目凭据及网络连接，然后重启开发服务器。
        </p>
      </section>
    </main>
  );
}

function layerIcon(layer: EditorLayer) {
  switch (layer.type) {
    case "image":
      return <ImageIcon className="size-3.5" aria-hidden="true" />;
    case "text":
      return <Type className="size-3.5" aria-hidden="true" />;
    case "shape":
      return <Shapes className="size-3.5" aria-hidden="true" />;
    case "group":
      return <GroupIcon className="size-3.5" aria-hidden="true" />;
  }
}

function LayersPanel() {
  const layers = useEditorStore((state) => state.layers);
  const selectedLayerIds = useEditorStore((state) => state.selectedLayerIds);
  const setSelection = useEditorStore((state) => state.setSelection);
  const updateLayer = useEditorStore((state) => state.updateLayer);
  const removeLayers = useEditorStore((state) => state.removeLayers);

  return (
    <aside
      className="min-h-0 overflow-y-auto border-l border-white/10 bg-zinc-950"
      aria-label="图层面板"
      data-testid="layers-panel"
    >
      <div className="sticky top-0 z-10 flex h-10 items-center justify-between border-b border-white/10 bg-zinc-950 px-3">
        <span className="text-xs font-medium text-zinc-300">图层</span>
        <span className="font-mono text-[10px] text-zinc-600">{layers.length}</span>
      </div>
      {layers.length === 0 ? (
        <p className="px-3 py-8 text-center text-xs text-zinc-600">暂无图层</p>
      ) : (
        <div className="p-2">
          {[...layers].reverse().map((layer) => {
            const selected = selectedLayerIds.includes(layer.id);
            return (
              <div
                key={layer.id}
                className={cn(
                  "group flex h-9 items-center gap-1 rounded-md px-1",
                  selected ? "bg-cyan-400/10 text-cyan-100" : "text-zinc-400 hover:bg-white/5",
                )}
                data-layer-id={layer.id}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  title={layer.visible ? "隐藏图层" : "显示图层"}
                  aria-label={layer.visible ? `隐藏 ${layer.name}` : `显示 ${layer.name}`}
                  onClick={() => {
                    updateLayer(layer.id, { visible: !layer.visible });
                  }}
                >
                  {layer.visible ? <Eye /> : <EyeOff />}
                </Button>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs outline-none"
                  onClick={() => {
                    setSelection([layer.id]);
                  }}
                >
                  {layerIcon(layer)}
                  <span className="truncate">{layer.name}</span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  title="删除图层"
                  aria-label={`删除 ${layer.name}`}
                  onClick={() => {
                    removeLayers([layer.id]);
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}

function createTextLayer(): TextLayer {
  return {
    id: crypto.randomUUID(),
    type: "text",
    name: "新文字",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    x: 1470,
    y: 970,
    width: 900,
    height: 220,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    text: "双击编辑文字",
    fontFamily: "Arial",
    fontSize: 96,
    fontStyle: "bold",
    align: "center",
    color: "#fafafa",
    lineHeight: 1.2,
  };
}

export function EditorWorkspace({ project }: EditorWorkspaceProps) {
  const [fps, setFps] = useState(60);
  const [sessionState, setSessionState] = useState<SessionState>("loading");
  const [layersPanelOpen, setLayersPanelOpen] = useState(true);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const assetId = useGenerationStore((state) => state.result?.asset_id);
  const addLayer = useEditorStore((state) => state.addLayer);
  const resetEditor = useEditorStore((state) => state.resetEditor);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const canUndo = useEditorStore((state) => state.canUndo);
  const canRedo = useEditorStore((state) => state.canRedo);
  const configured = isSupabaseConfigured();

  useEffect(() => {
    resetEditor({ layers: project.layers, selectedLayerIds: [] });
  }, [project.id, project.layers, resetEditor]);

  useEffect(() => {
    if (!configured) {
      return;
    }

    let active = true;
    const supabase = createSupabaseClient();
    void supabase.auth
      .getSession()
      .then(({ error }) => {
        if (active) {
          setSessionState(error ? "error" : "ready");
        }
      })
      .catch(() => {
        if (active) {
          setSessionState("error");
        }
      });

    return () => {
      active = false;
    };
  }, [configured]);

  async function handleImageImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) {
      return;
    }

    setImporting(true);
    try {
      const result = await uploadProjectImage({
        file,
        projectId: project.id,
        documentWidth: DOCUMENT_WIDTH,
        documentHeight: DOCUMENT_HEIGHT,
      });
      addLayer(result.layer);
      toast.success("图片已添加到画布");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "图片导入失败。 ");
    } finally {
      setImporting(false);
    }
  }

  if (!configured) {
    return <ConfigurationError />;
  }
  if (sessionState === "loading") {
    return <SessionLoading />;
  }
  if (sessionState === "error") {
    return <SessionError />;
  }

  return (
    <main
      className="grid h-dvh min-h-0 grid-rows-[48px_40px_1fr] overflow-hidden bg-background text-foreground"
      data-component="editor-workspace"
      data-editor-workspace
      data-state="ready"
    >
      <header className="flex min-w-0 items-center justify-between border-b border-white/10 bg-zinc-950 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="shrink-0 text-sm font-semibold">StatueForge AI</h1>
          <span className="h-4 w-px bg-white/10" aria-hidden="true" />
          <p className="truncate text-xs text-zinc-400" data-project-title>
            {project.name}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 font-mono text-[11px] text-zinc-500">
          <span className="hidden sm:inline">
            {DOCUMENT_WIDTH} x {DOCUMENT_HEIGHT}
          </span>
          <span className={fps < 30 ? "text-red-400" : "text-emerald-400"}>
            {fps} FPS
          </span>
          <ExportDialog
            assetId={assetId ?? project.id}
            has3dData={false}
            disabled={false}
          />
        </div>
      </header>

      <div className="flex min-w-0 items-center gap-1 border-b border-white/10 bg-zinc-950 px-2" role="toolbar" aria-label="编辑器工具栏">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          data-testid="image-file-input"
          onChange={(event) => {
            void handleImageImport(event);
          }}
        />
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={importing}
          onClick={() => {
            fileInputRef.current?.click();
          }}
        >
          {importing ? <LoaderCircle className="animate-spin" /> : <Upload />}
          {importing ? "上传中" : "导入图片"}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          onClick={() => {
            addLayer(createTextLayer());
          }}
        >
          <Type />
          添加文字
        </Button>
        <span className="mx-1 h-4 w-px bg-white/10" aria-hidden="true" />
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          disabled={!canUndo}
          title="撤销"
          aria-label="撤销"
          onClick={undo}
        >
          <Undo2 />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          disabled={!canRedo}
          title="重做"
          aria-label="重做"
          onClick={redo}
        >
          <Redo2 />
        </Button>
        <div className="ml-auto">
          <Button
            type="button"
            size="xs"
            variant="ghost"
            aria-pressed={layersPanelOpen}
            onClick={() => {
              setLayersPanelOpen((open) => !open);
            }}
          >
            {layersPanelOpen ? <PanelRightClose /> : <PanelRightOpen />}
            <Layers3 />
            图层面板
          </Button>
        </div>
      </div>

      <section
        className={cn(
          "grid min-h-0",
          layersPanelOpen ? "grid-cols-[minmax(0,1fr)_240px]" : "grid-cols-1",
        )}
        aria-label="画布编辑器"
      >
        <div className="min-h-0 min-w-0">
          <CanvasCore
            documentWidth={DOCUMENT_WIDTH}
            documentHeight={DOCUMENT_HEIGHT}
            onFpsChange={setFps}
          />
        </div>
        {layersPanelOpen ? <LayersPanel /> : null}
      </section>
    </main>
  );
}
