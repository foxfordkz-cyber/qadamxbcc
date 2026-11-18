"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Clock3, LoaderCircle, Send, UserRound, XCircle } from "lucide-react";
import { api, ApiError } from "@/lib/contracts";
import { mobileText } from "@/lib/mobile-copy";
import { useLocale } from "@/lib/i18n";

// Mirrors the BFF response of /api/v1/trusted-circle/{id}; no tokens or chat addresses reach the browser.
type NotificationState = "NOTIFICATION_QUEUED" | "NOTIFICATION_SENT" | "CONTACT_ACKNOWLEDGED" | "SUSPICION_REPORTED" | "DELIVERY_FAILED" | "CONTACT_REVOKED" | "NOTIFICATION_EXPIRED";
type ContactState = "CONTACT_NOT_CONFIGURED" | "CONTACT_PENDING_CONSENT" | "CONTACT_VERIFIED" | "CONTACT_REVOKED";
interface Circle { contact_state?: ContactState | null; contacts?: { id: string; alias: string }[]; notifications: { id: string; contact_id: string; state: NotificationState; expires_at: string }[] }

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
export function TrustedCircle({ transactionId, active }: { transactionId: string; active: boolean }) {
  const { lang } = useLocale();
  const m = (key: Parameters<typeof mobileText>[1]) => mobileText(lang, key);
  const [circle, setCircle] = useState<Circle | null>(null);
  const [hidden, setHidden] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const pauseUntil = useRef(0);
  const polling = useRef(false);
  const load = useCallback(async (scope: "all" | "notifications", signal?: AbortSignal) => {
    if (polling.current || Date.now() < pauseUntil.current) return;
    polling.current = true;
    try {
      const value = await api<Circle>(`trusted-circle/${transactionId}${scope === "notifications" ? "?scope=notifications" : ""}`, signal ? { signal } : undefined);
      setCircle(previous => ({ ...previous, ...value }));
    } catch (failure) {
      if (signal?.aborted) return;
      if (failure instanceof ApiError && (failure.code === "unavailable" || failure.status === 404)) setHidden(true);
      else if (failure instanceof ApiError && failure.code === "rateLimited") pauseUntil.current = Date.now() + 15_000;
    } finally { polling.current = false; }
  }, [transactionId]);
  useEffect(() => {
    const controller = new AbortController();
    void load("all", controller.signal);
    return () => controller.abort();
  }, [load]);
  const waiting = !!circle?.notifications.some(item => !terminal(item.state));
  useEffect(() => {
    if (!waiting) return;
    const controller = new AbortController();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load("notifications", controller.signal); }, TRUSTED_POLL_MS);
    return () => { clearInterval(timer); controller.abort(); };
  }, [waiting, load]);

  async function notify(contactId: string) {
    if (sending) return;
    setSending(true); setError(null);
    try { const value = await api<Circle>(`trusted-circle/${transactionId}`, { method: "POST", body: JSON.stringify({ contact_id: contactId }) }); setCircle(previous => ({ ...previous, ...value })); }
    catch (failure) {
      const key = errorFor(failure); setError(key);
      if (key === "trustedErrorUnavailable") setHidden(true);
      void load("all");
    } finally { setSending(false); }
  }

  if (hidden || !circle) return null;
  const contacts = circle.contacts ?? [];
  const notified = new Set(circle.notifications.map(item => item.contact_id));
  const alias = (id: string) => contacts.find(contact => contact.id === id)?.alias || m("trustedTitle");
  const suspicion = circle.notifications.some(item => item.state === "SUSPICION_REPORTED");
  const pending = contacts.filter(contact => !notified.has(contact.id));
  return <section className={`trusted-circle${suspicion ? " has-suspicion" : ""}`} aria-labelledby="trusted-title" data-state={circle.notifications.at(-1)?.state ?? circle.contact_state ?? "none"}>
    <h3 id="trusted-title"><UserRound size={17} aria-hidden="true" />{m("trustedTitle")}</h3>
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
    {(contacts.length > 0 || circle.notifications.length > 0) && <p className="trusted-note">{m("trustedPowerless")}</p>}
  </section>;
}
