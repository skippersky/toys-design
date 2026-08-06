import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";

function assertSafeTemporaryDirectory(path: string): void {
  const resolved = resolve(/* turbopackIgnore: true */ path);
  if (
    dirname(resolved) !== resolve(tmpdir()) ||
    !basename(resolved).startsWith("statueforge-export-")
  ) {
    throw new Error("Refusing to clean an unexpected export directory.");
  }
}

export async function removeExportTemporaryDirectory(
  path: string,
): Promise<void> {
  assertSafeTemporaryDirectory(path);
  await rm(/* turbopackIgnore: true */ path, {
    recursive: true,
    force: true,
  });
}
