import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";
import { readPsd } from "ag-psd";
import sharp from "sharp";

const APP_URL = "http://127.0.0.1:3101";
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
    const error = events.find((event) => event.event === "error");
    throw new Error(error?.data?.message ?? "Export did not complete.");
  }
  return complete.data;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
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

async function renderEvidenceScreenshot(lines, path) {
  const text = lines
    .map(
      (line, index) =>
        `<text x="56" y="${String(72 + index * 38)}" font-family="Consolas, monospace" font-size="23" fill="${index === 0 ? "#67e8f9" : "#f4f4f5"}">${escapeXml(line || " ")}</text>`,
    )
    .join("");
  const height = Math.max(620, 120 + lines.length * 38);
  const image = await sharp(
    Buffer.from(`
      <svg width="1600" height="${String(height)}" xmlns="http://www.w3.org/2000/svg">
        <rect width="1600" height="${String(height)}" fill="#09090b"/>
        <rect x="28" y="28" width="1544" height="${String(height - 56)}" rx="8" fill="#18181b" stroke="#3f3f46"/>
        ${text}
      </svg>
    `),
  )
    .png()
    .toBuffer();
  await writeFile(path, image);
}

function buildLayers() {
  return [
    {
      id: "qa-shape",
      type: "shape",
      name: "QA Vector Badge",
      visible: true,
      locked: false,
      opacity: 0.85,
      blendMode: "multiply",
      x: 180,
      y: 140,
      width: 720,
      height: 420,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      shape: "rectangle",
      fill: "#0891b2",
      stroke: "#f4f4f5",
      strokeWidth: 8,
      cornerRadius: 48,
    },
    {
      id: "qa-text-group",
      type: "group",
      name: "QA Text Group",
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "normal",
      x: 0,
      y: 0,
      width: 800,
      height: 180,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      childIds: ["qa-text"],
    },
    {
      id: "qa-text",
      parentId: "qa-text-group",
      type: "text",
      name: "QA Editable Title",
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "screen",
      x: 140,
      y: 650,
      width: 900,
      height: 220,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      text: "StatueForge QA",
      fontFamily: "Arial",
      fontSize: 96,
      fontStyle: "bold",
      align: "left",
      color: "#ffffff",
      lineHeight: 1.2,
    },
  ];
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
  ["node_modules/next/dist/bin/next", "start", "-p", "3101"],
  { cwd: process.cwd(), env: process.env, windowsHide: true },
);
server.stdout.on("data", (chunk) => serverLogs.push(chunk.toString()));
server.stderr.on("data", (chunk) => serverLogs.push(chunk.toString()));

let projectId;
let userId;
let assetId;
let supabase;
try {
  await waitForServer(server, serverLogs);

  const authStorage = new Map();
  supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      storage: {
        getItem: (name) => authStorage.get(name) ?? null,
        setItem: (name, value) => authStorage.set(name, value),
        removeItem: (name) => authStorage.delete(name),
      },
    },
  });
  const signIn = await supabase.auth.signInAnonymously();
  if (signIn.error || !signIn.data.user) {
    throw new Error(signIn.error?.message ?? "Anonymous sign-in failed.");
  }
  userId = signIn.data.user.id;
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const sessionValue = authStorage.get(`sb-${projectRef}-auth-token`);
  if (!sessionValue) throw new Error("Supabase session was not persisted.");
  const cookie = createCookieHeader(
    `sb-${projectRef}-auth-token`,
    sessionValue,
  );

  const projectInsert = await supabase
    .from("projects")
    .insert({
      profile_id: userId,
      user_id: userId,
      name: `Step 4 export contract QA ${new Date().toISOString()}`,
      style: "custom",
      ratio: "16:9",
      status: "draft",
      thumbnail_url: "https://placehold.co/600x400/png?text=Export+QA",
      layers_json: [],
    })
    .select("id")
    .single();
  if (projectInsert.error) throw new Error(projectInsert.error.message);
  projectId = projectInsert.data.id;

  const prepareResponse = await fetch(`${APP_URL}/api/projects/${projectId}`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  const prepared = await prepareResponse.json();
  if (!prepareResponse.ok || typeof prepared.assetId !== "string") {
    throw new Error(
      `Asset preparation failed: ${String(prepareResponse.status)}`,
    );
  }
  assetId = prepared.assetId;

  const layers = buildLayers();
  const saveResponse = await fetch(`${APP_URL}/api/projects/${projectId}`, {
    method: "PATCH",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      assetId,
      layers,
      layerStorageKeys: {},
    }),
  });
  const saveBody = await saveResponse.json();
  if (!saveResponse.ok || saveBody.assetId !== assetId) {
    throw new Error(`Asset save failed: ${JSON.stringify(saveBody)}`);
  }

  const results = [];
  for (const format of ["psd", "zip"]) {
    const startedAt = performance.now();
    const response = await fetch(`${APP_URL}/api/export/package`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ assetId, format, include3d: false }),
    });
    const responseBody = await response.text();
    const events = parseSse(responseBody);
    const completion = completeEvent(events);
    const download = await fetch(completion.downloadUrl);
    const bytes = Buffer.from(await download.arrayBuffer());
    const evidencePath = resolve(
      EVIDENCE_DIRECTORY,
      `step4-api-export-current.${format}`,
    );
    await writeFile(evidencePath, bytes);
    results.push({
      format,
      routeStatus: response.status,
      contentType: response.headers.get("content-type"),
      events,
      responseBody,
      downloadStatus: download.status,
      bytes,
      evidencePath,
      hash: sha256(bytes),
      elapsedMs: Math.round(performance.now() - startedAt),
      expiresAt: completion.expiresAt,
      downloadUrl: completion.downloadUrl,
    });
  }

  const psdResult = results.find((result) => result.format === "psd");
  const zipResult = results.find((result) => result.format === "zip");
  if (!psdResult || !zipResult) throw new Error("Both exports are required.");
  if (
    results.some(
      (result) =>
        result.routeStatus !== 200 ||
        result.downloadStatus !== 200 ||
        result.responseBody.includes("Asset was not found"),
    )
  ) {
    throw new Error("A-16 export contract verification failed.");
  }

  const parsedPsd = readPsd(psdResult.bytes, {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true,
  });
  const rootNames = parsedPsd.children?.map((layer) => layer.name) ?? [];
  const textLayer = parsedPsd.children?.[0]?.children?.[0];
  const shapeLayer = parsedPsd.children?.[1];
  const zipText = zipResult.bytes.toString("latin1");
  const timestamp = new Date().toISOString();
  const evidenceLines = [
    `[A-16 Runtime Verify] ${timestamp}`,
    `project.id=${projectId}`,
    `assets.id=${assetId}`,
    `submitted assetId matches assets.id: true`,
    "",
    `PSD route=${String(psdResult.routeStatus)} download=${String(psdResult.downloadStatus)}`,
    `PSD events=${psdResult.events.map((event) => event.event).join(" -> ")}`,
    `PSD sha256=${psdResult.hash}`,
    `PSD layers=${String(parsedPsd.children?.length ?? 0)} roots=${rootNames.join(", ")}`,
    `PSD text=${textLayer?.text?.text ?? "MISSING"}`,
    `PSD shape vectorMask=${String(Boolean(shapeLayer?.vectorMask))}`,
    "",
    `ZIP route=${String(zipResult.routeStatus)} download=${String(zipResult.downloadStatus)}`,
    `ZIP events=${zipResult.events.map((event) => event.event).join(" -> ")}`,
    `ZIP sha256=${zipResult.hash}`,
    `ZIP master.psd=${String(zipText.includes("master.psd"))}`,
    `ZIP render_preview.png=${String(zipText.includes("render_preview.png"))}`,
    "",
    `Asset was not found occurrences=${String(results.reduce((count, result) => count + (result.responseBody.match(/Asset was not found/gu)?.length ?? 0), 0))}`,
  ];
  await writeFile(
    resolve(EVIDENCE_DIRECTORY, "step4-export-api-runtime.log"),
    `${evidenceLines.join("\n")}\n`,
    "utf8",
  );
  await writeFile(
    resolve(EVIDENCE_DIRECTORY, "step4-export-api-server.log"),
    serverLogs.join(""),
    "utf8",
  );
  await renderEvidenceScreenshot(
    evidenceLines,
    resolve(EVIDENCE_DIRECTORY, "step4-export-api-response.png"),
  );

  console.log(evidenceLines.join("\n"));
} finally {
  if (supabase && userId) {
    const listed = await supabase.storage.from("exports").list(userId);
    if (!listed.error && listed.data.length > 0) {
      await supabase.storage
        .from("exports")
        .remove(listed.data.map((item) => `${userId}/${item.name}`));
    }
  }
  if (supabase && projectId) {
    await supabase.from("projects").delete().eq("id", projectId);
  }
  server.kill();
}
