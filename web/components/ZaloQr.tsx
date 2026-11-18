"use client";
/* eslint-disable react-hooks/set-state-in-effect -- the sign-in starts when the box opens */
import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";

type Phase = "starting" | "qr" | "scanned" | "done" | "declined" | "expired" | "error";
interface Login { state: Phase; qr: string; name: string; accountKey: string; error: string }

/** Zalo's own web calls, reached through the app's /zalo-api proxy (next.config.mjs) to the Node.js Zalo service. Errors come back as {error}. */
async function zalo<T>(path: string, method = "GET"): Promise<T> {
  const r = await fetch(`/zalo-api${path}`, { method, headers: method === "GET" ? undefined : { "content-type": "application/json" }, body: method === "POST" ? "{}" : undefined });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(String(body.error ?? body.detail ?? `HTTP ${r.status}`));
  return body as T;
}

/** Sign in to a Zalo account by QR code. When the person has scanned it and confirmed on the phone, `onDone` gets the service's key for the account. */
export function ZaloQr({ onDone, onCancel }: { onDone: (accountKey: string) => void; onCancel: () => void }) {
  const t = useT();
  const [login, setLogin] = useState<Login | null>(null);
  const [failure, setFailure] = useState("");
  const idRef = useRef("");
  const box = useRef<HTMLDivElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone; // eslint-disable-line react-hooks/refs -- always call the latest handler

  const begin = useCallback(async () => {
    setFailure("");
    setLogin(null);
    try {
      idRef.current = (await zalo<{ loginId: string }>("/login", "POST")).loginId;
    } catch (e) {
      setFailure((e as Error).message);
    }
  }, []);

  useEffect(() => { void begin(); }, [begin]);
  useEffect(() => () => { if (idRef.current) void zalo(`/login/${idRef.current}`, "DELETE").catch(() => {}); }, []);

  useEffect(() => {
    if (failure || login?.state === "done" || login?.state === "declined" || login?.state === "expired" || login?.state === "error") return;
    const timer = setInterval(async () => {
      if (!idRef.current) return;
      try {
        const l = await zalo<Login>(`/login/${idRef.current}`);
        setLogin(l);
        if (l.state === "done" && l.accountKey) { idRef.current = ""; doneRef.current(l.accountKey); }
      } catch (e) {
        setFailure((e as Error).message);
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [failure, login?.state]);

  useEffect(() => { if (login?.state === "qr") box.current?.scrollIntoView({ block: "nearest" }); }, [login?.state]);

  const ended = failure || (login && ["declined", "expired", "error"].includes(login.state));
  const message = failure || (login?.state === "declined" ? t("The sign-in was declined on the phone.") : login?.state === "expired" ? t("The QR code expired.") : login?.state === "error" ? login.error : "");
  return (
    <div ref={box} data-testid="zalo-qr" className="mt-2 rounded-xl bg-inset p-3 ring-1 ring-inset ring-ink/[0.07]">
      <div className="mb-2 text-[12.5px] leading-[1.45] text-ink-secondary">{t("Open Zalo on your phone, tap the QR scanner (in the search bar or under More), scan this code, then confirm the sign-in on the phone.")}</div>
      <div className="mx-auto flex size-[200px] items-center justify-center rounded-lg bg-white">
        {login?.state === "qr" && login.qr
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={login.qr} alt={t("Zalo QR code")} className="size-full object-contain" />
          : login?.state === "scanned"
            ? <div role="status" className="px-4 text-center text-[13px] text-neutral-700"><span data-no-i18n="">{login.name}</span><br />{t("Confirm on your phone")}</div>
            : ended ? <span className="px-4 text-center text-[13px] text-neutral-600">{t("No code")}</span> : <Loader2 className="animate-spin text-neutral-500" size={22} />}
      </div>
      {message && <div role="alert" data-no-i18n="" className="mt-2 text-center text-[12.5px] text-danger">{message}</div>}
      <div className="mt-2 flex items-center justify-end gap-2">
        {ended && <button type="button" onClick={() => void begin()} className="flex h-8 items-center gap-1 rounded-full bg-raised px-3 text-[13px] hover:bg-raised-hover"><RefreshCw size={13} /> {t("Try again")}</button>}
        <button type="button" onClick={onCancel} className="h-8 rounded-full px-3 text-[13px] text-ink-secondary hover:bg-ink/10">{t("Cancel")}</button>
      </div>
    </div>
  );
}
