"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Clock3, LoaderCircle, Send, UserRound, XCircle } from "lucide-react";
import { api, ApiError } from "@/lib/contracts";
import { mobileText } from "@/lib/mobile-copy";
import { useLocale } from "@/lib/i18n";
import { CircleLogin, isCircleGuest } from "./circle-login";

// Mirrors the BFF response of /api/v1/trusted-circle/{id}; no tokens or chat addresses reach the browser.
type NotificationState = "NOTIFICATION_QUEUED" | "NOTIFICATION_SENT" | "CONTACT_ACKNOWLEDGED" | "SUSPICION_REPORTED" | "DELIVERY_FAILED" | "CONTACT_REVOKED" | "NOTIFICATION_EXPIRED";
type ContactState = "CONTACT_NOT_CONFIGURED" | "CONTACT_PENDING_CONSENT" | "CONTACT_VERIFIED" | "CONTACT_REVOKED";
interface Circle { private_session?: boolean; channel?: string | null; contact_state?: ContactState | null; contacts?: { id: string; alias: string }[]; notifications: { id: string; contact_id: string; state: NotificationState; expires_at: string }[] }

/** Polling interval: above the contract's 2.1 s floor and within the 30/min per-owner budget. */
export const TRUSTED_POLL_MS = 4000;
const terminal = (state: NotificationState) => state !== "NOTIFICATION_QUEUED" && state !== "NOTIFICATION_SENT";
type ErrorKey = "trustedErrorConsent" | "trustedErrorCooling" | "trustedErrorBusy" | "trustedErrorGeneric" | "trustedErrorUnavailable";
const errorFor = (failure: unknown): ErrorKey => {
  const code = failure instanceof ApiError ? failure.code : "";
  return code === "contact_consent_required" || code === "contact_notifications_disabled" ? "trustedErrorConsent"
    : code === "active_cooling_required" ? "trustedErrorCooling" : code === "rateLimited" ? "trustedErrorBusy"
    : code === "unavailable" ? "trustedErrorUnavailable" : "trustedErrorGeneric";
};

/** "Notify a trusted contact" inside the cooling sheet. Hidden when the integration is not available. */
export function TrustedCircle({ transactionId, active, historyOnly = false }: { transactionId: string; active: boolean; historyOnly?: boolean }) {
  const { lang } = useLocale();
  const m = (key: Parameters<typeof mobileText>[1]) => mobileText(lang, key);
  const [circle, setCircle] = useState<Circle | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [guest, setGuest] = useState(false);
  const pauseUntil = useRef(0);
  const version = useRef(0);
  const writing = useRef(false);
  const read = useRef(false);
  const load = useCallback(async (scope: "all" | "notifications") => {
    if (writing.current || read.current || Date.now() < pauseUntil.current) return;
    const ticket = ++version.current;
    read.current = true;
    try {
      const value = await api<Circle>(`trusted-circle/${transactionId}${scope === "notifications" ? "?scope=notifications" : ""}`);
      if (ticket === version.current) { setGuest(false); setCircle(previous => ({ ...previous, ...value })); setError(null); }
    } catch (failure) {
      if (ticket !== version.current) return;
      if (isCircleGuest(failure)) { setCircle(null); setError(null); setGuest(true); return; }
      setError(errorFor(failure));
      if (failure instanceof ApiError && failure.status === 429) pauseUntil.current = Date.now() + (failure.retryAfter || 60) * 1000;
    } finally { if (ticket === version.current) read.current = false; }
  }, [transactionId]);
  useEffect(() => {
    setCircle(null); setGuest(false);
    void load("all");
    const refresh = () => { if (document.visibilityState === "visible") void load("all"); };
    window.addEventListener("focus", refresh);
    return () => { ++version.current; read.current = false; window.removeEventListener("focus", refresh); };
  }, [load]);
  const waiting = !!circle?.notifications.some(item => !terminal(item.state));
  useEffect(() => {
    if (!waiting && !circle?.private_session) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(waiting ? "notifications" : "all"); }, waiting ? TRUSTED_POLL_MS : 60000);
    return () => clearInterval(timer);
  }, [waiting, circle?.private_session, load]);

  async function notify(contactId: string) {
    if (writing.current || Date.now() < pauseUntil.current) return;
    writing.current = true; read.current = false; ++version.current;
    setSending(true); setError(null);
    try {
      const value = await api<Circle>(`trusted-circle/${transactionId}`, { method: "POST", body: JSON.stringify({ contact_id: contactId }) });
      setCircle(value);
    } catch (failure) {
      if (isCircleGuest(failure)) { setCircle(null); setError(null); setGuest(true); return; }
      setError(errorFor(failure));
      if (failure instanceof ApiError && failure.status === 429) pauseUntil.current = Date.now() + (failure.retryAfter || 60) * 1000;
    } finally { writing.current = false; setSending(false); }
  }

  if (guest) return historyOnly ? null : <CircleLogin onUnlocked={() => { setGuest(false); void load("all"); }} />;
  if (!circle) return <section className="trusted-circle"><strong>{m("trustedTitle")}</strong><p role="status">{m(error ?? "loading")}</p>
    {error && <button type="button" className="secondary" onClick={() => void load("all")}>{m("refresh")}</button>}</section>;
  if (historyOnly && circle.notifications.length === 0) return null;
  const contacts = circle.contacts ?? [];
  const notified = new Set(circle.notifications.map(item => item.contact_id));
  const alias = (id: string) => contacts.find(contact => contact.id === id)?.alias || m("trustedTitle");
  const suspicion = circle.notifications.some(item => item.state === "SUSPICION_REPORTED");
  const pending = contacts.filter(contact => !notified.has(contact.id));
  return <section className={`trusted-circle${suspicion ? " has-suspicion" : ""}`} aria-labelledby="trusted-title" data-state={circle.notifications.at(-1)?.state ?? circle.contact_state ?? "none"}>
    <h3 id="trusted-title"><UserRound size={17} aria-hidden="true" />{m("trustedTitle")}</h3>
    {circle.channel && <small>{m("notifyChannel")} · {circle.channel}</small>}
    {circle.notifications.length > 0 && <ul className="trusted-statuses" aria-live="polite">
      {circle.notifications.map(item => {
        const Icon = item.state === "SUSPICION_REPORTED" ? AlertTriangle : item.state === "CONTACT_ACKNOWLEDGED" ? Check : terminal(item.state) ? XCircle : Clock3;
        return <li key={item.id} className={`trusted-status state-${item.state.toLowerCase()}`} data-state={item.state}><Icon size={16} aria-hidden="true" /><span><b>{alias(item.contact_id)}</b>{m(item.state)}</span></li>;
      })}
    </ul>}
    {suspicion && <p className="trusted-suspicion" role="alert"><AlertTriangle size={16} aria-hidden="true" />{m("trustedSuspicion")}</p>}
    {circle.notifications.some(item => item.state === "NOTIFICATION_SENT") && <p className="trusted-note">{m("trustedSentNote")}</p>}
    {circle.notifications.length === 0 && <p className="trusted-note">{contacts.length ? m("trustedIntro") : `${m(circle.contact_state && circle.contact_state !== "CONTACT_VERIFIED" ? circle.contact_state : "CONTACT_NOT_CONFIGURED")}. ${m("trustedSetup")}`}</p>}
    {active && pending.length > 0 && <div className="trusted-actions">{pending.map(contact => <button key={contact.id} type="button" className="secondary trusted-notify" disabled={sending} onClick={() => void notify(contact.id)}>
      {sending ? <LoaderCircle className="animate-spin" size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}{sending ? m("trustedSending") : contacts.length > 1 ? `${m("trustedNotifyTo")}: ${contact.alias || m("trustedTitle")}` : m("trustedNotify")}
    </button>)}</div>}
    {error && <p className="error" role="alert">{m(error)}</p>}
    <button type="button" className="secondary" disabled={sending} onClick={() => void load("all")}>{m("refresh")}</button>
    {(contacts.length > 0 || circle.notifications.length > 0) && <p className="trusted-note">{m("trustedPowerless")}</p>}
  </section>;
}
