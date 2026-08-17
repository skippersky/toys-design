"use client";

import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import { saveEditorDocument } from "@/lib/editor-project-client";
import { ensureAnonymousSession } from "@/lib/supabase/anonymous-auth";
import type { EditorLayer, ImageLayer } from "@/store/editor-store";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 300;

interface ImageDimensions {
  width: number;
  height: number;
}

export interface ImagePlacement extends ImageDimensions {
  x: number;
  y: number;
}

export interface UploadProjectImageOptions {
  file: File;
  projectId: string;
  assetId: string;
  existingLayers: readonly EditorLayer[];
  documentWidth: number;
  documentHeight: number;
}

export interface UploadProjectImageResult {
  layer: ImageLayer;
  storagePath: string;
  userId: string;
}

export function getImageExtension(mimeType: string): string | null {
  switch (mimeType) {
    case "image/avif":
      return "avif";
    case "image/gif":
      return "gif";
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return null;
  }
}

export function calculateImagePlacement(
  image: ImageDimensions,
  document: ImageDimensions,
): ImagePlacement {
  const scale = Math.min(
    1,
    (document.width * 0.8) / image.width,
    (document.height * 0.8) / image.height,
  );
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  return {
    width,
    height,
    x: Math.round((document.width - width) / 2),
    y: Math.round((document.height - height) / 2),
  };
}

async function readImageDimensions(file: File): Promise<ImageDimensions> {
  if ("createImageBitmap" in window) {
    const bitmap = await createImageBitmap(file);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise<ImageDimensions>((resolve, reject) => {
      const image = new window.Image();
      image.addEventListener(
        "load",
        () => {
          resolve({ width: image.naturalWidth, height: image.naturalHeight });
        },
        { once: true },
      );
      image.addEventListener(
        "error",
        () => {
          reject(new Error("无法读取所选图片。"));
        },
        { once: true },
      );
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function validateImage(file: File): string {
  const extension = getImageExtension(file.type);
  if (!extension) {
    throw new Error("仅支持 PNG、JPEG、WebP、GIF 或 AVIF 图片。 ");
  }
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
    throw new Error("图片必须小于 25 MB。 ");
  }
  return extension;
}

async function getAuthenticatedUserId(): Promise<{
  client: ReturnType<typeof createSupabaseClient>;
  userId: string;
}> {
  const client = createSupabaseClient();
  const { userId } = await ensureAnonymousSession(client.auth);

  return { client, userId };
}

export async function uploadProjectImage({
  file,
  projectId,
  assetId,
  existingLayers,
  documentWidth,
  documentHeight,
}: UploadProjectImageOptions): Promise<UploadProjectImageResult> {
  const extension = validateImage(file);
  const dimensions = await readImageDimensions(file);
  const placement = calculateImagePlacement(dimensions, {
    width: documentWidth,
    height: documentHeight,
  });
  const { client, userId } = await getAuthenticatedUserId();
  const storagePath = `${userId}/${projectId}/${crypto.randomUUID()}.${extension}`;

  const uploadResult = await client.storage
    .from("assets")
    .upload(storagePath, file, {
      cacheControl: "300",
      contentType: file.type,
      upsert: false,
    });
  if (uploadResult.error) {
    const bucketMissing = uploadResult.error.message
      .toLowerCase()
      .includes("bucket");
    throw new Error(
      bucketMissing
        ? "assets 存储桶不存在。请先执行 supabase/migrations 中的项目迁移。"
        : `图片上传失败：${uploadResult.error.message}`,
    );
  }

  const signedUrlResult = await client.storage
    .from("assets")
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (signedUrlResult.error) {
    await client.storage.from("assets").remove([storagePath]);
    throw new Error(`无法创建图片预览地址：${signedUrlResult.error.message}`);
  }

  const layer: ImageLayer = {
    id: crypto.randomUUID(),
    type: "image",
    name: file.name || "Imported image",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    src: signedUrlResult.data.signedUrl,
    thumbnailSrc: signedUrlResult.data.signedUrl,
    originalWidth: dimensions.width,
    originalHeight: dimensions.height,
  };

  try {
    await saveEditorDocument({
      projectId,
      assetId,
      layers: [...existingLayers, layer],
      layerStorageKeys: { [layer.id]: storagePath },
    });
  } catch (error) {
    await client.storage.from("assets").remove([storagePath]);
    throw error;
  }

  return {
    storagePath,
    userId,
    layer,
  };
}
