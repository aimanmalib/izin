// Reader cache: (sha256 of the document text, provider, model, prompt version) -> reader output.
// Entries do not expire: the same text read by the same model and prompt gives the same evidence.
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { ReaderOutput } from "./types.js";

export interface CachedReading {
  output: ReaderOutput;
  reader: string;
}

export interface ReaderCache {
  get(key: string): CachedReading | undefined;
  set(key: string, value: CachedReading): void;
}

export function cacheKey(text: string, provider: string, model: string, prompt: string): string {
  const sha = createHash("sha256").update(text).digest("hex");
  return `${sha}|${provider}|${model}|${prompt}`;
}

export class MemoryReaderCache implements ReaderCache {
  private readonly map = new Map<string, CachedReading>();
  get(key: string) {
    return this.map.get(key);
  }
  set(key: string, value: CachedReading) {
    this.map.set(key, value);
  }
}

export class SqliteReaderCache implements ReaderCache {
  private readonly getStmt;
  private readonly setStmt;
  constructor(db: Database.Database) {
    db.exec("CREATE TABLE IF NOT EXISTS reader_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at TEXT NOT NULL)");
    this.getStmt = db.prepare<[string], { value: string }>("SELECT value FROM reader_cache WHERE key = ?");
    this.setStmt = db.prepare("INSERT OR REPLACE INTO reader_cache (key, value, created_at) VALUES (?, ?, ?)");
  }
  get(key: string) {
    const row = this.getStmt.get(key);
    return row ? (JSON.parse(row.value) as CachedReading) : undefined;
  }
  set(key: string, value: CachedReading) {
    this.setStmt.run(key, JSON.stringify(value), new Date().toISOString());
  }
}
