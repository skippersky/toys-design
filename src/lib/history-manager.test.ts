import { describe, expect, it } from "vitest";

import {
  HistoryManager,
  type HistoryStorage,
  SnapshotCommand,
} from "@/lib/history-manager";

class MemoryStorage implements HistoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("HistoryManager", () => {
  it("coalesces rapid transforms into one undo entry", () => {
    let time = 0;
    const history = new HistoryManager(
      { x: 0, metadata: { stable: true } },
      {
        debounceMs: 250,
        storage: null,
        now: () => time,
      },
    );

    history.execute(
      new SnapshotCommand("Move", history.state, {
        ...history.state,
        x: 10,
      }),
      { debounceKey: "transform:layer-1" },
    );
    time = 100;
    history.execute(
      new SnapshotCommand("Move", history.state, {
        ...history.state,
        x: 20,
      }),
      { debounceKey: "transform:layer-1" },
    );

    expect(history.undoDepth).toBe(1);
    expect(history.undo().x).toBe(0);
    expect(history.redo().x).toBe(20);
  });

  it("caps history while preserving structural sharing", () => {
    const shared = { untouched: true };
    const history = new HistoryManager(
      { value: 0, shared },
      { maxStates: 3, storage: null },
    );

    for (let value = 1; value <= 5; value += 1) {
      history.execute(
        new SnapshotCommand("Increment", history.state, {
          value,
          shared: history.state.shared,
        }),
      );
    }

    expect(history.undoDepth).toBe(3);
    expect(history.state.shared).toBe(shared);
    expect(history.undo().value).toBe(4);
    expect(history.undo().value).toBe(3);
    expect(history.undo().value).toBe(2);
    expect(history.undo().value).toBe(2);
  });

  it("restores undo and redo state from session storage", () => {
    const storage = new MemoryStorage();
    const first = new HistoryManager(
      { value: 0 },
      { storage, storageKey: "editor" },
    );
    first.execute(new SnapshotCommand("Change", first.state, { value: 1 }));
    first.execute(new SnapshotCommand("Change", first.state, { value: 2 }));
    first.undo();

    const restored = new HistoryManager(
      { value: -1 },
      { storage, storageKey: "editor" },
    );

    expect(restored.state.value).toBe(1);
    expect(restored.canUndo).toBe(true);
    expect(restored.canRedo).toBe(true);
    expect(restored.redo().value).toBe(2);
  });
});
