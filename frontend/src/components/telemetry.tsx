"use client";

import { Activity, ArrowUpRight, Check, Clock3, Network, ShieldCheck, ShieldX, Wallet, Zap } from "lucide-react";
import type { Evaluation } from "@/lib/contracts";
import { money, useLocale } from "@/lib/i18n";
import { Badge, Explain, Gauge } from "./risk";

export function Telemetry({ result, amount, roundtrip, busy, onReview }: { result: Evaluation | null; amount: string; roundtrip: number; busy: boolean; onReview: () => void }) {
  const { lang, t } = useLocale();
  return <aside className="telemetry-column">
    <section className="panel telemetry-panel" aria-live="polite" aria-busy={busy}>
      <div className="telemetry-heading"><div className="telemetry-symbol"><ShieldCheck size={25} /></div><div><span className="eyebrow">BCC SHIELD</span><h2>{t("telemetry")}</h2></div><span className="live-dot" /></div>
      <p className="telemetry-intro">{t("telemetryIntro")}</p>
      <div className="telemetry-metrics"><div><span><Zap size={15} />{t("latency")}</span><strong className="tabular-nums">{result ? result.latency_ms.toFixed(2) : "—"}<small>{t("ms")}</small></strong></div><div><span><Activity size={15} />{t("roundtrip")}</span><strong className="tabular-nums">{result ? roundtrip.toFixed(0) : "—"}<small>{t("ms")}</small></strong></div></div>
      <div className="decision-heading"><h3>{t("decision")}</h3>{result ? <Badge status={result.status} /> : <span className="neutral-badge">{t(busy ? "evaluating" : "awaiting")}</span>}</div>
      {result ? <><div className="decision-top"><Gauge score={result.risk_score} /><div className="decision-summary"><p className="muted">{t("transferAmount")}</p><strong className="result-amount tabular-nums">{money(amount, lang)}</strong><p className="result-headline">{lang === "kk" ? result.headline_kk : result.headline_ru}</p><p className="muted">{result.recipient.display_name} · {result.recipient.iban_masked}</p></div></div><Explain kk={result.reasons_kk} ru={result.reasons_ru} />{result.status === "cooling_off" && <button className="secondary review-button" onClick={onReview}><Clock3 size={17} />{t("review")}<ArrowUpRight size={17} /></button>}</>
        : <div className="awaiting"><div className={`shield-orbit ${busy ? "scanning" : ""}`}><ShieldCheck size={42} /></div><h3>{t(busy ? "evaluating" : "awaiting")}</h3><p>{t("awaitingText")}</p></div>}
      <div className="telemetry-footer"><span><span className="live-dot" />{t("monitoring")}</span><span>{t("scoringTarget")}</span></div>
    </section>
    <section className="panel pipeline-panel"><div className="pipeline-heading"><h2>{t("pipeline")}</h2><span>01 — 03</span></div><div className="pipeline">{([{ key: "behavior", icon: Wallet, time: 15 }, { key: "network", icon: Network, time: 25 }, { key: "adaptive", icon: ShieldCheck, time: 10 }] as const).map(({ key, icon: Icon, time }, index) => <div key={key}><span className="pipeline-icon"><Icon size={20} /></span><span><small>0{index + 1}</small><strong>{t(key)}</strong></span><em>{t("target")}<b>&lt;{time} {t("ms")}</b></em></div>)}</div><div className="thresholds"><span><Check size={14} /><b>0–39</b>{t("low")}</span><span><Clock3 size={14} /><b>40–74</b>{t("medium")}</span><span><ShieldX size={14} /><b>75–100</b>{t("high")}</span></div></section>
  </aside>;
}
