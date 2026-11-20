"use client";

import { BrainCircuit, ChevronDown, ClipboardCheck, Fingerprint, HelpCircle, Network, ScanLine } from "lucide-react";
import type { Evaluation } from "@/lib/contracts";
import { decisionEvidence, type EvidenceGroup } from "@/lib/decision-evidence";
import { evidenceReasonLabel, evidenceText, type EvidenceMessage } from "@/lib/decision-evidence-copy";
import { useLocale } from "@/lib/i18n";
import "./decision-evidence.css";

const icons = { context: Fingerprint, network: Network, checks: ClipboardCheck, ml: BrainCircuit, unknown: HelpCircle };
const order: EvidenceGroup[] = ["context", "network", "ml", "checks", "unknown"];

export function DecisionEvidence({ detail, stale = false }: { detail: Evaluation; stale?: boolean }) {
  const { lang } = useLocale();
  const text = (key: EvidenceMessage) => evidenceText(lang, key);
  const summary = decisionEvidence(detail);
  const groups = order.filter(group => ["context", "network", "ml"].includes(group) || summary.groups[group].length > 0);
  return <section className="decision-evidence" aria-label={text("title")} data-testid="decision-evidence" data-focus={summary.focus}>
    <header><h3><ScanLine size={17} aria-hidden />{text("title")}</h3><small>{text("scope")}</small></header>
    <div className="decision-evidence-groups">
      {groups.map(group => {
        const Icon = icons[group];
        const count = summary.groups[group].length;
        return <div key={group} className={`decision-evidence-group ${group}`} data-evidence-group={group} data-reason-count={count}>
          <span><Icon size={15} aria-hidden />{text(group)}</span>
          <strong>{count ? <><b className="tabular-nums">{count}</b> {evidenceReasonLabel(lang, count)}</> : text(group === "ml" ? summary.mlAvailable ? "available" : "unavailable" : "absent")}</strong>
        </div>;
      })}
    </div>
    <p className="decision-evidence-basis">{text(summary.focus)}</p>
    {summary.incomplete && <p className="decision-evidence-caution">{text("incomplete")}</p>}
    {stale && <p className="decision-evidence-caution">{text("stale")}</p>}
    <details className="decision-evidence-details">
      <summary>{text("details")}<ChevronDown size={14} aria-hidden /></summary>
      {groups.filter(group => summary.groups[group].length > 0).map(group => <div className="decision-evidence-reasons" key={group}>
        <h4>{text(group)}</h4><ul>{summary.groups[group].map((reason, index) => <li key={`${reason.code}-${index}`}>
          <p>{(lang === "kk" ? reason.reason_kk : reason.reason_ru).trim() || text("textMissing")}</p><code>{reason.code}</code>
        </li>)}</ul>
      </div>)}
      <p className="decision-evidence-ml-note">{text("mlRole")}</p>
    </details>
  </section>;
}
