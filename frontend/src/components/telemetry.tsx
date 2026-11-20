"use client";

import { ChevronDown, Clock3 } from "lucide-react";
import { MLInspector } from "./ml-inspector";
import type { Biometrics } from "./use-biometrics";
import type { CallCheck, Context, Evaluation } from "@/lib/contracts";
import { money, useLocale, type MessageKey } from "@/lib/i18n";
import { Badge, Explain, Gauge } from "./risk";

type Props = { callCheck?: CallCheck | null; result: Evaluation | null; amount: string; roundtrip: number; busy: boolean; error?: MessageKey | null; onReview: () => void; sensor: Biometrics; sender?: string; context?: Partial<Context> };

/** What Saq Bol sees while the client fills in the transfer, then its decision. */
export function Telemetry({ callCheck, result, amount, roundtrip, busy, error, onReview, sensor, sender, context }: Props) {
  const { lang, t } = useLocale();
  const snap = sensor.snapshot;
  const typing = snap.typing_duration_ms == null ? "—" : `${snap.typing_duration_ms.toLocaleString(lang === "kk" ? "kk-KZ" : "ru-KZ")} ${t("ms")} · ${snap.hesitation_count} ${t("sigPauses")}`;
  const signals: { key: string; label: MessageKey; value: string; risk: boolean }[] = [
    { key: "call", label: "sigCall", value: t(context?.active_call ? "sigCallOn" : "sigNo"), risk: !!context?.active_call },
    ...(context?.payment_requested_after_call ? [{ key: "reported-call-request", label: "reportedCallRequest" as const, value: t("sigYes"), risk: true }] : []),
    { key: "bank-log", label: "sigBankLog", value: callCheck ? t(callCheck.verified ? "sigBankCalling" : "sigBankNotCalling") : context?.active_call ? t("sigChecking") : "—", risk: !!callCheck && !callCheck.verified },
    { key: "deposit", label: "sigDeposit", value: t(context?.from_deposit ? "sigYes" : "sigNo"), risk: !!context?.from_deposit },
    { key: "paste", label: "sigRequisites", value: snap.pasted_recipient ? t("pasteDetected") : snap.edits ? t("sigTyped") : "—", risk: !!snap.pasted_recipient },
    { key: "typing", label: "sigTyping", value: typing, risk: false },
    { key: "device", label: "sigDevice", value: t(context?.is_new_device ? "sigNewDevice" : "sigKnownDevice"), risk: !!context?.is_new_device },
  ];
  return <aside className="telemetry-column">
    <section className="panel telemetry-panel" aria-live="polite" aria-busy={busy} aria-labelledby="telemetry-title">
      <header className="telemetry-heading">
        <div><h2 id="telemetry-title">{t("decisionPanel")}</h2><p>{t("decisionPanelHint")}</p></div>
        {result ? <Badge status={result.status} /> : busy ? <span className="neutral-badge">{t("evaluating")}</span> : null}
      </header>

      <ul className="signal-list" aria-label={t("decisionPanel")}>
        {signals.map(signal => <li key={signal.key} className={signal.risk ? "risk" : ""}><span>{t(signal.label)}</span><b className="tabular-nums">{signal.value}</b></li>)}
      </ul>

      {result ? <div className="decision-block">
        <div className="decision-top"><Gauge score={result.risk_score} /><div className="decision-summary"><strong className="result-amount tabular-nums">{money(amount, lang)}</strong><p className="result-headline">{lang === "kk" ? result.headline_kk : result.headline_ru}</p><p className="muted">{result.recipient.display_name} · {result.recipient.iban_masked}</p></div></div>
        <Explain kk={result.reasons_kk} ru={result.reasons_ru} />
        {result.status === "cooling_off" && <button className="primary review-button" onClick={onReview}><Clock3 size={18} />{t("review")}</button>}
      </div> : <p className="decision-wait" role="status">{error && !busy ? t(error) : t(busy ? "evaluating" : "sigWaiting")}</p>}

      <div className="threshold-strip"><span className="low"><b className="tabular-nums">0–39</b>{t("low")}</span><span className="medium"><b className="tabular-nums">40–74</b>{t("medium")}</span><span className="high"><b className="tabular-nums">75–100</b>{t("high")}</span></div>

      <details className="tech-details">
        <summary>{t("techDetails")}<ChevronDown size={16} aria-hidden="true" /></summary>
        <dl className="tech-grid" aria-label={t("technicalDetails")}>
          <div><dt>{t("latency")}</dt><dd className="tabular-nums">{result ? `${result.latency_ms.toFixed(2)} ${t("ms")}` : "—"}</dd></div>
          <div><dt>{t("roundtrip")}</dt><dd className="tabular-nums">{result ? `${roundtrip.toFixed(0)} ${t("ms")}` : "—"}</dd></div>
          <div className="wide"><dt>{t("caseId")}</dt><dd><code>{result?.transaction_id ?? "—"}</code></dd></div>
          <div className="wide"><dt>{t("senderAccount")}</dt><dd><code>{sender || "—"}</code></dd></div>
        </dl>
        {result && <MLInspector details={result} reasons={result.reasons} />}
      </details>
    </section>
  </aside>;
}
