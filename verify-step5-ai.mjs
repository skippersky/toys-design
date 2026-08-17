import { readFile } from "node:fs/promises";

function parseEnvironment(source) {
  return Object.fromEntries(
    source.split(/\r?\n/u).flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return [];
      }
      const separator = trimmed.indexOf("=");
      if (separator < 1) {
        return [];
      }
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed
        .slice(separator + 1)
        .trim()
        .replace(/^['"]|['"]$/gu, "");
      return [[key, value]];
    }),
  );
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 500);
  }
}

const environment = parseEnvironment(await readFile(".env.local", "utf8"));
const supabaseUrl = environment.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = environment.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const comfyUrl = environment.COMFYUI_HTTP_URL;

console.log(`[Config] Supabase URL: ${supabaseUrl ? "configured" : "missing"}`);
console.log(
  `[Config] Supabase anon key: ${anonKey ? "configured" : "missing"}`,
);
console.log(
  `[Config] ComfyUI checkpoint: ${environment.COMFYUI_CHECKPOINT_NAME || "missing"}`,
);

if (!supabaseUrl || !anonKey) {
  throw new Error("Supabase public environment variables are required.");
}

const rpcResponse = await fetch(
  `${supabaseUrl.replace(/\/$/u, "")}/rest/v1/rpc/reserve_generation_task`,
  {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_project_id: "00000000-0000-4000-8000-000000000001",
      p_editor_asset_id: "00000000-0000-4000-8000-000000000002",
      p_credit_cost: 1,
      p_request_metadata: { verification: true },
    }),
  },
);
console.log(`[Supabase RPC] HTTP ${rpcResponse.status}`);
console.log(
  `[Supabase RPC] ${JSON.stringify(await readJson(rpcResponse)).slice(0, 800)}`,
);

if (comfyUrl) {
  try {
    const comfyResponse = await fetch(
      `${comfyUrl.replace(/\/$/u, "")}/system_stats`,
      { signal: AbortSignal.timeout(3000) },
    );
    console.log(`[ComfyUI] HTTP ${comfyResponse.status}`);
    console.log(
      `[ComfyUI] ${JSON.stringify(await readJson(comfyResponse)).slice(0, 800)}`,
    );
  } catch (error) {
    console.log(
      `[ComfyUI] unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
} else {
  console.log("[ComfyUI] URL missing");
}

try {
  const localResponse = await fetch(
    "http://127.0.0.1:3000/api/generate/statue",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(5000),
    },
  );
  console.log(`[Local API unauthenticated] HTTP ${localResponse.status}`);
  console.log(
    `[Local API unauthenticated] ${JSON.stringify(await readJson(localResponse)).slice(0, 800)}`,
  );
} catch (error) {
  console.log(
    `[Local API] unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
  );
}
