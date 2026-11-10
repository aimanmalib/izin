// SQLite storage for checks, fetched documents, reader extractions, daily spend and the gallery.
// Document text stays on the server: no route serves the docs table.
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import type { DocReading } from "../baca/reader.js";
import type { PolicyDoc } from "../kumpul/types.js";
import { receiptHash, type Receipt } from "./receipt.js";

export type CheckSource = "web" | "api" | "mcp" | "gallery" | "bench" | "cli";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS checks (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, site TEXT NOT NULL, url TEXT NOT NULL, action TEXT NOT NULL,
  detail TEXT, source TEXT NOT NULL, status TEXT NOT NULL, verdict TEXT, receipt_json TEXT, receipt_sha256 TEXT,
  cost_usd REAL, ms_total INTEGER, origin TEXT, agent TEXT, pasted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS checks_lookup ON checks (site, url, action, created_at);
CREATE INDEX IF NOT EXISTS checks_origin ON checks (origin, action, created_at);
CREATE TABLE IF NOT EXISTS docs (
  sha256 TEXT PRIMARY KEY, url TEXT NOT NULL, fetched_at TEXT NOT NULL, status TEXT NOT NULL, bytes INTEGER NOT NULL,
  kind TEXT NOT NULL, text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS extractions (
  doc_sha256 TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, prompt_version TEXT NOT NULL,
  result_json TEXT NOT NULL, tokens_in INTEGER, tokens_out INTEGER, cost_usd REAL, ms INTEGER,
  PRIMARY KEY (doc_sha256, provider, model, prompt_version)
);
CREATE TABLE IF NOT EXISTS budget (day TEXT PRIMARY KEY, serv_usd REAL NOT NULL DEFAULT 0, dolphin_usd REAL NOT NULL DEFAULT 0, new_checks INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS gallery (site TEXT NOT NULL, action TEXT NOT NULL, check_id TEXT NOT NULL, updated_at TEXT NOT NULL, changed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (site, action));
`;

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  return db;
}

export class ReceiptStore {
  constructor(readonly db: Database.Database) {
    db.exec(SCHEMA);
  }

  /** Stores a finished receipt; a row queued earlier under the same id keeps its source and agent. */
  saveCheck(r: Receipt, source: CheckSource, agent: string | null = null): void {
    this.db
      .prepare(
        `INSERT INTO checks (id, created_at, site, url, action, detail, source, status, verdict, receipt_json, receipt_sha256, cost_usd, ms_total, origin, agent, pasted)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'done', ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = 'done', verdict = excluded.verdict, receipt_json = excluded.receipt_json,
           receipt_sha256 = excluded.receipt_sha256, cost_usd = excluded.cost_usd, ms_total = excluded.ms_total`,
      )
      .run(
        r.id, r.created_at, r.site, r.url, r.action, r.detail, source, r.verdict, JSON.stringify(r), r.receipt_sha256,
        r.totals.cost_usd_estimated, r.totals.ms, new URL(r.url).origin.toLowerCase(), agent, r.signals.mode === "paste" ? 1 : 0,
      );
  }

  /** The stored receipt, or null. A receipt whose hash no longer matches its JSON is not served. */
  getReceipt(id: string): Receipt | null {
    const row = this.db.prepare<[string], { receipt_json: string | null }>("SELECT receipt_json FROM checks WHERE id = ? AND status = 'done'").get(id);
    if (!row?.receipt_json) return null;
    const r = JSON.parse(row.receipt_json) as Receipt;
    return receiptHash(r) === r.receipt_sha256 ? r : null;
  }

  /** Points a gallery cell at a new receipt; `changed` marks a verdict that differs from the cell's previous one. */
  saveGallery(site: string, action: string, checkId: string, at: string): { changed: boolean } {
    const prev = this.db
      .prepare<[string, string], { verdict: string | null }>("SELECT c.verdict FROM gallery g JOIN checks c ON c.id = g.check_id WHERE g.site = ? AND g.action = ?")
      .get(site, action);
    const now = this.db.prepare<[string], { verdict: string | null }>("SELECT verdict FROM checks WHERE id = ?").get(checkId);
    const changed = Boolean(prev?.verdict && now?.verdict && prev.verdict !== now.verdict);
    this.db
      .prepare(
        `INSERT INTO gallery (site, action, check_id, updated_at, changed) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(site, action) DO UPDATE SET check_id = excluded.check_id, updated_at = excluded.updated_at, changed = excluded.changed`,
      )
      .run(site, action, checkId, at, changed ? 1 : 0);
    return { changed };
  }

  saveDocs(docs: PolicyDoc[], fetchedAt: string): void {
    const stmt = this.db.prepare("INSERT OR IGNORE INTO docs (sha256, url, fetched_at, status, bytes, kind, text) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const d of docs) stmt.run(sha256(d.text), d.url, fetchedAt, d.state, Buffer.byteLength(d.text), d.kind, d.text);
  }

  saveExtractions(docs: { id: string; text: string }[], readings: DocReading[], promptVersion: string): void {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO extractions (doc_sha256, provider, model, prompt_version, result_json, tokens_in, tokens_out, cost_usd, ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const r of readings) {
      const doc = docs.find((d) => d.id === r.doc_id);
      const ok = [...r.attempts].reverse().find((a) => a.outcome === "ok");
      if (!doc || !r.output || !ok || r.cached) continue;
      stmt.run(sha256(doc.text), ok.provider, ok.model, promptVersion, JSON.stringify(r.output), ok.input_tokens, ok.output_tokens, r.cost_usd, r.attempts.reduce((s, a) => s + a.ms, 0));
    }
  }
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
