import "server-only";

import {
  buildEditorDocumentMetadata,
  extensionForImageContentType,
  parseEditorLayers,
  readLayerStorageKeys,
} from "@/lib/editor-document";
import { isRecord, isUserScopedPath } from "@/lib/export-utils";
import { createClient } from "@/lib/supabase/server";
import type { EditorLayer, ImageLayer } from "@/store/editor-store";
import type { EditorProject, PreparedEditorProject } from "@/types/project";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const SIGNED_IMAGE_TTL_SECONDS = 300;

export const PROJECT_SELECT =
  "id, profile_id, user_id, source_project_id, name, style, ratio, ip_ref_url, status, thumbnail_url, layers_json, created_at, updated_at";

export interface EditorProjectRow {
  id: string;
  profile_id: string | null;
  user_id: string | null;
  source_project_id: string | null;
  name: string;
  style: string;
  ratio: string;
  ip_ref_url: string | null;
  status: string;
  thumbnail_url: string | null;
  layers_json: unknown;
  created_at: string;
  updated_at: string;
}

interface EditorAssetRow {
  id: string;
  metadata: unknown;
}

interface MaterializedLayers {
  layers: EditorLayer[];
  storageKeys: Record<string, string>;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function isEditorProjectRow(value: unknown): value is EditorProjectRow {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isNullableString(value.profile_id) &&
    isNullableString(value.user_id) &&
    isNullableString(value.source_project_id) &&
    typeof value.name === "string" &&
    typeof value.style === "string" &&
    typeof value.ratio === "string" &&
    isNullableString(value.ip_ref_url) &&
    typeof value.status === "string" &&
    isNullableString(value.thumbnail_url) &&
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string"
  );
}

export function ownsProject(row: EditorProjectRow, userId: string): boolean {
  return (row.profile_id ?? row.user_id) === userId;
}

export function toEditorProject(
  row: EditorProjectRow,
  layers = parseEditorLayers(row.layers_json),
): EditorProject {
  return {
    id: row.id,
    name: row.name,
    thumbnailUrl:
      row.thumbnail_url ??
      "https://placehold.co/1200x675/18181b/a1a1aa.png?text=StatueForge",
    layers,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    userId: row.user_id ?? row.profile_id,
    sourceProjectId: row.source_project_id,
  };
}

function safeLayerPathPart(layerId: string): string {
  return layerId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80) || "layer";
}

async function signLayer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  layer: ImageLayer,
  path: string,
): Promise<ImageLayer> {
  const signed = await supabase.storage
    .from("assets")
    .createSignedUrl(path, SIGNED_IMAGE_TTL_SECONDS);
  if (signed.error) {
    throw new Error(`Unable to sign image layer ${layer.id}.`);
  }
  return {
    ...layer,
    src: signed.data.signedUrl,
    thumbnailSrc: signed.data.signedUrl,
  };
}

async function materializeImageLayers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  layers: readonly EditorLayer[],
  userId: string,
  projectId: string,
  existingStorageKeys: Readonly<Record<string, string>> = {},
): Promise<MaterializedLayers> {
  const storageKeys = { ...existingStorageKeys };
  const uploadedPaths: string[] = [];
  try {
    const materialized = await Promise.all(
      layers.map(async (layer): Promise<EditorLayer> => {
        if (layer.type !== "image") {
          return layer;
        }

        const existingPath = storageKeys[layer.id];
        if (existingPath) {
          if (!isUserScopedPath(existingPath, userId)) {
            throw new Error("Image layer is outside the current user scope.");
          }
          return signLayer(supabase, layer, existingPath);
        }

        const sourceUrl = new URL(layer.src);
        if (sourceUrl.protocol !== "https:") {
          throw new Error("Only HTTPS image sources can initialize a project.");
        }
        const response = await fetch(sourceUrl, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Unable to copy source image for layer ${layer.id}.`);
        }
        const extension = extensionForImageContentType(
          response.headers.get("content-type") ?? "",
        );
        if (!extension) {
          throw new Error("Project source returned an unsupported image type.");
        }
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
          throw new Error("Project source image exceeds the 25MB limit.");
        }

        const storagePath = `${userId}/${projectId}/${safeLayerPathPart(layer.id)}.${extension}`;
        const upload = await supabase.storage
          .from("assets")
          .upload(storagePath, new Uint8Array(bytes), {
            contentType: response.headers.get("content-type") ?? undefined,
            cacheControl: "300",
            upsert: true,
          });
        if (upload.error) {
          throw new Error(
            `Unable to store source image for layer ${layer.id}.`,
          );
        }
        uploadedPaths.push(storagePath);
        storageKeys[layer.id] = storagePath;
        return signLayer(supabase, layer, storagePath);
      }),
    );

    return { layers: materialized, storageKeys };
  } catch (error) {
    if (uploadedPaths.length > 0) {
      await supabase.storage.from("assets").remove(uploadedPaths);
    }
    throw error;
  }
}

async function findEditorAsset(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
): Promise<EditorAssetRow | null> {
  const result = (await supabase
    .from("assets")
    .select("id, metadata")
    .eq("project_id", projectId)
    .contains("metadata", { editor_document: true })
    .limit(1)
    .maybeSingle()) as unknown as {
    data: EditorAssetRow | null;
    error: { message: string } | null;
  };
  if (result.error) {
    throw new Error(result.error.message);
  }
  return result.data;
}

async function ensureEditorAsset(
  supabase: Awaited<ReturnType<typeof createClient>>,
  project: EditorProjectRow,
  userId: string,
): Promise<PreparedEditorProject> {
  const currentAsset = await findEditorAsset(supabase, project.id);
  const existingStorageKeys = readLayerStorageKeys(currentAsset?.metadata);
  const materialized = await materializeImageLayers(
    supabase,
    parseEditorLayers(project.layers_json),
    userId,
    project.id,
    existingStorageKeys,
  );
  const metadata = buildEditorDocumentMetadata(
    materialized.layers,
    materialized.storageKeys,
  );

  let assetId = currentAsset?.id;
  if (assetId) {
    const update = await supabase
      .from("assets")
      .update({ metadata, updated_at: new Date().toISOString() })
      .eq("id", assetId)
      .eq("project_id", project.id);
    if (update.error) {
      throw new Error(update.error.message);
    }
  } else {
    let insert = (await supabase
      .from("assets")
      .insert({
        project_id: project.id,
        user_id: userId,
        type: "draft",
        oss_key: `${userId}/${project.id}/editor-document`,
        metadata,
        version: 1,
        is_final: false,
      })
      .select("id")
      .single()) as unknown as {
      data: { id: string } | null;
      error: { message: string } | null;
    };
    if (insert.error?.message.includes("user_id")) {
      insert = await supabase
        .from("assets")
        .insert({
          project_id: project.id,
          type: "draft",
          oss_key: `${userId}/${project.id}/editor-document`,
          metadata,
          version: 1,
          is_final: false,
        })
        .select("id")
        .single();
    }
    if (insert.error || !insert.data) {
      const concurrentAsset = await findEditorAsset(supabase, project.id);
      if (!concurrentAsset) {
        throw new Error(
          insert.error?.message ?? "Unable to create editor asset.",
        );
      }
      assetId = concurrentAsset.id;
    } else {
      assetId = insert.data.id;
    }
  }

  const projectUpdate = await supabase
    .from("projects")
    .update({ layers_json: materialized.layers })
    .eq("id", project.id);
  if (projectUpdate.error) {
    throw new Error(projectUpdate.error.message);
  }

  return {
    project: toEditorProject(project, materialized.layers),
    assetId,
  };
}

async function findOwnedClone(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sourceProjectId: string,
  userId: string,
): Promise<EditorProjectRow | null> {
  const result = (await supabase
    .from("projects")
    .select(PROJECT_SELECT)
    .eq("profile_id", userId)
    .eq("source_project_id", sourceProjectId)
    .limit(1)
    .maybeSingle()) as unknown as {
    data: unknown;
    error: { message: string } | null;
  };
  if (result.error) {
    throw new Error(result.error.message);
  }
  return isEditorProjectRow(result.data) ? result.data : null;
}

async function clonePublicProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  source: EditorProjectRow,
  userId: string,
): Promise<EditorProjectRow> {
  const existing = await findOwnedClone(supabase, source.id, userId);
  if (existing) {
    return existing;
  }

  const insert = (await supabase
    .from("projects")
    .insert({
      profile_id: userId,
      user_id: userId,
      source_project_id: source.id,
      name: source.name,
      style: source.style,
      ratio: source.ratio,
      ip_ref_url: source.ip_ref_url,
      status: "draft",
      thumbnail_url: source.thumbnail_url,
      layers_json: source.layers_json,
    })
    .select(PROJECT_SELECT)
    .single()) as unknown as {
    data: unknown;
    error: { message: string } | null;
  };
  if (insert.error || !isEditorProjectRow(insert.data)) {
    const concurrentClone = await findOwnedClone(supabase, source.id, userId);
    if (concurrentClone) {
      return concurrentClone;
    }
    throw new Error(insert.error?.message ?? "Unable to create owned project.");
  }
  return insert.data;
}

export async function prepareOwnedEditorProject(
  requestedProjectId: string,
  userId: string,
): Promise<PreparedEditorProject | null> {
  const supabase = await createClient();
  const sourceResult = (await supabase
    .from("projects")
    .select(PROJECT_SELECT)
    .eq("id", requestedProjectId)
    .maybeSingle()) as unknown as {
    data: unknown;
    error: { message: string } | null;
  };
  if (sourceResult.error || !isEditorProjectRow(sourceResult.data)) {
    return null;
  }

  const source = sourceResult.data;
  if (
    (source.profile_id ?? source.user_id) !== null &&
    !ownsProject(source, userId)
  ) {
    return null;
  }
  const ownedProject = ownsProject(source, userId)
    ? source
    : await clonePublicProject(supabase, source, userId);
  return ensureEditorAsset(supabase, ownedProject, userId);
}
