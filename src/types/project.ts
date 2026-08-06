import type { EditorLayer } from "@/store/editor-store";

export interface EditorProject {
  id: string;
  name: string;
  thumbnailUrl: string;
  layers: EditorLayer[];
  createdAt: string;
  updatedAt: string;
  userId: string | null;
}
