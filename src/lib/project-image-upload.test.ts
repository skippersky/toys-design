import { describe, expect, it } from "vitest";

import {
  calculateImagePlacement,
  getImageExtension,
} from "@/lib/project-image-upload";

describe("project image upload helpers", () => {
  it("maps supported MIME types without trusting the filename", () => {
    expect(getImageExtension("image/jpeg")).toBe("jpg");
    expect(getImageExtension("image/png")).toBe("png");
    expect(getImageExtension("image/svg+xml")).toBeNull();
  });

  it("centers and scales oversized images within the document", () => {
    expect(
      calculateImagePlacement(
        { width: 8000, height: 4000 },
        { width: 4000, height: 2000 },
      ),
    ).toEqual({ width: 3200, height: 1600, x: 400, y: 200 });
  });
});
