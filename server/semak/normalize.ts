// Normalisation used to compare a model's quote with the document text. Both sides go through the
// same steps: NFKC, curly quotes to straight, every dash to "-", whitespace runs to one space,
// lower case. The index map lets a match in normalised text point back to the original text.

const SINGLE_QUOTES = /[‘’‚‛′ʼ＇]/gu;
const DOUBLE_QUOTES = /[“”„‟″«»＂]/gu;
const DASHES = /[\p{Pd}−⁃﹣－]/gu;
const SPACE = /\s/u;

function mapChar(ch: string): string {
  return ch.normalize("NFKC").replace(SINGLE_QUOTES, "'").replace(DOUBLE_QUOTES, '"').replace(DASHES, "-").toLowerCase();
}

export interface Normalised {
  text: string;
  /** For every code unit of `text`, the index of the source code unit it came from. */
  map: number[];
}

/** Normalises `source` and records where each output code unit came from. */
export function normaliseWithMap(source: string): Normalised {
  let text = "";
  const map: number[] = [];
  let pendingSpace = -1;
  let i = 0;
  for (const ch of source) {
    const at = i;
    i += ch.length;
    const out = mapChar(ch);
    for (const o of out) {
      if (SPACE.test(o)) {
        if (pendingSpace < 0) pendingSpace = at;
        continue;
      }
      if (pendingSpace >= 0 && text.length > 0) {
        text += " ";
        map.push(pendingSpace);
      }
      pendingSpace = -1;
      text += o;
      for (let k = 0; k < o.length; k++) map.push(at);
    }
  }
  return { text, map };
}

export function normalise(source: string): string {
  return normaliseWithMap(source).text;
}

/** Length in code points, so that a quote's length does not depend on surrogate pairs. */
export function codePointLength(s: string): number {
  return Array.from(s).length;
}
