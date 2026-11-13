"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ArrowLeft, ArrowRight, Check, Clock3, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { api, type Answers, type Context, type Decision, type Evaluation } from "@/lib/contracts";
import { warningKeys } from "@/lib/biometrics";
import { completeAnswers, coolingQuestions as questions, remainingSeconds } from "@/lib/cooling";
import { errorKey, money, useLocale, type MessageKey } from "@/lib/i18n";

interface Props {
  result: Evaluation;
  amount: string;
  context: Partial<Context>;
  answers: Partial<Answers>;
  setAnswers: Dispatch<SetStateAction<Partial<Answers>>>;
  onClose: () => void;
  onResolved: (value: Decision) => void;
}

export function CoolingModal({ result, amount, context, answers, setAnswers, onClose, onResolved }: Props) {
  const { lang, setLang, t } = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState(() => {
    const first = questions.findIndex(q => typeof answers[q] !== "boolean");
    return first === -1 ? questions.length : first === 0 ? -1 : first;
  });
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const seconds = remainingSeconds(result.cooling_off_until, now);
  const answered = questions.filter(q => typeof answers[q] === "boolean").length;
  const reviewing = step === questions.length;
  const question = step >= 0 && !reviewing ? questions[step] : null;
  const stage = step < 0 ? 0 : reviewing ? 2 : 1;

  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.showModal();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer); element?.close(); document.body.style.overflow = previousOverflow;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => { heading.current?.focus(); dialog.current?.scrollTo({ top: 0 }); }, [step]);

  async function submit() {
    if (inFlight.current || !completeAnswers(answers)) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      onResolved(await api<Decision>(`transfers/${result.transaction_id}/resolve-cooling`, {
        method: "POST", body: JSON.stringify({ answers }),
      }));
    } catch (e) { setError(errorKey(e)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <dialog ref={dialog} className="cooling-modal mobile-cooling" aria-labelledby="cooling-title" aria-describedby="cooling-description"
    onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <div className="cooling-toolbar"><span className="sheet-wordmark">bcc<span> shield</span></span>
      <div className="language" aria-label={t("language")}>{(["kk", "ru"] as const).map(l => <button type="button" key={l} aria-pressed={lang === l} onClick={() => setLang(l)}>{l === "kk" ? "ҚАЗ" : "РУС"}</button>)}</div>
      <button type="button" className="sheet-close" aria-label={t("holdLater")} disabled={busy} onClick={onClose}><X size={20} /></button>
    </div>
    <ol className="cooling-steps" aria-label={t("securityCheck")}>{(["checkStep", "reviewStep", "decisionStep"] as const).map((key, index) =>
      <li key={key} className={index <= stage ? "active" : ""} aria-current={index === stage ? "step" : undefined}><span>{index < stage ? <Check size={12} /> : index + 1}</span>{t(key)}</li>
    )}</ol>
    <div className="cooling-transfer"><div><small>{t("coolingSummary")}</small><strong>{money(amount, lang)}</strong><span>{result.recipient.display_name}</span></div>
      <div className="cooling-clock" role="timer" aria-label={t("remaining")}><Clock3 size={17} /><strong>{seconds === null ? "—" : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`}</strong><small>{t("remaining")}</small></div>
    </div>
    {seconds === null && <p className="cooling-time-note">{t("coolingTimerMissing")}</p>}
    {seconds === 0 && <p className="cooling-time-note" role="status">{t("coolingExpiredHint")}</p>}
    <div className="cooling-step-content" key={step}>
      <h2 id="cooling-title" ref={heading} tabIndex={-1}>{t(step < 0 ? "coolingTitle" : reviewing ? "coolingReview" : "securityCheck")}</h2>
      <p id="cooling-description" className="muted">{t(step < 0 ? "coolingText" : reviewing ? "coolingReviewHint" : "coolingTimingHint")}</p>
      {step < 0 && <>
        <aside className="ai-warning"><strong><ShieldCheck size={17} />{t("aiWarning")}</strong>{warningKeys(context, result.reasons).map(key => <p key={key}>{t(key)}</p>)}</aside>
        <p className="cooling-advice"><ShieldCheck size={22} />{t("coolingAdvice")}</p>
        <button type="button" className="primary cooling-wide" onClick={() => setStep(0)}>{t("coolingStart")}<ArrowRight size={18} /></button>
      </>}
      {question && <>
        <div className="verification-progress"><span>{t("coolingQuestion")} {step + 1} / {questions.length}</span><strong>{answered} / {questions.length}</strong></div>
        <progress className="cooling-progress" value={answered} max={questions.length} aria-label={t("verificationProgress")} />
        <fieldset className="cooling-question" disabled={busy}><legend>{t(question)}</legend>
          <div className="cooling-choices">{[true, false].map(value => <label key={String(value)}><input type="radio" name={question} checked={answers[question] === value} onChange={() => setAnswers(previous => ({ ...previous, [question]: value }))} /><span>{t(value ? "yes" : "no")}</span>{answers[question] === value && <Check size={18} />}</label>)}</div>
        </fieldset>
        <div className="cooling-navigation"><button type="button" className="secondary" onClick={() => setStep(step - 1)}><ArrowLeft size={16} />{t("coolingBack")}</button>
          <button type="button" className="primary" disabled={typeof answers[question] !== "boolean"} onClick={() => setStep(step + 1)}>{t("coolingNext")}<ArrowRight size={16} /></button></div>
      </>}
      {reviewing && <form onSubmit={e => { e.preventDefault(); void submit(); }}>
        <ol className="cooling-review">{questions.map((q, index) => <li key={q}><span>{t(q)}<strong>{t(answers[q] ? "yes" : "no")}</strong></span><button type="button" disabled={busy} onClick={() => setStep(index)} aria-label={`${t("editAnswer")}: ${t(q)}`}>{t("editAnswer")}</button></li>)}</ol>
        <p className="muted">{t("confirmNote")}</p>
        {error && <p role="alert" className="error">{t(error)}</p>}
        <button className="primary cooling-wide" disabled={busy || !completeAnswers(answers)}>{busy ? <LoaderCircle className="animate-spin" size={18} /> : <ShieldCheck size={18} />}{t("confirm")}</button>
      </form>}
    </div>
    <div className="cooling-later"><button type="button" disabled={busy} onClick={onClose}>{t("holdLater")}</button><p>{t("holdLaterHint")}</p></div>
  </dialog>;
}
