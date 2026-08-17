import { readFile, rm, writeFile } from "node:fs/promises";

import { createClient } from "@supabase/supabase-js";

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

const environment = parseEnvironment(await readFile(".env.local", "utf8"));
const url = environment.NEXT_PUBLIC_SUPABASE_URL;
const key =
  environment.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) {
  throw new Error("Public Supabase credentials are missing.");
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const signIn = await supabase.auth.signInAnonymously();
if (signIn.error || !signIn.data.user) {
  throw new Error(signIn.error?.message ?? "Anonymous sign-in failed.");
}

const path = `${signIn.data.user.id}/qa/photopea-step4.psd`;
const psd = await readFile("docs/qa-evidence/step4-api-export-current.psd");
const upload = await supabase.storage.from("exports").upload(path, psd, {
  contentType: "image/vnd.adobe.photoshop",
  upsert: true,
});
if (upload.error) {
  throw new Error(`Temporary PSD upload failed: ${upload.error.message}`);
}

const signed = await supabase.storage
  .from("exports")
  .createSignedUrl(path, 300);
if (signed.error) {
  await supabase.storage.from("exports").remove([path]);
  throw new Error(`Temporary PSD signing failed: ${signed.error.message}`);
}

console.log(`[Photopea Verify] user=${signIn.data.user.id}`);
console.log(`[Photopea Verify] path=${path}`);
console.log(`[Photopea Verify] signed_url=${signed.data.signedUrl}`);
console.log(
  "[Photopea Verify] temporary object expires and is removed in 180s",
);
await writeFile(".photopea-signed-url.tmp", signed.data.signedUrl, "utf8");

await new Promise((resolve) => setTimeout(resolve, 180_000));
const cleanup = await supabase.storage.from("exports").remove([path]);
await rm(".photopea-signed-url.tmp", { force: true });
if (cleanup.error) {
  throw new Error(`Temporary PSD cleanup failed: ${cleanup.error.message}`);
}
console.log("[Photopea Verify] temporary object removed");
