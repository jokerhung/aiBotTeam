import { vi } from "./i18n-vi";

export const dictionaries: Record<string, Record<string, string>> = { vi };

/** The text in the chosen language; English is the key, so an unknown string simply stays English. */
export function translate(lang: string, text: string): string {
  return dictionaries[lang]?.[text] ?? text;
}
