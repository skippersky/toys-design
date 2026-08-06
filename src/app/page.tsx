import { ProjectGallery } from "@/components/projects/project-gallery";
import { listProjects } from "@/lib/projects-server";

export default async function Home() {
  const projects = await listProjects();
  return <ProjectGallery projects={projects} />;
}
