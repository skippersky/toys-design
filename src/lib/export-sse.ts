import type { ExportProgressStatus, ExportSseEvent } from "@/types/export";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProgressStatus(value: unknown): value is ExportProgressStatus {
  return (
    value === "processing" ||
    value === "rendering" ||
    value === "packaging" ||
    value === "uploading"
  );
}

export function parseExportSseBlock(block: string): ExportSseEvent | null {
  const lines = block.split("\n");
  const event = lines
    .find((line) => line.startsWith("event: "))
    ?.slice("event: ".length);
  const dataLine = lines
    .find((line) => line.startsWith("data: "))
    ?.slice("data: ".length);
  if (!event || !dataLine) {
    return null;
  }

  let data: unknown;
  try {
    data = JSON.parse(dataLine);
  } catch {
    return null;
  }
  if (!isRecord(data)) {
    return null;
  }

  if (event === "progress" && isProgressStatus(data.status)) {
    return { event, data: { status: data.status } };
  }
  if (
    event === "complete" &&
    typeof data.downloadUrl === "string" &&
    typeof data.expiresAt === "string"
  ) {
    return {
      event,
      data: { downloadUrl: data.downloadUrl, expiresAt: data.expiresAt },
    };
  }
  if (
    event === "error" &&
    data.code === "EXPORT_FAILED" &&
    typeof data.message === "string"
  ) {
    return {
      event,
      data: { code: "EXPORT_FAILED", message: data.message },
    };
  }
  return null;
}

export async function readExportSse(
  response: Response,
  onEvent: (event: ExportSseEvent) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Export response did not include an SSE stream.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;
  while (!done) {
    const chunk = await reader.read();
    done = chunk.done;
    buffer += decoder.decode(chunk.value, { stream: !done });

    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const event = parseExportSseBlock(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      if (event) {
        onEvent(event);
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}
