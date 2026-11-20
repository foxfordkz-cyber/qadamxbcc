"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Clock3, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { api, type Answers, type Context, type Evaluation } from "@/lib/contracts";
import { warningKeys } from "@/lib/biometrics";
import { remainingSeconds } from "@/lib/transfer-session";
import { completeCoolingAnswers, coolingQuestions as questions, firstCoolingStep } from "@/lib/cooling-flow";
import { mobileText } from "@/lib/mobile-copy";
import { errorKey, money, useLocale, type MessageKey } from "@/lib/i18n";
import { TrustedCircle } from "./trusted-circle";
import "./mobile-client.css";

type Props = { draftFailed: boolean; result: Evaluation; context: Partial<Context>; answers: Partial<Answers>; onAnswersChange: (value: Partial<Answers>) => void; onClose: () => void; onResolved: (value: Evaluation) => void };
export function CoolingModal({ draftFailed, result, context, answers, onAnswersChange, onClose, onResolved }: Props) {
  const { lang, setLang, t } = useLocale();
  const m = (key: Parameters<typeof mobileText>[1]) => mobileText(lang, key);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState(() => firstCoolingStep(answers));
  const [editing, setEditing] = useState(false);
  const [clock, setClock] = useState(() => ({ receivedAt: Date.now(), started: performance.now(), elapsed: 0 }));
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const notify = useRef(onResolved); notify.current = onResolved;
  const [error, setError] = useState<MessageKey | null>(null);
  const remaining = remainingSeconds(result, clock.elapsed, clock.receivedAt);
  const seconds = result.cooling_off_until && Number.isFinite(Date.parse(result.cooling_off_until)) && Number.isFinite(remaining) ? remaining : null;
  const unchanged = !!result.verification_answers && questions.every(q => result.verification_answers?.[q] === answers[q]);
  const answered = questions.filter(q => typeof answers[q] === "boolean").length;
  const reviewing = step === questions.length;
  const question = step >= 0 && !reviewing ? questions[step] : null;
  const stage = step < 0 ? 0 : reviewing ? 2 : 1;
  useEffect(() => { setClock({ receivedAt: Date.now(), started: performance.now(), elapsed: 0 }); }, [result.server_time]);
  useEffect(() => {
    let disposed = false;
    let refreshing = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (refreshing || inFlight.current || document.visibilityState !== "visible") return;
      refreshing = true;
      try {
        const value = await api<Evaluation>(`transfers/${result.transaction_id}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) });
        if (!disposed && !inFlight.current) notify.current(value);
      } catch { /* Reads never release funds. Explicit actions still verify on the server. */ }
      finally { refreshing = false; }
    };
    const visible = () => void refresh();
    const timer = setInterval(visible, 15000);
    document.addEventListener("visibilitychange", visible); window.addEventListener("focus", visible);
    return () => { disposed = true; clearInterval(timer); controller.abort(); document.removeEventListener("visibilitychange", visible); window.removeEventListener("focus", visible); };
  }, [result.transaction_id]);
  useEffect(() => {
    const element = dialog.current; const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; element?.showModal();
    const timer = setInterval(() => setClock(value => ({ ...value, elapsed: performance.now() - value.started })), 1000);
    return () => { clearInterval(timer); element?.close(); document.body.style.overflow = previousOverflow; if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => { heading.current?.focus(); dialog.current?.scrollTo({ top: 0 }); }, [step]);

  async function submit(cancel = false) {
    if (inFlight.current || (!cancel && !completeCoolingAnswers(answers))) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const value = await api<Evaluation>(`transfers/${result.transaction_id}/${cancel ? "cancel" : "resolve-cooling"}`, { method: "POST", body: JSON.stringify(cancel ? {} : { answers }) });
      onResolved(value);
    } catch (failure) {
      try {
        const current = await api<Evaluation>(`transfers/${result.transaction_id}`);
        if (current.status !== "cooling_off" || (!cancel && questions.every(q => current.verification_answers?.[q] === answers[q]))) { onResolved(current); return; }
      } catch { /* The same operation remains available for a safe retry. */ }
      setError(errorKey(failure));
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="cooling-modal mobile-cooling" data-step={step < 0 ? "intro" : reviewing ? "review" : "question"} aria-labelledby="cooling-title" aria-describedby="cooling-description" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="cooling-toolbar"><span className="sheet-mark" aria-hidden="true"><ShieldCheck size={18} /></span><span className="sheet-wordmark">saq<span> bol</span></span><div className="language" aria-label={t("language")}>{(["kk", "ru"] as const).map(value => <button type="button" key={value} aria-pressed={lang === value} onClick={() => setLang(value)}>{value === "kk" ? "ҚАЗ" : "РУС"}</button>)}</div><button type="button" className="sheet-close" aria-label={t("leaveHeld")} disabled={busy} onClick={onClose}><X size={20} /></button></div>
    <ol className="cooling-stages" aria-label={t("securityCheck")}>{(["coolingIntroStep", "coolingQuestionsStep", "coolingReviewStep"] as const).map((key, index) => <li key={key} className={index <= stage ? "active" : ""} aria-current={index === stage ? "step" : undefined}><span>{index < stage ? <Check size={12} /> : index + 1}</span>{m(key)}</li>)}</ol>
    <div className="cooling-transfer"><div><small>{m("coolingSummary")}</small><strong>{result.amount === undefined ? "— ₸" : money(result.amount, lang)}</strong><span>{result.recipient.display_name} · {result.recipient.iban_masked}</span></div><div className="cooling-clock" role="timer" aria-label={t("remaining")}><Clock3 size={16} aria-hidden="true" /><strong className="tabular-nums">{seconds === null ? "—" : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`}</strong><small>{t("remaining")}</small></div></div>
    {seconds === null && <p className="cooling-time-note" role="status">{m("coolingMissing")}</p>}{seconds === 0 && <p className="cooling-time-note" role="status">{t("expired")}</p>}
    <div className="cooling-step-content" key={step}>
      <h2 id="cooling-title" ref={heading} tabIndex={-1}>{t(step < 0 ? "coolingTitle" : "securityCheck")}</h2><p id="cooling-description" className="muted">{step < 0 ? t("coolingText") : m(reviewing ? "coolingReviewHint" : "coolingAnswerHint")}</p>
      {step < 0 && <><aside className="ai-warning"><strong><AlertTriangle size={17} aria-hidden="true" />{t("aiWarning")}</strong><ul>{warningKeys(context, result.reasons).map(key => <li key={key}>{t(key)}</li>)}</ul></aside><p className="cooling-advice"><ShieldCheck size={21} />{m("coolingAdvice")}</p><p className="cooling-legal">{t("legalPause")}</p><button type="button" className="primary cooling-wide cooling-start" onClick={() => setStep(0)}>{m("coolingStart")}<ArrowRight size={18} /></button></>}
      {question && <><div className="verification-progress"><span>{m("coolingQuestion")} {step + 1} / {questions.length}</span><strong>{answered} / {questions.length}</strong></div><progress className="cooling-progress" value={answered} max={questions.length} aria-label={t("verificationProgress")} /><fieldset className="cooling-question" disabled={busy}><legend>{t(question)}</legend><div className="cooling-choices">{[true, false].map(value => <label key={String(value)}><input type="radio" name={question} checked={answers[question] === value} onChange={() => { onAnswersChange({ ...answers, [question]: value }); }} /><span>{t(value ? "yes" : "no")}</span>{answers[question] === value && <Check size={18} />}</label>)}</div></fieldset><div className="cooling-navigation"><button type="button" className="secondary cooling-back" onClick={() => { setStep(editing ? questions.length : step - 1); setEditing(false); }}><ArrowLeft size={16} />{m("coolingBack")}</button><button type="button" className="primary cooling-next" disabled={typeof answers[question] !== "boolean"} onClick={() => { setStep(editing ? questions.length : step + 1); setEditing(false); }}>{m("coolingNext")}<ArrowRight size={16} /></button></div></>}
      {reviewing && <form onSubmit={event => { event.preventDefault(); void submit(); }}><h3 className="cooling-review-title">{m("coolingReview")}</h3><ol className="cooling-review-list">{questions.map((q, index) => <li key={q}><span>{t(q)}<strong>{typeof answers[q] === "boolean" ? t(answers[q] ? "yes" : "no") : "—"}</strong></span><button type="button" className="cooling-edit" disabled={busy} aria-label={`${m("coolingEdit")}: ${t(q)}`} onClick={() => { setEditing(true); setStep(index); }}>{m("coolingEdit")}</button></li>)}</ol><p className="muted mt-4 text-xs" role="status">{t(unchanged && seconds !== 0 ? "answersSaved" : "confirmNote")}</p><button className="primary cooling-wide cooling-submit" disabled={busy || !completeCoolingAnswers(answers) || (unchanged && seconds !== 0)}>{busy ? <LoaderCircle className="animate-spin" size={17} /> : <ShieldCheck size={17} />}{t(seconds === 0 ? "releaseTransfer" : "confirm")}</button></form>}
    </div>
    <TrustedCircle transactionId={result.transaction_id} active={result.status === "cooling_off" && seconds !== null && seconds > 0} />
    {error && <p role="alert" className="error">{t(error)}</p>}
    <div className="cooling-later"><button type="button" className="secondary" disabled={busy} onClick={onClose}>{t("leaveHeld")}</button><button type="button" className="danger-button" disabled={busy} onClick={() => void submit(true)}><X size={16} />{t("cancelTransfer")}</button><p>{m(draftFailed ? "draftFailed" : "coolingDraftHint")}</p><p>{t("cancelNote")}</p></div>
  </dialog>;
}
