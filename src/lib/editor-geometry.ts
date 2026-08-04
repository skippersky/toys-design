import type { EditorLayer, GroupLayer } from "@/store/editor-store";

export interface LayerBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewportBounds extends LayerBounds {
  buffer: number;
}

export interface TransformMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY_MATRIX: TransformMatrix = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
};

export function multiplyMatrices(
  parent: TransformMatrix,
  child: TransformMatrix,
): TransformMatrix {
  return {
    a: parent.a * child.a + parent.c * child.b,
    b: parent.b * child.a + parent.d * child.b,
    c: parent.a * child.c + parent.c * child.d,
    d: parent.b * child.c + parent.d * child.d,
    e: parent.a * child.e + parent.c * child.f + parent.e,
    f: parent.b * child.e + parent.d * child.f + parent.f,
  };
}

export function createLayerMatrix(layer: EditorLayer): TransformMatrix {
  const radians = (layer.rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);

  return {
    a: cosine * layer.scaleX,
    b: sine * layer.scaleX,
    c: -sine * layer.scaleY,
    d: cosine * layer.scaleY,
    e: layer.x,
    f: layer.y,
  };
}

export function transformPoint(
  matrix: TransformMatrix,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  };
}

function boundsFromMatrix(
  matrix: TransformMatrix,
  width: number,
  height: number,
): LayerBounds {
  const points = [
    transformPoint(matrix, 0, 0),
    transformPoint(matrix, width, 0),
    transformPoint(matrix, width, height),
    transformPoint(matrix, 0, height),
  ];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);

  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };
}

export function mergeBounds(bounds: readonly LayerBounds[]): LayerBounds {
  if (bounds.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const minX = Math.min(...bounds.map((item) => item.x));
  const minY = Math.min(...bounds.map((item) => item.y));
  const maxX = Math.max(...bounds.map((item) => item.x + item.width));
  const maxY = Math.max(...bounds.map((item) => item.y + item.height));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function getGroupBounds(
  layer: GroupLayer,
  layersById: ReadonlyMap<string, EditorLayer>,
  parentMatrix: TransformMatrix,
  visited: ReadonlySet<string>,
): LayerBounds {
  const groupMatrix = multiplyMatrices(parentMatrix, createLayerMatrix(layer));
  const nextVisited = new Set(visited).add(layer.id);
  const childBounds = layer.childIds.flatMap((childId) => {
    const child = layersById.get(childId);
    if (!child || nextVisited.has(child.id) || !child.visible) {
      return [];
    }
    return [getLayerBounds(child, layersById, groupMatrix, nextVisited)];
  });

  return childBounds.length > 0
    ? mergeBounds(childBounds)
    : boundsFromMatrix(groupMatrix, layer.width, layer.height);
}

export function getLayerBounds(
  layer: EditorLayer,
  layersById: ReadonlyMap<string, EditorLayer>,
  parentMatrix: TransformMatrix = IDENTITY_MATRIX,
  visited: ReadonlySet<string> = new Set(),
): LayerBounds {
  if (layer.type === "group") {
    return getGroupBounds(layer, layersById, parentMatrix, visited);
  }

  const matrix = multiplyMatrices(parentMatrix, createLayerMatrix(layer));
  return boundsFromMatrix(matrix, layer.width, layer.height);
}

export function intersectsViewport(
  bounds: LayerBounds,
  viewport: ViewportBounds,
): boolean {
  const left = viewport.x - viewport.buffer;
  const top = viewport.y - viewport.buffer;
  const right = viewport.x + viewport.width + viewport.buffer;
  const bottom = viewport.y + viewport.height + viewport.buffer;

  return (
    bounds.x + bounds.width >= left &&
    bounds.x <= right &&
    bounds.y + bounds.height >= top &&
    bounds.y <= bottom
  );
}

export function getWorldMatrix(
  layer: EditorLayer,
  layersById: ReadonlyMap<string, EditorLayer>,
): TransformMatrix {
  const ancestors: EditorLayer[] = [];
  const visited = new Set<string>();
  let current: EditorLayer | undefined = layer;

  while (current && !visited.has(current.id)) {
    ancestors.unshift(current);
    visited.add(current.id);
    current = current.parentId ? layersById.get(current.parentId) : undefined;
  }

  return ancestors.reduce(
    (matrix, ancestor) => multiplyMatrices(matrix, createLayerMatrix(ancestor)),
    IDENTITY_MATRIX,
  );
}

export function getWorldLayerBounds(
  layer: EditorLayer,
  layersById: ReadonlyMap<string, EditorLayer>,
): LayerBounds {
  const parent = layer.parentId ? layersById.get(layer.parentId) : undefined;
  const parentMatrix = parent
    ? getWorldMatrix(parent, layersById)
    : IDENTITY_MATRIX;
  return getLayerBounds(layer, layersById, parentMatrix);
}
