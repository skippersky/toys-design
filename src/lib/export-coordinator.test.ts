import { describe, expect, it, vi } from "vitest";

import {
  createExportDeadline,
  ExportConcurrencyGate,
} from "@/lib/export-coordinator";

describe("export coordinator", () => {
  it("isolates owners and permits at most two active exports each", () => {
    const gate = new ExportConcurrencyGate(2);

    expect(gate.reserve("user-a")).toBe(true);
    expect(gate.reserve("user-a")).toBe(true);
    expect(gate.reserve("user-a")).toBe(false);
    expect(gate.reserve("user-b")).toBe(true);
    expect(gate.active("user-a")).toBe(2);
    expect(gate.active("user-b")).toBe(1);

    gate.release("user-a");
    expect(gate.reserve("user-a")).toBe(true);
  });

  it("fires a deadline once and supports graceful cancellation", () => {
    vi.useFakeTimers();
    const timedOut = vi.fn();
    createExportDeadline(60_000, timedOut);
    vi.advanceTimersByTime(60_000);
    expect(timedOut).toHaveBeenCalledTimes(1);

    const cancelled = vi.fn();
    const deadline = createExportDeadline(60_000, cancelled);
    deadline.cancel();
    vi.advanceTimersByTime(60_000);
    expect(cancelled).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
