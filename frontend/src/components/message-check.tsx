"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { api } from "@/lib/contracts";
import { useLocale } from "@/lib/i18n";
import { mobileText } from "@/lib/mobile-copy";
import { messageMatches, type SignalMatch } from "@/lib/message-check";
import { AttachMessageSignal } from "./attach-message-signal";
import { BankLinkCheck } from "./bank-link-check";

const guideSchema = z.object({
  questions: z.array(z.object({ field: z.string(), ru: z.string(), kk: z.string(), caution_answer: z.boolean() })).length(5),
  advice_ru: z.string(), advice_kk: z.string(),
});
type Guide = z.infer<typeof guideSchema>;

export function MessageCheck() {
  const { lang, t } = useLocale();
  const m = (key: Parameters<typeof mobileText>[1]) => mobileText(lang, key);
  const [input, setInput] = useState("");
  const [signals, setSignals] = useState<SignalMatch[] | null>(null);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    api("scam-check/guide", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) })
      .then(value => { if (!controller.signal.aborted) setGuide(guideSchema.parse(value)); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [reload]);
  return <section className="mobile-tool">
    <form onSubmit={event => { event.preventDefault(); setSignals(messageMatches(input)); setInput(""); setAnswers({}); }}>
      <label htmlFor="message-check-text">{m("inputMessage")}</label>
      <textarea id="message-check-text" maxLength={2000} rows={4} autoComplete="off" spellCheck={false} value={input}
        onChange={event => { setInput(event.target.value); setSignals(null); setAnswers({}); }} />
      <p className="muted">{m("privacy")}</p>
      <button className="primary" disabled={!input.trim()}>{m("checkMessage")}</button>
    </form>
    {signals && <div className="safety-result" role="status">
      <strong>{m(signals.length ? "flagged" : "noFlags")}</strong>
      {signals.length > 0 && <ul>{signals.map(({code, phrase}) => <li key={code}>
        <mark>{phrase}</mark><br />{m(code)}</li>)}</ul>}
      <p>{guide ? guide[lang === "kk" ? "advice_kk" : "advice_ru"] : m("advice")}</p>
    </div>}
    {!!signals?.length && <>
      <button type="button" className="secondary" onClick={() => { setSignals(null); setAnswers({}); }}>
        {lang === "kk" ? "Нәтижені тазарту" : "Очистить результат"}</button>
      <AttachMessageSignal codes={signals.map(item => item.code)} />
    </>}
    <BankLinkCheck />
    {guide && <details><summary>{m("questions")}</summary>{guide.questions.map(q => <fieldset key={q.field}>
      <legend>{q[lang]}</legend>{[true, false].map(value => <label key={String(value)}>
        <input type="radio" name={q.field} checked={answers[q.field] === value}
          onChange={() => setAnswers(previous => ({ ...previous, [q.field]: value }))} /> {t(value ? "yes" : "no")}
      </label>)}</fieldset>)}
      {Object.keys(answers).length === guide.questions.length && <div role="status"><b>{m(guide.questions.some(q => q.caution_answer === answers[q.field]) ? "flagged" : "noFlags")}</b>
        <ul>{guide.questions.filter(q => q.caution_answer === answers[q.field]).map(q => <li key={q.field}>{q[lang]}</li>)}</ul>
        <p>{guide[lang === "kk" ? "advice_kk" : "advice_ru"]}</p></div>}
    </details>}
    {!guide && <p role="status">{m("questions")} · {m(failed ? "trustedErrorUnavailable" : "loading")}
      {failed && <button type="button" className="secondary" onClick={() => setReload(n => n + 1)}>{m("refresh")}</button>}</p>}
  </section>;
}
