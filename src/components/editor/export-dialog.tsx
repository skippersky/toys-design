"use client";

import { Download, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { readExportSse } from "@/lib/export-sse";
import type { ExportFormat, ExportProgressStatus } from "@/types/export";

export interface ExportDialogProps {
  assetId: string;
  has3dData: boolean;
  disabled?: boolean;
}

function triggerDownload(url: string, format: ExportFormat): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `statueforge-export.${format}`;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

export function ExportDialog({
  assetId,
  has3dData,
  disabled = false,
}: ExportDialogProps) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("psd");
  const [include3d, setInclude3d] = useState(false);
  const [status, setStatus] = useState<ExportProgressStatus>();
  const [error, setError] = useState<string>();
  const abortRef = useRef<AbortController | null>(null);
  const loading = status !== undefined;

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  async function startExport(): Promise<void> {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("processing");
    setError(undefined);

    try {
      const response = await fetch("/api/export/package", {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          assetId,
          format,
          include3d: format === "zip" && include3d,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message =
          typeof body === "object" &&
          body !== null &&
          "message" in body &&
          typeof body.message === "string"
            ? body.message
            : "Export request failed.";
        throw new Error(message);
      }

      const streamState: { error?: string; completed: boolean } = {
        completed: false,
      };
      await readExportSse(response, (event) => {
        if (event.event === "progress") {
          setStatus(event.data.status);
        } else if (event.event === "complete") {
          streamState.completed = true;
          triggerDownload(event.data.downloadUrl, format);
          toast.success("Export is ready.");
        } else {
          streamState.error = event.data.message;
        }
      });
      if (streamState.error) {
        throw new Error(streamState.error);
      }
      if (!streamState.completed) {
        throw new Error("Export stream ended before completion.");
      }
      setStatus(undefined);
      setOpen(false);
    } catch (caught) {
      if (controller.signal.aborted) {
        return;
      }
      const message =
        caught instanceof Error ? caught.message : "Export failed.";
      setError(message);
      setStatus(undefined);
      toast.error(message, {
        action: {
          label: "Retry",
          onClick: () => {
            void startExport();
          },
        },
      });
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && loading) {
          abortRef.current?.abort();
          setStatus(undefined);
        }
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          <Download />
          Export
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export asset</DialogTitle>
          <DialogDescription>
            Create a layered production package from this asset.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-2">
          <RadioGroup
            value={format}
            onValueChange={(value) => {
              if (value === "psd" || value === "zip") {
                setFormat(value);
                if (value === "psd") {
                  setInclude3d(false);
                }
              }
            }}
            className="grid grid-cols-2 gap-2"
            disabled={loading}
          >
            <label className="flex h-16 cursor-pointer items-center gap-3 rounded-md border border-input px-3 text-sm has-[[data-state=checked]]:border-primary">
              <RadioGroupItem value="psd" />
              <span>
                <span className="block font-medium">PSD</span>
                <span className="text-xs text-muted-foreground">
                  Layered document
                </span>
              </span>
            </label>
            <label className="flex h-16 cursor-pointer items-center gap-3 rounded-md border border-input px-3 text-sm has-[[data-state=checked]]:border-primary">
              <RadioGroupItem value="zip" />
              <span>
                <span className="block font-medium">ZIP</span>
                <span className="text-xs text-muted-foreground">
                  PSD and preview
                </span>
              </span>
            </label>
          </RadioGroup>

          <label className="flex items-center gap-3 text-sm">
            <Checkbox
              checked={include3d}
              disabled={!has3dData || format !== "zip" || loading}
              onCheckedChange={(checked) => {
                setInclude3d(checked === true);
              }}
            />
            Include 3D Reference
          </label>

          {status ? (
            <div
              className="flex items-center gap-2 text-sm text-muted-foreground"
              role="status"
            >
              <LoaderCircle className="size-4 animate-spin" />
              <span className="capitalize">{status}</span>
            </div>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            disabled={loading || disabled}
            onClick={() => {
              void startExport();
            }}
          >
            {loading ? <LoaderCircle className="animate-spin" /> : <Download />}
            {loading ? "Exporting" : "Export"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
