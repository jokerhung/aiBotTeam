"use client";
import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { translate } from "@/lib/translate";

/** Before sign-in the language setting is not known yet: the browser's own language decides. */
const T = (text: string) => (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("vi") ? translate("vi", text) : text);

/** When the server is open beyond this computer it asks for a pairing code first; on the usual local server this renders nothing extra. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "ok" | "needed">("checking");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/auth/status").then((r) => r.json()).then((s: { required: boolean; authenticated: boolean }) => setState(s.required && !s.authenticated ? "needed" : "ok")).catch(() => setState("ok"));
  }, []);
  if (state === "ok") return <>{children}</>;
  if (state === "checking") return null;
  const pair = async () => {
    setBusy(true);
    setError("");
    const r = await fetch("/api/auth/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) }).catch(() => null);
    setBusy(false);
    if (r?.ok) setState("ok");
    else setError(T(r?.status === 401 ? "That code is not valid, or it has expired. Ask for a new one." : "Could not reach the server."));
  };
  return (
    <main data-testid="pairing" className="flex h-full items-center justify-center bg-app p-6 text-ink">
      <div className="w-full max-w-[380px] rounded-2xl bg-panel p-6 shadow-xl ring-1 ring-ink/10">
        <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-raised text-ink-secondary"><KeyRound size={20} /></div>
        <h1 className="text-[18px] font-semibold">{T("Pair this browser")}</h1>
        <p className="mt-1.5 text-[13.5px] leading-5 text-ink-secondary">{T("This BotTeam is open to other computers. Enter the code shown on the computer that runs it, in its console.")}</p>
        <input autoFocus inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && code.trim() && void pair()} aria-label={T("Pairing code")} placeholder="0000-0000"
          className="mt-4 h-11 w-full rounded-lg bg-inset px-3 text-center font-mono text-[18px] tracking-widest text-ink outline-none ring-1 ring-inset ring-ink/[0.07] focus:ring-ink/25" />
        {error && <div role="alert" className="mt-2 text-[13px] text-danger">{error}</div>}
        <button type="button" disabled={busy || !code.trim()} onClick={() => void pair()} className="mt-4 h-10 w-full rounded-full bg-accent text-[14px] font-medium text-[var(--color-accent-ink)] disabled:opacity-40">{T("Pair")}</button>
      </div>
    </main>
  );
}
