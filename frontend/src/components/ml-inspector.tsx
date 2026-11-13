"use client";
import { BrainCircuit } from "lucide-react";
import type { MLDetails, Reason } from "@/lib/contracts";
import { useLocale } from "@/lib/i18n";

export function MLInspector({ details, reasons = [] }: { details?: MLDetails; reasons?: Reason[] }) {
  const { lang, t } = useLocale();
  const score = details?.ml_score;
  const available = typeof score === "number" && Number.isFinite(score);
  return <section className="ml-inspector" aria-label={t("hybridAnalysis")}>
    <div className="ml-heading"><h3><BrainCircuit size={18} />{t("hybridAnalysis")}</h3><span className={`ml-badge ${available ? "ready" : ""}`}>{t("mlScore")}: {available ? `${score.toFixed(1)}%` : "—"}</span></div>
    <p className="muted input-hint">{t(available ? "mlScoreHint" : "mlUnavailable")}</p>
    {available && <><ul className="contributors">{details?.ml_contributors?.map(contributor => <li key={contributor.feature}><div><span>{lang === "kk" ? contributor.label_kk : contributor.label_ru}</span><strong className={contributor.contribution > 0 ? "risk-positive" : "risk-negative"}>{contributor.contribution > 0 ? "+" : ""}{contributor.contribution.toFixed(1)} {t("points")}</strong></div><div className="contribution-track"><i style={{ width: `${Math.min(100, Math.abs(contributor.contribution) * 2)}%` }} className={contributor.contribution > 0 ? "positive" : "negative"} /></div></li>)}</ul><p className="muted input-hint">{t("contributorHint")}</p><small className="model-version">{details?.ml_model_version}</small></>}
    <div className="layer-breakdown">{(["behavioral", "velocity", "graph", "ml"] as const).map(layer => <div key={layer}><span>{t(layer === "behavioral" ? "behavior" : layer === "velocity" ? "velocityLayer" : layer === "graph" ? "graphLayer" : "mlLayer")}</span><b>+{reasons.filter(reason => reason.layer === layer).reduce((sum, reason) => sum + reason.score_delta, 0)}</b></div>)}</div>
    <p className="muted input-hint">{t("breakdownHint")}</p>
  </section>;
}
