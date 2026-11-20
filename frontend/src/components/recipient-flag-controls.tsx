"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Flag, RefreshCw, ShieldCheck } from "lucide-react";
import { api, ApiError } from "@/lib/contracts";
import { useLocale } from "@/lib/i18n";
import { randomId } from "@/lib/secure-fallback";
import { FLAG_PENDING_PREFIX, flagMarker, readFlagMarker, recipientFlagInputSchema, type RecipientFlag, type RecipientFlagInput, type RecipientFlagReceipt } from "@/lib/recipient-flag";
import { flagText, type FlagMessage } from "@/lib/recipient-flag-copy";
import "./recipient-flag.css";

export function RecipientFlagControls({ accountId, disabled, onChanged }: { accountId: string; disabled: boolean; onChanged: () => void }) {
  const { lang } = useLocale(); const t = (key: FlagMessage) => flagText(lang, key);
  const [value, setValue] = useState<RecipientFlag | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [readFailed, setReadFailed] = useState(false), [unknown, setUnknown] = useState(false), [reviewed, setReviewed] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [pending, setPending] = useState<RecipientFlagInput | null>(null);
  const [draft, setDraft] = useState<boolean | null>(null), [note, setNote] = useState("");
  const [message, setMessage] = useState<FlagMessage | null>(null), [receipt, setReceipt] = useState<RecipientFlagReceipt | null>(null);
  const [retryUntil, setRetryUntil] = useState(0), [clock, setClock] = useState(Date.now);
  const mounted = useRef(true), lock = useRef(false), serial = useRef(0), unknownRef = useRef(false);
  const retryRef = useRef(0), changedRef = useRef(onChanged); changedRef.current = onChanged;
  const route = `soc/recipients/${accountId}/flag`, storeKey = `${FLAG_PENDING_PREFIX}${accountId}`;
  const backoff = (error: unknown) => { if (error instanceof ApiError && error.status === 429) { retryRef.current = Date.now() + Math.max(1, error.retryAfter || 60) * 1_000; setRetryUntil(retryRef.current); setClock(Date.now()); } };
  const read = useCallback(async (manual = false) => {
    if (retryRef.current > Date.now()) return false;
    const attempt = ++serial.current; setLoading(true);
    try {
      const result = await api<RecipientFlag>(route);
      if (!mounted.current || serial.current !== attempt) return false;
      // The serial guard excludes late reads. A demo reseed may legitimately reset the version.
      setValue(result); setReadFailed(false);
      if (manual && unknownRef.current) setReviewed(true);
      return true;
    } catch (error) { if (mounted.current && serial.current === attempt) { backoff(error); setReadFailed(true); } return false; }
    finally { if (mounted.current && serial.current === attempt) setLoading(false); }
  }, [route]);
  useEffect(() => {
    mounted.current = true;
    try { const marker = readFlagMarker(accountId, sessionStorage.getItem(storeKey)); unknownRef.current = !!marker; setUnknown(!!marker); setStorageReady(true); } catch { setMessage("storage"); }
    void read();
    const guard = (event: BeforeUnloadEvent) => { if (unknownRef.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", guard);
    return () => { mounted.current = false; serial.current++; window.removeEventListener("beforeunload", guard); };
  }, [accountId, storeKey, read]);
  useEffect(() => { if (!retryUntil) return; const timer = setInterval(() => setClock(Date.now()), 1_000); return () => clearInterval(timer); }, [retryUntil]);
  function clearPending() {
    try { sessionStorage.removeItem(storeKey); } catch { /* A leftover marker conservatively requires another review on reload. */ }
    unknownRef.current = false; setUnknown(false); setPending(null); setReviewed(false);
  }
  async function perform(input: RecipientFlagInput, retry = false) {
    if (lock.current || retryRef.current > Date.now()) return;
    if (!retry) {
      try { sessionStorage.setItem(storeKey, flagMarker(accountId, input)); }
      catch { setMessage("storage"); return; }
    }
    lock.current = true; unknownRef.current = true; setUnknown(true); setReviewed(false); setPending(input); setBusy(true); setMessage(null);
    try {
      const result = await api<RecipientFlagReceipt>(route, { method: "POST", body: JSON.stringify(input) });
      if (!mounted.current) return;
      if (result.flagged !== input.flagged || result.version !== input.expected_version + 1) throw new ApiError("invalidResponse", 502);
      clearPending(); setReceipt(result); setDraft(null); setNote("");
      const fresh = await read(); if (mounted.current) { setMessage(fresh ? "saved" : null); changedRef.current(); }
    } catch (error) {
      if (!mounted.current) return;
      backoff(error);
      if (!retry && error instanceof ApiError && [400, 401, 403, 404, 409, 413, 415, 422, 429].includes(error.status)) {
        clearPending(); setMessage(error.status === 409 ? "conflict" : "rejected");
        if (error.status !== 429) await read();
      } else setMessage("unknown");
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  function confirm() {
    if (!value || draft === null || disabled || loading || busy || readFailed || unknown || !storageReady || retryRef.current > Date.now()) return;
    const parsed = recipientFlagInputSchema.safeParse({ flagged: draft, note, expected_version: value.version, request_id: randomId() });
    if (!parsed.success) { setMessage("invalidNote"); return; }
    void perform(parsed.data);
  }
  const throttled = retryUntil > clock;
  const blocked = disabled || loading || busy || readFailed || unknown || throttled || !value || !storageReady;
  return <section className="recipient-flag" aria-label={t("title")} data-account-id={accountId}>
    <div className="recipient-flag-heading"><h3><Flag size={16} />{t("title")}</h3><button type="button" className="secondary" aria-label={t("refresh")} disabled={loading || busy || throttled} onClick={() => void read(true)}><RefreshCw size={14} /></button></div>
    <p className="recipient-flag-scope">{t("scope")}</p>
    {loading && <p role="status">{t("loading")}</p>}
    {readFailed && <p className="recipient-flag-error" role="alert">{t("failed")}</p>}
    {value && <p className={`recipient-flag-state ${value.flagged ? "flagged" : "clear"}`}><ShieldCheck size={15} />{t(value.flagged ? "flagged" : "clear")} · {t("version")} {value.version}</p>}
    {throttled && <p role="status">{t("rate")} {Math.ceil((retryUntil - clock) / 1_000)} {t("seconds")}</p>}
    {unknown && <div className="recipient-flag-unknown" role="alert"><AlertTriangle size={17} /><p>{t(pending ? "unknown" : "restored")}</p>{pending && <button type="button" className="secondary recipient-flag-retry" disabled={busy || throttled} onClick={() => void perform(pending, true)}>{t("retry")}</button>}<button type="button" className="secondary recipient-flag-read" disabled={loading || busy || throttled} onClick={() => void read(true)}>{t("refresh")}</button><button type="button" className="secondary recipient-flag-reviewed" disabled={!reviewed || loading || busy || readFailed || throttled} onClick={() => { clearPending(); setDraft(null); setNote(""); setMessage(null); }}>{t("reviewed")}</button></div>}
    <div className="recipient-flag-actions"><button type="button" className="secondary recipient-flag-open" disabled={blocked || value?.flagged} onClick={() => { setDraft(true); setMessage(null); setReceipt(null); }}>{t("flag")}</button><button type="button" className="secondary recipient-unflag-open" disabled={blocked || value?.flagged === false} onClick={() => { setDraft(false); setMessage(null); setReceipt(null); }}>{t("unflag")}</button></div>
    {draft !== null && !unknown && <form className="recipient-flag-confirmation" onSubmit={event => { event.preventDefault(); confirm(); }}><strong>{t(draft ? "flag" : "unflag")}</strong><code>{accountId}</code>{!draft && <p>{t("unflagScope")}</p>}<label htmlFor="recipient-flag-note">{t("reason")}<textarea id="recipient-flag-note" maxLength={200} minLength={1} required rows={2} value={note} onChange={event => setNote(event.target.value)} disabled={busy} aria-describedby="recipient-flag-note-hint" /></label><small id="recipient-flag-note-hint">{t("reasonHint")}</small><div><button className="primary recipient-flag-confirm" disabled={blocked || !note.trim()}>{busy ? t("saving") : t("confirm")}</button><button type="button" className="secondary" disabled={busy} onClick={() => { setDraft(null); setNote(""); }}>{t("back")}</button></div></form>}
    {message && message !== "unknown" && <p role={message === "saved" ? "status" : "alert"} className={message === "saved" ? "recipient-flag-success" : "recipient-flag-error"}>{t(message)}</p>}
    {receipt && <small className="recipient-flag-audit">{t("audit")}: {receipt.audit_id} · {t("service")}: {receipt.actor}</small>}
  </section>;
}
