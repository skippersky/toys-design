import { describe, expect, it } from "vitest";

import { parseExportSseBlock } from "@/lib/export-sse";

describe("parseExportSseBlock", () => {
  it("parses progress, completion and errors strictly", () => {
    expect(
      parseExportSseBlock('event: progress\ndata: {"status":"uploading"}'),
    ).toEqual({ event: "progress", data: { status: "uploading" } });
    expect(
      parseExportSseBlock(
        'event: complete\ndata: {"downloadUrl":"https://signed","expiresAt":"2026-08-04T12:05:00Z"}',
      ),
    ).toEqual({
      event: "complete",
      data: {
        downloadUrl: "https://signed",
        expiresAt: "2026-08-04T12:05:00Z",
      },
    });
    expect(
      parseExportSseBlock(
        'event: error\ndata: {"code":"EXPORT_FAILED","message":"Nope"}',
      ),
    ).toEqual({
      event: "error",
      data: { code: "EXPORT_FAILED", message: "Nope" },
    });
    expect(
      parseExportSseBlock('event: progress\ndata: {"status":"unexpected"}'),
    ).toBeNull();
  });
});
