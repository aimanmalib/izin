// UI text lives in lang/*.json only. English is the default; Bahasa Melayu is a toggle kept in
// localStorage. fmt() fills {name} slots.
import { createContext, useContext } from "react";
import en from "../../lang/en.json";
import ms from "../../lang/ms.json";

export const LANGS = { en, ms } as const;
export type Lang = keyof typeof LANGS;
export type Strings = typeof en;

const KEY = "izin.lang";

export function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "en" || saved === "ms") return saved;
  } catch {
    // Storage can be blocked; English stays the default.
  }
  return "en";
}

export function saveLang(lang: Lang): void {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // Not saved; the toggle still works for this visit.
  }
}

export function fmt(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export const LangContext = createContext<{ lang: Lang; t: Strings; setLang: (l: Lang) => void }>({
  lang: "en",
  t: en,
  setLang: () => {},
});

export const useT = () => useContext(LangContext);
