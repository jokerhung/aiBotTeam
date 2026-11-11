import { vi, viPatterns } from "./i18n-vi";

export const dictionaries: Record<string, Record<string, string>> = { vi };
const patterns: Record<string, [RegExp, string][]> = { vi: viPatterns };

/** The text in the chosen language. English is the key: an exact entry wins, then a pattern (text with a name or
 * number inside), and anything else stays as it is. */
export function translate(lang: string, text: string): string {
  const exact = dictionaries[lang]?.[text];
  if (exact !== undefined) return exact;
  for (const [re, out] of patterns[lang] ?? []) {
    const m = re.exec(text);
    if (m) return out.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? "");
  }
  return text;
}
