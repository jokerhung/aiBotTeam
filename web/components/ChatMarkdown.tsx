"use client";
import "katex/dist/katex.min.css";
import { Check, Copy } from "lucide-react";
import { memo, useEffect, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { cn } from "@/lib/utils";

type Highlighter = { codeToHtml: (code: string, o: object) => string; getLoadedLanguages: () => string[]; loadLanguage: (...l: string[]) => Promise<void> };
let highlighter: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  highlighter ??= import("shiki").then((s) =>
    s.createHighlighter({ themes: ["github-light", "github-dark"], langs: ["text", "bash", "json", "typescript", "python"] }),
  ) as Promise<Highlighter>;
  return highlighter;
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title="Copy"
      aria-label="Copy code"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="inline-flex size-6 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-ink/10 hover:text-ink"
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

function Mermaid({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
        const { svg } = await mermaid.render(`m${Math.random().toString(36).slice(2)}`, code);
        if (live) setSvg(svg);
      })
      .catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [code]);
  if (failed) return <CodeBlock code={code} lang="text" />;
  return <div className="my-2 overflow-x-auto" dangerouslySetInnerHTML={{ __html: svg ?? "" }} />;
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getHighlighter()
      .then(async (h) => {
        let l = lang || "text";
        if (!h.getLoadedLanguages().includes(l)) {
          try { await h.loadLanguage(l); } catch { l = "text"; }
        }
        const out = h.codeToHtml(code, { lang: l, themes: { light: "github-light", dark: "github-dark" }, defaultColor: false });
        if (live) setHtml(out);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [code, lang]);
  return (
    <div className="chat-code-block group/code my-2 overflow-hidden rounded-xl bg-inset text-[13px]">
      <div className="flex items-center justify-between px-3 pt-1.5 text-[11px] text-ink-tertiary">
        <span>{lang || "text"}</span>
        <CopyButton text={code} />
      </div>
      {html ? (
        <div className="shiki-wrap overflow-x-auto px-3 pb-3 pt-1 font-mono leading-5" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="overflow-x-auto px-3 pb-3 pt-1 font-mono leading-5">{code}</pre>
      )}
    </div>
  );
}

const components: Components = {
  p: ({ children }) => <p dir="auto">{children}</p>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-accent-text underline underline-offset-2">
      {children}
    </a>
  ),
  h1: ({ children }) => <h3 className="md-heading mt-3 text-[17px] font-semibold">{children}</h3>,
  h2: ({ children }) => <h3 className="md-heading mt-3 text-[16px] font-semibold">{children}</h3>,
  h3: ({ children }) => <h4 className="md-heading mt-2 text-[15px] font-semibold">{children}</h4>,
  h4: ({ children }) => <h4 className="md-heading mt-2 text-[15px] font-semibold">{children}</h4>,
  ul: ({ children }) => <ul className="ml-5 list-disc space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="ml-5 list-decimal space-y-1">{children}</ol>,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-hairline pl-3 text-ink-secondary">{children}</blockquote>,
  hr: () => <hr className="my-3 border-hairline" />,
  table: ({ children }) => (
    <div data-table-card className="chat-table my-2 w-full overflow-x-auto rounded-xl outline outline-1 -outline-offset-1 outline-ink/10">
      <table className="w-full border-collapse text-left text-[14px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-ink/[0.04]">{children}</thead>,
  th: ({ children }) => <th className="px-3 py-1.5 font-medium">{children}</th>,
  td: ({ children }) => <td className="border-t border-ink/10 px-3 py-1.5">{children}</td>,
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const lang = /language-([\w-]+)/.exec(className ?? "")?.[1];
    const text = String(children).replace(/\n$/, "");
    if (!lang && !text.includes("\n")) {
      return <code className="rounded bg-ink/[0.07] px-1.5 py-0.5 font-mono text-[0.9em]">{children}</code>;
    }
    return lang === "mermaid" ? <Mermaid code={text} /> : <CodeBlock code={text} lang={lang ?? "text"} />;
  },
};

/** A reply's Markdown. Tables are cards, code is highlighted, math is KaTeX, mermaid fences render as diagrams. */
export const ChatMarkdown = memo(function ChatMarkdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("chat-md min-w-0 [&>*+*]:mt-2", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
