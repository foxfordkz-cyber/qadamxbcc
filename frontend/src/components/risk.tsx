"use client";

import { BrainCircuit, Check, Clock3, ShieldX } from "lucide-react";
import type { Status } from "@/lib/contracts";
import { useLocale } from "@/lib/i18n";

export function Badge({ status }: { status: Status }) {
  const { t } = useLocale();
  const Icon = status === "approved" ? Check : status === "blocked" ? ShieldX : Clock3;
  return <span className={`badge ${status}`}><Icon size={13} aria-hidden />{t(status)}</span>;
}
export function Gauge({ score, compact = false }: { score: number; compact?: boolean }) {
  const { t } = useLocale();
  const value = Math.max(0, Math.min(100, score));
  const color = value >= 75 ? "#F04438" : value >= 40 ? "#F79009" : "#00A859";
  const textColor = value >= 75 ? "#B42318" : value >= 40 ? "#B54708" : "#067647";
  if (compact) return <div className="mini-gauge" role="meter" aria-label={t("risk")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}><strong style={{ color: textColor }}>{value}</strong><span><i style={{ width: `${value}%`, background: color }} /></span></div>;
  return <div className="gauge" role="meter" aria-label={t("risk")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
    <svg viewBox="0 0 160 160" aria-hidden><circle className="gauge-track" cx="80" cy="80" r="65" /><circle cx="80" cy="80" r="65" fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${value * 4.084} 408.4`} transform="rotate(-90 80 80)" /></svg>
    <div><strong>{value}</strong><span>/ 100</span></div>
    <p style={{ color: textColor }}>{t(value >= 75 ? "high" : value >= 40 ? "medium" : "low")}</p>
  </div>;
}
export function Explain({ kk, ru }: { kk: string[]; ru: string[] }) {
  const { lang, t } = useLocale();
  const reasons = lang === "kk" ? kk : ru;
  return <section className="explain"><h3><BrainCircuit size={18} />{t("explain")}</h3>
    {reasons.length ? <ul>{reasons.map((r, i) => <li key={`${i}-${r}`}>{r}</li>)}</ul> : <p>{t("noReasons")}</p>}
  </section>;
}
