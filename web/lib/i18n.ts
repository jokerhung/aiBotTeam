"use client";
import { useCallback, useEffect } from "react";
import { useStore } from "@/state/store";
import { dictionaries, translate } from "./translate";

export { dictionaries, translate };

/** Interface languages. English is the source text; a missing entry simply shows the English. */
export const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "vi", label: "Tiếng Việt" },
] as const;

/** `t("Allow once")` in the chosen language; the English text is the key, so a gap never breaks the screen. */
export function useT() {
  const { state } = useStore();
  const lang = state.config.settings.language;
  return useCallback((text: string) => translate(lang, text), [lang]);
}

// ---- whole-document localizer ------------------------------------------------------------------------------------
// Fixed interface strings are translated where they sit in the page: text nodes and the placeholder / title /
// aria-label attributes whose whole text is a key of the dictionary. What people wrote (messages, bot names) lives in
// elements marked data-no-i18n and is never touched; the original English is remembered so switching back restores it.

const ATTRS = ["placeholder", "title", "aria-label"] as const;
const SKIP = "script,style,textarea,input,code,pre,[data-no-i18n]";
const originals = new WeakMap<Node, string>();

function inSkipped(node: Node): boolean {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return !el || !!el.closest(SKIP);
}

function translateText(node: Text, lang: string) {
  if (inSkipped(node)) return;
  const current = node.nodeValue ?? "";
  const source = originals.get(node);
  // a node we translated earlier whose text React has not touched since: translate from the remembered English
  const english = source !== undefined && (current === translate(lang, source) || current === source) ? source : current;
  const core = english.trim();
  if (!core) return;
  const out = lang === "en" ? english : english.replace(core, translate(lang, core));
  if (out !== current) {
    if (!originals.has(node)) originals.set(node, english);
    node.nodeValue = out;
  }
  if (out !== english) originals.set(node, english);
}

function translateAttrs(el: Element, lang: string) {
  if (inSkipped(el)) return;
  for (const attr of ATTRS) {
    const value = el.getAttribute(attr);
    if (value === null) continue;
    const key = `data-i18n-${attr}`;
    const source = el.getAttribute(key);
    const english = source !== null && (value === translate(lang, source) || value === source) ? source : value;
    const out = lang === "en" ? english : translate(lang, english);
    if (out !== value) el.setAttribute(attr, out);
    if (out !== english) el.setAttribute(key, english);
    else if (source !== null && lang === "en") el.removeAttribute(key);
  }
}

export function localize(root: Node, lang: string) {
  if (root.nodeType === Node.TEXT_NODE) return translateText(root as Text, lang);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n: Node | null = root; n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) translateText(n as Text, lang);
    else translateAttrs(n as Element, lang);
  }
}

/** Keeps document.body in the chosen language, including content that renders later. */
export function useLocalizer() {
  const { state } = useStore();
  const lang = state.config.settings.language;
  useEffect(() => {
    let own = false;
    let queued = false;
    const pending = new Set<Node>();
    const run = () => {
      queued = false;
      own = true;
      for (const n of pending) if (n.isConnected) localize(n, lang);
      pending.clear();
      own = false;
    };
    const obs = new MutationObserver((records) => {
      if (own) return;
      for (const r of records) pending.add(r.type === "childList" ? r.target : r.target);
      if (!queued) { queued = true; requestAnimationFrame(run); }
    });
    own = true;
    localize(document.body, lang);
    own = false;
    obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
    return () => obs.disconnect();
  }, [lang]);
}
