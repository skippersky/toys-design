"use client";

import { useState } from "react";

import { CanvasCore } from "@/components/editor/canvas-core";
import { ExportDialog } from "@/components/editor/export-dialog";
import { useGenerationStore } from "@/store/generation-store";

const DOCUMENT_WIDTH = 3840;
const DOCUMENT_HEIGHT = 2160;

export function EditorWorkspace() {
  const [fps, setFps] = useState(60);
  const assetId = useGenerationStore((state) => state.result?.asset_id);

  return (
    <main className="grid h-dvh min-h-0 grid-rows-[48px_1fr] overflow-hidden bg-background text-foreground">
      <header className="flex min-w-0 items-center justify-between border-b border-white/10 bg-zinc-950 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="shrink-0 text-sm font-semibold">StatueForge AI</h1>
          <span className="h-4 w-px bg-white/10" aria-hidden="true" />
          <p className="truncate text-xs text-zinc-400">Untitled project</p>
        </div>
        <div className="flex shrink-0 items-center gap-3 font-mono text-[11px] text-zinc-500">
          <span className="hidden sm:inline">
            {DOCUMENT_WIDTH} x {DOCUMENT_HEIGHT}
          </span>
          <span className={fps < 30 ? "text-red-400" : "text-emerald-400"}>
            {fps} FPS
          </span>
          <ExportDialog
            assetId={assetId ?? ""}
            has3dData={false}
            disabled={!assetId}
          />
        </div>
      </header>
      <section className="min-h-0" aria-label="Canvas editor">
        <CanvasCore
          documentWidth={DOCUMENT_WIDTH}
          documentHeight={DOCUMENT_HEIGHT}
          onFpsChange={setFps}
        />
      </section>
    </main>
  );
}
