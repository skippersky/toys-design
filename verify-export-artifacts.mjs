import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";

import { readPsd } from "ag-psd";

import { generateExportArtifact } from "./worker-runtime/workers/export-worker.js";

/** @typedef {import("./src/store/editor-store").ShapeLayer} ShapeLayer */
/** @typedef {import("./src/types/export").ExportRequest} ExportRequest */
/** @typedef {import("./src/types/export").ExportWorkerMessage} ExportWorkerMessage */
/** @typedef {Extract<ExportWorkerMessage, { success: true }>} ExportWorkerSuccess */

const evidenceDirectory = resolve("docs/qa-evidence");
const workerUrl = new URL(
  "./worker-runtime/workers/export-worker.js",
  import.meta.url,
);

/** @returns {ShapeLayer[]} */
function buildLayers() {
  const blendModes = /** @type {const} */ ([
    "normal",
    "multiply",
    "screen",
    "overlay",
  ]);
  return Array.from({ length: 20 }, (_, index) => {
    const column = index % 5;
    const row = Math.floor(index / 5);
    return {
      id: `qa-layer-${String(index + 1)}`,
      type: "shape",
      name: `QA Layer ${String(index + 1).padStart(2, "0")}`,
      visible: index !== 19,
      locked: false,
      opacity: 1 - (index % 4) * 0.1,
      blendMode: blendModes[index % blendModes.length] ?? "normal",
      x: 80 + column * 720,
      y: 80 + row * 500,
      width: 640,
      height: 420,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      shape: index % 2 === 0 ? "rectangle" : "ellipse",
      fill: `hsl(${String((index * 37) % 360)} 70% 45%)`,
      stroke: "#ffffff",
      strokeWidth: 2,
      cornerRadius: 12,
    };
  });
}

/**
 * @param {string} taskId
 * @param {"psd" | "zip"} format
 * @returns {ExportRequest}
 */
function buildRequest(taskId, format) {
  return {
    taskId,
    userId: "qa-user-step4",
    format,
    include3d: format === "zip",
    layers: buildLayers(),
    images: [],
    documentWidth: 3840,
    documentHeight: 2160,
    modelRef: format === "zip" ? { assetId: "qa-model" } : undefined,
    timestamp: "2026-08-07T12:00:00.000Z",
  };
}

/**
 * @param {string} artifactPath
 * @returns {Promise<void>}
 */
async function removeArtifactDirectory(artifactPath) {
  await rm(dirname(artifactPath), { recursive: true, force: true });
}

/**
 * @param {string} taskId
 * @returns {Promise<{ message: ExportWorkerSuccess; worker: Worker }>}
 */
async function runWorker(taskId) {
  const worker = new Worker(workerUrl);
  return new Promise((resolvePromise, rejectPromise) => {
    worker.once("error", rejectPromise);
    worker.on(
      "message",
      /** @param {ExportWorkerMessage} message */ (message) => {
        if (!("type" in message)) {
          if (message.success) {
            resolvePromise({ message, worker });
          } else {
            rejectPromise(new Error(message.error));
          }
        }
      },
    );
    worker.postMessage(buildRequest(taskId, "psd"));
  });
}

/** @returns {Promise<number>} */
async function verifyDisconnectCleanup() {
  const worker = new Worker(workerUrl);
  const startedAt = performance.now();
  return new Promise((resolvePromise, rejectPromise) => {
    worker.once("error", rejectPromise);
    worker.on(
      "message",
      /** @param {ExportWorkerMessage} message */ (message) => {
        if (
          "type" in message &&
          message.status === "rendering" &&
          message.temporaryDirectory
        ) {
          const temporaryDirectory = message.temporaryDirectory;
          void worker
            .terminate()
            .then(async () => {
              await rm(temporaryDirectory, { recursive: true, force: true });
              resolvePromise(Math.round(performance.now() - startedAt));
            })
            .catch(rejectPromise);
        }
      },
    );
    worker.postMessage(buildRequest("qa-disconnect", "psd"));
  });
}

await mkdir(evidenceDirectory, { recursive: true });

const psdStartedAt = performance.now();
const psdArtifact = await generateExportArtifact(
  buildRequest("qa-step4-sample", "psd"),
);
const psdElapsedMs = Math.round(performance.now() - psdStartedAt);
const psdEvidencePath = resolve(evidenceDirectory, "step4-export-sample.psd");
await copyFile(psdArtifact.artifactPath, psdEvidencePath);
const psdBytes = await readFile(psdArtifact.artifactPath);
const parsedPsd = readPsd(psdBytes, {
  skipLayerImageData: true,
  skipCompositeImageData: true,
  skipThumbnail: true,
});
await removeArtifactDirectory(psdArtifact.artifactPath);

const zipArtifact = await generateExportArtifact(
  buildRequest("qa-step4-sample", "zip"),
);
const zipEvidencePath = resolve(evidenceDirectory, "step4-export-sample.zip");
await copyFile(zipArtifact.artifactPath, zipEvidencePath);
const zipText = (await readFile(zipArtifact.artifactPath)).toString("latin1");
await removeArtifactDirectory(zipArtifact.artifactPath);

const concurrentStartedAt = performance.now();
const concurrentRuns = await Promise.all([
  runWorker("qa-concurrent-a"),
  runWorker("qa-concurrent-b"),
]);
const concurrentElapsedMs = Math.round(performance.now() - concurrentStartedAt);
for (const run of concurrentRuns) {
  await run.worker.terminate();
  await removeArtifactDirectory(run.message.artifactPath);
}

const disconnectElapsedMs = await verifyDisconnectCleanup();

global.gc?.();
const heapBaseline = process.memoryUsage().heapUsed;
/** @type {number[]} */
const sequentialDurations = [];
for (let index = 0; index < 5; index += 1) {
  const startedAt = performance.now();
  const artifact = await generateExportArtifact(
    buildRequest(`qa-memory-${String(index + 1)}`, "psd"),
  );
  sequentialDurations.push(Math.round(performance.now() - startedAt));
  await removeArtifactDirectory(artifact.artifactPath);
  global.gc?.();
}
global.gc?.();
const heapAfter = process.memoryUsage().heapUsed;

console.log(`[PSD Verify] path: ${psdEvidencePath}`);
console.log(`[PSD Verify] size: ${String(psdBytes.byteLength)} bytes`);
console.log(
  `[PSD Verify] document: ${String(parsedPsd.width)}x${String(parsedPsd.height)}`,
);
console.log(
  `[PSD Verify] layers: ${String(parsedPsd.children?.length ?? 0)}; first: ${parsedPsd.children?.[0]?.name ?? "none"}`,
);
console.log(`[Performance Verify] 4K/20-layer PSD: ${String(psdElapsedMs)}ms`);
console.log(
  `[ZIP Verify] path: ${zipEvidencePath}; master.psd=${String(zipText.includes("master.psd"))}; render_preview.png=${String(zipText.includes("render_preview.png"))}; model_ref.json=${String(zipText.includes("model_ref.json"))}`,
);
console.log(
  `[Concurrency Verify] thread IDs: ${concurrentRuns.map((run) => run.message.threadId).join(",")}; process IDs: ${concurrentRuns.map((run) => run.message.processId).join(",")}; elapsed: ${String(concurrentElapsedMs)}ms`,
);
console.log(
  `[Disconnect Verify] worker terminated and temporary directory removed in ${String(disconnectElapsedMs)}ms`,
);
console.log(
  `[Memory Verify] five durations: ${sequentialDurations.join(",")}ms; heap baseline=${String(heapBaseline)}; heap after=${String(heapAfter)}; delta=${String(heapAfter - heapBaseline)}`,
);
