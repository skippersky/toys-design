import { notFound } from "next/navigation";

import { EditorWorkspace } from "@/components/editor/editor-workspace";
import { getProject } from "@/lib/projects-server";

interface EditorProjectPageProps {
  params: Promise<{
    projectId: string;
  }>;
}

export default async function EditorProjectPage({
  params,
}: EditorProjectPageProps) {
  const { projectId } = await params;
  const project = await getProject(projectId);

  if (!project) {
    notFound();
  }

  return <EditorWorkspace project={project} />;
}
