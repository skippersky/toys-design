"use client";

import Konva from "konva";
import { Ellipse, Group, Image as KonvaImage, Rect, Text } from "react-konva";
import { memo, useCallback, useMemo, type ReactElement } from "react";

import { useImageResource } from "@/lib/image-resource";
import {
  getWorldLayerBounds,
  intersectsViewport,
  type ViewportBounds,
} from "@/lib/editor-geometry";
import type {
  EditorLayer,
  EditorLayerPatch,
  GroupLayer,
  ImageLayer,
  ShapeLayer,
  TextLayer,
} from "@/store/editor-store";

export interface LayerRendererProps {
  layer: EditorLayer;
  layersById: ReadonlyMap<string, EditorLayer>;
  effectsEnabled: boolean;
  editingLayerId?: string;
  exportImages?: ReadonlyMap<string, HTMLImageElement>;
  viewportBounds?: ViewportBounds;
  ancestorIds?: ReadonlySet<string>;
  registerNode: (id: string, node: Konva.Node | null) => void;
  onSelect: (id: string, additive: boolean) => void;
  onChange: (id: string, patch: EditorLayerPatch) => void;
  onStartTextEdit: (id: string) => void;
}

interface TypedLayerProps<T extends EditorLayer> extends Omit<
  LayerRendererProps,
  "layer"
> {
  layer: T;
}

function toCompositeOperation(
  blendMode: EditorLayer["blendMode"],
): GlobalCompositeOperation {
  return blendMode === "normal" ? "source-over" : blendMode;
}

function useLayerTransform(layer: EditorLayer) {
  return useMemo(
    () => ({
      x: layer.x,
      y: layer.y,
      width: layer.width,
      height: layer.height,
      scaleX: layer.scaleX,
      scaleY: layer.scaleY,
      rotation: layer.rotation,
      opacity: layer.opacity,
      visible: layer.visible,
      globalCompositeOperation: toCompositeOperation(layer.blendMode),
    }),
    [layer],
  );
}

function useLayerInteractions(
  layer: EditorLayer,
  registerNode: LayerRendererProps["registerNode"],
  onSelect: LayerRendererProps["onSelect"],
  onChange: LayerRendererProps["onChange"],
) {
  const setNode = useCallback(
    (node: Konva.Node | null) => {
      registerNode(layer.id, node);
    },
    [layer.id, registerNode],
  );
  const handleSelect = useCallback(
    (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      event.cancelBubble = true;
      const nativeEvent = event.evt;
      const additive =
        "shiftKey" in nativeEvent &&
        (nativeEvent.shiftKey || nativeEvent.ctrlKey || nativeEvent.metaKey);
      onSelect(layer.id, additive);
    },
    [layer.id, onSelect],
  );
  const handleDragEnd = useCallback(
    (event: Konva.KonvaEventObject<DragEvent>) => {
      onChange(layer.id, {
        x: event.target.x(),
        y: event.target.y(),
      });
    },
    [layer.id, onChange],
  );
  const handleTransformEnd = useCallback(
    (event: Konva.KonvaEventObject<Event>) => {
      onChange(layer.id, {
        x: event.target.x(),
        y: event.target.y(),
        scaleX: event.target.scaleX(),
        scaleY: event.target.scaleY(),
        rotation: event.target.rotation(),
      });
    },
    [layer.id, onChange],
  );

  return { setNode, handleSelect, handleDragEnd, handleTransformEnd };
}

function shadowProps(layer: EditorLayer, effectsEnabled: boolean) {
  if (!effectsEnabled || !layer.shadow) {
    return {};
  }
  return {
    shadowColor: layer.shadow.color,
    shadowBlur: layer.shadow.blur,
    shadowOffsetX: layer.shadow.offsetX,
    shadowOffsetY: layer.shadow.offsetY,
    shadowOpacity: layer.shadow.opacity,
  };
}

const ImageLayerRenderer = memo(function ImageLayerRenderer({
  layer,
  effectsEnabled,
  exportImages,
  registerNode,
  onSelect,
  onChange,
}: TypedLayerProps<ImageLayer>): ReactElement {
  const previewImage = useImageResource(layer.thumbnailSrc ?? layer.src);
  const image = exportImages?.get(layer.id) ?? previewImage;
  const transform = useLayerTransform(layer);
  const { setNode, handleSelect, handleDragEnd, handleTransformEnd } =
    useLayerInteractions(layer, registerNode, onSelect, onChange);

  return (
    <Group
      {...transform}
      {...shadowProps(layer, effectsEnabled)}
      id={layer.id}
      ref={setNode}
      draggable={!layer.locked}
      onClick={handleSelect}
      onTap={handleSelect}
      onDragEnd={handleDragEnd}
      onTransformEnd={handleTransformEnd}
    >
      <Rect width={layer.width} height={layer.height} fill="#27272a" />
      {image ? (
        <KonvaImage
          image={image}
          width={layer.width}
          height={layer.height}
          listening={false}
        />
      ) : null}
    </Group>
  );
});

const TextLayerRenderer = memo(function TextLayerRenderer({
  layer,
  effectsEnabled,
  editingLayerId,
  registerNode,
  onSelect,
  onChange,
  onStartTextEdit,
}: TypedLayerProps<TextLayer>): ReactElement {
  const transform = useLayerTransform(layer);
  const { setNode, handleSelect, handleDragEnd, handleTransformEnd } =
    useLayerInteractions(layer, registerNode, onSelect, onChange);
  const handleDoubleClick = useCallback(
    (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      event.cancelBubble = true;
      onStartTextEdit(layer.id);
    },
    [layer.id, onStartTextEdit],
  );

  return (
    <Group
      {...transform}
      {...shadowProps(layer, effectsEnabled)}
      id={layer.id}
      ref={setNode}
      draggable={!layer.locked && editingLayerId !== layer.id}
      onClick={handleSelect}
      onTap={handleSelect}
      onDblClick={handleDoubleClick}
      onDblTap={handleDoubleClick}
      onDragEnd={handleDragEnd}
      onTransformEnd={handleTransformEnd}
    >
      <Text
        text={layer.text}
        width={layer.width}
        height={layer.height}
        fontFamily={layer.fontFamily}
        fontSize={layer.fontSize}
        fontStyle={layer.fontStyle}
        align={layer.align}
        fill={layer.color}
        lineHeight={layer.lineHeight}
        visible={editingLayerId !== layer.id}
        listening={false}
      />
    </Group>
  );
});

const ShapeLayerRenderer = memo(function ShapeLayerRenderer({
  layer,
  effectsEnabled,
  registerNode,
  onSelect,
  onChange,
}: TypedLayerProps<ShapeLayer>): ReactElement {
  const transform = useLayerTransform(layer);
  const { setNode, handleSelect, handleDragEnd, handleTransformEnd } =
    useLayerInteractions(layer, registerNode, onSelect, onChange);
  const shapeProps = {
    width: layer.width,
    height: layer.height,
    fill: layer.fill,
    stroke: layer.stroke,
    strokeWidth: layer.strokeWidth,
    listening: false,
  };

  return (
    <Group
      {...transform}
      {...shadowProps(layer, effectsEnabled)}
      id={layer.id}
      ref={setNode}
      draggable={!layer.locked}
      onClick={handleSelect}
      onTap={handleSelect}
      onDragEnd={handleDragEnd}
      onTransformEnd={handleTransformEnd}
    >
      {layer.shape === "ellipse" ? (
        <Ellipse
          {...shapeProps}
          x={layer.width / 2}
          y={layer.height / 2}
          radiusX={layer.width / 2}
          radiusY={layer.height / 2}
        />
      ) : (
        <Rect {...shapeProps} cornerRadius={layer.cornerRadius} />
      )}
    </Group>
  );
});

const GroupLayerRenderer = memo(function GroupLayerRenderer({
  layer,
  layersById,
  effectsEnabled,
  viewportBounds,
  ancestorIds = new Set(),
  ...props
}: TypedLayerProps<GroupLayer>): ReactElement | null {
  const transform = useLayerTransform(layer);
  const { setNode, handleSelect, handleDragEnd, handleTransformEnd } =
    useLayerInteractions(
      layer,
      props.registerNode,
      props.onSelect,
      props.onChange,
    );
  const nextAncestors = useMemo(
    () => new Set(ancestorIds).add(layer.id),
    [ancestorIds, layer.id],
  );

  if (ancestorIds.has(layer.id)) {
    return null;
  }

  return (
    <Group
      {...transform}
      {...shadowProps(layer, effectsEnabled)}
      id={layer.id}
      ref={setNode}
      draggable={!layer.locked}
      onClick={handleSelect}
      onTap={handleSelect}
      onDragEnd={handleDragEnd}
      onTransformEnd={handleTransformEnd}
    >
      {layer.childIds.map((childId) => {
        const child = layersById.get(childId);
        const isVisible =
          child?.visible &&
          (!viewportBounds ||
            intersectsViewport(
              getWorldLayerBounds(child, layersById),
              viewportBounds,
            ));
        return child && isVisible ? (
          <LayerRenderer
            key={child.id}
            {...props}
            layer={child}
            layersById={layersById}
            effectsEnabled={effectsEnabled}
            viewportBounds={viewportBounds}
            ancestorIds={nextAncestors}
          />
        ) : null;
      })}
    </Group>
  );
});

export const LayerRenderer = memo(function LayerRenderer(
  props: LayerRendererProps,
): ReactElement | null {
  if (!props.layer.visible) {
    return null;
  }

  switch (props.layer.type) {
    case "image":
      return <ImageLayerRenderer {...props} layer={props.layer} />;
    case "text":
      return <TextLayerRenderer {...props} layer={props.layer} />;
    case "shape":
      return <ShapeLayerRenderer {...props} layer={props.layer} />;
    case "group":
      return <GroupLayerRenderer {...props} layer={props.layer} />;
  }
});
