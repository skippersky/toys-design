import type { ImageLayer } from "@/store/editor-store";
import type { EditorProject } from "@/types/project";

const SEED_DATE = "2026-08-06T00:00:00.000Z";

function imageLayer(id: string, name: string, src: string): ImageLayer {
  return {
    id,
    type: "image",
    name,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    x: 0,
    y: 0,
    width: 3840,
    height: 2160,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    src,
    originalWidth: 1200,
    originalHeight: 675,
  };
}

const CYBERPUNK_IMAGE =
  "https://placehold.co/1200x675/111827/22d3ee.png?text=Cyberpunk+Alley";
const NEON_IMAGE =
  "https://placehold.co/1200x675/18181b/f472b6.png?text=Neon+Sign";
const MARBLE_IMAGE =
  "https://placehold.co/1200x675/27272a/e4e4e7.png?text=Marble+Bust+Study";

export const SEED_PROJECTS: readonly EditorProject[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Cyberpunk Alley",
    thumbnailUrl: CYBERPUNK_IMAGE,
    layers: [
      imageLayer(
        "11111111-1111-4111-8111-111111111101",
        "Cyberpunk Alley",
        CYBERPUNK_IMAGE,
      ),
    ],
    createdAt: SEED_DATE,
    updatedAt: "2026-08-06T08:30:00.000Z",
    userId: null,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Neon Sign",
    thumbnailUrl: NEON_IMAGE,
    layers: [
      imageLayer(
        "22222222-2222-4222-8222-222222222202",
        "Neon Sign",
        NEON_IMAGE,
      ),
    ],
    createdAt: SEED_DATE,
    updatedAt: "2026-08-05T15:10:00.000Z",
    userId: null,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Marble Bust Study",
    thumbnailUrl: MARBLE_IMAGE,
    layers: [
      imageLayer(
        "33333333-3333-4333-8333-333333333303",
        "Marble Bust Study",
        MARBLE_IMAGE,
      ),
    ],
    createdAt: SEED_DATE,
    updatedAt: "2026-08-04T11:45:00.000Z",
    userId: null,
  },
];

export function getSeedProject(id: string): EditorProject | null {
  return SEED_PROJECTS.find((project) => project.id === id) ?? null;
}
