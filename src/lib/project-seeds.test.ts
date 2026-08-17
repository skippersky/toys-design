import { describe, expect, it } from "vitest";

import { getSeedProject, SEED_PROJECTS } from "@/lib/project-seeds";

describe("project seeds", () => {
  it("provides navigable projects with visible image layers", () => {
    expect(SEED_PROJECTS).toHaveLength(3);
    expect(SEED_PROJECTS.map((project) => project.name)).toEqual(
      expect.arrayContaining(["Cyberpunk Alley", "Neon Sign"]),
    );
    expect(
      SEED_PROJECTS.every(
        (project) =>
          project.layers.length > 0 && project.layers[0]?.type === "image",
      ),
    ).toBe(true);
  });

  it("resolves a seed by its route identifier", () => {
    const project = SEED_PROJECTS[0];
    expect(getSeedProject(project.id)?.name).toBe(project.name);
    expect(getSeedProject("missing")).toBeNull();
  });
});
