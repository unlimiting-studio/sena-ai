import * as fs from "node:fs/promises";
import * as path from "node:path";

import { z } from "zod";

const STORE_VERSION = 1;

const PersistedThreadSessionSchema = z.object({
  sessionId: z.string().min(1),
  updatedAt: z.number().int().nonnegative(),
});

const PersistedStoreSchema = z.object({
  version: z.literal(STORE_VERSION),
  updatedAt: z.number().int().nonnegative(),
  sessions: z.record(z.string(), PersistedThreadSessionSchema),
});

type PersistedStore = z.infer<typeof PersistedStoreSchema>;

type ThreadSessionEntry = {
  sessionId: string;
  updatedAt: number;
};

const toNonEmptyTrimmedString = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeThreadKey = (threadKey: string): string | null => toNonEmptyTrimmedString(threadKey);

export class SlackThreadSessionStore {
  private readonly filePath: string;
  private readonly ttlMs: number | null;

  private loaded = false;
  private loadPromise: Promise<void> | null = null;

  private sessions = new Map<string, ThreadSessionEntry>();

  private flushTimer: NodeJS.Timeout | null = null;
  private flushInFlight: Promise<void> | null = null;
  private dirty = false;

  constructor(options: { filePath: string; ttlMs?: number | null }) {
    this.filePath = options.filePath;
    this.ttlMs = options.ttlMs ?? null;
  }

  async get(threadKey: string): Promise<string | null> {
    const normalizedKey = normalizeThreadKey(threadKey);
    if (!normalizedKey) {
      return null;
    }

    await this.ensureLoaded();

    const entry = this.sessions.get(normalizedKey);
    if (!entry) {
      return null;
    }

    if (this.isExpired(entry)) {
      this.sessions.delete(normalizedKey);
      this.markDirty();
      return null;
    }

    return entry.sessionId;
  }

  async set(threadKey: string, sessionId: string): Promise<void> {
    const normalizedKey = normalizeThreadKey(threadKey);
    const normalizedSessionId = toNonEmptyTrimmedString(sessionId);
    if (!normalizedKey || !normalizedSessionId) {
      return;
    }

    await this.ensureLoaded();

    const existing = this.sessions.get(normalizedKey);
    if (existing?.sessionId === normalizedSessionId) {
      existing.updatedAt = Date.now();
      this.markDirty();
      return;
    }

    this.sessions.set(normalizedKey, { sessionId: normalizedSessionId, updatedAt: Date.now() });
    this.markDirty();
  }

  async delete(threadKey: string): Promise<void> {
    const normalizedKey = normalizeThreadKey(threadKey);
    if (!normalizedKey) {
      return;
    }

    await this.ensureLoaded();

    if (!this.sessions.delete(normalizedKey)) {
      return;
    }
    this.markDirty();
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    if (!this.loadPromise) {
      this.loadPromise = this.loadFromDisk().finally(() => {
        this.loaded = true;
        this.loadPromise = null;
      });
    }
    await this.loadPromise;
  }

  private isExpired(entry: ThreadSessionEntry): boolean {
    if (this.ttlMs === null) {
      return false;
    }
    return Date.now() - entry.updatedAt > this.ttlMs;
  }

  private markDirty(): void {
    this.dirty = true;
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush().catch(() => undefined);
    }, 250);
    this.flushTimer.unref?.();
  }

  private async flush(): Promise<void> {
    await this.ensureLoaded();

    if (!this.dirty) {
      return;
    }

    if (this.flushInFlight) {
      await this.flushInFlight;
      return;
    }

    this.dirty = false;
    this.flushInFlight = this.writeToDisk().finally(() => {
      this.flushInFlight = null;
    });
    await this.flushInFlight;
  }

  private async loadFromDisk(): Promise<void> {
    let rawFile: string;
    try {
      rawFile = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      const code = this.getErrnoCode(error);
      if (code === "ENOENT") {
        return;
      }
      return;
    }

    let rawJson: unknown;
    try {
      rawJson = JSON.parse(rawFile);
    } catch {
      return;
    }

    const parsed = PersistedStoreSchema.safeParse(rawJson);
    if (!parsed.success) {
      return;
    }

    const now = Date.now();
    for (const [threadKey, entry] of Object.entries(parsed.data.sessions)) {
      if (this.ttlMs !== null && now - entry.updatedAt > this.ttlMs) {
        continue;
      }
      this.sessions.set(threadKey, { sessionId: entry.sessionId, updatedAt: entry.updatedAt });
    }
  }

  private async writeToDisk(): Promise<void> {
    const now = Date.now();
    const sessions: PersistedStore["sessions"] = {};

    for (const [threadKey, entry] of this.sessions.entries()) {
      if (this.isExpired(entry)) {
        continue;
      }
      sessions[threadKey] = {
        sessionId: entry.sessionId,
        updatedAt: entry.updatedAt,
      };
    }

    const payload: PersistedStore = {
      version: STORE_VERSION,
      updatedAt: now,
      sessions,
    };

    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(payload), "utf8");
    } catch {
      return;
    }
  }

  private getErrnoCode(error: unknown): string | null {
    if (!(error instanceof Error)) {
      return null;
    }
    const maybeError = error as Error & { code?: unknown };
    return typeof maybeError.code === "string" ? maybeError.code : null;
  }
}
