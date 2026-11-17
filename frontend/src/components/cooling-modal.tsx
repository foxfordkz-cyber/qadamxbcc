"use client";

import { useEffect, useRef, useState } from "react";
import { Clock3, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { api, type Answers, type Context, type Evaluation } from "@/lib/contracts";
import { warningKeys } from "@/lib/biometrics";
import { remainingSeconds } from "@/lib/transfer-session";
import { errorKey, useLocale, type MessageKey } from "@/lib/i18n";

const questions: (keyof Answers)[] = ["caller_claims_bank_or_police", "asked_to_move_to_safe_account", "asked_to_keep_secret_or_install_app", "initiated_by_customer", "knows_recipient_personally"];

export function CoolingModal({ result, context, onClose, onResolved }: { result: Evaluation; context: Partial<Context>; onClose: () => void; onResolved: (value: Evaluation) => void }) {
  const { lang, setLang, t } = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const [answers, setAnswers] = useState<Partial<Answers>>(result.verification_answers ?? {});
  const [clock, setClock] = useState(() => ({ receivedAt: Date.now(), started: performance.now(), elapsed: 0 }));
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const seconds = remainingSeconds(result, clock.elapsed, clock.receivedAt);
  const unchanged = !!result.verification_answers && questions.every(q => result.verification_answers?.[q] === answers[q]);
  useEffect(() => { setClock({ receivedAt: Date.now(), started: performance.now(), elapsed: 0 }); }, [result.server_time]);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.showModal();
    const timer = setInterval(() => setClock(value => ({ ...value, elapsed: performance.now() - value.started })), 1000);
    return () => { clearInterval(timer); element?.close(); document.body.style.overflow = previousOverflow; if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  async function submit(cancel = false) {
    if (inFlight.current || (!cancel && !questions.every(q => typeof answers[q] === "boolean"))) return;
    inFlight.current = true; setBusy(true); setError(null);
    try { onResolved(await api<Evaluation>(`transfers/${result.transaction_id}/${cancel ? "cancel" : "resolve-cooling"}`, { method: "POST", body: JSON.stringify(cancel ? {} : { answers }) })); }
    catch (e) {
      // A lost response or another operator's action must not leave a stale hold on screen.
      try { const current = await api<Evaluation>(`transfers/${result.transaction_id}`); if (current.status !== "cooling_off") { onResolved(current); return; } } catch { /* Keep the same transaction available for retry. */ }
      setError(errorKey(e));
    }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="cooling-modal" aria-labelledby="cooling-title" aria-describedby="cooling-description" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <div className="flex items-center justify-between gap-3"><span className="badge cooling_off"><Clock3 size={15} />{t("cooling_off")}</span>
      <div className="language" aria-label={t("language")}>{(["kk", "ru"] as const).map(l => <button type="button" key={l} aria-pressed={lang === l} onClick={() => setLang(l)}>{l === "kk" ? "ҚАЗ" : "РУС"}</button>)}</div>
    </div>
    <div className="security-sheet-brand"><span className="sheet-shield"><ShieldCheck size={30} /></span><div><strong>bcc.kz</strong><span>{t("securityCheck")}</span></div></div>
    <h2 id="cooling-title">{t("coolingTitle")}</h2><p id="cooling-description" className="muted">{t("coolingText")}</p>
    <aside className="ai-warning"><strong><ShieldCheck size={17} />{t("aiWarning")}</strong>{warningKeys(context, result.reasons).map(key => <p key={key}>{t(key)}</p>)}</aside>
    <div className="countdown"><span>{t("remaining")}</span><strong>{String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}</strong></div>
    {seconds === 0 && <p className="muted">{t("expired")}</p>}
    <div className="verification-progress"><span>{t("verificationProgress")}</span><strong>{questions.filter(q => typeof answers[q] === "boolean").length} / {questions.length}</strong></div>
    <form onSubmit={e => { e.preventDefault(); void submit(); }}>
      <fieldset disabled={busy} className="space-y-3 border-0 p-0">
        {questions.map((q, index) => <fieldset key={q} className="question"><legend>{index + 1}. {t(q)}</legend><div className="flex gap-3">{[true, false].map(value => <label key={String(value)}><input type="radio" name={q} required checked={answers[q] === value} onChange={() => setAnswers(a => ({ ...a, [q]: value }))} />{t(value ? "yes" : "no")}</label>)}</div></fieldset>)}
      </fieldset>
      <p className="muted mt-4 text-xs" role="status">{t(unchanged && seconds > 0 ? "answersSaved" : "confirmNote")}</p>
      {error && <p role="alert" className="error">{t(error)}</p>}
      <div className="mt-5 flex flex-wrap gap-3"><button className="primary flex-1" disabled={busy || !questions.every(q => typeof answers[q] === "boolean") || (unchanged && seconds > 0)}>{busy && <LoaderCircle className="animate-spin" size={16} />}{t(seconds === 0 ? "releaseTransfer" : "confirm")}</button><button type="button" className="secondary" disabled={busy} onClick={onClose}>{t("leaveHeld")}</button></div>
      <button type="button" className="danger-button mt-3" disabled={busy} onClick={() => void submit(true)}><X size={16} />{t("cancelTransfer")}</button>
      <p className="muted mt-3 text-xs">{t("cancelNote")}</p>
    </form>
  </dialog>;
}
