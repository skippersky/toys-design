"use client";

import { parseEditorLayers } from "@/lib/editor-document";
import { isRecord } from "@/lib/export-utils";
import type { EditorLayer } from "@/store/editor-store";
import type { EditorProject, PreparedEditorProject } from "@/types/project";

const PROJECT_REQUEST_TIMEOUT_MS = 15_000;

function parseProject(value: unknown): EditorProject {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.thumbnailUrl !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    (value.userId !== null && typeof value.userId !== "string") ||
    (value.sourceProjectId !== null &&
      typeof value.sourceProjectId !== "string")
  ) {
    throw new Error("Project preparation returned invalid data.");
  }
  return {
    id: value.id,
    name: value.name,
    thumbnailUrl: value.thumbnailUrl,
    layers: parseEditorLayers(value.layers),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    userId: value.userId,
    sourceProjectId: value.sourceProjectId,
  };
}

async function responseError(response: Response): Promise<Error> {
  const body: unknown = await response.json().catch(() => null);
  return new Error(
    isRecord(body) && typeof body.message === "string"
      ? body.message
      : `Project request failed with HTTP ${String(response.status)}.`,
  );
}

export async function prepareEditorProject(
  projectId: string,
): Promise<PreparedEditorProject> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, PROJECT_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`/api/projects/${projectId}`, {
      method: "POST",
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("项目数据加载超时，请检查网络后重试。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw await responseError(response);
  }
  const body: unknown = await response.json();
  if (!isRecord(body) || typeof body.assetId !== "string") {
    throw new Error("Project preparation did not return an asset ID.");
  }
  return { project: parseProject(body.project), assetId: body.assetId };
}

export interface SaveEditorDocumentOptions {
  projectId: string;
  assetId: string;
  layers: readonly EditorLayer[];
  layerStorageKeys?: Readonly<Record<string, string>>;
}

export async function saveEditorDocument({
  projectId,
  assetId,
  layers,
  layerStorageKeys,
}: SaveEditorDocumentOptions): Promise<void> {
  const response = await fetch(`/api/projects/${projectId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assetId, layers, layerStorageKeys }),
  });
  if (!response.ok) {
    throw await responseError(response);
  }
}
