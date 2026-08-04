export interface HistoryCommand<T> {
  readonly label: string;
  execute(state: T): T;
  undo(state: T): T;
}

export interface HistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface HistoryManagerOptions {
  maxStates?: number;
  debounceMs?: number;
  storageKey?: string;
  storage?: HistoryStorage | null;
  now?: () => number;
}

export interface ExecuteHistoryOptions {
  debounceKey?: string;
}

interface HistoryEntry<T> {
  command: SnapshotCommand<T>;
  debounceKey?: string;
  timestamp: number;
}

interface StoredEntry<T> {
  label: string;
  before: T;
  after: T;
  debounceKey?: string;
  timestamp: number;
}

interface StoredHistory<T> {
  present: T;
  past: StoredEntry<T>[];
  future: StoredEntry<T>[];
}

export class SnapshotCommand<T> implements HistoryCommand<T> {
  constructor(
    public readonly label: string,
    public readonly before: T,
    public readonly after: T,
  ) {}

  execute(): T {
    return this.after;
  }

  undo(): T {
    return this.before;
  }
}

function getSessionStorage(): HistoryStorage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isStoredHistory<T>(value: unknown): value is StoredHistory<T> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<StoredHistory<T>>;
  return (
    "present" in candidate &&
    Array.isArray(candidate.past) &&
    Array.isArray(candidate.future)
  );
}

function hydrateEntry<T>(entry: StoredEntry<T>): HistoryEntry<T> {
  return {
    command: new SnapshotCommand(entry.label, entry.before, entry.after),
    debounceKey: entry.debounceKey,
    timestamp: entry.timestamp,
  };
}

function serializeEntry<T>(entry: HistoryEntry<T>): StoredEntry<T> {
  return {
    label: entry.command.label,
    before: entry.command.before,
    after: entry.command.after,
    debounceKey: entry.debounceKey,
    timestamp: entry.timestamp,
  };
}

export class HistoryManager<T> {
  private readonly maxStates: number;
  private readonly debounceMs: number;
  private readonly storageKey?: string;
  private readonly storage: HistoryStorage | null;
  private readonly now: () => number;
  private past: HistoryEntry<T>[] = [];
  private future: HistoryEntry<T>[] = [];
  private present: T;

  constructor(initialState: T, options: HistoryManagerOptions = {}) {
    this.maxStates = Math.max(1, options.maxStates ?? 50);
    this.debounceMs = Math.max(0, options.debounceMs ?? 250);
    this.storageKey = options.storageKey;
    this.storage =
      options.storage === undefined ? getSessionStorage() : options.storage;
    this.now = options.now ?? Date.now;
    this.present = initialState;
    this.restore();
  }

  get state(): T {
    return this.present;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoDepth(): number {
    return this.past.length;
  }

  execute(command: HistoryCommand<T>, options: ExecuteHistoryOptions = {}): T {
    const before = this.present;
    const after = command.execute(before);

    if (Object.is(before, after)) {
      return this.present;
    }

    const timestamp = this.now();
    const previous = this.past.at(-1);
    if (
      previous &&
      options.debounceKey !== undefined &&
      previous.debounceKey === options.debounceKey &&
      timestamp - previous.timestamp <= this.debounceMs
    ) {
      previous.command = new SnapshotCommand(
        previous.command.label,
        previous.command.before,
        after,
      );
      previous.timestamp = timestamp;
    } else {
      this.past.push({
        command: new SnapshotCommand(command.label, before, after),
        debounceKey: options.debounceKey,
        timestamp,
      });

      if (this.past.length > this.maxStates) {
        this.past.splice(0, this.past.length - this.maxStates);
      }
    }

    this.present = after;
    this.future = [];
    this.persist();
    return this.present;
  }

  undo(): T {
    const entry = this.past.pop();
    if (!entry) {
      return this.present;
    }

    this.present = entry.command.undo();
    this.future.push(entry);
    this.persist();
    return this.present;
  }

  redo(): T {
    const entry = this.future.pop();
    if (!entry) {
      return this.present;
    }

    this.present = entry.command.execute();
    this.past.push(entry);
    this.persist();
    return this.present;
  }

  replacePresent(state: T, clearFuture = true): void {
    this.present = state;
    if (clearFuture) {
      this.future = [];
    }
    this.persist();
  }

  reset(state: T): void {
    this.present = state;
    this.past = [];
    this.future = [];
    this.persist();
  }

  clearRecovery(): void {
    if (!this.storage || !this.storageKey) {
      return;
    }

    try {
      this.storage.removeItem(this.storageKey);
    } catch {
      // Storage can be unavailable in privacy mode; history remains in memory.
    }
  }

  private restore(): void {
    if (!this.storage || !this.storageKey) {
      return;
    }

    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) {
        return;
      }

      const stored: unknown = JSON.parse(raw);
      if (!isStoredHistory<T>(stored)) {
        return;
      }

      this.present = stored.present;
      this.past = stored.past.slice(-this.maxStates).map(hydrateEntry);
      this.future = stored.future.slice(-this.maxStates).map(hydrateEntry);
    } catch {
      this.clearRecovery();
    }
  }

  private persist(): void {
    if (!this.storage || !this.storageKey) {
      return;
    }

    const stored: StoredHistory<T> = {
      present: this.present,
      past: this.past.map(serializeEntry),
      future: this.future.map(serializeEntry),
    };

    try {
      this.storage.setItem(this.storageKey, JSON.stringify(stored));
    } catch {
      // A full session store must not interrupt an active editing session.
    }
  }
}
