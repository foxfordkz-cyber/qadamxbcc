"use client";

import { useEffect, useState } from "react";
import { Check, Clock3, Copy, Download, FileText, Fingerprint, RefreshCw, ShieldCheck } from "lucide-react";
import type { Evaluation } from "@/lib/contracts";
import { caseReport } from "@/lib/case-report";
import { caseTimeline } from "@/lib/case-timeline";
import { policeReportHtml } from "@/lib/police-report";
import { money, useLocale, type MessageKey } from "@/lib/i18n";
import { Badge, Gauge } from "./risk";
import { RecipientFlagControls } from "./recipient-flag-controls";
import { ReturnReviewControls } from "./incoming-returns";
import { DecisionEvidence } from "./decision-evidence";
import { FundsTracePanel } from "./funds-trace-panel";

type Props = { traceRevision?: number; detail: Evaluation | null; loading: boolean; error: MessageKey | null; receivedAt: number | null; selectedId: string | null; onReview?: (id: string) => void; onSelectReceipt?: (id: string) => void; readOnly?: boolean; busy: boolean; onRetry: () => void };
const nextSteps = { approved: "caseNextApproved", cooling_off: "caseNextHeld", blocked: "caseNextBlocked", cancelled: "caseNextCancelled" } as const;
const signals = { active_call: "active_call", from_deposit: "from_deposit", is_new_device: "is_new_device", is_new_recipient: "is_new_recipient", pasted_recipient: "pasteDetected" } as const;

export function PoliceReportButton({ onOpen, disabled }: { onOpen: () => void; disabled?: boolean }) {
  const { t } = useLocale();
  return <button type="button" className="secondary police-report" disabled={disabled} onClick={onOpen}><FileText size={16} />{t("policeReport")}</button>;
}

export function CaseInspector({ traceRevision = 0, detail, loading, error, receivedAt, selectedId, onReview, onSelectReceipt, readOnly, busy, onRetry }: Props) {
  const { t, lang } = useLocale();
  const [notice, setNotice] = useState<MessageKey | null>(null);
  useEffect(() => { setNotice(null); }, [selectedId]);
  const current = detail?.transaction_id === selectedId ? detail : null;
  const date = (value: string | number) => new Date(value).toLocaleString(lang === "kk" ? "kk-KZ" : "ru-KZ", { timeZone: "Asia/Qyzylorda", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  async function copyId() {
    if (!current) return;
    try { await navigator.clipboard.writeText(current.transaction_id); setNotice("caseIdCopied"); }
    catch { setNotice("copyCaseFailed"); }
  }
  function download() {
    if (!current || error || loading) return;
    let url: string | null = null;
    try {
      url = URL.createObjectURL(new Blob([JSON.stringify(caseReport(current, lang), null, 2)], { type: "application/json;charset=utf-8" }));
      const anchor = document.createElement("a"); anchor.href = url;
      anchor.download = `bcc-shield-${current.transaction_id}.json`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      const downloadUrl = url; setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setNotice(null);
    } catch { if (url) URL.revokeObjectURL(url); setNotice("caseExportFailed"); }
  }
  function policeReport() {
    if (!current || error || loading) return;
    // A blob page opened from this click: printable, saved as PDF by the browser, no server round trip.
    const url = URL.createObjectURL(new Blob([policeReportHtml(current, lang, t)], { type: "text/html;charset=utf-8" }));
    // "noopener" makes window.open return null even on success, so a blocked pop-up is not detectable here.
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setNotice(null);
  }
  const story = current ? caseTimeline(current) : [];
  const active = current ? (Object.keys(signals) as (keyof typeof signals)[]).filter(key => current.context?.[key] === true) : [];
  const callAnswer = current?.context?.call_pressure_answer;
  const callLabels = { on_call: "callOwnerOnCall", after_call: "callOwnerAfterCall", no_request: "callOwnerNoRequest" } as const;
  return <section className="panel case-panel investigation-card" aria-label={t("caseDetails")} data-transaction-id={selectedId ?? ""} aria-busy={loading}>
    <div className="case-heading"><h2>{t("caseDetails")}</h2>{current && <Badge status={current.status} />}</div>
    {error && <div className="investigation-error" role="alert"><strong>{t("caseUnavailable")}</strong><p>{t(error)}</p><button className="secondary" onClick={onRetry} disabled={loading}><RefreshCw size={15} />{t("retryCase")}</button></div>}
    {loading && <p className="muted text-xs" role="status">{t("caseRefreshing")}</p>}
    {!current ? <p className="empty">{t(selectedId ? error ? "caseUnavailable" : "refreshing" : "select")}</p> : <>
      <div className="investigation-summary"><strong>{current.amount === undefined ? "— ₸" : money(current.amount, lang)}</strong><Gauge compact score={current.risk_score} /></div>
      <p className="case-recipient">{current.recipient.display_name} · {current.recipient.iban_masked}</p>
      <dl className="tech-grid">
        <div><dt>{t("callOwnerStatement")}</dt><dd>{t(callAnswer ? callLabels[callAnswer] : "callOwnerUnknown")}
          {callAnswer && current.created_at && <> · {date(current.created_at)}</>}</dd></div>
        {current.bank_call_evidence && <div><dt>{t("sigBankLog")}</dt>
          <dd>{t(current.bank_call_evidence.outbound_call_listed ? "sigBankCalling" : "sigBankNotCalling")} · {date(current.bank_call_evidence.checked_at)}</dd></div>}
      </dl>
      {!readOnly && current.reasons.some(reason => reason.code === "RETURN_REDIRECT_REPORTED") && (
        <ReturnReviewControls
          key={`${current.transaction_id}/${current.updated_at ?? current.reasons.length}`}
          id={current.transaction_id}
          disabled={loading || !!error || busy}
          onChanged={onRetry}
        />
      )}
      {!readOnly && <RecipientFlagControls key={current.recipient.id} accountId={current.recipient.id} disabled={loading || !!error || busy} onChanged={onRetry} onSelect={onSelectReceipt} />}
      {typeof current.ml_score === "number" && <div className="investigation-model"><span className="ml-badge ready" title={t("mlScoreHint")}>{t("mlScore")}: {current.ml_score.toFixed(1)}%</span><small>{current.ml_model_version}</small></div>}
      <div className="investigation-id"><span>{t("caseId")}</span><code className="tabular-nums">{current.transaction_id}</code><button onClick={() => void copyId()} aria-label={t("copyCaseId")} title={t("copyCaseId")}><Copy size={15} /></button></div>
      {receivedAt !== null && <p className="investigation-updated">{error ? `${t("staleData")} · ` : ""}{t("lastUpdated")}: {date(receivedAt)} · UTC+5</p>}
<>
        <div className={`investigation-next ${current.status}`}><ShieldCheck size={19} /><div><h3>{t("caseNextStep")}</h3><p>{t(nextSteps[current.status])}</p></div></div>
        <DecisionEvidence key={current.transaction_id} detail={current} stale={!!error || loading} />
        <FundsTracePanel key={`funds-${current.transaction_id}-${traceRevision}`} initiallyOpen={traceRevision > 0} id={current.transaction_id} status={current.status} />
        <div className="investigation-signals"><h3><Fingerprint size={17} />{t("caseSignalSnapshot")}</h3>{active.length ? <div>{active.map(key => <span key={key}>{t(signals[key])}</span>)}</div> : <p className="muted">{t("caseNoSignals")}</p>}</div>
        <div className="investigation-timeline"><h3><Clock3 size={17} />{t("caseStory")} <small>UTC+5</small></h3><ol>{story.map((item, index) => <li key={`${item.key}-${index}`} className={item.tone}><span>{t(item.key)}{item.signals ? `: ${item.signals.map(key => t(signals[key])).join(", ")}` : ""}{item.score !== undefined ? ` · ${item.score}/100` : ""}</span>{item.time ? <time dateTime={item.time}>{date(item.time)}</time> : <time>—</time>}</li>)}</ol></div>
        {current.verification_answers && <p className="investigation-answers"><Check size={16} />{t("caseAnswersSaved")}</p>}
      </>
      {!readOnly && onReview && current.status === "cooling_off" && <button className="primary review-button" disabled={busy || loading || !!error} onClick={() => onReview(current.transaction_id)}><Clock3 size={17} />{t("review")}</button>}
      <div className="investigation-export"><div className="investigation-export-buttons"><PoliceReportButton disabled={loading || !!error} onOpen={policeReport} /><button className="secondary case-export" disabled={loading || !!error} onClick={download}><Download size={16} />{t("caseExport")}</button></div><p>{t("policeReportHint")}</p></div>
      {notice && <p className="investigation-notice" role="status">{t(notice)}</p>}
    </>}
  </section>;
}
