"use client";

import Konva from "konva";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { Layer, Stage, Transformer } from "react-konva";

import { LayerRenderer } from "@/components/editor/layers/layer-renderer";
import { useEditorShortcuts } from "@/hooks/use-editor-shortcuts";
import {
  getLayerBounds,
  getWorldMatrix,
  intersectsViewport,
} from "@/lib/editor-geometry";
import { loadImage, preloadImage } from "@/lib/image-resource";
import { cn } from "@/lib/utils";
import {
  type EditorLayer,
  type ImageLayer,
  type TextLayer,
  useEditorStore,
} from "@/store/editor-store";

const VIEWPORT_BUFFER = 200;
const MIN_SCALE = 0.05;
const MAX_SCALE = 4;

interface ViewTransform {
  x: number;
  y: number;
  scale: number;
}

interface ContainerSize {
  width: number;
  height: number;
}

interface PanSample {
  x: number;
  y: number;
  timestamp: number;
}

export interface CanvasExportOptions {
  mimeType?: string;
  quality?: number;
  pixelRatio?: number;
}

export interface CanvasCoreHandle {
  toBlob: (options?: CanvasExportOptions) => Promise<Blob>;
  fitToViewport: () => void;
}

export interface CanvasCoreProps {
  documentWidth: number;
  documentHeight: number;
  className?: string;
  onFpsChange?: (fps: number) => void;
}

function usePerformanceSafeguard(onFpsChange?: (fps: number) => void) {
  const [effectsEnabled, setEffectsEnabled] = useState(true);
  const onFpsChangeRef = useRef(onFpsChange);

  useEffect(() => {
    onFpsChangeRef.current = onFpsChange;
  }, [onFpsChange]);

  useEffect(() => {
    let animationFrame = 0;
    let frameCount = 0;
    let sampleStart = performance.now();
    let lastFrame = sampleStart;

    const measure = (timestamp: number): void => {
      if (
        document.visibilityState !== "visible" ||
        timestamp - lastFrame > 500
      ) {
        frameCount = 0;
        sampleStart = timestamp;
        lastFrame = timestamp;
        animationFrame = requestAnimationFrame(measure);
        return;
      }

      frameCount += 1;
      lastFrame = timestamp;
      const elapsed = timestamp - sampleStart;
      if (elapsed >= 1000) {
        const fps = Math.round((frameCount * 1000) / elapsed);
        onFpsChangeRef.current?.(fps);
        if (fps < 30) {
          setEffectsEnabled(false);
        }
        frameCount = 0;
        sampleStart = timestamp;
      }
      animationFrame = requestAnimationFrame(measure);
    };

    animationFrame = requestAnimationFrame(measure);
    return () => {
      cancelAnimationFrame(animationFrame);
    };
  }, []);

  return effectsEnabled;
}

interface ThumbnailSentinelProps {
  layer: ImageLayer;
  root: HTMLDivElement;
  layersById: ReadonlyMap<string, EditorLayer>;
}

function ThumbnailSentinel({
  layer,
  root,
  layersById,
}: ThumbnailSentinelProps): ReactElement {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const matrix = useMemo(
    () => getWorldMatrix(layer, layersById),
    [layer, layersById],
  );
  const setSentinel = useCallback(
    (node: HTMLSpanElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!node) {
        return;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            preloadImage(layer.thumbnailSrc ?? layer.src);
            observer.disconnect();
          }
        },
        { root, rootMargin: `${String(VIEWPORT_BUFFER)}px` },
      );
      observer.observe(node);
      observerRef.current = observer;
    },
    [layer.src, layer.thumbnailSrc, root],
  );

  return (
    <span
      ref={setSentinel}
      aria-hidden="true"
      className="pointer-events-none absolute opacity-0"
      style={{
        width: layer.width,
        height: layer.height,
        transform: `matrix(${String(matrix.a)}, ${String(matrix.b)}, ${String(matrix.c)}, ${String(matrix.d)}, ${String(matrix.e)}, ${String(matrix.f)})`,
        transformOrigin: "0 0",
      }}
    />
  );
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

export const CanvasCore = forwardRef<CanvasCoreHandle, CanvasCoreProps>(
  function CanvasCore(
    { documentWidth, documentHeight, className, onFpsChange },
    forwardedRef,
  ) {
    const layers = useEditorStore((state) => state.layers);
    const selectedLayerIds = useEditorStore((state) => state.selectedLayerIds);
    const updateLayer = useEditorStore((state) => state.updateLayer);
    const setSelection = useEditorStore((state) => state.setSelection);
    const { isSpacePressed } = useEditorShortcuts();
    const effectsEnabled = usePerformanceSafeguard(onFpsChange);

    const [container, setContainer] = useState<HTMLDivElement | null>(null);
    const [containerSize, setContainerSize] = useState<ContainerSize>({
      width: 0,
      height: 0,
    });
    const [viewport, setViewport] = useState<ViewTransform>({
      x: 0,
      y: 0,
      scale: 1,
    });
    const [isPanning, setIsPanning] = useState(false);
    const [editingLayerId, setEditingLayerId] = useState<string>();
    const [isExporting, setIsExporting] = useState(false);
    const [exportImages, setExportImages] = useState<
      ReadonlyMap<string, HTMLImageElement>
    >(new Map());

    const stageRef = useRef<Konva.Stage>(null);
    const resizeObserverRef = useRef<ResizeObserver | null>(null);
    const [registeredNodes, setRegisteredNodes] = useState<
      ReadonlyMap<string, Konva.Node>
    >(new Map());
    const panSampleRef = useRef<PanSample | undefined>(undefined);
    const velocityRef = useRef({ x: 0, y: 0 });
    const inertiaFrameRef = useRef(0);
    const hasFittedRef = useRef(false);

    const layersById = useMemo(
      () => new Map(layers.map((layer) => [layer.id, layer])),
      [layers],
    );

    const rootLayers = useMemo(
      () => layers.filter((layer) => !layer.parentId && layer.visible),
      [layers],
    );

    const fitToViewport = useCallback(() => {
      if (containerSize.width === 0 || containerSize.height === 0) {
        return;
      }
      const scale = Math.min(
        (containerSize.width - 64) / documentWidth,
        (containerSize.height - 64) / documentHeight,
        1,
      );
      setViewport({
        scale,
        x: (containerSize.width - documentWidth * scale) / 2,
        y: (containerSize.height - documentHeight * scale) / 2,
      });
      hasFittedRef.current = true;
    }, [containerSize, documentHeight, documentWidth]);

    const setContainerNode = useCallback(
      (node: HTMLDivElement | null) => {
        resizeObserverRef.current?.disconnect();
        resizeObserverRef.current = null;
        if (!node) {
          cancelAnimationFrame(inertiaFrameRef.current);
          setContainer(null);
          return;
        }

        setContainer(node);
        const updateSize = (width: number, height: number): void => {
          setContainerSize({ width, height });
          if (!hasFittedRef.current && width > 0 && height > 0) {
            const scale = Math.min(
              (width - 64) / documentWidth,
              (height - 64) / documentHeight,
              1,
            );
            setViewport({
              scale,
              x: (width - documentWidth * scale) / 2,
              y: (height - documentHeight * scale) / 2,
            });
            hasFittedRef.current = true;
          }
        };

        updateSize(node.clientWidth, node.clientHeight);
        const observer = new ResizeObserver((entries) => {
          const entry = entries[0];
          updateSize(entry.contentRect.width, entry.contentRect.height);
        });
        observer.observe(node);
        resizeObserverRef.current = observer;
      },
      [documentHeight, documentWidth],
    );

    const viewportBounds = useMemo(
      () => ({
        x: -viewport.x / viewport.scale,
        y: -viewport.y / viewport.scale,
        width: containerSize.width / viewport.scale,
        height: containerSize.height / viewport.scale,
        buffer: VIEWPORT_BUFFER,
      }),
      [containerSize, viewport],
    );

    const visibleLayers = useMemo(
      () =>
        isExporting
          ? rootLayers
          : rootLayers.filter((layer) =>
              intersectsViewport(
                getLayerBounds(layer, layersById),
                viewportBounds,
              ),
            ),
      [isExporting, layersById, rootLayers, viewportBounds],
    );

    const registerNode = useCallback(
      (id: string, node: Konva.Node | null): void => {
        setRegisteredNodes((current) => {
          if (current.get(id) === node || (!node && !current.has(id))) {
            return current;
          }
          const next = new Map(current);
          if (node) {
            next.set(id, node);
          } else {
            next.delete(id);
          }
          return next;
        });
      },
      [],
    );

    const selectedNodes = selectedLayerIds.flatMap((id) => {
      const node = registeredNodes.get(id);
      return node ? [node] : [];
    });

    const handleSelect = useCallback(
      (id: string, additive: boolean) => {
        if (!additive) {
          setSelection([id]);
          return;
        }
        const selected = useEditorStore.getState().selectedLayerIds;
        setSelection(
          selected.includes(id)
            ? selected.filter((selectedId) => selectedId !== id)
            : [...selected, id],
        );
      },
      [setSelection],
    );

    const handleStagePointerDown = useCallback(
      (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
        if (event.target === event.target.getStage()) {
          setSelection([]);
          setEditingLayerId(undefined);
        }
      },
      [setSelection],
    );

    const stopInertia = useCallback(() => {
      cancelAnimationFrame(inertiaFrameRef.current);
      inertiaFrameRef.current = 0;
    }, []);

    const handleWheel = useCallback(
      (event: ReactWheelEvent<HTMLDivElement>) => {
        event.preventDefault();
        stopInertia();
        const bounds = event.currentTarget.getBoundingClientRect();
        const pointerX = event.clientX - bounds.left;
        const pointerY = event.clientY - bounds.top;
        const zoomFactor = Math.exp(-event.deltaY * 0.0015);

        setViewport((current) => {
          const nextScale = Math.min(
            MAX_SCALE,
            Math.max(MIN_SCALE, current.scale * zoomFactor),
          );
          const worldX = (pointerX - current.x) / current.scale;
          const worldY = (pointerY - current.y) / current.scale;
          return {
            scale: nextScale,
            x: pointerX - worldX * nextScale,
            y: pointerY - worldY * nextScale,
          };
        });
      },
      [stopInertia],
    );

    const handlePointerDown = useCallback(
      (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!isSpacePressed || event.button !== 0) {
          return;
        }
        event.preventDefault();
        stopInertia();
        event.currentTarget.setPointerCapture(event.pointerId);
        setIsPanning(true);
        panSampleRef.current = {
          x: event.clientX,
          y: event.clientY,
          timestamp: performance.now(),
        };
        velocityRef.current = { x: 0, y: 0 };
      },
      [isSpacePressed, stopInertia],
    );

    const handlePointerMove = useCallback(
      (event: ReactPointerEvent<HTMLDivElement>) => {
        const previous = panSampleRef.current;
        if (!isPanning || !previous) {
          return;
        }

        const timestamp = performance.now();
        const deltaX = event.clientX - previous.x;
        const deltaY = event.clientY - previous.y;
        const frameDuration = Math.max(1, timestamp - previous.timestamp);
        velocityRef.current = {
          x: (deltaX / frameDuration) * 16.67,
          y: (deltaY / frameDuration) * 16.67,
        };
        panSampleRef.current = {
          x: event.clientX,
          y: event.clientY,
          timestamp,
        };
        setViewport((current) => ({
          ...current,
          x: current.x + deltaX,
          y: current.y + deltaY,
        }));
      },
      [isPanning],
    );

    const handlePointerUp = useCallback(
      (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!isPanning) {
          return;
        }
        event.currentTarget.releasePointerCapture(event.pointerId);
        setIsPanning(false);
        panSampleRef.current = undefined;

        const tick = (): void => {
          const velocity = velocityRef.current;
          if (Math.hypot(velocity.x, velocity.y) < 0.2) {
            inertiaFrameRef.current = 0;
            return;
          }
          setViewport((current) => ({
            ...current,
            x: current.x + velocity.x,
            y: current.y + velocity.y,
          }));
          velocityRef.current = {
            x: velocity.x * 0.92,
            y: velocity.y * 0.92,
          };
          inertiaFrameRef.current = requestAnimationFrame(tick);
        };
        inertiaFrameRef.current = requestAnimationFrame(tick);
      },
      [isPanning],
    );

    useImperativeHandle(
      forwardedRef,
      () => ({
        fitToViewport,
        toBlob: async (options = {}) => {
          const stage = stageRef.current;
          if (!stage) {
            throw new Error("Canvas is not ready for export");
          }

          const imageLayers = layers.filter(
            (layer): layer is ImageLayer => layer.type === "image",
          );
          const loadedImages = await Promise.all(
            imageLayers.map(
              async (layer) => [layer.id, await loadImage(layer.src)] as const,
            ),
          );

          setExportImages(new Map(loadedImages));
          setIsExporting(true);
          await nextAnimationFrame();
          await nextAnimationFrame();

          try {
            const result = await stage.toBlob({
              width: documentWidth,
              height: documentHeight,
              mimeType: options.mimeType ?? "image/png",
              quality: options.quality,
              pixelRatio: options.pixelRatio ?? 1,
            });
            if (!(result instanceof Blob)) {
              throw new Error("Canvas export did not produce a Blob");
            }
            return result;
          } finally {
            setIsExporting(false);
            setExportImages(new Map());
          }
        },
      }),
      [documentHeight, documentWidth, fitToViewport, layers],
    );

    const editingLayer = editingLayerId
      ? layersById.get(editingLayerId)
      : undefined;
    const editingText =
      editingLayer?.type === "text" ? editingLayer : undefined;
    const editingMatrix = editingText
      ? getWorldMatrix(editingText, layersById)
      : undefined;

    const surfaceStyle: CSSProperties = {
      width: documentWidth,
      height: documentHeight,
      transform: `translate3d(${String(viewport.x)}px, ${String(viewport.y)}px, 0) scale(${String(viewport.scale)})`,
      transformOrigin: "0 0",
      backgroundColor: "#18181b",
      backgroundImage:
        "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
      backgroundSize: "32px 32px",
      willChange: isPanning ? "transform" : undefined,
    };

    return (
      <div
        ref={setContainerNode}
        className={cn(
          "relative h-full w-full touch-none overflow-hidden bg-zinc-950 select-none",
          className,
        )}
        style={{
          cursor: isPanning ? "grabbing" : isSpacePressed ? "grab" : "default",
        }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div className="absolute left-0 top-0 shadow-2xl" style={surfaceStyle}>
          <Stage
            ref={stageRef}
            width={documentWidth}
            height={documentHeight}
            onMouseDown={handleStagePointerDown}
            onTouchStart={handleStagePointerDown}
          >
            <Layer imageSmoothingEnabled={!isPanning}>
              {visibleLayers.map((layer) => (
                <LayerRenderer
                  key={layer.id}
                  layer={layer}
                  layersById={layersById}
                  effectsEnabled={effectsEnabled}
                  editingLayerId={editingLayerId}
                  exportImages={isExporting ? exportImages : undefined}
                  viewportBounds={isExporting ? undefined : viewportBounds}
                  registerNode={registerNode}
                  onSelect={handleSelect}
                  onChange={updateLayer}
                  onStartTextEdit={setEditingLayerId}
                />
              ))}
              {selectedNodes.length > 0 && !isExporting ? (
                <Transformer
                  nodes={selectedNodes}
                  borderStroke="#f59e0b"
                  anchorFill="#18181b"
                  anchorStroke="#f59e0b"
                  anchorSize={10 / viewport.scale}
                  borderStrokeWidth={1.5 / viewport.scale}
                  rotateAnchorOffset={28 / viewport.scale}
                  flipEnabled={false}
                  boundBoxFunc={(oldBox, newBox) =>
                    Math.abs(newBox.width) < 8 || Math.abs(newBox.height) < 8
                      ? oldBox
                      : newBox
                  }
                />
              ) : null}
            </Layer>
          </Stage>

          {container
            ? layers
                .filter((layer): layer is ImageLayer => layer.type === "image")
                .map((layer) => (
                  <ThumbnailSentinel
                    key={layer.id}
                    layer={layer}
                    root={container}
                    layersById={layersById}
                  />
                ))
            : null}

          {editingText && editingMatrix ? (
            <TextEditorOverlay
              layer={editingText}
              matrix={editingMatrix}
              onChange={(text) => {
                updateLayer(editingText.id, { text });
              }}
              onClose={() => {
                setEditingLayerId(undefined);
              }}
            />
          ) : null}
        </div>
      </div>
    );
  },
);

CanvasCore.displayName = "CanvasCore";

interface TextEditorOverlayProps {
  layer: TextLayer;
  matrix: ReturnType<typeof getWorldMatrix>;
  onChange: (text: string) => void;
  onClose: () => void;
}

function TextEditorOverlay({
  layer,
  matrix,
  onChange,
  onClose,
}: TextEditorOverlayProps): ReactElement {
  return (
    <div
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label={`Edit ${layer.name}`}
      tabIndex={0}
      className="absolute overflow-hidden border border-amber-400 bg-transparent p-0 outline-none"
      style={{
        width: layer.width,
        height: layer.height,
        color: layer.color,
        fontFamily: layer.fontFamily,
        fontSize: layer.fontSize,
        fontStyle: layer.fontStyle.includes("italic") ? "italic" : "normal",
        fontWeight: layer.fontStyle.includes("bold") ? 700 : 400,
        lineHeight: layer.lineHeight,
        textAlign: layer.align,
        whiteSpace: "pre-wrap",
        transform: `matrix(${String(matrix.a)}, ${String(matrix.b)}, ${String(matrix.c)}, ${String(matrix.d)}, ${String(matrix.e)}, ${String(matrix.f)})`,
        transformOrigin: "0 0",
        pointerEvents: "auto",
      }}
      onInput={(event) => {
        onChange(event.currentTarget.textContent);
      }}
      onBlur={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    >
      {layer.text}
    </div>
  );
}
