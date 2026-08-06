import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Worker } from "node:worker_threads";
import { readPsd } from "ag-psd";
import { afterEach, describe, expect, it } from "vitest";

import type { GroupLayer, ShapeLayer, TextLayer } from "@/store/editor-store";
import type { ExportRequest, ExportWorkerMessage } from "@/types/export";
import { removeExportTemporaryDirectory } from "@/lib/export-temp";
import { generateExportArtifact } from "@/workers/export-worker";

const shapeLayer: ShapeLayer = {
  id: "shape",
  type: "shape",
  name: "Base Shape",
  visible: true,
  locked: false,
  opacity: 0.5,
  blendMode: "multiply",
  x: 10,
  y: 20,
  width: 180,
  height: 120,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  shape: "rectangle",
  fill: "#cc3300",
  stroke: "#ffffff",
  strokeWidth: 2,
  cornerRadius: 8,
};

const textLayer: TextLayer = {
  id: "text",
  type: "text",
  name: "Editable Title",
  parentId: "group",
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: "screen",
  x: 20,
  y: 30,
  width: 220,
  height: 80,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  text: "StatueForge",
  fontFamily: "Arial",
  fontSize: 32,
  fontStyle: "bold",
  align: "center",
  color: "#ffffff",
  lineHeight: 1.2,
};

const groupLayer: GroupLayer = {
  id: "group",
  type: "group",
  name: "Text Group",
  visible: true,
  locked: false,
  opacity: 0.8,
  blendMode: "overlay",
  x: 100,
  y: 40,
  width: 220,
  height: 80,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  childIds: ["text"],
};

const temporaryDirectories: string[] = [];

function request(format: "psd" | "zip"): ExportRequest {
  return {
    taskId: `test-${format}`,
    userId: "user-123",
    format,
    include3d: format === "zip",
    layers: [shapeLayer, groupLayer, textLayer],
    images: [],
    documentWidth: 400,
    documentHeight: 300,
    modelRef: format === "zip" ? { assetId: "model-1" } : undefined,
    timestamp: "2026-08-04T12:00:00.000Z",
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await removeExportTemporaryDirectory(directory);
    }),
  );
});

describe("export worker", () => {
  it("runs the compiled worker entry point in an isolated thread", async () => {
    const worker = new Worker("./worker-runtime/workers/export-worker.js");

    try {
      const message = await new Promise<
        Extract<ExportWorkerMessage, { success: true }>
      >((resolveMessage, rejectMessage) => {
        worker.once("error", rejectMessage);
        worker.on("message", (workerMessage: ExportWorkerMessage) => {
          if (!("type" in workerMessage)) {
            if (workerMessage.success) {
              resolveMessage(workerMessage);
            } else {
              rejectMessage(new Error(workerMessage.error));
            }
          }
        });
        worker.postMessage(request("psd"));
      });

      expect(message.threadId).toBeGreaterThan(0);
      expect(message.processId).toBe(process.pid);
      temporaryDirectories.push(dirname(message.artifactPath));
      expect(await readFile(message.artifactPath)).not.toHaveLength(0);
    } finally {
      await worker.terminate();
    }
  });

  it("writes Photoshop layers with hierarchy, text, opacity and blend modes", async () => {
    const artifact = await generateExportArtifact(request("psd"));
    temporaryDirectories.push(dirname(artifact.artifactPath));
    const buffer = await readFile(artifact.artifactPath);
    const psd = readPsd(buffer, {
      skipLayerImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true,
    });

    expect(psd.width).toBe(400);
    expect(psd.height).toBe(300);
    expect(psd.children?.map((layer) => layer.name)).toEqual([
      "Text Group",
      "Base Shape",
    ]);
    const group = psd.children?.[0];
    expect(group?.blendMode).toBe("overlay");
    expect(group?.opacity).toBeCloseTo(0.8, 2);
    expect(group?.children?.[0]?.name).toBe("Editable Title");
    expect(group?.children?.[0]?.text?.text).toBe("StatueForge");
    expect(group?.children?.[0]?.blendMode).toBe("screen");
    expect(psd.children?.[1]?.opacity).toBeCloseTo(0.5, 2);
    expect(psd.children?.[1]?.blendMode).toBe("multiply");
  });

  it("streams the expected sanitized package files into a ZIP", async () => {
    const zipRequest = request("zip");
    zipRequest.layers = [
      { ...shapeLayer, x: -40, y: -30 },
      groupLayer,
      textLayer,
    ];
    const artifact = await generateExportArtifact(zipRequest);
    temporaryDirectories.push(dirname(artifact.artifactPath));
    const buffer = await readFile(artifact.artifactPath);
    const binary = buffer.toString("latin1");

    expect(artifact.contentType).toBe("application/zip");
    expect(binary).toContain("master.psd");
    expect(binary).toContain("render_preview.png");
    expect(binary).toContain("model_ref.json");
  });
});
