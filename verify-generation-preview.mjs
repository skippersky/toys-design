import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

function parseEnvironment(source) {
  const parsed = {};
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator < 0) {
      continue;
    }
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
  if (encoded.length <= 3180) {
    return `${key}=${encoded}`;
  }
  const chunks = [];
  for (let index = 0; index < encoded.length; index += 3180) {
    chunks.push(
      `${key}.${String(chunks.length)}=${encoded.slice(index, index + 3180)}`,
    );
  }
  return chunks.join("; ");
}

function parseSse(source) {
  return source
    .trim()
    .split(/\n\n/u)
    .map((block) => {
      const lines = block.split("\n");
      const event = lines
        .find((line) => line.startsWith("event: "))
        ?.slice(7);
      const data = lines
        .find((line) => line.startsWith("data: "))
        ?.slice(6);
      return { event, data: data ? JSON.parse(data) : null };
    });
}

const environment = parseEnvironment(await readFile(".env.local", "utf8"));
const url = environment.NEXT_PUBLIC_SUPABASE_URL;
const key =
  environment.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) {
  throw new Error("Public Supabase credentials are missing.");
}

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

const projectRef = new URL(url).hostname.split(".")[0];
const storageKey = `sb-${projectRef}-auth-token`;
const sessionValue = storage.get(storageKey);
if (!sessionValue) {
  throw new Error("Supabase session was not persisted for the route request.");
}

const startedAt = Date.now();
const response = await fetch("http://127.0.0.1:3000/api/generate/statue", {
  method: "POST",
  headers: {
    Accept: "text/event-stream",
    "Content-Type": "application/json",
    Cookie: createCookieHeader(storageKey, sessionValue),
  },
  body: JSON.stringify({
    style: "toy",
    ratio: "16:9",
    prompt: "Step 4 watermarked preview verification",
  }),
});
const responseText = await response.text();
if (!response.ok) {
  throw new Error(
    `Generation route failed with ${String(response.status)}: ${responseText}`,
  );
}

const events = parseSse(responseText);
const previewEvent = events.find(
  (entry) =>
    entry.event === "progress" &&
    entry.data &&
    typeof entry.data === "object" &&
    "preview_url" in entry.data,
);
const completeEvent = events.find((entry) => entry.event === "complete");
const previewUrl = previewEvent?.data?.preview_url;
if (typeof previewUrl !== "string" || !completeEvent) {
  throw new Error(`Generation SSE did not complete with a preview: ${responseText}`);
}

const previewResponse = await fetch(previewUrl);
if (!previewResponse.ok) {
  throw new Error(
    `Signed preview download failed with ${String(previewResponse.status)}.`,
  );
}
const preview = Buffer.from(await previewResponse.arrayBuffer());
const metadata = await sharp(preview).metadata();
const hash = createHash("sha256").update(preview).digest("hex");
const evidenceDirectory = resolve("docs/qa-evidence");
const previewPath = resolve(
  evidenceDirectory,
  "step4-generation-preview-watermarked.png",
);
const logPath = resolve(
  evidenceDirectory,
  "step4-generation-preview-runtime.log",
);
await mkdir(evidenceDirectory, { recursive: true });
await writeFile(previewPath, preview);

const log = [
  `[Generation Verify] status=${String(response.status)} elapsed_ms=${String(Date.now() - startedAt)}`,
  `[Generation Verify] user=${signIn.data.user.id}`,
  `[Generation Verify] events=${events.map((entry) => entry.event).join(",")}`,
  `[Generation Verify] asset_id=${String(completeEvent.data?.asset_id ?? "")}`,
  `[Watermark Verify] preview_status=${String(previewResponse.status)}`,
  `[Watermark Verify] dimensions=${String(metadata.width)}x${String(metadata.height)}`,
  `[Watermark Verify] sha256=${hash}`,
  `[Watermark Verify] signed_url=${previewUrl}`,
].join("\n");
await writeFile(logPath, `${log}\n`, "utf8");
console.log(log);
console.log(`[Watermark Verify] saved=${previewPath}`);
