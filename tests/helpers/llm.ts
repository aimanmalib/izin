// Fake OpenAI-compatible endpoints for reader tests. No network: the SDK is given this fetch.
export interface Seen {
  url: string;
  body: Record<string, unknown>;
}

export type Reply =
  | { status: number; json?: unknown; headers?: Record<string, string> }
  | { stream: Record<string, unknown>[]; headers?: Record<string, string> }
  | { hang: true };

const enc = new TextEncoder();

export function fakeFetch(script: (seen: Seen, n: number) => Reply) {
  const seen: Seen[] = [];
  const fn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const s = { url, body };
    seen.push(s);
    const r = script(s, seen.length);
    if ("hang" in r) {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    }
    if ("stream" in r) {
      const text = r.stream.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(enc.encode(text));
          c.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream", ...r.headers } });
    }
    return new Response(JSON.stringify(r.json ?? { error: { message: `status ${r.status}` } }), {
      status: r.status,
      headers: { "content-type": "application/json", ...r.headers },
    });
  };
  return { fetch: fn as typeof globalThis.fetch, seen };
}

/** Stream chunks for one reply: optional reasoning deltas, content in pieces, usage last. */
export function chunks(model: string, content: string, opts: { reasoning?: number; usage?: [number, number, number?] } = {}) {
  const out: Record<string, unknown>[] = [];
  const base = { id: "x", object: "chat.completion.chunk", created: 1, model };
  for (let i = 0; i < (opts.reasoning ?? 0); i++) out.push({ ...base, choices: [{ index: 0, delta: { reasoning: "think " }, finish_reason: null }] });
  for (let i = 0; i < content.length; i += 50) out.push({ ...base, choices: [{ index: 0, delta: { content: content.slice(i, i + 50) }, finish_reason: null }] });
  const [p, c, r] = opts.usage ?? [1000, 200];
  out.push({
    ...base,
    choices: [],
    usage: { prompt_tokens: p, completion_tokens: c, total_tokens: p + c, ...(r !== undefined ? { completion_tokens_details: { reasoning_tokens: r } } : {}) },
  });
  return out;
}

export function completion(model: string, content: string, usage: [number, number] = [1000, 200]) {
  return {
    id: "y",
    object: "chat.completion",
    created: 1,
    model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: usage[0], completion_tokens: usage[1], total_tokens: usage[0] + usage[1] },
  };
}
