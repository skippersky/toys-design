import type { EditorLayer } from "@/store/editor-store";

export type ExportFormat = "psd" | "zip";

export interface ExportPackageRequest {
  assetId: string;
  format: ExportFormat;
  include3d: boolean;
}

export interface ExportImagePayload {
  layerId: string;
  bytes: ArrayBuffer;
}

export interface ExportRequest {
  taskId: string;
  layers: EditorLayer[];
  format: ExportFormat;
  include3d: boolean;
  userId: string;
  documentWidth?: number;
  documentHeight?: number;
  images: ExportImagePayload[];
  modelRef?: unknown;
  timestamp: string;
}

export type ExportProgressStatus =
  "processing" | "rendering" | "packaging" | "uploading";

export type ExportWorkerMessage =
  | {
      taskId: string;
      type: "progress";
      status: ExportProgressStatus;
      temporaryDirectory?: string;
      threadId: number;
      processId: number;
    }
  | {
      taskId: string;
      success: true;
      artifactPath: string;
      extension: ExportFormat;
      contentType: "application/zip" | "image/vnd.adobe.photoshop";
      byteLength: number;
      threadId: number;
      processId: number;
    }
  | {
      taskId: string;
      success: false;
      error: string;
      threadId: number;
      processId: number;
    };

export interface ParsedAssetExportMetadata {
  layers: EditorLayer[];
  layerStorageKeys: Readonly<Record<string, string>>;
  documentWidth?: number;
  documentHeight?: number;
  modelRef?: unknown;
}

export type ExportSseEvent =
  | {
      event: "progress";
      data: { status: ExportProgressStatus };
    }
  | {
      event: "complete";
      data: { downloadUrl: string; expiresAt: string };
    }
  | {
      event: "error";
      data: { code: "EXPORT_FAILED"; message: string };
    };
