"use client";

import { ArrowRight, BrainCircuit, Check, CircleDashed, Clock3, ExternalLink, Fingerprint, Gauge, MessageSquareWarning, Network, PhoneCall, ShieldCheck, ShieldX, Smartphone, UserRound, Wallet, X } from "lucide-react";
import type { Lang } from "@/lib/contracts";
import { compare, compareNote, compareSources, competitors, decisions, layers, metrics, phases, problem, screens, slides, steps, team, type L, type Slide } from "@/content/pitch-deck";

const stepIcons = [MessageSquareWarning, PhoneCall, Wallet, Network];
const layerIcons = [Fingerprint, Gauge, Network, BrainCircuit];
const screenIcons = [Smartphone, UserRound, ShieldCheck];
const decisionIcons = { approved: Check, cooling_off: Clock3, blocked: ShieldX } as const;
const statusText = { live: ["Жұмыс істейді", "Работает"], building: ["Жасалып жатыр", "В работе"] } as const;
const cellText = { yes: ["Бар", "Есть"], no: ["Жоқ", "Нет"], partial: ["Ішінара", "Частично"], building: ["Жасалуда", "В работе"] } as const;
const scoreLabel = ["балл", "балл"] as const;

export function DeckSlide({ slide, index, total, lang }: { slide: Slide; index: number; total: number; lang: Lang }) {
  const tr = (value: L) => value[lang];
  const pick = (pair: readonly [string, string]) => pair[lang === "kk" ? 0 : 1];
  return <article className={`deck-slide deck-k-${slide.kind}`} aria-label={`${index + 1} / ${total}`}>
    <div className="deck-mark"><span className="deck-logo"><ShieldCheck size={16} /></span><span>SAQ BOL</span><span className="deck-eyebrow">{tr(slide.eyebrow)}</span><span className="deck-count">{String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</span></div>

    {slide.kind === "cover" && <div className="deck-cover">
      <div className="deck-cover-text"><h1>{tr(slide.title)}</h1>{slide.lead && <p className="deck-lead">{tr(slide.lead)}</p>}</div>
      <div className="deck-cover-stack" aria-hidden="true">
        <div className="deck-mini denied"><ShieldX size={18} /><div><strong>{pick(["Бұл банк емес", "Это не банк"])}</strong><p>{pick(["Банк сізге қазір қоңырау шалып жатқан жоқ.", "Банк вам сейчас НЕ звонит."])}</p></div></div>
        <div className="deck-mini held"><Clock3 size={18} /><div><strong>{pick(["Аударым кідірісте · 14:59", "Перевод на удержании · 14:59"])}</strong><p>900 000 ₸ · {pick(["4 себеп", "4 причины"])}</p></div></div>
        <div className="deck-mini sent"><UserRound size={18} /><div><strong>{pick(["Жақын адамға хабар жіберілді", "Близкому отправлено сообщение"])}</strong><p>Telegram</p></div></div>
      </div>
    </div>}

    {slide.kind === "problem" && <div className="deck-problem">
      <div><h1>{tr(slide.title)}</h1>{slide.lead && <p className="deck-lead">{tr(slide.lead)}</p>}</div>
      <blockquote className="deck-quote"><p>«{tr(problem.quote)}»</p><a href={problem.quoteSource.url} target="_blank" rel="noopener noreferrer">{problem.quoteSource.label} <ExternalLink size={12} /></a></blockquote>
      <div className="deck-stat"><strong>{problem.stat}</strong><p>{tr(problem.statLabel)}</p><a href={problem.statSource.url} target="_blank" rel="noopener noreferrer">{problem.statSource.label} <ExternalLink size={12} /></a></div>
    </div>}

    {slide.kind === "steps" && <>
      <h1>{tr(slide.title)}</h1>
      <ol className="deck-steps">{steps.map((step, i) => { const Icon = stepIcons[i]; return <li key={step.stage.ru} className={`deck-card status-${step.status}`}>
        <div className="deck-step-head"><span className="deck-step-n">{i + 1}</span><Icon size={20} /><strong>{tr(step.stage)}</strong></div>
        <p className="deck-threat">{tr(step.threat)}</p>
        <div className="deck-layer"><ArrowRight size={16} /><p>{tr(step.layer)}</p></div>
        <span className={`deck-status ${step.status}`}>{step.status === "live" ? <Check size={13} /> : <CircleDashed size={13} />}{pick(statusText[step.status])}</span>
      </li>; })}</ol>
    </>}

    {slide.kind === "live" && <div className="deck-live">
      <div className="deck-phone"><iframe src="/mobile" title={pick(["Saq Bol тірі қосымшасы", "Живое приложение Saq Bol"])} loading="lazy" /></div>
      <div className="deck-live-side">
        <h1>{tr(slide.title)}</h1>{slide.lead && <p className="deck-lead">{tr(slide.lead)}</p>}
        <ol className="deck-screens">{screens.map((screen, i) => { const Icon = screenIcons[i]; return <li key={screen.owner} className="deck-card">
          <Icon size={20} /><div><strong>{tr(screen.who)}</strong><p>{tr(screen.sees)}</p></div>
        </li>; })}</ol>
        <a className="deck-open" href="/" target="_blank" rel="noopener noreferrer">{pick(["SOC-ты ашу", "Открыть SOC"])} <ExternalLink size={14} /></a>
      </div>
    </div>}

    {slide.kind === "engine" && <>
      <h1>{tr(slide.title)}</h1>
      <div className="deck-engine">
        <ol className="deck-layers">{layers.map((layer, i) => { const Icon = layerIcons[i]; return <li key={layer.name.ru} className="deck-card"><Icon size={22} /><strong>{tr(layer.name)}</strong><p>{tr(layer.signals)}</p></li>; })}</ol>
        <div className="deck-arrow" aria-hidden="true"><ArrowRight size={28} /></div>
        <ul className="deck-decisions">{decisions.map(decision => { const Icon = decisionIcons[decision.status]; return <li key={decision.status} className={`deck-decision ${decision.status}`}>
          <Icon size={22} /><div><strong>{tr(decision.title)}</strong><p>{tr(decision.detail)}</p></div><span className="deck-score">{decision.score}<small>{pick(scoreLabel)}</small></span>
        </li>; })}</ul>
      </div>
    </>}

    {slide.kind === "proof" && <>
      <h1>{tr(slide.title)}</h1>
      <ul className="deck-metrics">{metrics.map(metric => <li key={metric.label.ru} className="deck-card">
        <strong className="deck-metric-value">{metric.value}<small>{tr(metric.unit)}</small></strong>
        <p>{tr(metric.label)}</p><code>{metric.source}</code>
      </li>)}</ul>
    </>}

    {slide.kind === "market" && <>
      <h1>{tr(slide.title)}</h1>
      <div className="deck-table-wrap"><table className="deck-table">
        <thead><tr><th scope="col"><span className="sr-only">{pick(["Мүмкіндік", "Возможность"])}</span></th>{competitors.map(name => <th key={name} scope="col" className={name === "Saq Bol" ? "ours" : ""}>{name}</th>)}</tr></thead>
        <tbody>{compare.map(row => <tr key={row.feature.ru}><th scope="row">{tr(row.feature)}</th>{row.cells.map((cell, i) => <td key={competitors[i]} className={`${cell}${competitors[i] === "Saq Bol" ? " ours" : ""}`}>
          <span className="deck-cell">{cell === "yes" ? <Check size={17} /> : cell === "no" ? <X size={15} /> : <CircleDashed size={15} />}<span>{pick(cellText[cell])}</span></span>
        </td>)}</tr>)}</tbody>
      </table></div>
      <p className="deck-footnote">{tr(compareNote)} {compareSources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.label}</a>)}</p>
    </>}

    {slide.kind === "close" && <div className="deck-close">
      <h1>{tr(slide.title)}</h1>
      <ol className="deck-phases">{phases.map((phase, i) => <li key={phase.name.ru} className="deck-card"><span className="deck-step-n">{i + 1}</span><strong>{tr(phase.name)}</strong><p>{tr(phase.detail)}</p></li>)}</ol>
      {slide.lead && <p className="deck-final">{tr(slide.lead)}</p>}
      <ul className="deck-team">{team.map(member => <li key={member.name.ru}><strong>{tr(member.name)}</strong><span>{tr(member.role)}</span></li>)}</ul>
    </div>}

    <div className="deck-foot"><span>{pick(["Оқу прототипі · синтетикалық деректер · банк төлемдері орындалмайды", "Учебный прототип · синтетические данные · банковские платежи не выполняются"])}</span><span>ҚАЗ / РУС</span></div>
  </article>;
}

export const deckSlides = slides;
export const deckSeconds = slides.reduce((sum, slide) => sum + slide.seconds, 0);
