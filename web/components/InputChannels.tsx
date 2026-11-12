"use client";
import { Check, MessageCircle, Plus, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { api } from "@/state/api";
import { useStore } from "@/state/store";

const INPUT = "w-full rounded-lg bg-inset px-3 text-[14px] text-ink outline-none ring-1 ring-inset ring-ink/[0.07] placeholder:text-ink-tertiary focus:ring-ink/25";
const LOOK: Record<string, { icon: typeof Send; tone: string }> = {
  telegram: { icon: Send, tone: "bg-[#229ed9] text-white" },
  zalo: { icon: MessageCircle, tone: "bg-[#0068ff] text-white" },
};
const HELP: Record<string, string> = {
  telegram: "Get a token from @BotFather, turn privacy mode off (/setprivacy → Disable), add the bot to the chat and send /id there to see the chat id.",
  zalo: "Create the bot in the “Zalo Bot Manager” account inside Zalo. People message the bot directly; /id shows the chat id.",
};

export interface ChannelAccount { id: string; app: string; label: string; username: string; enabled: boolean; state: "active" | "error" | "stopped"; error: string | null; usedBy: string[] }
interface Channel { id: string; name: string; blurb: string; limits: string[]; maxAccounts: number; connected: boolean; accounts: ChannelAccount[] }
interface AdminChat { accountId: string; chat: string }
export interface ChannelGrant { accountId: string; botId: string; botName?: string; chats: string[]; adminChats: AdminChat[]; maxPhotos: number; timeoutSec: number; remindAt: string; retentionDays: number; prompt: string; warnings?: string[] }

const list = (text: string) => text.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);

/** One bot's use of one account: which chats it serves, where results go, and the limits of a batch. */
function GrantEditor({ app, account, botId, botName, grant, accounts, onChanged }: {
  app: string; account: ChannelAccount; botId: string; botName: string; grant: ChannelGrant | undefined; accounts: ChannelAccount[]; onChanged: () => void;
}) {
  const t = useT();
  const adminText = (g: ChannelGrant | undefined) => (g?.adminChats ?? []).map((a) => (a.accountId === account.id ? a.chat : `${accounts.find((x) => x.id === a.accountId)?.label ?? a.accountId}:${a.chat}`)).join(", ");
  const [chats, setChats] = useState((grant?.chats ?? []).join(", "));
  const [admins, setAdmins] = useState(adminText(grant));
  const [maxPhotos, setMaxPhotos] = useState(String(grant?.maxPhotos ?? 40));
  const [timeoutSec, setTimeoutSec] = useState(String(grant?.timeoutSec ?? 900));
  const [remindAt, setRemindAt] = useState(grant?.remindAt ?? "");
  const [prompt, setPrompt] = useState(grant?.prompt ?? "");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const base = `/api/channels/${app}/accounts/${account.id}/grants/${botId}`;
  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      const adminChats = list(admins).map((entry) => {
        const cut = entry.indexOf(":");
        const other = cut > 0 ? accounts.find((x) => x.label.toLowerCase() === entry.slice(0, cut).toLowerCase()) : undefined;
        return other ? { accountId: other.id, chat: entry.slice(cut + 1) } : { accountId: account.id, chat: entry };
      });
      const r = await api<ChannelGrant>(base, { method: "PUT", body: JSON.stringify({ chats: list(chats), adminChats, maxPhotos: Number(maxPhotos), timeoutSec: Number(timeoutSec), remindAt: remindAt.trim(), prompt }) });
      setWarnings(r.warnings ?? []);
      setNote({ ok: true, text: t("Saved") });
      onChanged();
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const revoke = async () => {
    setBusy(true);
    await api(base, { method: "DELETE" }).catch(() => {});
    setBusy(false);
    onChanged();
  };
  const field = "mt-2 block text-[12px] text-ink-tertiary";
  return (
    <div data-testid="input-grant" className="mt-2 rounded-lg bg-inset px-3 py-2.5 ring-1 ring-inset ring-ink/[0.07]">
      <div className="flex items-center gap-2 text-[13.5px]">
        <span data-no-i18n="" className="min-w-0 flex-1 truncate font-medium">{botName}</span>
        {grant && <button type="button" disabled={busy} onClick={() => void revoke()} className="rounded-full px-2.5 py-1 text-[12.5px] text-ink-secondary hover:bg-ink/10">{t("Remove")}</button>}
      </div>
      <label className={field}>{t("Chats this bot answers (chat ids, separated by commas)")}
        <input value={chats} onChange={(e) => setChats(e.target.value)} aria-label={t("Chats this bot answers")} placeholder="-1001234567890" data-no-i18n="" className={cn(INPUT, "mt-1 h-9 font-mono text-[13px]")} />
      </label>
      <label className={field}>{t("Chats that receive the result files (empty: the chat that sent the batch)")}
        <input value={admins} onChange={(e) => setAdmins(e.target.value)} aria-label={t("Chats that receive the results")} placeholder="123456789" data-no-i18n="" className={cn(INPUT, "mt-1 h-9 font-mono text-[13px]")} />
      </label>
      <div className="flex gap-2">
        <label className={cn(field, "flex-1")}>{t("Photos per batch")}
          <input value={maxPhotos} onChange={(e) => setMaxPhotos(e.target.value)} inputMode="numeric" aria-label={t("Photos per batch")} className={cn(INPUT, "mt-1 h-9")} />
        </label>
        <label className={cn(field, "flex-1")}>{t("Time limit (seconds)")}
          <input value={timeoutSec} onChange={(e) => setTimeoutSec(e.target.value)} inputMode="numeric" aria-label={t("Time limit (seconds)")} className={cn(INPUT, "mt-1 h-9")} />
        </label>
        <label className={cn(field, "flex-1")}>{t("Reminder time")}
          <input value={remindAt} onChange={(e) => setRemindAt(e.target.value)} placeholder={t("e.g. 18:30")} aria-label={t("Reminder time")} className={cn(INPUT, "mt-1 h-9")} />
        </label>
      </div>
      <label className={field}>{t("What the bot is told for each batch ({job} is the batch folder)")}
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} aria-label={t("What the bot is told for each batch")} className={cn(INPUT, "mt-1 resize-y py-2 text-[13px]")} />
      </label>
      {warnings.map((w) => <div key={w} role="status" className="mt-1.5 text-[12.5px] text-warning">{t(w)}</div>)}
      <div className="mt-2 flex items-center justify-end gap-2">
        {note && <span role={note.ok ? "status" : "alert"} data-no-i18n={note.ok ? undefined : ""} className={cn("min-w-0 flex-1 text-[12.5px]", note.ok ? "text-success" : "text-danger")}>{note.text}</span>}
        <button type="button" disabled={busy || !list(chats).length} onClick={() => void save()} data-testid="input-grant-save"
          className="h-8 rounded-full bg-accent px-3.5 text-[13px] font-medium text-[var(--color-accent-ink)] disabled:opacity-40">{grant ? t("Save") : t("Allow this bot")}</button>
      </div>
    </div>
  );
}

function AccountRow({ app, account, accounts, onChanged }: { app: string; account: ChannelAccount; accounts: ChannelAccount[]; onChanged: () => void }) {
  const { state } = useStore();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [grants, setGrants] = useState<ChannelGrant[]>([]);
  const [adding, setAdding] = useState("");
  const base = `/api/channels/${app}/accounts/${account.id}`;
  const load = useCallback(() => api<{ grants: ChannelGrant[] }>(`${base}/grants`).then((r) => setGrants(r.grants)).catch(() => {}), [base]);
  useEffect(() => { if (open) void load(); }, [open, load, state.channelTick]);
  const names = account.usedBy.map((id) => state.bots.find((b) => b.id === id)?.name).filter(Boolean) as string[];
  const act = async (path: string, init: RequestInit) => { await api(`${base}${path}`, init).catch(() => {}); onChanged(); };
  const webhook = !!account.error && /webhook/i.test(account.error);
  const free = state.bots.filter((b) => !grants.some((g) => g.botId === b.id));
  return (
    <div data-testid="input-account" className="mt-1.5 pl-14 pr-1 text-[12.5px]">
      <div className="flex items-center gap-2">
        <span data-no-i18n="" className="min-w-0 flex-1 truncate text-ink-secondary">{account.label}{account.username ? ` · ${account.username.startsWith("Bot") ? "" : "@"}${account.username}` : ""}</span>
        <span className={cn(account.state === "active" ? "text-success" : account.state === "error" ? "text-danger" : "text-ink-tertiary")}>
          {account.state === "active" ? t("Connected") : account.state === "error" ? t("Needs you") : t("Stopped")}
        </span>
        {account.state === "error" && (webhook
          ? <button type="button" onClick={() => void act("/clear-webhook", { method: "POST" })} className="rounded-full px-2.5 py-1 text-accent-text hover:bg-ink/10">{t("Clear webhook")}</button>
          : <button type="button" onClick={() => void act("", { method: "PATCH", body: JSON.stringify({ enabled: true }) })} className="rounded-full px-2.5 py-1 text-accent-text hover:bg-ink/10">{t("Reconnect")}</button>)}
        <button type="button" onClick={() => void act("", { method: "DELETE" })} className="rounded-full px-2.5 py-1 text-ink-secondary hover:bg-ink/10">{t("Disconnect")}</button>
      </div>
      {account.error && <div role="alert" data-no-i18n="" className="mt-0.5 text-danger">{account.error}</div>}
      <div className="mt-0.5 flex items-center gap-1.5 text-ink-tertiary">
        <span className="min-w-0 truncate">{names.length ? <>{t("Used by")} <span data-no-i18n="">{names.join(", ")}</span></> : t("No bot uses this account yet")}</span>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="input-change" className="shrink-0 text-accent-text hover:underline">{open ? t("Done") : t("Change")}</button>
      </div>
      {open && (
        <div className="mb-1">
          {grants.map((g) => <GrantEditor key={g.botId} app={app} account={account} botId={g.botId} botName={g.botName || g.botId} grant={g} accounts={accounts} onChanged={() => { void load(); onChanged(); }} />)}
          {adding && <GrantEditor key={`new-${adding}`} app={app} account={account} botId={adding} botName={state.bots.find((b) => b.id === adding)?.name ?? adding} grant={undefined} accounts={accounts}
            onChanged={() => { setAdding(""); void load(); onChanged(); }} />}
          {free.length > 0 && !adding && (
            <select value="" onChange={(e) => setAdding(e.target.value)} aria-label={t("Let a bot use this account")} data-testid="input-add-bot" className="mt-2 h-9 w-full rounded-lg bg-raised px-2 text-[13px] text-ink">
              <option value="">{t("Let a bot use this account…")}</option>
              {free.map((b) => <option key={b.id} value={b.id} data-no-i18n="">{b.name}</option>)}
            </select>
          )}
        </div>
      )}
    </div>
  );
}

/** The Input tab: messaging channels that receive messages and start a bot by themselves. The server keeps each bot token and never shows it again. */
export function InputChannels() {
  const { state } = useStore();
  const t = useT();
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ id: string; text: string } | null>(null);
  const load = useCallback(() => api<{ channels: Channel[] }>("/api/channels").then((r) => setChannels(r.channels)).catch(() => {}), []);
  useEffect(() => { void load(); }, [load, state.channelTick]);
  const connect = async (c: Channel) => {
    setBusy(true);
    setNote(null);
    try {
      await api(`/api/channels/${c.id}/accounts`, { method: "POST", body: JSON.stringify({ label: label.trim(), token: token.trim() }) });
      setOpen(null);
      setLabel("");
      setToken("");
      await load();
    } catch (e) {
      setNote({ id: c.id, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const all = (channels ?? []).flatMap((c) => c.accounts);
  return (
    <div role="tabpanel" aria-label={t("Input")} data-testid="input-panel" className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
      <div className="mx-2 mb-3 rounded-xl bg-raised px-3.5 py-2.5 text-[13px] leading-5 text-ink-secondary">
        {t("Inputs receive messages and start a bot by themselves. The Telegram entry under Connected apps only gives a bot tools to send.")}
      </div>
      {(channels ?? []).map((c) => {
        const look = LOOK[c.id] ?? LOOK.telegram;
        const full = c.accounts.length >= c.maxAccounts;
        return (
          <div key={c.id} data-testid="input-row" className="rounded-xl px-2 py-2.5 hover:bg-raised/50">
            <div className="flex items-center gap-3">
              <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", look.tone)} aria-hidden><look.icon size={20} /></span>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-[14.5px] font-medium">{t(c.name)}</div>
                <div className="text-[12.5px] leading-[1.35] text-ink-tertiary">{t(c.blurb)}</div>
              </div>
              {c.connected && <span className="flex shrink-0 items-center gap-1 text-[12.5px] text-success"><Check size={13} /> {t("Connected")}</span>}
              <button type="button" disabled={full} onClick={() => { setOpen(open === c.id ? null : c.id); setNote(null); }} data-testid={`input-connect-${c.id}`}
                aria-label={c.accounts.length ? `${t("Add account")}: ${t(c.name)}` : `${t("Connect")}: ${t(c.name)}`}
                className={cn("flex h-9 shrink-0 items-center gap-1 rounded-full px-4 text-[13.5px] font-medium disabled:opacity-40", c.accounts.length ? "bg-raised text-ink hover:bg-raised-hover" : "bg-accent text-[var(--color-accent-ink)]")}>
                {c.accounts.length ? <><Plus size={13} /> {t("Add account")}</> : t("Connect")}
              </button>
            </div>
            {c.limits.length > 0 && <ul className="mt-1.5 list-disc pl-[78px] pr-2 text-[12px] leading-[1.5] text-ink-tertiary">{c.limits.map((l) => <li key={l}>{t(l)}</li>)}</ul>}
            {c.accounts.map((a) => <AccountRow key={a.id} app={c.id} account={a} accounts={all} onChanged={() => void load()} />)}
            {open === c.id && (
              <div className="mt-2 pl-14 pr-1">
                <div className="mb-1.5 text-[12px] leading-[1.45] text-ink-tertiary">{t(HELP[c.id] ?? "")}</div>
                <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} aria-label={t("Account label")} placeholder={t("A label for this account, such as the shop's name")} maxLength={40} className={cn(INPUT, "h-10")} />
                <input type="password" value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === "Enter" && label.trim() && token.trim() && void connect(c)}
                  aria-label={t("Bot token")} placeholder={t("Bot token")} autoComplete="off" data-no-i18n="" className={cn(INPUT, "mt-1.5 h-10")} />
                <div className="mt-1.5 flex items-center justify-end gap-2">
                  {note?.id === c.id && <span role="alert" data-no-i18n="" className="min-w-0 flex-1 text-[12.5px] text-danger">{note.text}</span>}
                  <button type="button" disabled={busy || !label.trim() || !token.trim()} onClick={() => void connect(c)} data-testid="input-save"
                    className="h-8 rounded-full bg-accent px-3.5 text-[13px] font-medium text-[var(--color-accent-ink)] disabled:opacity-40">{t("Connect")}</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface BotGrant extends ChannelGrant { app: string; accountLabel: string; username: string }
interface Batch { id: string; accountId: string; chatId: string; userName: string; status: string; machine: string; files: { name: string; kind: string }[]; outFiles: string[]; error: string | null; threadId: string | null; startedAt: number | null; finishedAt: number | null; createdAt: number }
const STATUS: Record<string, string> = { collecting: "Receiving files", queued: "Waiting", running: "Running", done: "Done", failed: "Failed", cancelled: "Cancelled", expired: "Expired" };

/** In a bot's settings: the input accounts this bot answers on, what is wrong (no folder, an engine that cannot see), and its latest batches. */
export function BotInputs({ botId }: { botId: string }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const [data, setData] = useState<{ grants: BotGrant[]; warnings: string[]; batches: Batch[] } | null>(null);
  const load = useCallback(() => api<{ grants: BotGrant[]; warnings: string[]; batches: Batch[] }>(`/api/bots/${botId}/channels`).then(setData).catch(() => {}), [botId]);
  useEffect(() => { void load(); }, [load, state.channelTick]);
  const act = async (id: string, what: "retry" | "cancel") => { await api(`/api/channels/batches/${id}/${what}`, { method: "POST" }).catch(() => {}); void load(); };
  const grants = data?.grants ?? [];
  return (
    <div className="px-5 py-2.5" data-testid="bot-inputs">
      <div className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">{t("Inputs")}</div>
      {grants.length === 0 && (
        <div className="text-[13px] text-ink-tertiary">
          {t("No Telegram or Zalo account starts this bot yet.")}{" "}
          <button type="button" onClick={() => dispatch({ type: "apps", open: true, tab: "input" })} className="text-accent-text hover:underline">{t("Set one up")}</button>
        </div>
      )}
      {grants.length > 0 && (data?.warnings ?? []).map((w) => <div key={w} role="alert" className="mb-1.5 rounded-lg bg-warning/12 px-3 py-2 text-[12.5px] text-warning">{t(w)}</div>)}
      <div className="flex flex-col gap-1.5">
        {grants.map((g) => (
          <div key={g.accountId} className="rounded-lg bg-inset px-3 py-2 text-[13px] ring-1 ring-inset ring-ink/[0.07]">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-ink"><span>{t(g.app === "zalo" ? "Zalo bot" : "Telegram bot")}</span> · <span data-no-i18n="">{g.accountLabel}</span></span>
              <button type="button" onClick={() => dispatch({ type: "apps", open: true, tab: "input" })} className="shrink-0 text-[12.5px] text-accent-text hover:underline">{t("Change")}</button>
            </div>
            <div data-no-i18n="" className="mt-0.5 truncate font-mono text-[12px] text-ink-tertiary">{g.chats.join(", ")}</div>
          </div>
        ))}
      </div>
      {(data?.batches.length ?? 0) > 0 && (
        <div className="mt-2">
          <div className="mb-1 text-[12px] text-ink-tertiary">{t("Latest batches")}</div>
          {data!.batches.slice(0, 8).map((b) => (
            <div key={b.id} data-testid="bot-batch" className="flex items-center gap-2 py-1 text-[12.5px]">
              <span className={cn("shrink-0", b.status === "done" ? "text-success" : b.status === "failed" ? "text-danger" : "text-ink-secondary")}>{t(STATUS[b.status] ?? b.status)}</span>
              <span data-no-i18n="" className="min-w-0 flex-1 truncate text-ink-tertiary" title={b.error ?? undefined}>
                {b.userName || b.chatId}{b.machine ? ` · ${b.machine}` : ""} · {b.files.length} · {new Date(b.createdAt).toLocaleString()}
              </span>
              {b.threadId && <button type="button" onClick={() => void api(`/api/bots/${botId}`, { method: "PATCH", body: JSON.stringify({ threadId: b.threadId }) })} className="shrink-0 text-accent-text hover:underline">{t("Open")}</button>}
              {b.status === "failed" && <button type="button" onClick={() => void act(b.id, "retry")} className="shrink-0 text-accent-text hover:underline">{t("Try again")}</button>}
              {(b.status === "running" || b.status === "queued") && <button type="button" onClick={() => void act(b.id, "cancel")} className="shrink-0 text-ink-secondary hover:underline">{t("Stop")}</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
