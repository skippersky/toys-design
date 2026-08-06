import sharp from "sharp";

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => {
    const entities: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      '"': "&quot;",
      "'": "&apos;",
    };
    return entities[character] ?? "";
  });
}

/** Preview-only utility. Never pass a master export artifact to this function. */
export async function addPreviewWatermark(
  image: Buffer,
  userId: string,
  timestamp: string,
): Promise<Buffer> {
  const metadata = await sharp(image).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Preview dimensions are unavailable.");
  }

  const width = metadata.width;
  const height = metadata.height;
  const text = escapeXml(`${userId} | ${timestamp}`);
  const overlay = Buffer.from(`
    <svg width="${String(width)}" height="${String(height)}" xmlns="http://www.w3.org/2000/svg">
      <g transform="rotate(-30 ${String(width / 2)} ${String(height / 2)})">
        <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"
          font-family="Inter, Arial, sans-serif" font-size="48" font-weight="700"
          fill="rgba(255,255,255,0.3)">${text}</text>
      </g>
    </svg>
  `);

  return sharp(image)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .png()
    .toBuffer();
}
