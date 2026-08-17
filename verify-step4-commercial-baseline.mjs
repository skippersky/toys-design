import { readFile } from "node:fs/promises";

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
const userId = signIn.data.user.id;
const projectRef = new URL(url).hostname.split(".")[0];
const storageKey = `sb-${projectRef}-auth-token`;
const sessionValue = storage.get(storageKey);
if (!sessionValue) throw new Error("Supabase session was not persisted.");
const cookie = createCookieHeader(storageKey, sessionValue);

const profileBefore = await supabase
  .from("profiles")
  .select("user_id,tier,credits")
  .eq("user_id", userId)
  .maybeSingle();
if (
  profileBefore.error &&
  !profileBefore.error.message.includes("Cannot coerce")
) {
  throw new Error(profileBefore.error.message);
}

const attempts = await Promise.all(
  Array.from({ length: 20 }, () =>
    supabase.rpc("decrement_credits", { p_user_id: userId, p_amount: 1 }),
  ),
);
const rpcError = attempts.find((attempt) => attempt.error)?.error;
if (rpcError) throw new Error(rpcError.message);
const succeeded = attempts.filter((attempt) => attempt.data === true).length;
const rejected = attempts.filter((attempt) => attempt.data === false).length;
const profileAfter = await supabase
  .from("profiles")
  .select("user_id,tier,credits")
  .eq("user_id", userId)
  .maybeSingle();
if (
  profileAfter.error &&
  !profileAfter.error.message.includes("Cannot coerce")
) {
  throw new Error(profileAfter.error.message);
}
if (
  succeeded !== 10 ||
  rejected !== 10 ||
  (profileAfter.data !== null && profileAfter.data.credits !== 0)
) {
  throw new Error("Concurrent credit deduction violated the 10-credit limit.");
}

const projectInsert = await supabase
  .from("projects")
  .insert({
    profile_id: userId,
    user_id: userId,
    name: `Step 4 asset ownership QA ${new Date().toISOString()}`,
    style: "custom",
    ratio: "16:9",
    status: "draft",
    thumbnail_url: "https://placehold.co/600x400/png?text=Step4+QA",
    layers_json: [],
  })
  .select("id")
  .single();
if (projectInsert.error) throw new Error(projectInsert.error.message);
const projectId = projectInsert.data.id;

const preparedResponse = await fetch(
  `http://127.0.0.1:3000/api/projects/${projectId}`,
  { method: "POST", headers: { Cookie: cookie } },
);
const prepared = await preparedResponse.json();
if (!preparedResponse.ok || typeof prepared.assetId !== "string") {
  throw new Error(
    `Project preparation failed with ${String(preparedResponse.status)}.`,
  );
}

const layerId = crypto.randomUUID();
const image = await sharp({
  create: {
    width: 320,
    height: 180,
    channels: 4,
    background: "#0e7490",
  },
})
  .png()
  .toBuffer();
const objectPath = `${userId}/${projectId}/${layerId}.png`;
const upload = await supabase.storage.from("assets").upload(objectPath, image, {
  contentType: "image/png",
  cacheControl: "300",
  upsert: false,
});
if (upload.error) throw new Error(upload.error.message);
const signed = await supabase.storage
  .from("assets")
  .createSignedUrl(objectPath, 300);
if (signed.error) throw new Error(signed.error.message);

const layer = {
  id: layerId,
  type: "image",
  name: "Step 4 imported image",
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: "normal",
  x: 0,
  y: 0,
  width: 320,
  height: 180,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  src: signed.data.signedUrl,
  thumbnailSrc: signed.data.signedUrl,
  originalWidth: 320,
  originalHeight: 180,
};
const saveResponse = await fetch(
  `http://127.0.0.1:3000/api/projects/${projectId}`,
  {
    method: "PATCH",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      assetId: prepared.assetId,
      layers: [layer],
      layerStorageKeys: { [layerId]: objectPath },
    }),
  },
);
if (!saveResponse.ok) {
  throw new Error(`Project save failed with ${String(saveResponse.status)}.`);
}

const importedAsset = await supabase
  .from("assets")
  .select("id,project_id,user_id,source_layer_id,oss_key,metadata")
  .eq("project_id", projectId)
  .eq("source_layer_id", layerId)
  .single();
if (importedAsset.error) throw new Error(importedAsset.error.message);
if (
  importedAsset.data.user_id !== userId ||
  importedAsset.data.metadata?.imported_image !== true
) {
  throw new Error("Imported asset ownership metadata is invalid.");
}

console.log(
  `[Profile Verify] direct_select=${profileBefore.data === null ? "filtered_by_current_access_policy" : JSON.stringify(profileBefore.data)}`,
);
console.log(`[Credit Verify] concurrent_attempts=${String(attempts.length)}`);
console.log(
  `[Credit Verify] successful=${String(succeeded)} rejected=${String(rejected)}`,
);
console.log(
  `[Profile Verify] final=${profileAfter.data === null ? "verified_by_rpc_rejections" : JSON.stringify(profileAfter.data)}`,
);
console.log(`[Asset Verify] project_id=${projectId}`);
console.log(`[Asset Verify] editor_asset_id=${String(prepared.assetId)}`);
console.log(`[Asset Verify] imported=${JSON.stringify(importedAsset.data)}`);
