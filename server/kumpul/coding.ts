// Content codings: a body sent as gzip, deflate or br is decoded before anything else reads it.
// The size cap that applies to the bytes received applies again to the decoded bytes, so a small
// compressed body cannot grow without bound.
import { createBrotliDecompress, createGunzip, createInflate, createInflateRaw } from "node:zlib";

export type Coding = "gzip" | "deflate" | "br";

const CODINGS: Readonly<Record<string, Coding>> = { gzip: "gzip", "x-gzip": "gzip", deflate: "deflate", br: "br" };

export interface Capped {
  buf: Buffer;
  /** More than the cap arrived; `buf` holds the chunks that fit. */
  over: boolean;
}

/** Appends chunks until the cap would be passed. Returns true when it was. */
async function fill(chunks: Buffer[], body: AsyncIterable<Buffer>, max: number): Promise<boolean> {
  let size = 0;
  for await (const chunk of body) {
    size += chunk.length;
    if (size > max) return true;
    chunks.push(chunk);
  }
  return false;
}

export async function readCapped(body: AsyncIterable<Buffer>, max: number): Promise<Capped> {
  const chunks: Buffer[] = [];
  const over = await fill(chunks, body, max);
  return { buf: Buffer.concat(chunks), over };
}

/**
 * The coding named by a Content-Encoding header. Null when there is none, when Izin does not
 * know it, or when several are stacked: those bodies are left as they arrived.
 */
export function contentCoding(header: string | string[] | undefined): Coding | null {
  const names = [header ?? ""]
    .flat()
    .join(",")
    .toLowerCase()
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name && name !== "identity");
  return names.length === 1 ? (CODINGS[names[0] as string] ?? null) : null;
}

function decoderFor(coding: Coding, wire: Buffer) {
  if (coding === "gzip") return createGunzip();
  if (coding === "br") return createBrotliDecompress();
  // "deflate" means the zlib format, but some servers send the bare stream without its header.
  const [b0 = 0, b1 = 0] = wire;
  const zlibHeader = (b0 & 0x0f) === 8 && ((b0 << 8) | b1) % 31 === 0;
  return zlibHeader ? createInflate() : createInflateRaw();
}

/**
 * Decodes a received body, keeping at most `max` decoded bytes. `failed` is set when the stream
 * is not valid for its coding; `buf` then holds whatever was decoded before it broke.
 */
export async function decodeCapped(wire: Buffer, coding: Coding, max: number): Promise<Capped & { failed: boolean }> {
  const decoder = decoderFor(coding, wire);
  const chunks: Buffer[] = [];
  let over = false;
  let failed = false;
  decoder.end(wire);
  try {
    over = await fill(chunks, decoder as AsyncIterable<Buffer>, max);
  } catch {
    failed = true;
  }
  return { buf: Buffer.concat(chunks), over, failed };
}
