import { beforeEach, describe, expect, it } from "vitest";

import {
  editorHistoryManager,
  type ShapeLayer,
  useEditorStore,
} from "@/store/editor-store";

function createShape(id: string, x: number): ShapeLayer {
  return {
    id,
    type: "shape",
    name: id,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    x,
    y: 40,
    width: 100,
    height: 100,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    shape: "rectangle",
    fill: "#ffffff",
    strokeWidth: 0,
    cornerRadius: 0,
  };
}

describe("editor store", () => {
  beforeEach(() => {
    useEditorStore.getState().resetEditor();
  });

  it("undoes and redoes a multi-selection group operation", () => {
    const store = useEditorStore.getState();
    store.addLayer(createShape("one", 20));
    store.addLayer(createShape("two", 160));
    useEditorStore.getState().setSelection(["one", "two"]);
    useEditorStore.getState().groupUngroup();

    const grouped = useEditorStore.getState();
    const group = grouped.layers.find((layer) => layer.type === "group");
    expect(group?.childIds).toEqual(["one", "two"]);
    expect(grouped.selectedLayerIds).toEqual([group?.id]);

    grouped.undo();
    expect(
      useEditorStore.getState().layers.some((layer) => layer.type === "group"),
    ).toBe(false);
    expect(useEditorStore.getState().selectedLayerIds).toEqual(["one", "two"]);

    useEditorStore.getState().redo();
    expect(
      useEditorStore.getState().layers.some((layer) => layer.type === "group"),
    ).toBe(true);
  });

  it("ungroups a selection and restores the group on undo", () => {
    const store = useEditorStore.getState();
    store.addLayer(createShape("one", 20));
    store.addLayer(createShape("two", 160));
    useEditorStore.getState().setSelection(["one", "two"]);
    useEditorStore.getState().groupUngroup();

    const group = useEditorStore
      .getState()
      .layers.find((layer) => layer.type === "group");
    expect(group).toBeDefined();

    useEditorStore.getState().groupUngroup();
    expect(
      useEditorStore.getState().layers.some((layer) => layer.type === "group"),
    ).toBe(false);
    expect(useEditorStore.getState().selectedLayerIds).toEqual(["one", "two"]);
    expect(
      useEditorStore.getState().layers.find((layer) => layer.id === "one")?.x,
    ).toBe(20);

    useEditorStore.getState().undo();
    expect(
      useEditorStore.getState().layers.some((layer) => layer.type === "group"),
    ).toBe(true);
  });

  it("coalesces repeated transform updates", () => {
    useEditorStore.getState().addLayer(createShape("one", 20));
    const depthAfterAdd = editorHistoryManager.undoDepth;

    useEditorStore.getState().updateLayer("one", { x: 30 });
    useEditorStore.getState().updateLayer("one", { x: 40 });
    useEditorStore.getState().updateLayer("one", { x: 50 });

    expect(editorHistoryManager.undoDepth).toBe(depthAfterAdd + 1);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().layers[0]?.x).toBe(20);
  });
});
