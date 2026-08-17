"use client";

import {
  AlertTriangle,
  BringToFront,
  Copy,
  Eye,
  EyeOff,
  Group as GroupIcon,
  ImageIcon,
  Layers3,
  Lock,
  LoaderCircle,
  PanelRightClose,
  PanelRightOpen,
  Redo2,
  SendToBack,
  Shapes,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  Unlock,
  Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";

import { CanvasCore } from "@/components/editor/canvas-core";
import { AiGenerationDialog } from "@/components/editor/ai-generation-dialog";
import { ExportDialog } from "@/components/editor/export-dialog";
import { SupabaseConfigurationError } from "@/components/supabase-configuration-error";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  EDITOR_DOCUMENT_HEIGHT,
  EDITOR_DOCUMENT_WIDTH,
} from "@/lib/editor-document";
import {
  prepareEditorProject,
  saveEditorDocument,
} from "@/lib/editor-project-client";
import { uploadProjectImage } from "@/lib/project-image-upload";
import {
  AnonymousSessionRequestError,
  ensureAnonymousSessionThroughServer,
} from "@/lib/supabase/anonymous-session-client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { cn } from "@/lib/utils";
import {
  type EditorLayer,
  type TextLayer,
  useEditorStore,
} from "@/store/editor-store";
import type { EditorProject } from "@/types/project";

const DOCUMENT_WIDTH = EDITOR_DOCUMENT_WIDTH;
const DOCUMENT_HEIGHT = EDITOR_DOCUMENT_HEIGHT;

type SessionState = "loading" | "ready" | "error";

interface EditorWorkspaceProps {
  project: EditorProject;
}

function SessionLoading({ message }: { message: string }) {
  return (
    <main
      className="grid min-h-dvh place-items-center bg-background text-foreground"
      data-component="editor-workspace"
      data-editor-workspace
      data-state="session-loading"
      aria-busy="true"
    >
      <div
        className="flex items-center gap-3 text-sm text-zinc-400"
        role="status"
      >
        <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
        {message}
      </div>
    </main>
  );
}

function SessionError({
  message,
  onRetry,
}: {
  message?: string;
  onRetry: () => void;
}) {
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
        <AlertTriangle
          className="mb-4 size-8 text-red-400"
          aria-hidden="true"
        />
        <h1 className="text-lg font-semibold">Supabase 会话加载失败</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-300">
          {message ??
            "请检查 .env.local 中的项目凭据及网络连接，然后重启开发服务器。"}
        </p>
        <Button className="mt-5" onClick={onRetry}>
          重试
        </Button>
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
        <span className="font-mono text-[10px] text-zinc-600">
          {layers.length}
        </span>
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
                  selected
                    ? "bg-cyan-400/10 text-cyan-100"
                    : "text-zinc-400 hover:bg-white/5",
                )}
                data-layer-id={layer.id}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  title={layer.visible ? "隐藏图层" : "显示图层"}
                  aria-label={
                    layer.visible ? `隐藏 ${layer.name}` : `显示 ${layer.name}`
                  }
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
  const router = useRouter();
  const [fps, setFps] = useState(60);
  const [sessionState, setSessionState] = useState<SessionState>("loading");
  const [sessionMessage, setSessionMessage] = useState(
    "正在建立 Supabase 会话...",
  );
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [sessionError, setSessionError] = useState<string>();
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState(project);
  const [editorAssetId, setEditorAssetId] = useState<string | null>(null);
  const [layersPanelOpen, setLayersPanelOpen] = useState(true);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const layers = useEditorStore((state) => state.layers);
  const selectedLayerIds = useEditorStore((state) => state.selectedLayerIds);
  const addLayer = useEditorStore((state) => state.addLayer);
  const duplicateLayers = useEditorStore((state) => state.duplicateLayers);
  const removeLayers = useEditorStore((state) => state.removeLayers);
  const reorderLayers = useEditorStore((state) => state.reorderLayers);
  const updateLayer = useEditorStore((state) => state.updateLayer);
  const resetEditor = useEditorStore((state) => state.resetEditor);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const canUndo = useEditorStore((state) => state.canUndo);
  const canRedo = useEditorStore((state) => state.canRedo);
  const configured = isSupabaseConfigured();

  useEffect(() => {
    if (!configured) {
      return;
    }

    const lifecycle = new AbortController();
    void ensureAnonymousSessionThroughServer()
      .then(async ({ userId }) => {
        if (lifecycle.signal.aborted) {
          return;
        }
        setSessionMessage("正在加载项目数据...");
        const prepared = await prepareEditorProject(project.id);
        lifecycle.signal.throwIfAborted();
        setAuthUserId(userId);
        setAuthError(null);
        if (prepared.project.id !== project.id) {
          router.replace(`/editor/${prepared.project.id}`);
          return;
        }
        setActiveProject(prepared.project);
        setEditorAssetId(prepared.assetId);
        resetEditor({ layers: prepared.project.layers, selectedLayerIds: [] });
        setSessionState("ready");
      })
      .catch((caught: unknown) => {
        if (lifecycle.signal.aborted) {
          return;
        }
        if (caught instanceof AnonymousSessionRequestError) {
          setAuthError(caught.message);
          setSessionError(caught.message);
          setSessionState("error");
          return;
        }
        setSessionError(
          caught instanceof Error ? caught.message : "项目初始化失败。",
        );
        setSessionState("error");
      });

    return () => {
      lifecycle.abort();
    };
  }, [configured, project.id, resetEditor, router, sessionAttempt]);

  function retrySessionInitialization(): void {
    setSessionState("loading");
    setSessionMessage("正在建立 Supabase 会话...");
    setSessionError(undefined);
    setAuthError(null);
    setSessionAttempt((attempt) => attempt + 1);
  }

  useEffect(() => {
    if (!editorAssetId) {
      return;
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useEditorStore.subscribe((state, previousState) => {
      if (state.layers === previousState.layers) {
        return;
      }
      if (timeout) {
        clearTimeout(timeout);
      }
      timeout = setTimeout(() => {
        void saveEditorDocument({
          projectId: activeProject.id,
          assetId: editorAssetId,
          layers: state.layers,
        }).catch((caught: unknown) => {
          toast.error(
            caught instanceof Error ? caught.message : "项目自动保存失败。",
          );
        });
      }, 500);
    });
    return () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      unsubscribe();
    };
  }, [activeProject.id, editorAssetId]);

  async function handleImageImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) {
      return;
    }

    setImporting(true);
    try {
      if (!editorAssetId) {
        throw new Error("项目资产仍在准备中，请稍后重试。");
      }
      const result = await uploadProjectImage({
        file,
        projectId: activeProject.id,
        assetId: editorAssetId,
        existingLayers: layers,
        documentWidth: DOCUMENT_WIDTH,
        documentHeight: DOCUMENT_HEIGHT,
      });
      addLayer(result.layer);
      setAuthUserId(result.userId);
      setAuthError(null);
      toast.success("图片已添加到画布");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "图片导入失败。 ");
    } finally {
      setImporting(false);
    }
  }

  if (!configured) {
    return <SupabaseConfigurationError componentName="editor-workspace" />;
  }
  if (sessionState === "loading") {
    return <SessionLoading message={sessionMessage} />;
  }
  if (sessionState === "error") {
    return (
      <SessionError
        message={sessionError}
        onRetry={retrySessionInitialization}
      />
    );
  }

  const selectedLayers = layers.filter((layer) =>
    selectedLayerIds.includes(layer.id),
  );
  const allSelectedLocked =
    selectedLayers.length > 0 && selectedLayers.every((layer) => layer.locked);
  const moveSelection = (position: "front" | "back"): void => {
    const selected = new Set(selectedLayerIds);
    const selectedIds = layers
      .filter((layer) => selected.has(layer.id))
      .map((layer) => layer.id);
    const otherIds = layers
      .filter((layer) => !selected.has(layer.id))
      .map((layer) => layer.id);
    reorderLayers(
      position === "front"
        ? [...otherIds, ...selectedIds]
        : [...selectedIds, ...otherIds],
    );
  };
  const selectedImage = selectedLayers.find((layer) => layer.type === "image");
  const showAiGeneration = (): void => {
    setAiDialogOpen(true);
  };

  return (
    <main
      className="grid h-dvh min-h-0 grid-rows-[48px_40px_1fr] overflow-hidden bg-background text-foreground"
      data-component="editor-workspace"
      data-editor-workspace
      data-state="ready"
      data-auth-status={authError ? "unavailable" : "ready"}
      data-auth-user-id={authUserId ?? undefined}
    >
      <AiGenerationDialog
        open={aiDialogOpen}
        onOpenChange={setAiDialogOpen}
        projectId={activeProject.id}
        editorAssetId={editorAssetId ?? ""}
        selectedImage={selectedImage}
        onGenerated={(result) => {
          if (!layers.some((layer) => layer.id === result.layer.id)) {
            addLayer(result.layer);
          }
          setAiDialogOpen(false);
        }}
      />
      <header className="flex min-w-0 items-center justify-between border-b border-white/10 bg-zinc-950 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="shrink-0 text-sm font-semibold">StatueForge AI</h1>
          <span className="h-4 w-px bg-white/10" aria-hidden="true" />
          <p className="truncate text-xs text-zinc-400" data-project-title>
            {activeProject.name}
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
            assetId={editorAssetId ?? ""}
            has3dData={false}
            disabled={!editorAssetId || layers.length === 0}
          />
        </div>
      </header>

      <div
        className="flex min-w-0 items-center gap-1 border-b border-white/10 bg-zinc-950 px-2"
        role="toolbar"
        aria-label="编辑器工具栏"
      >
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
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={!editorAssetId}
          onClick={showAiGeneration}
        >
          <Sparkles />
          AI 生成
        </Button>
        <span className="mx-1 h-4 w-px bg-white/10" aria-hidden="true" />
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          disabled={!canUndo}
          title={canUndo ? "撤销" : "暂无可撤销操作"}
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
          title={canRedo ? "重做" : "暂无可重做操作"}
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
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="min-h-0 min-w-0">
              <CanvasCore
                documentWidth={DOCUMENT_WIDTH}
                documentHeight={DOCUMENT_HEIGHT}
                onFpsChange={setFps}
              />
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent aria-label="画布右键菜单">
            <ContextMenuItem
              disabled={selectedLayerIds.length === 0}
              onSelect={() => {
                duplicateLayers();
              }}
            >
              <Copy />
              复制图层
            </ContextMenuItem>
            <ContextMenuItem
              disabled={selectedLayerIds.length === 0}
              onSelect={() => {
                moveSelection("front");
              }}
            >
              <BringToFront />
              置于顶层
            </ContextMenuItem>
            <ContextMenuItem
              disabled={selectedLayerIds.length === 0}
              onSelect={() => {
                moveSelection("back");
              }}
            >
              <SendToBack />
              置于底层
            </ContextMenuItem>
            <ContextMenuItem
              disabled={selectedLayerIds.length === 0}
              onSelect={() => {
                selectedLayerIds.forEach((id) => {
                  updateLayer(id, { locked: !allSelectedLocked });
                });
              }}
            >
              {allSelectedLocked ? <Unlock /> : <Lock />}
              {allSelectedLocked ? "解锁图层" : "锁定图层"}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={showAiGeneration}>
              <Sparkles />
              AI 生成
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              disabled={selectedLayerIds.length === 0}
              onSelect={() => {
                removeLayers();
              }}
            >
              <Trash2 />
              删除图层
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {layersPanelOpen ? <LayersPanel /> : null}
      </section>
    </main>
  );
}
