import { NextResponse, type NextRequest } from "next/server";
import { validate as isUuid } from "uuid";

import {
  buildEditorDocumentMetadata,
  buildImportedAssetRecords,
  inferDuplicatedImageStorageKeys,
  parseEditorLayers,
  readLayerStorageKeys,
} from "@/lib/editor-document";
import { isRecord, isUserScopedPath } from "@/lib/export-utils";
import {
  isEditorProjectRow,
  ownsProject,
  prepareOwnedEditorProject,
  PROJECT_SELECT,
} from "@/lib/editor-project-server";
import { createClient } from "@/lib/supabase/server";

interface ProjectRouteProps {
  params: Promise<{ projectId: string }>;
}

function errorResponse(status: number, message: string) {
  return NextResponse.json(
    { code: "EDITOR_PROJECT_ERROR", message },
    { status },
  );
}

export async function POST(
  _request: NextRequest,
  { params }: ProjectRouteProps,
) {
  const { projectId } = await params;
  if (!isUuid(projectId)) {
    return errorResponse(400, "A valid project ID is required.");
  }
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return errorResponse(401, "Authentication is required.");
  }

  try {
    const prepared = await prepareOwnedEditorProject(projectId, user.id);
    if (!prepared) {
      return errorResponse(404, "Project was not found.");
    }
    return NextResponse.json(prepared);
  } catch (error) {
    console.error("Unable to prepare editor project", {
      projectId,
      userId: user.id,
      error,
    });
    return errorResponse(
      500,
      error instanceof Error ? error.message : "Unable to prepare project.",
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: ProjectRouteProps,
) {
  const { projectId } = await params;
  const body: unknown = await request.json().catch(() => null);
  if (
    !isUuid(projectId) ||
    !isRecord(body) ||
    typeof body.assetId !== "string" ||
    !isUuid(body.assetId)
  ) {
    return errorResponse(400, "A valid project document is required.");
  }

  let layers;
  try {
    layers = parseEditorLayers(body.layers);
  } catch (error) {
    return errorResponse(
      400,
      error instanceof Error ? error.message : "Editor layers are invalid.",
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return errorResponse(401, "Authentication is required.");
  }

  const projectResult = (await supabase
    .from("projects")
    .select(PROJECT_SELECT)
    .eq("id", projectId)
    .maybeSingle()) as unknown as {
    data: unknown;
    error: { message: string } | null;
  };
  if (
    projectResult.error ||
    !isEditorProjectRow(projectResult.data) ||
    !ownsProject(projectResult.data, user.id)
  ) {
    return errorResponse(404, "Owned project was not found.");
  }

  const assetResult = (await supabase
    .from("assets")
    .select("id, metadata")
    .eq("id", body.assetId)
    .eq("project_id", projectId)
    .maybeSingle()) as unknown as {
    data: { id: string; metadata: unknown } | null;
    error: { message: string } | null;
  };
  if (assetResult.error || !assetResult.data) {
    return errorResponse(404, "Editor asset was not found.");
  }

  const additionalStorageKeys = isRecord(body.layerStorageKeys)
    ? Object.fromEntries(
        Object.entries(body.layerStorageKeys).flatMap(([layerId, path]) =>
          typeof path === "string" ? [[layerId, path]] : [],
        ),
      )
    : {};
  if (
    Object.values(additionalStorageKeys).some(
      (path) => !isUserScopedPath(path, user.id),
    )
  ) {
    return errorResponse(403, "Image storage path is outside the user scope.");
  }

  const previousStorageKeys = readLayerStorageKeys(assetResult.data.metadata);
  const previousLayers =
    isRecord(assetResult.data.metadata) &&
    Array.isArray(assetResult.data.metadata.layers)
      ? parseEditorLayers(assetResult.data.metadata.layers)
      : [];
  const duplicatedImageStorageKeys = inferDuplicatedImageStorageKeys(
    layers,
    previousLayers,
    previousStorageKeys,
  );
  let metadata;
  try {
    metadata = buildEditorDocumentMetadata(layers, previousStorageKeys, {
      ...duplicatedImageStorageKeys,
      ...additionalStorageKeys,
    });
  } catch (error) {
    return errorResponse(
      422,
      error instanceof Error ? error.message : "Editor metadata is invalid.",
    );
  }

  let saveResult = (await supabase.rpc("save_editor_document", {
    p_project_id: projectId,
    p_asset_id: body.assetId,
    p_layers: layers,
    p_metadata: metadata,
    p_imported_assets: buildImportedAssetRecords(
      layers,
      additionalStorageKeys,
      body.assetId,
    ),
  })) as { data: string | null; error: { message: string } | null };
  if (saveResult.error?.message.includes("p_imported_assets")) {
    saveResult = (await supabase.rpc("save_editor_document", {
      p_project_id: projectId,
      p_asset_id: body.assetId,
      p_layers: layers,
      p_metadata: metadata,
    })) as { data: string | null; error: { message: string } | null };
  }
  if (saveResult.error || saveResult.data !== body.assetId) {
    return errorResponse(
      500,
      saveResult.error?.message ?? "Unable to save editor document.",
    );
  }
  return NextResponse.json({ assetId: saveResult.data, saved: true });
}
