import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

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

const environment = parseEnvironment(await readFile(".env.local", "utf8"));
const url = environment.NEXT_PUBLIC_SUPABASE_URL;
const key =
  environment.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error("Public Supabase credentials are missing.");

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
if (!sessionValue) throw new Error("Supabase session was not persisted.");

const original = await sharp({
  create: {
    width: 1200,
    height: 675,
    channels: 4,
    background: "#1f2937",
  },
})
  .composite([
    {
      input: Buffer.from(`
        <svg width="1200" height="675" xmlns="http://www.w3.org/2000/svg">
          <text x="600" y="338" text-anchor="middle" dominant-baseline="middle"
            font-family="Arial" font-size="92" font-weight="700" fill="#f9fafb">ORIGINAL PREVIEW</text>
        </svg>
      `),
    },
  ])
  .png()
  .toBuffer();

const response = await fetch("http://127.0.0.1:3000/api/preview", {
  method: "POST",
  headers: {
    "Content-Type": "image/png",
    Cookie: createCookieHeader(storageKey, sessionValue),
  },
  body: original,
});
const body = await response.json();
if (!response.ok || typeof body.previewUrl !== "string") {
  throw new Error(`Preview API failed with ${String(response.status)}.`);
}
const previewResponse = await fetch(body.previewUrl);
if (!previewResponse.ok) {
  throw new Error(
    `Preview download failed with ${String(previewResponse.status)}.`,
  );
}
const watermarked = Buffer.from(await previewResponse.arrayBuffer());
const evidenceDirectory = resolve("docs/qa-evidence");
await mkdir(evidenceDirectory, { recursive: true });
const originalPath = resolve(evidenceDirectory, "step4-preview-original.png");
const watermarkedPath = resolve(
  evidenceDirectory,
  "step4-preview-api-watermarked.png",
);
const comparisonPath = resolve(
  evidenceDirectory,
  "step4-preview-comparison.png",
);
await writeFile(originalPath, original);
await writeFile(watermarkedPath, watermarked);

const left = await sharp(original).resize(800, 450).png().toBuffer();
const right = await sharp(watermarked).resize(800, 450).png().toBuffer();
const comparison = await sharp({
  create: {
    width: 1600,
    height: 520,
    channels: 4,
    background: "#09090b",
  },
})
  .composite([
    { input: left, left: 0, top: 70 },
    { input: right, left: 800, top: 70 },
    {
      input: Buffer.from(`
        <svg width="1600" height="70" xmlns="http://www.w3.org/2000/svg">
          <rect width="1600" height="70" fill="#09090b"/>
          <text x="400" y="38" text-anchor="middle" font-family="Arial" font-size="28" fill="#fafafa">ORIGINAL</text>
          <text x="1200" y="38" text-anchor="middle" font-family="Arial" font-size="28" fill="#fafafa">SERVER WATERMARK</text>
        </svg>
      `),
      left: 0,
      top: 0,
    },
  ])
  .png()
  .toBuffer();
await writeFile(comparisonPath, comparison);

const hash = createHash("sha256").update(watermarked).digest("hex");
const log = [
  `[Preview API Verify] status=${String(response.status)}`,
  `[Preview API Verify] user_id=${signIn.data.user.id}`,
  `[Preview API Verify] expires_in=${String(body.expiresIn)}`,
  `[Preview API Verify] timestamp=${String(body.timestamp)}`,
  `[Preview API Verify] signed_url=${body.previewUrl}`,
  `[Preview API Verify] download_status=${String(previewResponse.status)}`,
  `[Preview API Verify] sha256=${hash}`,
  `[Preview API Verify] comparison=${comparisonPath}`,
].join("\n");
await writeFile(
  resolve(evidenceDirectory, "step4-preview-api-runtime.log"),
  `${log}\n`,
  "utf8",
);
console.log(log);
