"use client";

import { Activity, BrainCircuit, Clock3, Fingerprint, Network, RotateCcw, ShieldCheck, Wallet, Zap } from "lucide-react";
import { MLInspector } from "./ml-inspector";
import type { Biometrics } from "./use-biometrics";
import type { Evaluation } from "@/lib/contracts";
import { money, useLocale, type MessageKey } from "@/lib/i18n";
import { Badge, Explain, Gauge } from "./risk";

const layers = [{ key: "behavior", icon: Wallet }, { key: "network", icon: Network }, { key: "mlLayer", icon: BrainCircuit }, { key: "adaptive", icon: ShieldCheck }] as const;

export function Telemetry({ result, amount, roundtrip, busy, error, onReview, sensor, sender }: { result: Evaluation | null; amount: string; roundtrip: number; busy: boolean; error?: MessageKey | null; onReview: () => void; sensor: Biometrics; sender?: string }) {
  const { lang, t } = useLocale();
  const state = t(busy ? "evaluating" : error ? "evaluationUnconfirmed" : "awaiting");
  return <aside className="telemetry-column">
    <section className="panel telemetry-panel" aria-live="polite" aria-busy={busy} aria-labelledby="telemetry-title">
      <header className="telemetry-heading">
        <div><h2 id="telemetry-title">{t("decisionPanel")}</h2><p>{t("decisionPanelHint")}</p></div>
        {result ? <Badge status={result.status} /> : busy ? <span className="neutral-badge">{state}</span> : null}
      </header>

      {result ? <div className="decision-block">
        <div className="decision-top"><Gauge score={result.risk_score} /><div className="decision-summary"><strong className="result-amount tabular-nums">{money(amount, lang)}</strong><p className="result-headline">{lang === "kk" ? result.headline_kk : result.headline_ru}</p><p className="muted">{result.recipient.display_name} · {result.recipient.iban_masked}</p></div></div>
        <Explain kk={result.reasons_kk} ru={result.reasons_ru} />
        {result.status === "cooling_off" && <button className="primary review-button" onClick={onReview}><Clock3 size={18} />{t("review")}</button>}
      </div> : <div className="awaiting"><span className={`awaiting-icon ${busy ? "scanning" : ""}`}><ShieldCheck size={28} /></span><div><h3>{state}</h3><p>{t(error && !busy ? error : "awaitingText")}</p></div></div>}

      <div className={`biometric-sensor ${sensor.snapshot.pasted_recipient ? "paste-detected" : ""}`}>
        <div className="sensor-title"><Fingerprint size={18} aria-hidden="true" /><strong>{t("sensor")}</strong><button type="button" className="sensor-reset" title={t("resetSensor")} aria-label={t("resetSensor")} disabled={busy} onClick={sensor.reset}><RotateCcw size={14} /></button></div>
        <div className="sensor-readings" role="status"><span><i className="live-dot" />{t(sensor.snapshot.pasted_recipient ? "pasteDetected" : sensor.snapshot.edits ? "typingCadence" : "sensorWaiting")}</span><span className="tabular-nums">{sensor.snapshot.typing_duration_ms ?? "—"} {t("ms")}</span><span className="tabular-nums">{t("pauses")}: {sensor.snapshot.hesitation_count}</span></div>
        <small>{t("sensorPrivacy")}</small>
      </div>

      <dl className="tech-grid" aria-label={t("technicalDetails")}>
        <div><dt><Zap size={14} aria-hidden="true" />{t("latency")}</dt><dd className="tabular-nums">{result ? `${result.latency_ms.toFixed(2)} ${t("ms")}` : "—"}</dd></div>
        <div><dt><Activity size={14} aria-hidden="true" />{t("roundtrip")}</dt><dd className="tabular-nums">{result ? `${roundtrip.toFixed(0)} ${t("ms")}` : "—"}</dd></div>
        <div className="wide"><dt>{t("caseId")}</dt><dd><code>{result?.transaction_id ?? "—"}</code></dd></div>
        <div className="wide"><dt>{t("senderAccount")}</dt><dd><code>{sender || "—"}</code></dd></div>
      </dl>

      {result && <MLInspector details={result} reasons={result.reasons} />}

      <footer className="telemetry-footer">
        <div className="layer-strip" aria-label={t("layersShort")}>{layers.map(({ key, icon: Icon }, index) => <span key={key}><Icon size={14} aria-hidden="true" /><small className="tabular-nums">0{index + 1}</small>{t(key)}</span>)}</div>
        <div className="threshold-strip"><span className="low"><b className="tabular-nums">0–39</b>{t("low")}</span><span className="medium"><b className="tabular-nums">40–74</b>{t("medium")}</span><span className="high"><b className="tabular-nums">75–100</b>{t("high")}</span><span className="target">{t("scoringTarget")}</span></div>
      </footer>
    </section>
  </aside>;
}
