import { ProjectGallery } from "@/components/projects/project-gallery";
import { SupabaseConfigurationError } from "@/components/supabase-configuration-error";
import { listProjects } from "@/lib/projects-server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default async function Home() {
  if (!isSupabaseConfigured()) {
    return <SupabaseConfigurationError componentName="project-gallery" />;
  }

  const projects = await listProjects();
  return <ProjectGallery projects={projects} />;
}
