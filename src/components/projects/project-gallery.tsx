import { ArrowUpRight, Clock3, Layers3 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import type { EditorProject } from "@/types/project";

interface ProjectGalleryProps {
  projects: readonly EditorProject[];
}

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function ProjectGallery({ projects }: ProjectGalleryProps) {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-white/10 bg-zinc-950">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-5">
          <div className="flex items-center gap-3">
            <div className="grid size-8 place-items-center rounded-md bg-cyan-400 text-zinc-950">
              <Layers3 className="size-4" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold">StatueForge AI</p>
              <p className="text-xs text-zinc-500">项目工作区</p>
            </div>
          </div>
          <span className="font-mono text-xs text-zinc-500">
            {projects.length} 个项目
          </span>
        </div>
      </header>

      <section
        className="mx-auto max-w-7xl px-5 py-8"
        aria-labelledby="projects-title"
      >
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h1 id="projects-title" className="text-xl font-semibold">
              项目
            </h1>
            <p className="mt-1 text-sm text-zinc-500">选择项目进入画布编辑器</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/editor/${project.id}`}
              className="group overflow-hidden rounded-md border border-white/10 bg-zinc-950 transition-colors hover:border-cyan-400/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
              data-project-id={project.id}
            >
              <div className="relative aspect-video overflow-hidden bg-zinc-900">
                <Image
                  src={project.thumbnailUrl}
                  alt={`${project.name} 缩略图`}
                  fill
                  loading="eager"
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                />
                <div className="absolute right-3 top-3 grid size-8 place-items-center rounded-md bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100">
                  <ArrowUpRight className="size-4" aria-hidden="true" />
                </div>
              </div>
              <div className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-medium">
                    {project.name}
                  </h2>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500">
                    <Clock3 className="size-3" aria-hidden="true" />
                    更新于 {dateFormatter.format(new Date(project.updatedAt))}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-xs text-zinc-600">
                  {project.layers.length} 层
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
