import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import ts from "typescript";

const APP_URL = "http://127.0.0.1:3103";
const EVIDENCE_DIRECTORY = resolve("docs/qa-evidence");

function parseEnvironment(source) {
  const parsed = {};
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    const quoted =
      rawValue.length >= 2 &&
      ((rawValue.startsWith('"') && rawValue.endsWith('"')) ||
        (rawValue.startsWith("'") && rawValue.endsWith("'")));
    parsed[key] = quoted ? rawValue.slice(1, -1) : rawValue;
  }
  return parsed;
}

function createCookieHeader(key, value) {
  const encoded = `base64-${Buffer.from(value).toString("base64url")}`;
  if (encoded.length <= 3180) return `${key}=${encoded}`;
  const chunks = [];
  for (let index = 0; index < encoded.length; index += 3180) {
    chunks.push(
      `${key}.${String(chunks.length)}=${encoded.slice(index, index + 3180)}`,
    );
  }
  return chunks.join("; ");
}

function parseSse(source) {
  return source.split(/\n\n/u).flatMap((block) => {
    const event = block
      .split("\n")
      .find((line) => line.startsWith("event: "))
      ?.slice(7);
    const data = block
      .split("\n")
      .find((line) => line.startsWith("data: "))
      ?.slice(6);
    if (!event || !data) return [];
    return [{ event, data: JSON.parse(data) }];
  });
}

function completeEvent(events) {
  const complete = events.find((event) => event.event === "complete");
  if (!complete || typeof complete.data?.downloadUrl !== "string") {
    throw new Error("Export did not return a signed download URL.");
  }
  return complete.data;
}

function escapeXml(value) {
  return value.replace(/[<>&"']/g, (character) => {
    const entities = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      '"': "&quot;",
      "'": "&apos;",
    };
    return entities[character] ?? "";
  });
}

async function renderEvidenceScreenshot(lines, path) {
  const text = lines
    .map(
      (line, index) =>
        `<text x="56" y="${String(70 + index * 36)}" font-family="Consolas, monospace" font-size="22" fill="${index === 0 ? "#67e8f9" : "#f4f4f5"}">${escapeXml(line || " ")}</text>`,
    )
    .join("");
  const height = Math.max(680, 110 + lines.length * 36);
  const image = await sharp(
    Buffer.from(`
      <svg width="1700" height="${String(height)}" xmlns="http://www.w3.org/2000/svg">
        <rect width="1700" height="${String(height)}" fill="#09090b"/>
        <rect x="28" y="28" width="1644" height="${String(height - 56)}" rx="8" fill="#18181b" stroke="#3f3f46"/>
        ${text}
      </svg>
    `),
  )
    .png()
    .toBuffer();
  await writeFile(path, image);
}

async function waitForServer(child, logs) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Next server exited early:\n${logs.join("")}`);
    }
    try {
      const response = await fetch(APP_URL);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error("Next production server did not become ready.");
}

async function temporaryExportDirectories() {
  return new Set(
    (await readdir(tmpdir())).filter((name) =>
      name.startsWith("statueforge-export-"),
    ),
  );
}

async function createAuthenticatedContext(url, key) {
  const storage = new Map();
  const supabase = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      storage: {
        getItem: (name) => storage.get(name) ?? null,
        setItem: (name, value) => storage.set(name, value),
        removeItem: (name) => storage.delete(name),
      },
    },
  });
  const signIn = await supabase.auth.signInAnonymously();
  if (signIn.error || !signIn.data.user) {
    throw new Error(signIn.error?.message ?? "Anonymous sign-in failed.");
  }
  const userId = signIn.data.user.id;
  const projectRef = new URL(url).hostname.split(".")[0];
  const sessionValue = storage.get(`sb-${projectRef}-auth-token`);
  if (!sessionValue) throw new Error("Supabase session was not persisted.");
  return {
    supabase,
    userId,
    cookie: createCookieHeader(`sb-${projectRef}-auth-token`, sessionValue),
  };
}

async function createExportAsset(context, label) {
  const projectInsert = await context.supabase
    .from("projects")
    .insert({
      profile_id: context.userId,
      user_id: context.userId,
      name: `Step 4 ${label} ${new Date().toISOString()}`,
      style: "custom",
      ratio: "16:9",
      status: "draft",
      thumbnail_url: "https://placehold.co/600x400/png?text=Guard+QA",
      layers_json: [],
    })
    .select("id")
    .single();
  if (projectInsert.error) throw new Error(projectInsert.error.message);
  const projectId = projectInsert.data.id;
  const prepare = await fetch(`${APP_URL}/api/projects/${projectId}`, {
    method: "POST",
    headers: { Cookie: context.cookie },
  });
  const prepared = await prepare.json();
  if (!prepare.ok || typeof prepared.assetId !== "string") {
    throw new Error(`Asset preparation failed with ${String(prepare.status)}.`);
  }
  const layer = {
    id: `guard-${label}`,
    type: "shape",
    name: `Guard ${label}`,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    x: 0,
    y: 0,
    width: 1600,
    height: 900,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    shape: "rectangle",
    fill: "#0e7490",
    stroke: "#ffffff",
    strokeWidth: 4,
    cornerRadius: 24,
  };
  const save = await fetch(`${APP_URL}/api/projects/${projectId}`, {
    method: "PATCH",
    headers: { Cookie: context.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      assetId: prepared.assetId,
      layers: [layer],
      layerStorageKeys: {},
    }),
  });
  if (!save.ok)
    throw new Error(`Asset save failed with ${String(save.status)}.`);
  return { projectId, assetId: prepared.assetId };
}

async function requestExport(context, assetId, signal) {
  return fetch(`${APP_URL}/api/export/package`, {
    method: "POST",
    headers: {
      Cookie: context.cookie,
      Accept: "text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ assetId, format: "psd", include3d: false }),
    signal,
  });
}

async function runExactDeadline() {
  const source = await readFile("src/lib/export-coordinator.ts", "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const coordinatorModule = await import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
  );
  const startedAt = new Date();
  const elapsedMs = await new Promise((resolveWait) => {
    const started = performance.now();
    coordinatorModule.createExportDeadline(60_000, () => {
      resolveWait(Math.round(performance.now() - started));
    });
  });
  return {
    configuredMs: 60_000,
    startedAt: startedAt.toISOString(),
    firedAt: new Date().toISOString(),
    elapsedMs,
  };
}

const environment = parseEnvironment(await readFile(".env.local", "utf8"));
const supabaseUrl = environment.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  environment.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  throw new Error("Public Supabase credentials are missing.");
}

await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
const serverLogs = [];
const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-p", "3103"],
  { cwd: process.cwd(), env: process.env, windowsHide: true },
);
server.stdout.on("data", (chunk) => serverLogs.push(chunk.toString()));
server.stderr.on("data", (chunk) => serverLogs.push(chunk.toString()));

const contexts = [];
const projects = [];
try {
  await waitForServer(server, serverLogs);

  const concurrencyContext = await createAuthenticatedContext(
    supabaseUrl,
    supabaseKey,
  );
  contexts.push(concurrencyContext);
  const concurrencyAsset = await createExportAsset(
    concurrencyContext,
    "concurrency",
  );
  projects.push({
    context: concurrencyContext,
    id: concurrencyAsset.projectId,
  });

  const concurrencyStartedAt = new Date().toISOString();
  const concurrentResponses = await Promise.all(
    Array.from({ length: 3 }, () =>
      requestExport(concurrencyContext, concurrencyAsset.assetId),
    ),
  );
  const concurrentBodies = await Promise.all(
    concurrentResponses.map((response) => response.text()),
  );
  const concurrencyCompletedAt = new Date().toISOString();
  const statuses = concurrentResponses.map((response) => response.status);
  const allowedIndexes = statuses
    .map((status, index) => ({ status, index }))
    .filter(({ status }) => status === 200)
    .map(({ index }) => index);
  const rejectedCount = statuses.filter((status) => status === 429).length;
  if (allowedIndexes.length !== 2 || rejectedCount !== 1) {
    throw new Error(`Unexpected concurrency statuses: ${statuses.join(",")}`);
  }
  const completedExports = allowedIndexes.map((index) =>
    completeEvent(parseSse(concurrentBodies[index])),
  );

  const disconnectContext = await createAuthenticatedContext(
    supabaseUrl,
    supabaseKey,
  );
  contexts.push(disconnectContext);
  const disconnectAsset = await createExportAsset(
    disconnectContext,
    "disconnect",
  );
  projects.push({ context: disconnectContext, id: disconnectAsset.projectId });
  const tempBefore = await temporaryExportDirectories();
  const disconnectStartedAt = new Date().toISOString();
  const abortController = new AbortController();
  const disconnectResponse = await requestExport(
    disconnectContext,
    disconnectAsset.assetId,
    abortController.signal,
  );
  const reader = disconnectResponse.body?.getReader();
  if (!reader) throw new Error("Disconnect response stream is missing.");
  const decoder = new TextDecoder();
  let streamPrefix = "";
  while (!streamPrefix.includes('"status":"rendering"')) {
    const chunk = await reader.read();
    if (chunk.done) break;
    streamPrefix += decoder.decode(chunk.value, { stream: true });
  }
  if (!streamPrefix.includes('"status":"rendering"')) {
    throw new Error("Worker completed before disconnect could be simulated.");
  }
  abortController.abort();
  await reader.cancel().catch(() => {});
  await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
  const disconnectCompletedAt = new Date().toISOString();
  const tempAfter = await temporaryExportDirectories();
  const leakedDirectories = [...tempAfter].filter(
    (directory) => !tempBefore.has(directory),
  );
  if (leakedDirectories.length > 0) {
    throw new Error(
      `Disconnect leaked temporary directories: ${leakedDirectories.join(",")}`,
    );
  }

  const deadlinePromise = runExactDeadline();
  const expiryTarget =
    new Date(completedExports[0].expiresAt).getTime() + 2_000;
  const expiryWaitMs = Math.max(0, expiryTarget - Date.now());
  await new Promise((resolveWait) => setTimeout(resolveWait, expiryWaitMs));
  const expiryTestedAt = new Date().toISOString();
  const expiredResponse = await fetch(completedExports[0].downloadUrl);
  const expiredBody = await expiredResponse.text();
  const deadline = await deadlinePromise;
  if (
    expiredResponse.status < 400 ||
    !expiredBody.includes("InvalidJWT") ||
    !expiredBody.includes("exp")
  ) {
    throw new Error(
      `Expired URL was not rejected correctly: ${String(expiredResponse.status)} ${expiredBody}`,
    );
  }

  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  const serverLog = serverLogs.join("");
  const abandonmentLogged = serverLog.includes("Export SSE abandoned");
  const workerProgressLogged = serverLog.includes("Export worker progress");
  if (!abandonmentLogged || !workerProgressLogged) {
    throw new Error("Required server-side guard logs were not captured.");
  }

  const lines = [
    `[A-13/B-08 Runtime Verify] ${new Date().toISOString()}`,
    "",
    `[Concurrency] started_at=${concurrencyStartedAt}`,
    `[Concurrency] completed_at=${concurrencyCompletedAt}`,
    `[Concurrency] statuses=${statuses.join(",")}`,
    `[Concurrency] allowed=2 rejected=1 user=${concurrencyContext.userId}`,
    "",
    `[Disconnect] started_at=${disconnectStartedAt}`,
    `[Disconnect] completed_at=${disconnectCompletedAt}`,
    `[Disconnect] response_status=${String(disconnectResponse.status)}`,
    `[Disconnect] rendering_observed=true abandonment_logged=${String(abandonmentLogged)}`,
    `[Disconnect] leaked_temp_directories=${String(leakedDirectories.length)}`,
    "",
    `[Deadline] configured_ms=${String(deadline.configuredMs)}`,
    `[Deadline] started_at=${deadline.startedAt}`,
    `[Deadline] fired_at=${deadline.firedAt}`,
    `[Deadline] elapsed_ms=${String(deadline.elapsedMs)}`,
    "",
    `[URL Expiry] issued_expires_at=${completedExports[0].expiresAt}`,
    `[URL Expiry] tested_at=${expiryTestedAt}`,
    `[URL Expiry] status=${String(expiredResponse.status)}`,
    `[URL Expiry] body=${expiredBody}`,
    `[Server] worker_progress_logged=${String(workerProgressLogged)}`,
  ];
  await writeFile(
    resolve(EVIDENCE_DIRECTORY, "step4-export-guards-runtime.log"),
    `${lines.join("\n")}\n`,
    "utf8",
  );
  await writeFile(
    resolve(EVIDENCE_DIRECTORY, "step4-export-guards-server.log"),
    serverLog,
    "utf8",
  );
  await renderEvidenceScreenshot(
    lines,
    resolve(EVIDENCE_DIRECTORY, "step4-export-guards-runtime.png"),
  );
  console.log(lines.join("\n"));
} finally {
  server.kill();
  for (const { context, id } of projects) {
    await context.supabase.from("projects").delete().eq("id", id);
  }
  for (const context of contexts) {
    const listed = await context.supabase.storage
      .from("exports")
      .list(context.userId);
    if (!listed.error && listed.data.length > 0) {
      await context.supabase.storage
        .from("exports")
        .remove(listed.data.map((item) => `${context.userId}/${item.name}`));
    }
  }
}
