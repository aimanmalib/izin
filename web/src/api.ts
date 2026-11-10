// Calls to the Izin API. Types come from the server code so the page and the receipt agree.
import type { Action } from "../../server/config";
import type { Receipt } from "../../server/resit/receipt";
import type { SiteView } from "../../server/web/site";

export type { Action, Receipt, SiteView };
export type JobStatus = "queued" | "running" | "done" | "error";

export interface CheckBody {
  url: string;
  action: Action;
  detail?: string;
  terms_text?: string;
  agent?: string;
}

export type SubmitAnswer =
  | { kind: "accepted"; id: string; status: JobStatus; cached: boolean; no_refetch?: boolean }
  | { kind: "invalid"; code: string }
  | { kind: "rate_limited"; retry_after_s: number; scope: "ip" | "day" }
  | { kind: "budget"; cached_id: string | null }
  | { kind: "network" };

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

export const getSite = () => getJson<SiteView>("/api/site");
export const getHealth = () => getJson<{ ok: boolean; cache_only: boolean }>("/api/health");
export const getGallery = () =>
  getJson<{ sites: { host: string; checks: Partial<Record<Action, { verdict: Receipt["verdict"] | null; receipt_id: string }>> }[] }>("/api/gallery");

export async function getReceipt(id: string): Promise<{ status: JobStatus; receipt?: Receipt } | "not_found" | null> {
  try {
    const res = await fetch(`/api/receipt/${encodeURIComponent(id)}`, { headers: { accept: "application/json" } });
    if (res.status === 404) return "not_found";
    if (!res.ok) return null;
    return (await res.json()) as { status: JobStatus; receipt?: Receipt };
  } catch {
    return null;
  }
}

export async function submitCheck(body: CheckBody): Promise<SubmitAnswer> {
  let res: Response;
  try {
    res = await fetch("/api/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { kind: "network" };
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 202) return { kind: "accepted", ...(data as { id: string; status: JobStatus; cached: boolean; no_refetch?: boolean }) };
  if (res.status === 400) return { kind: "invalid", code: String(data.error ?? "invalid_url") };
  if (res.status === 429) return { kind: "rate_limited", retry_after_s: Number(data.retry_after_s ?? 60), scope: data.scope === "day" ? "day" : "ip" };
  if (res.status === 503) return { kind: "budget", cached_id: typeof data.cached_id === "string" ? data.cached_id : null };
  return { kind: "network" };
}
