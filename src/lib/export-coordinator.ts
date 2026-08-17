export class ExportConcurrencyGate {
  private readonly activeByOwner = new Map<string, number>();

  constructor(private readonly maximumPerOwner: number) {
    if (!Number.isInteger(maximumPerOwner) || maximumPerOwner < 1) {
      throw new Error("Export concurrency limit must be a positive integer.");
    }
  }

  reserve(ownerId: string): boolean {
    const active = this.activeByOwner.get(ownerId) ?? 0;
    if (active >= this.maximumPerOwner) {
      return false;
    }
    this.activeByOwner.set(ownerId, active + 1);
    return true;
  }

  release(ownerId: string): void {
    const active = this.activeByOwner.get(ownerId) ?? 0;
    if (active <= 1) {
      this.activeByOwner.delete(ownerId);
      return;
    }
    this.activeByOwner.set(ownerId, active - 1);
  }

  active(ownerId: string): number {
    return this.activeByOwner.get(ownerId) ?? 0;
  }
}

export interface ExportDeadline {
  cancel: () => void;
}

export function createExportDeadline(
  timeoutMs: number,
  onTimeout: () => void,
): ExportDeadline {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Export timeout must be positive.");
  }
  const timeout = setTimeout(onTimeout, timeoutMs);
  return {
    cancel() {
      clearTimeout(timeout);
    },
  };
}
