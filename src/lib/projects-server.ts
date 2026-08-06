import "server-only";

import { isEditorLayer, isRecord } from "@/lib/export-utils";
import { getSeedProject, SEED_PROJECTS } from "@/lib/project-seeds";
import { getPublicSupabaseConfig } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import type { EditorProject } from "@/types/project";

interface ProjectRow {
  id: string;
  name: string;
  thumbnail_url: string | null;
  layers_json: unknown;
  created_at: string;
  updated_at: string;
  user_id: string | null;
}

const PROJECT_QUERY_TIMEOUT_MS = 2500;

function isProjectRow(value: unknown): value is ProjectRow {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.thumbnail_url === null || typeof value.thumbnail_url === "string") &&
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string" &&
    (value.user_id === null || typeof value.user_id === "string")
  );
}

function toProject(row: ProjectRow): EditorProject {
  const layers = Array.isArray(row.layers_json)
    ? row.layers_json.filter(isEditorLayer)
    : [];
  return {
    id: row.id,
    name: row.name,
    thumbnailUrl:
      row.thumbnail_url ??
      "https://placehold.co/1200x675/18181b/a1a1aa.png?text=StatueForge",
    layers,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    userId: row.user_id,
  };
}

export async function listProjects(): Promise<EditorProject[]> {
  if (!getPublicSupabaseConfig()) {
    return [...SEED_PROJECTS];
  }

  try {
    const supabase = await createClient();
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, PROJECT_QUERY_TIMEOUT_MS);
    try {
      const result = await supabase
        .from("projects")
        .select(
          "id, name, thumbnail_url, layers_json, created_at, updated_at, user_id",
        )
        .order("updated_at", { ascending: false })
        .abortSignal(controller.signal);
      if (result.error || !Array.isArray(result.data)) {
        return [...SEED_PROJECTS];
      }
      const projects = result.data.filter(isProjectRow).map(toProject);
      return projects.length > 0 ? projects : [...SEED_PROJECTS];
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return [...SEED_PROJECTS];
  }
}

export async function getProject(id: string): Promise<EditorProject | null> {
  if (getPublicSupabaseConfig()) {
    try {
      const supabase = await createClient();
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, PROJECT_QUERY_TIMEOUT_MS);
      try {
        const result = await supabase
          .from("projects")
          .select(
            "id, name, thumbnail_url, layers_json, created_at, updated_at, user_id",
          )
          .eq("id", id)
          .abortSignal(controller.signal)
          .maybeSingle();
        if (!result.error && isProjectRow(result.data)) {
          return toProject(result.data);
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      // Local seeds keep the editor usable before the migration is applied.
    }
  }
  return getSeedProject(id);
}
