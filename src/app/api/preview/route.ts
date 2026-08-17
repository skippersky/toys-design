import { NextResponse, type NextRequest } from "next/server";

import { consumeRateLimit } from "@/lib/rate-limit";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { addPreviewWatermark } from "@/lib/watermark";

export const runtime = "nodejs";

const MAX_PREVIEW_BYTES = 25 * 1024 * 1024;
const PREVIEW_TTL_SECONDS = 300;
const PREVIEW_RATE_LIMIT = 20;
const PREVIEW_RATE_WINDOW_MS = 60_000;
const ACCEPTED_CONTENT_TYPES = new Set([
  "image/avif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function errorResponse(status: number, message: string) {
  return NextResponse.json({ code: "PREVIEW_FAILED", message }, { status });
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return errorResponse(401, "Authentication is required.");
  }

  const rateLimit = consumeRateLimit(
    `preview:${user.id}`,
    PREVIEW_RATE_LIMIT,
    PREVIEW_RATE_WINDOW_MS,
  );
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { code: "PREVIEW_FAILED", message: "Too many preview requests." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  const contentType = request.headers.get("content-type")?.split(";", 1)[0];
  if (!contentType || !ACCEPTED_CONTENT_TYPES.has(contentType)) {
    return errorResponse(415, "A supported preview image is required.");
  }

  const source = Buffer.from(await request.arrayBuffer());
  if (source.byteLength === 0 || source.byteLength > MAX_PREVIEW_BYTES) {
    return errorResponse(413, "Preview image must be between 1 byte and 25MB.");
  }

  const timestamp = new Date().toISOString();
  let preview: Buffer;
  try {
    preview = await addPreviewWatermark(source, user.id, timestamp);
  } catch {
    return errorResponse(422, "Preview image could not be decoded.");
  }

  const storagePath = `${user.id}/previews/${crypto.randomUUID()}.png`;
  const upload = await supabase.storage
    .from("assets")
    .upload(storagePath, preview, {
      contentType: "image/png",
      cacheControl: String(PREVIEW_TTL_SECONDS),
      upsert: false,
    });
  if (upload.error) {
    return errorResponse(500, "Watermarked preview could not be stored.");
  }

  const signed = await supabase.storage
    .from("assets")
    .createSignedUrl(storagePath, PREVIEW_TTL_SECONDS);
  if (signed.error) {
    await supabase.storage.from("assets").remove([storagePath]);
    return errorResponse(500, "Watermarked preview could not be signed.");
  }

  return NextResponse.json({
    previewUrl: signed.data.signedUrl,
    expiresIn: PREVIEW_TTL_SECONDS,
    timestamp,
  });
}
