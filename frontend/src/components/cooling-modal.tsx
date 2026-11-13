"use client";

import { useEffect, useRef, useState } from "react";
import { Clock3, LoaderCircle } from "lucide-react";
import { api, type Answers, type Decision, type Evaluation } from "@/lib/contracts";
import { errorKey, useLocale, type MessageKey } from "@/lib/i18n";

const questions: (keyof Answers)[] = ["caller_claims_bank_or_police", "asked_to_move_to_safe_account", "asked_to_keep_secret_or_install_app", "initiated_by_customer", "knows_recipient_personally"];

export function CoolingModal({ result, onClose, onResolved }: { result: Evaluation; onClose: () => void; onResolved: (value: Decision) => void }) {
  const { lang, setLang, t } = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const [answers, setAnswers] = useState<Partial<Answers>>({});
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const seconds = Math.max(0, Math.ceil(((result.cooling_off_until ? Date.parse(result.cooling_off_until) : now) - now) / 1000));
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(timer); element?.close(); if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  async function submit() {
    if (inFlight.current || !questions.every(q => typeof answers[q] === "boolean")) return;
    inFlight.current = true; setBusy(true); setError(null);
    try { onResolved(await api<Decision>(`transfers/${result.transaction_id}/resolve-cooling`, { method: "POST", body: JSON.stringify({ answers }) })); }
    catch (e) { setError(errorKey(e)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="cooling-modal" aria-labelledby="cooling-title" aria-describedby="cooling-description" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <div className="flex items-center justify-between gap-3"><span className="badge cooling_off"><Clock3 size={15} />{t("cooling_off")} · 15:00</span>
      <div className="language" aria-label={t("language")}>{(["kk", "ru"] as const).map(l => <button type="button" key={l} aria-pressed={lang === l} onClick={() => setLang(l)}>{l === "kk" ? "ҚАЗ" : "РУС"}</button>)}</div>
    </div>
    <h2 id="cooling-title">{t("coolingTitle")}</h2><p id="cooling-description" className="muted">{t("coolingText")}</p>
    <div className="countdown"><span>{t("remaining")}</span><strong>{String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}</strong></div>
    {seconds === 0 && <p className="muted">{t("expired")}</p>}
    <form onSubmit={e => { e.preventDefault(); void submit(); }}>
      <fieldset disabled={busy} className="space-y-3 border-0 p-0">
        {questions.map((q, index) => <fieldset key={q} className="question"><legend>{index + 1}. {t(q)}</legend><div className="flex gap-3">{[true, false].map(value => <label key={String(value)}><input type="radio" name={q} required checked={answers[q] === value} onChange={() => setAnswers(a => ({ ...a, [q]: value }))} />{t(value ? "yes" : "no")}</label>)}</div></fieldset>)}
      </fieldset>
      <p className="muted mt-4 text-xs">{t("confirmNote")}</p>
      {error && <p role="alert" className="error">{t(error)}</p>}
      <div className="mt-5 flex flex-wrap gap-3"><button className="primary flex-1" disabled={busy || !questions.every(q => typeof answers[q] === "boolean")}>{busy && <LoaderCircle className="animate-spin" size={16} />}{t("confirm")}</button><button type="button" className="secondary" disabled={busy} onClick={onClose}>{t("cancel")}</button></div>
      <p className="muted mt-3 text-xs">{t("cancelNote")}</p>
    </form>
  </dialog>;
}
