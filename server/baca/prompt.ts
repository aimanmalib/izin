// Loads a versioned system prompt from prompts/<name>.md. The file holds the prompt exactly;
// only the final newline is dropped.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PROMPTS_DIR } from "../config.js";

export interface Prompt {
  name: string;
  text: string;
  sha256: string;
}

export function loadPrompt(name: string, dir: string = process.env.IZIN_PROMPTS_DIR ?? PROMPTS_DIR): Prompt {
  if (!/^[a-z]+\.v\d+$/.test(name)) throw new Error(`bad prompt name ${name}`);
  const text = readFileSync(`${dir.replace(/\/?$/, "/")}${name}.md`, "utf8").replace(/\n$/, "");
  return { name, text, sha256: createHash("sha256").update(text).digest("hex") };
}
