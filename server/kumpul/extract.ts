// HTML to plain text for the reader. Hidden elements are deliberately KEPT: text hidden from
// people but readable by machines is exactly what Izin needs to see and flag.
import { load } from "cheerio";

// The subset of the parsed DOM this module reads.
interface DomNode {
  type: string;
  name?: string;
  data?: string;
  children?: DomNode[];
}

const DROP = "script, style, noscript, svg, iframe, template";
const HEADING = /^h[1-6]$/;
const BLOCK = new Set([
  "address", "article", "aside", "blockquote", "dd", "details", "div", "dl", "dt", "fieldset", "figcaption", "figure",
  "footer", "form", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "summary", "table", "tbody",
  "td", "tfoot", "th", "thead", "tr", "ul",
]);

export interface Anchor {
  href: string;
  text: string;
}

function textOf(node: DomNode): string {
  if (node.type === "text") return node.data ?? "";
  return (node.children ?? []).map(textOf).join("");
}

function walk(node: DomNode, out: string[]): void {
  if (node.type === "text") {
    out.push(node.data ?? "");
    return;
  }
  if (node.type !== "tag") return;
  const name = (node.name ?? "").toLowerCase();
  if (name === "br") {
    out.push("\n");
    return;
  }
  if (HEADING.test(name)) {
    out.push(`\n## ${textOf(node).replace(/\s+/g, " ").trim()}\n`);
    return;
  }
  const block = BLOCK.has(name);
  if (block) out.push("\n");
  for (const child of node.children ?? []) walk(child, out);
  if (block) out.push("\n");
}

export function extractText(html: string): string {
  const $ = load(html);
  $(DROP).remove();
  const root = $("main").first().length ? $("main").first() : $("article").first().length ? $("article").first() : $("body");
  const out: string[] = [];
  for (const node of root.toArray() as unknown as DomNode[]) walk(node, out);
  return out
    .join("")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Every link on the page (not only inside main): policy links usually live in the footer. */
export function extractAnchors(html: string, baseUrl: string): Anchor[] {
  const $ = load(html);
  const anchors: Anchor[] = [];
  $("a[href]").each((_, el) => {
    const raw = $(el).attr("href") ?? "";
    try {
      const u = new URL(raw, baseUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") return;
      u.hash = "";
      anchors.push({ href: u.href, text: $(el).text().replace(/\s+/g, " ").trim() });
    } catch {
      /* not a URL */
    }
  });
  return anchors;
}
