"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/contracts";
import { useLocale } from "@/lib/i18n";
import { mobileText } from "@/lib/mobile-copy";
import type { ContactState } from "@/lib/trusted-circle";

interface Member { id: string; alias: string; state: ContactState }
interface Invitation { contact: Member; invitation_token: string; expires_at: string; telegram_invitation_url?: string }
type CopyKey = Parameters<typeof mobileText>[1];
const path = "trusted-circle/members";

export function CircleMembers() {
  const { lang } = useLocale();
  const m = (key: CopyKey) => mobileText(lang, key);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [consent, setConsent] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CopyKey | null>(null);
  const pending = useRef(false);
  const readVersion = useRef(0);
  const retryAt = useRef(0);
  const report = (failure: unknown) => {
    if (failure instanceof ApiError && failure.status === 429) {
      retryAt.current = Date.now() + 1000 * (failure.retryAfter || 60);
      setError("trustedErrorBusy");
    } else if (failure instanceof ApiError && failure.code === "contact_limit_reached") setError("quota");
    else setError(navigator.onLine ? "trustedErrorUnavailable" : "offline");
  };
  const load = useCallback(async () => {
    if (pending.current || Date.now() < retryAt.current) return;
    const version = ++readVersion.current;
    try {
      const value = await api<{ contacts: Member[] }>(path);
      if (version !== readVersion.current) return;
      setMembers(value.contacts);
      setError(null);
      setInvitation(old => old && Date.parse(old.expires_at) > Date.now() && value.contacts.some(member =>
        member.id === old.contact.id && member.state === "CONTACT_PENDING_CONSENT") ? old : null);
    } catch (failure) { if (version === readVersion.current) report(failure); }
  }, []);
  useEffect(() => {
    if (!invitation) return;
    const expiry = setTimeout(() => setInvitation(null), Math.max(0, Date.parse(invitation.expires_at) - Date.now()));
    return () => clearTimeout(expiry);
  }, [invitation]);
  const awaitingConsent = members?.some(member => member.state === "CONTACT_PENDING_CONSENT");
  useEffect(() => {
    void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    return () => { ++readVersion.current; window.removeEventListener("online", refresh); window.removeEventListener("focus", refresh); };
  }, [load]);
  useEffect(() => {
    if (!awaitingConsent) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 10000);
    return () => clearInterval(timer);
  }, [awaitingConsent, load]);
  async function change(contactId?: string) {
    if (pending.current || Date.now() < retryAt.current || (!contactId && !consent)) return;
    pending.current = true;
    ++readVersion.current;
    setBusy(true); setError(null);
    try {
      if (contactId) {
        const member = await api<Member>(path, { method: "DELETE", body: JSON.stringify({ contact_id: contactId }) });
        setMembers(previous => previous?.map(item => item.id === member.id ? member : item) ?? null);
        setInvitation(old => old?.contact.id === contactId ? null : old);
        setConfirm(null);
      } else {
        const created = await api<Invitation>(path, { method: "POST", body: JSON.stringify({ owner_consent: true, language: lang }) });
        setInvitation(created);
        setMembers(previous => [...(previous ?? []), created.contact]);
        setConsent(false);
      }
    } catch (failure) {
      setMembers(null); setConsent(false); setConfirm(null); report(failure);
    } finally { pending.current = false; setBusy(false); }
  }
  const active = members?.filter(member => member.state !== "CONTACT_REVOKED").length ?? 0;
  return <section className="mobile-tool">
    <div className="tool-heading"><strong>{members && `${active} / 3`}</strong><button className="secondary" disabled={busy} onClick={() => void load()}>{m("refresh")}</button></div>
    <p className="muted">{m("guardianTestChat")} <a href="https://t.me/bekzat_bcc_shield_test_bot" target="_blank" rel="noopener noreferrer">@bekzat_bcc_shield_test_bot</a></p>
    {!members && !error && <p role="status">{m("loading")}</p>}
    {error && <p className="error" role="alert">{m(error)}</p>}
    {members && <>
      {!members.length && <p className="muted">{m("emptyCircle")}</p>}
      <ul className="circle-list">{members.map(member => <li key={member.id}>
        <span><b>{member.alias || `${m("member")} · ${member.id.slice(-4)}`}</b><small>{m(member.state)}</small></span>
        {member.state !== "CONTACT_REVOKED" && (confirm === member.id ? <div>
          <button className="danger-button" disabled={busy} onClick={() => void change(member.id)}>{m("confirmRevoke")}</button>
          <button className="secondary" disabled={busy} onClick={() => setConfirm(null)}>{m("back")}</button></div>
          : <button className="secondary" disabled={busy} onClick={() => setConfirm(member.id)}>{m("revoke")}</button>)}
      </li>)}</ul>
      {active < 3 ? <><label><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} /> {m("consent")}</label>
        <button className="primary" disabled={!consent || busy} onClick={() => void change()}>{m("invite")}</button></> : <p>{m("quota")}</p>}
    </>}
    {invitation && <div className="safety-result" role="status"><b>{m("invited")}</b><p>{m("inviteInstructions")}</p>
      <code dir="ltr">/start {invitation.invitation_token}</code>
      {invitation.telegram_invitation_url && <p><a href={invitation.telegram_invitation_url} target="_blank" rel="noopener noreferrer">{m("guardianInvitation")}</a></p>}
      <small>{m("expires")} · {new Date(invitation.expires_at).toLocaleTimeString(lang === "kk" ? "kk-KZ" : "ru-KZ")}</small></div>}
  </section>;
}
