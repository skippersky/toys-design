import { readFile } from "node:fs/promises";

import { createClient } from "@supabase/supabase-js";

/**
 * @param {string} source
 * @returns {Record<string, string | undefined>}
 */
function parseLocalEnvironment(source) {
  /** @type {Record<string, string | undefined>} */
  const parsed = {};
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    const key = separator < 0 ? line : line.slice(0, separator);
    const rawValue = separator < 0 ? "" : line.slice(separator + 1).trim();
    const isQuoted =
      rawValue.length >= 2 &&
      ((rawValue.startsWith('"') && rawValue.endsWith('"')) ||
        (rawValue.startsWith("'") && rawValue.endsWith("'")));
    parsed[key] = isQuoted ? rawValue.slice(1, -1) : rawValue;
  }
  return parsed;
}

const localEnvironment = parseLocalEnvironment(
  await readFile(new URL(".env.local", import.meta.url), "utf8"),
);
const url = localEnvironment.NEXT_PUBLIC_SUPABASE_URL;
const key =
  localEnvironment.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  localEnvironment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) {
  throw new Error(
    ".env.local does not contain the public Supabase credentials.",
  );
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const signIn = await supabase.auth.signInAnonymously();
if (signIn.error || !signIn.data.user) {
  throw new Error(signIn.error?.message ?? "Anonymous sign-in failed.");
}

const attempts = await Promise.all(
  Array.from({ length: 20 }, () =>
    supabase.rpc("decrement_credits", {
      p_user_id: signIn.data.user.id,
      p_amount: 1,
    }),
  ),
);
const errors = attempts.flatMap((attempt) =>
  attempt.error ? [attempt.error.message] : [],
);
if (errors.length > 0) {
  throw new Error(`Credit RPC failed: ${errors[0]}`);
}
const successes = attempts.filter((attempt) => attempt.data === true).length;
const rejected = attempts.filter((attempt) => attempt.data === false).length;
console.log(`[Profile Verify] anonymous user: ${signIn.data.user.id}`);
console.log(`[Credit Verify] concurrent attempts: ${String(attempts.length)}`);
console.log(`[Credit Verify] successful deductions: ${String(successes)}`);
console.log(
  `[Credit Verify] insufficient-credit rejections: ${String(rejected)}`,
);
if (successes !== 10 || rejected !== 10) {
  throw new Error(
    "Concurrent credit deduction did not preserve the 10-credit limit.",
  );
}
