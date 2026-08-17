"use client";

import { type Draft } from "immer";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

import { getLayerBounds, mergeBounds } from "@/lib/editor-geometry";
import { HistoryManager, SnapshotCommand } from "@/lib/history-manager";

export type BlendMode = "normal" | "multiply" | "screen" | "overlay";

export interface LayerShadow {
  readonly color: string;
  readonly blur: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly opacity: number;
}

export interface BaseEditorLayer {
  readonly id: string;
  readonly name: string;
  readonly parentId?: string;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly opacity: number;
  readonly blendMode: BlendMode;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotation: number;
  readonly shadow?: LayerShadow;
}

export interface ImageLayer extends BaseEditorLayer {
  readonly type: "image";
  readonly src: string;
  readonly thumbnailSrc?: string;
  readonly originalWidth: number;
  readonly originalHeight: number;
}

export interface TextLayer extends BaseEditorLayer {
  readonly type: "text";
  readonly text: string;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontStyle: "normal" | "bold" | "italic" | "bold italic";
  readonly align: "left" | "center" | "right";
  readonly color: string;
  readonly lineHeight: number;
}

export interface ShapeLayer extends BaseEditorLayer {
  readonly type: "shape";
  readonly shape: "rectangle" | "ellipse";
  readonly fill: string;
  readonly stroke?: string;
  readonly strokeWidth: number;
  readonly cornerRadius: number;
}

export interface GroupLayer extends BaseEditorLayer {
  readonly type: "group";
  readonly childIds: readonly string[];
}

export type EditorLayer = ImageLayer | TextLayer | ShapeLayer | GroupLayer;

export type EditorLayerPatch = Partial<
  Omit<BaseEditorLayer, "id"> &
    Omit<ImageLayer, keyof BaseEditorLayer | "type"> &
    Omit<TextLayer, keyof BaseEditorLayer | "type"> &
    Omit<ShapeLayer, keyof BaseEditorLayer | "type"> &
    Omit<GroupLayer, keyof BaseEditorLayer | "type">
>;

export interface EditorSnapshot {
  readonly layers: readonly EditorLayer[];
  readonly selectedLayerIds: readonly string[];
}

export interface EditorStore extends EditorSnapshot {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  addLayer: (layer: EditorLayer, index?: number) => void;
  duplicateLayers: (ids?: readonly string[]) => void;
  updateLayer: (id: string, patch: EditorLayerPatch) => void;
  removeLayers: (ids?: readonly string[]) => void;
  reorderLayers: (orderedIds: readonly string[]) => void;
  groupUngroup: (ids?: readonly string[]) => void;
  setSelection: (ids: readonly string[]) => void;
  undo: () => void;
  redo: () => void;
  resetEditor: (snapshot?: EditorSnapshot) => void;
}

const EMPTY_EDITOR: EditorSnapshot = {
  layers: [],
  selectedLayerIds: [],
};

export const editorHistoryManager = new HistoryManager<EditorSnapshot>(
  EMPTY_EDITOR,
  {
    maxStates: 50,
    debounceMs: 250,
    storageKey: "statueforge-editor-history",
  },
);

let groupSequence = 0;
let duplicateSequence = 0;

function createGroupId(): string {
  groupSequence += 1;
  return `group-${Date.now().toString(36)}-${groupSequence.toString(36)}`;
}

function createDuplicateId(): string {
  duplicateSequence += 1;
  return `layer-copy-${Date.now().toString(36)}-${duplicateSequence.toString(36)}`;
}

function cloneLayer(layer: EditorLayer): Draft<EditorLayer> {
  if (layer.type === "group") {
    return { ...layer, childIds: [...layer.childIds] };
  }
  if (layer.shadow) {
    return { ...layer, shadow: { ...layer.shadow } };
  }
  return { ...layer };
}

function snapshotFromState(state: EditorSnapshot): EditorSnapshot {
  return {
    layers: state.layers,
    selectedLayerIds: state.selectedLayerIds,
  };
}

function hasTransformPatch(patch: EditorLayerPatch): boolean {
  return ["x", "y", "width", "height", "scaleX", "scaleY", "rotation"].some(
    (key) => key in patch,
  );
}

function collectLayerTree(
  id: string,
  layersById: ReadonlyMap<string, EditorLayer>,
  collected: Set<string>,
): void {
  if (collected.has(id)) {
    return;
  }
  collected.add(id);
  const layer = layersById.get(id);
  if (layer?.type === "group") {
    layer.childIds.forEach((childId) => {
      collectLayerTree(childId, layersById, collected);
    });
  }
}

function ungroupLayers(
  state: Draft<EditorStore>,
  groupIds: ReadonlySet<string>,
): void {
  const replacementIds = new Map<string, readonly string[]>();

  for (const groupId of groupIds) {
    const group = state.layers.find((layer) => layer.id === groupId);
    if (!group || group.type !== "group") {
      continue;
    }
    replacementIds.set(group.id, [...group.childIds]);

    const radians = (group.rotation * Math.PI) / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const parent = group.parentId
      ? state.layers.find((layer) => layer.id === group.parentId)
      : undefined;

    for (const childId of group.childIds) {
      const child = state.layers.find((layer) => layer.id === childId);
      if (!child) {
        continue;
      }

      const scaledX = child.x * group.scaleX;
      const scaledY = child.y * group.scaleY;
      child.x = group.x + cosine * scaledX - sine * scaledY;
      child.y = group.y + sine * scaledX + cosine * scaledY;
      child.scaleX *= group.scaleX;
      child.scaleY *= group.scaleY;
      child.rotation += group.rotation;
      child.parentId = group.parentId;
    }

    if (parent?.type === "group") {
      const groupIndex = parent.childIds.indexOf(group.id);
      if (groupIndex >= 0) {
        parent.childIds.splice(groupIndex, 1, ...group.childIds);
      }
    }
  }

  state.layers = state.layers.filter((layer) => !groupIds.has(layer.id));
  state.selectedLayerIds = state.selectedLayerIds.flatMap((id) => {
    if (!groupIds.has(id)) {
      return [id];
    }
    return [...(replacementIds.get(id) ?? [])];
  });
}

const recoveredSnapshot = editorHistoryManager.state;

export const useEditorStore = create<EditorStore>()(
  immer((set, get) => {
    const syncHistoryFlags = (): void => {
      set((state) => {
        state.canUndo = editorHistoryManager.canUndo;
        state.canRedo = editorHistoryManager.canRedo;
      });
    };

    const applySnapshot = (snapshot: EditorSnapshot): void => {
      set((state) => {
        state.layers = [...snapshot.layers].map(cloneLayer);
        state.selectedLayerIds = [...snapshot.selectedLayerIds];
        state.canUndo = editorHistoryManager.canUndo;
        state.canRedo = editorHistoryManager.canRedo;
      });
    };

    const commit = (
      label: string,
      recipe: (state: Draft<EditorStore>) => void,
      debounceKey?: string,
    ): void => {
      const before = snapshotFromState(get());
      set(recipe);
      const after = snapshotFromState(get());

      if (
        before.layers === after.layers &&
        before.selectedLayerIds === after.selectedLayerIds
      ) {
        return;
      }

      editorHistoryManager.replacePresent(before, false);
      editorHistoryManager.execute(
        new SnapshotCommand(label, before, after),
        debounceKey ? { debounceKey } : undefined,
      );
      syncHistoryFlags();
    };

    return {
      layers: recoveredSnapshot.layers,
      selectedLayerIds: recoveredSnapshot.selectedLayerIds,
      canUndo: editorHistoryManager.canUndo,
      canRedo: editorHistoryManager.canRedo,

      addLayer: (layer, index) => {
        commit("Add layer", (state) => {
          const nextLayer = cloneLayer(layer);
          const insertionIndex = Math.max(
            0,
            Math.min(index ?? state.layers.length, state.layers.length),
          );
          state.layers.splice(insertionIndex, 0, nextLayer);
          state.selectedLayerIds = [nextLayer.id];

          if (nextLayer.parentId) {
            const parent = state.layers.find(
              (candidate) => candidate.id === nextLayer.parentId,
            );
            if (
              parent?.type === "group" &&
              !parent.childIds.includes(nextLayer.id)
            ) {
              parent.childIds.push(nextLayer.id);
            }
          }
        });
      },

      duplicateLayers: (ids) => {
        const requestedIds = ids ?? get().selectedLayerIds;
        if (requestedIds.length === 0) {
          return;
        }

        commit("Duplicate layers", (state) => {
          const layersById = new Map(
            state.layers.map((layer) => [layer.id, layer as EditorLayer]),
          );
          const copiedIds = new Set<string>();
          requestedIds.forEach((id) => {
            collectLayerTree(id, layersById, copiedIds);
          });
          const idMap = new Map(
            [...copiedIds].map((id) => [id, createDuplicateId()]),
          );
          const copies: Draft<EditorLayer>[] = [];
          for (const layer of state.layers) {
            if (!copiedIds.has(layer.id)) {
              continue;
            }
            const nextId = idMap.get(layer.id);
            if (!nextId) {
              continue;
            }
            const copiedParentId = layer.parentId
              ? idMap.get(layer.parentId)
              : undefined;
            const offset = copiedParentId ? 0 : 24;
            const copy = cloneLayer(layer);
            copy.id = nextId;
            copy.name = `${layer.name} copy`;
            copy.parentId = copiedParentId;
            copy.x = layer.x + offset;
            copy.y = layer.y + offset;
            if (copy.type === "group") {
              copy.childIds = copy.childIds.flatMap((childId) => {
                const copiedChildId = idMap.get(childId);
                return copiedChildId ? [copiedChildId] : [];
              });
            }
            copies.push(copy);
          }
          state.layers.push(...copies);
          state.selectedLayerIds = requestedIds.flatMap((id) => {
            const copiedId = idMap.get(id);
            return copiedId ? [copiedId] : [];
          });
        });
      },

      updateLayer: (id, patch) => {
        const debounceKey = hasTransformPatch(patch)
          ? `transform:${id}`
          : "text" in patch
            ? `text:${id}`
            : undefined;
        commit(
          "Update layer",
          (state) => {
            const layer = state.layers.find((candidate) => candidate.id === id);
            if (layer) {
              Object.assign(layer, patch);
            }
          },
          debounceKey,
        );
      },

      removeLayers: (ids) => {
        const targetIds = ids ?? get().selectedLayerIds;
        if (targetIds.length === 0) {
          return;
        }

        commit("Delete layers", (state) => {
          const layersById = new Map(
            state.layers.map((layer) => [layer.id, layer as EditorLayer]),
          );
          const removed = new Set<string>();
          targetIds.forEach((id) => {
            collectLayerTree(id, layersById, removed);
          });

          for (const layer of state.layers) {
            if (layer.type === "group") {
              layer.childIds = layer.childIds.filter((id) => !removed.has(id));
            }
          }

          state.layers = state.layers.filter((layer) => !removed.has(layer.id));
          state.selectedLayerIds = state.selectedLayerIds.filter(
            (id) => !removed.has(id),
          );
        });
      },

      reorderLayers: (orderedIds) => {
        const uniqueIds = [...new Set(orderedIds)];
        if (uniqueIds.length === 0) {
          return;
        }

        commit("Reorder layers", (state) => {
          const positions = uniqueIds
            .map((id) => state.layers.findIndex((layer) => layer.id === id))
            .filter((position) => position >= 0);
          if (positions.length === 0) {
            return;
          }

          const insertionIndex = Math.min(...positions);
          const reordered = uniqueIds.flatMap((id) => {
            const layer = state.layers.find((candidate) => candidate.id === id);
            return layer ? [layer] : [];
          });
          state.layers = state.layers.filter(
            (layer) => !uniqueIds.includes(layer.id),
          );
          state.layers.splice(insertionIndex, 0, ...reordered);
        });
      },

      groupUngroup: (ids) => {
        const targetIds = ids ?? get().selectedLayerIds;
        if (targetIds.length === 0) {
          return;
        }

        commit("Group layers", (state) => {
          const targets = targetIds.flatMap((id) => {
            const layer = state.layers.find((candidate) => candidate.id === id);
            return layer ? [layer] : [];
          });
          if (targets.length === 0) {
            return;
          }

          if (targets.every((layer) => layer.type === "group")) {
            ungroupLayers(state, new Set(targets.map((layer) => layer.id)));
            return;
          }

          const parentIds = new Set(targets.map((layer) => layer.parentId));
          if (targets.length < 2 || parentIds.size !== 1) {
            return;
          }

          const layersById = new Map(
            state.layers.map((layer) => [layer.id, layer as EditorLayer]),
          );
          const bounds = mergeBounds(
            targets.map((layer) => getLayerBounds(layer, layersById)),
          );
          const groupId = createGroupId();
          const parentId = targets[0]?.parentId;
          const group: Draft<GroupLayer> = {
            id: groupId,
            type: "group",
            name: "Group",
            parentId,
            visible: true,
            locked: false,
            opacity: 1,
            blendMode: "normal",
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            childIds: targets.map((layer) => layer.id),
          };

          const insertionIndex = Math.min(
            ...targets.map((target) =>
              state.layers.findIndex((layer) => layer.id === target.id),
            ),
          );
          for (const target of targets) {
            target.x -= bounds.x;
            target.y -= bounds.y;
            target.parentId = groupId;
          }
          state.layers.splice(insertionIndex, 0, group);

          if (parentId) {
            const parent = state.layers.find((layer) => layer.id === parentId);
            if (parent?.type === "group") {
              const firstChildIndex = Math.min(
                ...targets.map((target) => parent.childIds.indexOf(target.id)),
              );
              parent.childIds = parent.childIds.filter(
                (childId) => !targetIds.includes(childId),
              );
              parent.childIds.splice(firstChildIndex, 0, groupId);
            }
          }

          state.selectedLayerIds = [groupId];
        });
      },

      setSelection: (ids) => {
        const existing = new Set(get().layers.map((layer) => layer.id));
        const nextSelection = [...new Set(ids)].filter((id) =>
          existing.has(id),
        );
        set((state) => {
          state.selectedLayerIds = nextSelection;
        });
        editorHistoryManager.replacePresent(snapshotFromState(get()), false);
      },

      undo: () => {
        applySnapshot(editorHistoryManager.undo());
      },

      redo: () => {
        applySnapshot(editorHistoryManager.redo());
      },

      resetEditor: (snapshot = EMPTY_EDITOR) => {
        const nextSnapshot: EditorSnapshot = {
          layers: snapshot.layers.map(cloneLayer),
          selectedLayerIds: [...snapshot.selectedLayerIds],
        };
        editorHistoryManager.reset(nextSnapshot);
        applySnapshot(nextSnapshot);
      },
    };
  }),
);
