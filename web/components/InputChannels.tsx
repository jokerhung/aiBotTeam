"use client";
import { Check, MessageCircle, Plus, QrCode, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { IntakeEditor } from "./IntakeEditor";
import { ZaloQr } from "./ZaloQr";

const INPUT = "w-full rounded-lg bg-inset px-3 text-[14px] text-ink outline-none ring-1 ring-inset ring-ink/[0.07] placeholder:text-ink-tertiary focus:ring-ink/25";
const LOOK: Record<string, { icon: typeof Send; tone: string }> = {
  telegram: { icon: Send, tone: "bg-[#229ed9] text-white" },
  zalo: { icon: MessageCircle, tone: "bg-[#0068ff] text-white" },
  "zalo-personal": { icon: QrCode, tone: "bg-[#0068ff] text-white" },
};
const NAMES: Record<string, string> = { telegram: "Telegram bot", zalo: "Zalo bot", "zalo-personal": "Zalo personal account" };
const HELP: Record<string, string> = {
  telegram: "Get a token from @BotFather, turn privacy mode off (/setprivacy → Disable), add the bot to the chat and send /id there to see the chat id.",
  zalo: "Create the bot in the “Zalo Bot Manager” account inside Zalo. People message the bot directly; /id shows the chat id.",
  "zalo-personal": "Name this account, then scan the QR code with the Zalo app. People message your own Zalo account and the bot answers from it; /id shows the chat id.",
};

export interface ChannelAccount { id: string; app: string; label: string; username: string; enabled: boolean; state: "active" | "error" | "stopped"; error: string | null; usedBy: string[] }
interface Channel { id: string; name: string; blurb: string; limits: string[]; maxAccounts: number; connected: boolean; accounts: ChannelAccount[] }
interface AdminChat { accountId: string; chat: string }
export interface ChannelGrant { accountId: string; botId: string; botName?: string; chats: string[]; adminChats: AdminChat[]; maxPhotos: number; timeoutSec: number; remindAt: string; retentionDays: number; mode?: "batch" | "chat"; prompt: string; warnings?: string[]; intake?: GrantIntake | null }
interface GrantIntake { exists: boolean; valid: boolean; error: string | null; line: number | null; summary: string; usingLastGood: boolean }

const list = (text: string) => text.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);

/** One bot's use of one account: which chats it serves, where results go, and the limits of a batch. */
export function GrantEditor({ app, account, botId, botName, grant, accounts, onChanged }: {
  app: string; account: ChannelAccount; botId: string; botName: string; grant: ChannelGrant | undefined; accounts: ChannelAccount[]; onChanged: () => void;
}) {
  const t = useT();
  const adminText = (g: ChannelGrant | undefined) => (g?.adminChats ?? []).map((a) => (a.accountId === account.id ? a.chat : `${accounts.find((x) => x.id === a.accountId)?.label ?? a.accountId}:${a.chat}`)).join(", ");
  const [mode, setMode] = useState<"batch" | "chat">(grant?.mode ?? "batch");
  const [chats, setChats] = useState((grant?.chats ?? []).join(", "));
  const [admins, setAdmins] = useState(adminText(grant));
  const [editing, setEditing] = useState(false);
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
      const r = await api<ChannelGrant>(base, { method: "PUT", body: JSON.stringify(mode === "chat" ? { mode, chats: list(chats) } : { mode, chats: list(chats), adminChats }) });
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
      {!grant && (
        <div role="radiogroup" aria-label={t("How the bot works here")} className="mt-2 flex gap-1.5 text-[12.5px]" data-testid="input-grant-mode">
          {([["batch", "Collect files, run on Check"], ["chat", "Answer every message"]] as const).map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={mode === id} onClick={() => setMode(id)}
              className={cn("flex-1 rounded-lg px-2 py-1.5 ring-1 ring-ink/10", mode === id ? "bg-accent/12 ring-accent/60" : "hover:bg-ink/[0.04]")}>{t(label)}</button>
          ))}
        </div>
      )}
      <label className={field}>{t(mode === "chat" ? "Chats this bot answers (chat ids, or * for anyone who writes to it)" : "Chats this bot answers (chat ids, separated by commas)")}
        <input value={chats} onChange={(e) => setChats(e.target.value)} aria-label={t("Chats this bot answers")} placeholder={mode === "chat" ? "*" : "-1001234567890"} data-no-i18n="" className={cn(INPUT, "mt-1 h-9 font-mono text-[13px]")} />
      </label>
      <div className="mt-1 text-[12px] leading-[1.4] text-ink-tertiary" data-testid="input-grant-chat-hint">{t("Required. To find a chat id, send /id in that chat (or to the bot): it answers with the id even before it is allowed.")}</div>
      {mode === "batch" && (
        <label className={field}>{t("Chats that receive the result files (empty: the chat that sent the batch)")}
          <input value={admins} onChange={(e) => setAdmins(e.target.value)} aria-label={t("Chats that receive the results")} placeholder="123456789" data-no-i18n="" className={cn(INPUT, "mt-1 h-9 font-mono text-[13px]")} />
        </label>
      )}
      {grant ? (
        <div className="mt-2 rounded-lg bg-raised/60 px-3 py-2 text-[12.5px] leading-[1.45]" data-testid="input-grant-intake">
          <div className="text-ink-tertiary">{t("How this input works is written in the bot's intake.md.")}</div>
          {grant.intake?.error
            ? <div role="alert" data-no-i18n="" className="text-danger">✗ {grant.intake.line ? `${t("Line")} ${grant.intake.line}: ` : ""}{grant.intake.error}</div>
            : grant.intake?.summary ? <div data-no-i18n="" className="text-ink-secondary">{t(grant.intake.summary.split(" · ")[0])}{grant.intake.summary.includes("saves to ") ? ` · ${t("saves to")} ${grant.intake.summary.split("saves to ")[1]}` : ""}</div> : null}
          <button type="button" onClick={() => setEditing(true)} data-testid="input-grant-edit-intake" className="mt-0.5 text-accent-text hover:underline">{t("Edit intake.md")}</button>
        </div>
      ) : (
        <div className="mt-2 text-[12.5px] leading-[1.4] text-ink-secondary">{t(mode === "chat"
          ? "Every text message (or photo) sent to the bot is a question: it answers in the same chat, one question at a time. Give the bot its instructions in its profile."
          : "When this bot is allowed, an intake.md is made in its working folder if there is none. It says when the bot runs after something arrives, and where photos are saved.")}</div>
      )}
      {warnings.map((w) => <div key={w} role="status" className="mt-1.5 text-[12.5px] text-warning">{t(w)}</div>)}
      <div className="mt-2 flex items-center justify-end gap-2">
        {note && <span role={note.ok ? "status" : "alert"} data-no-i18n={note.ok ? undefined : ""} className={cn("min-w-0 flex-1 text-[12.5px]", note.ok ? "text-success" : "text-danger")}>{note.text}</span>}
        {editing && <IntakeEditor botId={botId} botName={botName} onClose={() => { setEditing(false); onChanged(); }} onSaved={onChanged} />}
        <button type="button" disabled={busy || !list(chats).length} onClick={() => void save()} data-testid="input-grant-save" title={!list(chats).length ? t("Enter at least one chat id first") : undefined}
          className="h-8 rounded-full bg-accent px-3.5 text-[13px] font-medium text-[var(--color-accent-ink)] disabled:opacity-40">{grant ? t("Save") : t("Allow this bot")}</button>
      </div>
    </div>
  );
}

const STATE_LABEL = { active: "Connected", error: "Needs you", stopped: "Stopped" } as const;
const STATE_INK = { active: "text-success", error: "text-danger", stopped: "text-ink-tertiary" } as const;
const ICON_BTN = "flex size-8 items-center justify-center rounded-lg border border-edge bg-composer text-ink hover:bg-raised";

function Fact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  const t = useT();
  return <div className={cn("min-w-0", className)}><div className="text-[10.5px] font-medium uppercase tracking-wide text-ink-tertiary">{t(label)}</div><div data-no-i18n="" className="text-[12.5px] leading-[17px] text-ink">{children}</div></div>;
}

/** One connected account as a card: its state, name, what it is used by, and what to do when it needs you. */
function AccountCard({ app, account, onChanged }: { app: string; account: ChannelAccount; onChanged: () => void }) {
  const { state } = useStore();
  const t = useT();
  const look = LOOK[app] ?? LOOK.telegram;
  const base = `/api/channels/${app}/accounts/${account.id}`;
  const names = account.usedBy.map((id) => state.bots.find((b) => b.id === id)?.name).filter(Boolean) as string[];
  const act = async (path: string, init: RequestInit) => { await api(`${base}${path}`, init).catch(() => {}); onChanged(); };
  const webhook = !!account.error && /webhook/i.test(account.error);
  return (
    <article data-testid="input-account" data-state={account.state} className="relative flex min-w-0 flex-col rounded-2xl border border-edge bg-card p-3.5 shadow-sm">
      <span className={cn("absolute right-3 top-3 flex size-8 items-center justify-center rounded-lg", look.tone)} aria-hidden><look.icon size={15} /></span>
      <div className={cn("text-[11px] font-semibold uppercase tracking-wide", STATE_INK[account.state])}>{t(STATE_LABEL[account.state])}</div>
      <h3 data-no-i18n="" className="mt-0.5 truncate pr-10 text-[13px] font-medium text-ink">{account.label}</h3>
      {account.username && <div data-no-i18n="" className="truncate text-[12px] text-ink-secondary">{account.username.startsWith("Bot") ? "" : "@"}{account.username}</div>}
      {account.error && <div role="alert" data-no-i18n="" className="mt-1.5 max-h-[60px] overflow-y-auto text-[12px] leading-[17px] text-danger">{account.error}</div>}
      <div className="mt-3 grid grid-cols-1 gap-y-2.5">
        <Fact label="Channel">{t(NAMES[app] ?? "Telegram bot")}</Fact>
        <Fact label="Used by">{names.length ? names.join(", ") : <span className="text-ink-tertiary">{t("No agent answers on this account yet")}</span>}</Fact>
      </div>
      <div className="mt-auto flex items-center gap-1.5 pt-3.5">
        {account.state === "error" && (webhook
          ? <button type="button" onClick={() => void act("/clear-webhook", { method: "POST" })} className="h-8 rounded-lg border border-edge bg-composer px-3 text-[12.5px] text-ink hover:bg-raised">{t("Clear webhook")}</button>
          : <button type="button" onClick={() => void act("", { method: "PATCH", body: JSON.stringify({ enabled: true }) })} className="h-8 rounded-lg border border-edge bg-composer px-3 text-[12.5px] text-ink hover:bg-raised">{t("Reconnect")}</button>)}
        <button type="button" title={t("Disconnect")} aria-label={`${t("Disconnect")} ${account.label}`} onClick={() => confirm(t("Disconnect this account?")) && void act("", { method: "DELETE" })}
          className={cn(ICON_BTN, "ml-auto text-danger hover:bg-danger/10")}><Trash2 size={14} /></button>
      </div>
    </article>
  );
}

/** The Channels page: connect messaging accounts (Telegram, Zalo) as cards. Which agent answers on which account is set in each agent's edit page. The server keeps each token and never shows it again. */
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
  const [qr, setQr] = useState(false);
  const connect = async (c: Channel, key?: string) => {
    setBusy(true);
    setNote(null);
    try {
      await api(`/api/channels/${c.id}/accounts`, { method: "POST", body: JSON.stringify({ label: label.trim(), token: (key ?? token).trim() }) });
      setQr(false);
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
  const accounts = (channels ?? []).flatMap((c) => c.accounts.map((a) => ({ app: c.id, account: a })));
  return (
    <div role="tabpanel" aria-label={t("Channels")} data-testid="input-panel" className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
      <h2 className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-ink-tertiary">{t("Connected accounts")} <span className="rounded-full bg-ink/[0.07] px-1.5 text-[11.5px] tabular-nums">{accounts.length}</span></h2>
      {accounts.length === 0 && <div className="mb-4 py-6 text-center text-[13.5px] text-ink-tertiary">{t("No account is connected yet.")}</div>}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="channel-accounts">
        {accounts.map(({ app, account }) => <AccountCard key={account.id} app={app} account={account} onChanged={() => void load()} />)}
      </div>
      <h2 className="mb-2 text-[12px] font-medium text-ink-tertiary">{t("Add a channel")}</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(channels ?? []).map((c) => {
          const look = LOOK[c.id] ?? LOOK.telegram;
          const full = c.accounts.length >= c.maxAccounts;
          return (
            <article key={c.id} data-testid="input-row" className="flex min-w-0 flex-col rounded-2xl border border-edge bg-card p-3.5 shadow-sm">
              <div className="flex items-center gap-3">
                <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", look.tone)} aria-hidden><look.icon size={18} /></span>
                <h3 className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{t(c.name)}</h3>
                {c.connected && <span className="flex shrink-0 items-center gap-1 text-[12px] text-success"><Check size={12} /> {c.accounts.length}</span>}
              </div>
              <p className="mt-2.5 text-[12.5px] leading-[18px] text-ink-secondary">{t(c.blurb)}</p>
              {c.limits.length > 0 && <ul className="mt-2 list-disc pl-4 text-[12px] leading-[1.5] text-ink-tertiary">{c.limits.map((l) => <li key={l}>{t(l)}</li>)}</ul>}
              {open === c.id && (
                <div className="mt-3">
                  <div className="mb-1.5 text-[12px] leading-[1.45] text-ink-tertiary">{t(HELP[c.id] ?? "")}</div>
                  <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} aria-label={t("Account label")} placeholder={t("A label for this account, such as the shop's name")} maxLength={40} className={cn(INPUT, "h-10")} />
                  {c.id === "zalo-personal" ? (
                    qr ? <ZaloQr onDone={(key) => void connect(c, key)} onCancel={() => setQr(false)} /> : null
                  ) : (
                    <input type="password" value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === "Enter" && label.trim() && token.trim() && void connect(c)}
                      aria-label={t("Bot token")} placeholder={t("Bot token")} autoComplete="off" data-no-i18n="" className={cn(INPUT, "mt-1.5 h-10")} />
                  )}
                  <div className="mt-1.5 flex items-center justify-end gap-2">
                    {note?.id === c.id && <span role="alert" data-no-i18n="" className="min-w-0 flex-1 text-[12.5px] text-danger">{note.text}</span>}
                    {c.id === "zalo-personal"
                      ? !qr && <button type="button" disabled={busy || !label.trim()} onClick={() => setQr(true)} data-testid="input-qr"
                          className="h-8 rounded-full bg-accent px-3.5 text-[13px] font-medium text-[var(--color-accent-ink)] disabled:opacity-40">{t("Show QR code")}</button>
                      : <button type="button" disabled={busy || !label.trim() || !token.trim()} onClick={() => void connect(c)} data-testid="input-save"
                          className="h-8 rounded-full bg-accent px-3.5 text-[13px] font-medium text-[var(--color-accent-ink)] disabled:opacity-40">{t("Connect")}</button>}
                  </div>
                </div>
              )}
              <div className="mt-auto pt-3.5">
                <button type="button" disabled={full} onClick={() => { setOpen(open === c.id ? null : c.id); setNote(null); setQr(false); }} data-testid={`input-connect-${c.id}`}
                  aria-label={c.accounts.length ? `${t("Add account")}: ${t(c.name)}` : `${t("Connect")}: ${t(c.name)}`}
                  className={cn("flex h-9 w-full items-center justify-center gap-1 rounded-lg px-4 text-[13.5px] font-medium disabled:opacity-40", c.accounts.length ? "border border-edge bg-composer text-ink hover:bg-raised" : "bg-accent text-[var(--color-accent-ink)]")}>
                  {c.accounts.length ? <><Plus size={13} /> {t("Add account")}</> : t("Connect")}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

interface BotGrant extends ChannelGrant { app: string; accountLabel: string; username: string }
interface Batch { id: string; accountId: string; chatId: string; userName: string; status: string; machine: string; files: { name: string; kind: string }[]; outFiles: string[]; error: string | null; threadId: string | null; startedAt: number | null; finishedAt: number | null; createdAt: number }
const STATUS: Record<string, string> = { collecting: "Receiving files", queued: "Waiting", running: "Running", done: "Done", failed: "Failed", cancelled: "Cancelled", expired: "Expired" };

/** In an agent's edit page (Availability): the channel accounts this agent answers on, each with its chats and its limits, and a way to add one. */
export function BotInputs({ botId }: { botId: string }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const [data, setData] = useState<{ grants: BotGrant[]; warnings: string[]; batches: Batch[] } | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [adding, setAdding] = useState("");
  const load = useCallback(() => {
    void api<{ grants: BotGrant[]; warnings: string[]; batches: Batch[] }>(`/api/bots/${botId}/channels`).then(setData).catch(() => {});
    void api<{ channels: Channel[] }>("/api/channels").then((r) => setChannels(r.channels)).catch(() => {});
  }, [botId]);
  useEffect(() => { load(); }, [load, state.channelTick]);
  const act = async (id: string, what: "retry" | "cancel") => { await api(`/api/channels/batches/${id}/${what}`, { method: "POST" }).catch(() => {}); void load(); };
  const grants = data?.grants ?? [];
  const accounts = channels.flatMap((c) => c.accounts);
  const accountOf = (id: string) => accounts.find((x) => x.id === id);
  const appOf = (id: string) => channels.find((c) => c.accounts.some((x) => x.id === id))?.id ?? "telegram";
  const free = accounts.filter((x) => !grants.some((g) => g.accountId === x.id));
  return (
    <div className="px-5 py-2.5" data-testid="bot-inputs">
      <div className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">{t("Channels")}</div>
      {grants.length === 0 && !adding && <div className="text-[13px] text-ink-tertiary">{t("This agent does not answer on any Telegram or Zalo account yet.")}</div>}
      {grants.length > 0 && (data?.warnings ?? []).map((w) => <div key={w} role="alert" className="mb-1.5 rounded-lg bg-warning/12 px-3 py-2 text-[12.5px] text-warning">{t(w)}</div>)}
      <div className="flex flex-col gap-2">
        {grants.map((g) => {
          const account = accountOf(g.accountId);
          return (
            <div key={g.accountId} data-testid="bot-channel">
              <div className="text-[13px] text-ink"><span>{t(NAMES[g.app] ?? "Telegram bot")}</span> · <span data-no-i18n="">{g.accountLabel}</span></div>
              {account && <GrantEditor app={g.app} account={account} botId={botId} botName={state.bots.find((b) => b.id === botId)?.name ?? botId} grant={g} accounts={accounts} onChanged={load} />}
            </div>
          );
        })}
        {adding && accountOf(adding) && (
          <GrantEditor key={`new-${adding}`} app={appOf(adding)} account={accountOf(adding)!} botId={botId} botName={state.bots.find((b) => b.id === botId)?.name ?? botId} grant={undefined} accounts={accounts}
            onChanged={() => { setAdding(""); load(); }} />
        )}
        {!adding && free.length > 0 && (
          <select value="" onChange={(e) => setAdding(e.target.value)} aria-label={t("Answer on a channel account")} data-testid="bot-add-channel" className="h-9 w-full rounded-lg bg-raised px-2 text-[13px] text-ink">
            <option value="">{t("Answer on a channel account…")}</option>
            {free.map((x) => <option key={x.id} value={x.id} data-no-i18n="">{`${t(NAMES[appOf(x.id)] ?? "Telegram bot")} · ${x.label}`}</option>)}
          </select>
        )}
        {adding && <button type="button" onClick={() => setAdding("")} className="self-start text-[12.5px] text-ink-secondary hover:underline">{t("Cancel")}</button>}
        {accounts.length === 0 && (
          <button type="button" onClick={() => dispatch({ type: "view", view: "input" })} className="self-start text-[13px] text-accent-text hover:underline">{t("Connect an account in Channels")}</button>
        )}
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
