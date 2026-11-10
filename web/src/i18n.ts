// UI text lives in lang/*.json only. English is the default; Bahasa Melayu is a toggle.
import en from "../../lang/en.json";
import ms from "../../lang/ms.json";

export const LANGS = { en, ms } as const;
export type Lang = keyof typeof LANGS;
export type Strings = typeof en;
