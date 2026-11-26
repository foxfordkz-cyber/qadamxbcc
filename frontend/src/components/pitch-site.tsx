"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight, Banknote, BarChart3, Check, ChevronLeft, ChevronRight, CircleDashed, Database, Download, FileText, Globe2,
  MessageSquareText, Minus, Network, Pause, Play, RotateCcw, Scale, ShieldAlert, StickyNote, Undo2,
} from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { landingText, type LandingKey } from "@/lib/landing-copy";
import { walletEntry } from "@/lib/wallet-warmup";
import { attack, bank, drops, fit, hero, hold, how, pilot, problem, proof, REPO, slides, tech, totalSeconds, ui, value, type L } from "@/content/pitch-site";
import { FxCard } from "./fx-card";
import { BrandMark } from "./brand-mark";
import { CountUp } from "./count-up";
import { DropNetwork } from "./drop-network";
import type { DropStage } from "./drop-scene";
import { HeroDemo } from "./hero-demo";
import { LanguageSwitch } from "./language-switch";
import { TextSizeToggle } from "./text-size";
import { useReducedMotion } from "./use-fx-tier";
import "./landing.css";
import "./pitch-site.css";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const GITHUB = "https://github.com/foxfordkz-cyber/qadamxbcc";
const featureIcons = [BarChart3, Database, Banknote, Scale, Globe2, Network, Undo2, FileText];
const nav = [["navProblem", "#problem"], ["navHow", "#how"], ["navValue", "#value"], ["navBank", "#bank"], ["navTech", "#tech"], ["navProof", "#proof"], ["navPilot", "#pilot"]] as const;
function Phone({ src, alt }: { src: string; alt: string }) {
  return <div className="ps-phone"><div className="ps-phone-screen"><img src={`${BASE}${src}`} alt={alt} loading="lazy" decoding="async" /></div></div>;
}

/** Slide position, keyboard navigation and the 5-minute clock for whoever presents. */
function usePresenter() {
  const [index, setIndex] = useState(0);
  const [running, setRunning] = useState(false);
  const [left, setLeft] = useState(totalSeconds);
  const reduced = useReducedMotion();

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const line = window.innerHeight * 0.45;
      let current = 0;
      slides.forEach((slide, i) => { const node = document.getElementById(slide.id); if (node && node.getBoundingClientRect().top <= line) current = i; });
      setIndex(current);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setLeft(value => { if (value <= 1) { setRunning(false); return 0; } return value - 1; }), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const go = useCallback((target: number) => {
    const slide = slides[Math.max(0, Math.min(slides.length - 1, target))];
    const node = document.getElementById(slide.id);
    node?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: slide.id.startsWith("how-") ? "center" : "start" });
  }, [reduced]);

  return { index, go, running, setRunning, left, reset: () => { setRunning(false); setLeft(totalSeconds); } };
}

export function PitchSite() {
  const { lang, setLang } = useLocale();
  const p = (pair: L) => pair[lang === "kk" ? 0 : 1];
  const T = (key: keyof typeof ui) => p(ui[key]);
  const LT = (key: LandingKey) => landingText(lang, key);
  const reduced = useReducedMotion();
  const { index, go, running, setRunning, left, reset } = usePresenter();
  const [notes, setNotes] = useState(false);
  const [howStep, setHowStep] = useState(0);
  const [dropStage, setDropStage] = useState<DropStage>(0);
  const [dropsHold, setDropsHold] = useState(false);
  const dropsRef = useRef<HTMLElement>(null);
  const [dropsSeen, setDropsSeen] = useState(false);
  const holdRef = useRef<HTMLElement>(null);
  const [holdSeen, setHoldSeen] = useState(false);
  const [holdPhase, setHoldPhase] = useState(0);
  const [animated, setAnimated] = useState(false);

  // The pitch is given in Kazakh; ?lang=ru opens the Russian version.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("lang");
    setLang(wanted === "ru" ? "ru" : "kk");
  }, [setLang]);

  // Blocks rise into place as they enter the screen. Without JavaScript or with
  // reduced motion everything is simply visible.
  useEffect(() => {
    if (reduced) return;
    setAnimated(true);
    const io = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add("is-in"); io.unobserve(entry.target); }
    }, { rootMargin: "0px 0px -12% 0px" });
    document.querySelectorAll(".pitch-site [data-reveal]").forEach(node => io.observe(node));
    return () => io.disconnect();
  }, [reduced]);

  useEffect(() => {
    if (!holdRef.current) return;
    const io = new IntersectionObserver(entries => setHoldSeen(entries.some(entry => entry.isIntersecting)), { threshold: 0.4 });
    io.observe(holdRef.current);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!holdSeen) { setHoldPhase(0); return; }
    if (reduced) { setHoldPhase(2); return; }
    const timer = setTimeout(() => setHoldPhase(phase => (phase + 1) % 3), holdPhase === 2 ? 4200 : 2600);
    return () => clearTimeout(timer);
  }, [holdSeen, holdPhase, reduced]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      if (["ArrowRight", "PageDown"].includes(event.key) || (event.key === " " && !event.shiftKey)) { event.preventDefault(); go(index + 1); }
      else if (["ArrowLeft", "PageUp"].includes(event.key) || (event.key === " " && event.shiftKey)) { event.preventDefault(); go(index - 1); }
      else if (event.key.toLowerCase() === "t") setRunning(value => !value);
      else if (event.key.toLowerCase() === "n") setNotes(value => !value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index, setRunning]);

  // The phone follows whichever step of the story sits in the middle of the screen.
  useEffect(() => {
    const nodes = how.steps.map((_, i) => document.getElementById(`how-${i + 1}`)).filter((node): node is HTMLElement => !!node);
    const io = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) setHowStep(Number((entry.target as HTMLElement).dataset.step));
    }, { rootMargin: "-45% 0px -45% 0px" });
    nodes.forEach(node => io.observe(node));
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!dropsRef.current) return;
    const io = new IntersectionObserver(entries => setDropsSeen(entries.some(entry => entry.isIntersecting)), { threshold: 0.35 });
    io.observe(dropsRef.current);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (reduced || dropsHold || !dropsSeen) return;
    const timer = setTimeout(() => setDropStage(value => ((value + 1) % 4) as DropStage), 4200);
    return () => clearTimeout(timer);
  }, [dropStage, reduced, dropsHold, dropsSeen]);

  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  const slide = slides[index];

  return <div className="public-home pitch-site" data-anim={animated ? "on" : undefined}>
    <header className="public-header">
      <div className="public-mast">
        <Link className="public-brand" href="/" aria-label="Saq Bol"><BrandMark size={34} /><strong>Saq Bol</strong></Link>
        <nav className="public-nav" aria-label={T("navHow")}>{nav.map(([key, href]) => <a key={key} href={href}>{T(key)}</a>)}</nav>
        <div className="public-tools"><TextSizeToggle label={T("textSize")} /><LanguageSwitch /></div>
      </div>
    </header>

    <section id="top" className="ps-hero" aria-labelledby="ps-title">
      <svg className="ps-routes" viewBox="0 0 1200 760" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 120 H260 V300 H520" /><path d="M1200 160 H930 V330 H700" /><path d="M0 560 H180 V430 H390" /><path d="M1200 600 H1040 V470 H820" />
        <circle cx="520" cy="300" r="4" /><circle cx="700" cy="330" r="4" /><circle cx="390" cy="430" r="4" /><circle cx="820" cy="470" r="4" />
      </svg>
      <div className="ps-hero-copy">
        <p className="ps-eyebrow">{p(hero.eyebrow)}</p>
        <h1 id="ps-title">{p(hero.titleA)}<br /><mark>{p(hero.titleB)}</mark></h1>
        <p className="ps-lead">{p(hero.lead)}</p>
        <div className="ps-actions">
          <Link className="ps-btn ps-btn-light" href="/mobile?tour=1">{T("demo")}<ArrowRight size={18} /></Link>
          <Link className="ps-btn ps-btn-ghost" href="/download/android"><Download size={18} />{T("android")}</Link>
        </div>
        <ul className="ps-chips">{hero.chips.map(chip => <li key={chip[1]}><Check size={15} />{p(chip)}</li>)}</ul>
      </div>
      <div className="ps-phones" aria-hidden="true">
        <Phone src="/pitch/app-home-ru.webp" alt="" />
        <div className="ps-phone-live"><HeroDemo step={1} bare /></div>
        <Phone src="/pitch/app-safety-ru.webp" alt="" />
      </div>
    </section>

    <section id="hold" ref={holdRef} className="ps-hold" data-phase={holdPhase} aria-labelledby="hold-title">
      <div className="ps-hold-stage" aria-hidden="true">
        <FxCard size="hero" state={holdPhase > 0 ? "frozen" : "idle"} ring={holdPhase > 0 ? 1 : 0} label={LT("heroCardLabel")} />
      </div>
      <div className="ps-hold-copy">
        <p className="eyebrow">{p(hold.eyebrow)}</p>
        <ol className="ps-hold-captions">{hold.captions.map((caption, i) => <li key={caption[1]} className={holdPhase === i ? "is-on" : holdPhase > i ? "is-done" : undefined}>
          <span>{String(i + 1).padStart(2, "0")}</span>{i === 2 ? <h2 id="hold-title">{p(caption)}</h2> : <b>{p(caption)}</b>}
        </li>)}</ol>
        <p className="ps-text">{p(hold.sub)}</p>
      </div>
    </section>

    <section id="problem" className="ps-section" aria-labelledby="problem-title">
      <div className="ps-problem" data-reveal>
        <div>
          <p className="eyebrow">{p(problem.eyebrow)}</p>
          <h2 id="problem-title" className="ps-h2">{p(problem.title)}</h2>
          <p className="ps-text">{p(problem.lead)}</p>
          <blockquote className="ps-quote"><p>«{p(problem.quote)}»</p><footer><a href={problem.quoteSource.url} target="_blank" rel="noopener noreferrer">{problem.quoteSource.label}</a> · {p(problem.quoteNote)}</footer></blockquote>
        </div>
        <div className="ps-stat">
          <CountUp value={problem.stat} />
          <p>{p(problem.statLabel)}</p>
          <a href={problem.statSource.url} target="_blank" rel="noopener noreferrer">{T("source")}: {problem.statSource.label}</a>
        </div>
      </div>
      <ol className="ps-attack">{attack.map((item, i) => <li key={item.stage[1]} data-reveal style={{ transitionDelay: `${i * 90}ms` }}>
        <span className="ps-attack-n">{String(i + 1).padStart(2, "0")}</span>
        <h3>{p(item.stage)}</h3>
        <p className="ps-threat">{p(item.threat)}</p>
        <p className="ps-layer"><ShieldAlert size={16} />{p(item.layer)}</p>
      </li>)}</ol>
    </section>

    <section id="how" className="ps-section ps-how" aria-labelledby="how-title">
      <header className="ps-head"><p className="eyebrow">{p(how.eyebrow)}</p><h2 id="how-title" className="ps-h2">{p(how.title)}</h2></header>
      <div className="ps-how-grid">
        <ol className="ps-how-steps">{how.steps.map((step, i) => <li key={step.title[1]} id={`how-${i + 1}`} data-step={i} className={howStep === i ? "is-on" : ""}>
          <span className="ps-step-tag">{String(i + 1).padStart(2, "0")} / 05</span>
          <h3>{p(step.title)}</h3>
          <p>{p(step.text)}</p>
        </li>)}</ol>
        <div className="ps-how-phone"><HeroDemo step={howStep} bare /></div>
      </div>
    </section>

    <section id="drops" ref={dropsRef} className="ps-section" aria-labelledby="drops-title2" onPointerEnter={() => setDropsHold(true)} onPointerLeave={() => setDropsHold(false)}>
      <header className="ps-head"><p className="eyebrow">{p(drops.eyebrow)}</p><h2 id="drops-title2" className="ps-h2">{p(drops.title)}</h2></header>
      <div className="ps-drops">
        <div className="ps-drops-stage"><DropNetwork stage={dropStage} label={LT("dropsLabel")} legend={{ client: LT("legendClient"), drop: LT("legendDrop"), hub: LT("legendHub"), cash: LT("legendCash") }} /></div>
        <ol className="ps-drops-steps">{([1, 2, 3, 4] as const).map((n, i) => <li key={n}>
          <button type="button" aria-pressed={dropStage === i} onClick={() => setDropStage(i as DropStage)}>
            <span className="ps-drops-n">{n}</span>
            <span><b>{LT(`d${n}Title` as LandingKey)}</b><small>{LT(`d${n}Text` as LandingKey)}</small></span>
          </button>
        </li>)}</ol>
      </div>
    </section>

    <section id="value" className="ps-section" aria-labelledby="value-title">
      <header className="ps-head" data-reveal><p className="eyebrow">{p(value.eyebrow)}</p><h2 id="value-title" className="ps-h2">{p(value.title)}</h2></header>
      <ul className="ps-bento">{value.items.map((item, i) => <li key={item.title[1]} className={`ps-bento-${i + 1}`} data-reveal style={{ transitionDelay: `${(i % 3) * 90}ms` }}>
        <span className="ps-bento-kpi">{item.kpi}</span>
        <h3>{p(item.title)}</h3>
        <p>{p(item.text)}</p>
      </li>)}</ul>
      <Link className="ps-inline-link" href="/pitch/console">{p(value.cta)}<ArrowRight size={16} /></Link>
    </section>

    <section id="bank" className="ps-band" aria-labelledby="bank-title2">
      <header className="ps-head ps-head-light"><p className="ps-eyebrow">{p(bank.eyebrow)}</p><h2 id="bank-title2" className="ps-h2">{p(bank.title)}</h2><p className="ps-text">{p(bank.lead)}</p></header>
      <figure className="ps-browser" data-reveal>
        <div className="ps-browser-bar" aria-hidden="true"><i /><i /><i /><span>saq-bol · SOC</span></div>
        <img src={`${BASE}/pitch/soc-ru.webp`} alt={p(["SOC мониторингі: аударымдар лентасы және кідірістер", "Мониторинг SOC: лента переводов и удержания"])} loading="lazy" decoding="async" />
      </figure>
      <ul className="ps-features">{bank.features.map((feature, i) => { const Icon = featureIcons[i]; return <li key={feature.title[1]} data-reveal style={{ transitionDelay: `${(i % 4) * 70}ms` }}>
        <span className="ps-feature-icon"><Icon size={20} /></span>
        <h3>{p(feature.title)}</h3>
        <p>{p(feature.text)}</p>
      </li>; })}</ul>
      <div className="ps-band-links">
        <a href={walletEntry("soc")}>{LT("footSoc")}<ArrowRight size={16} /></a>
        <a href={walletEntry("wallet")}>{LT("footWallet")}<ArrowRight size={16} /></a>
      </div>
    </section>

    <section id="tech" className="ps-section" aria-labelledby="tech-title">
      <header className="ps-head"><p className="eyebrow">{p(tech.eyebrow)}</p><h2 id="tech-title" className="ps-h2">{p(tech.title)}</h2></header>
      <div className="ps-arch" role="img" aria-label={p(tech.title)} data-reveal>
        <div className="ps-arch-col">
          <span className="ps-arch-label">{p(["Арналар", "Каналы"])}</span>
          {tech.channels.map(item => <span key={item[1]} className="ps-node">{p(item)}</span>)}
        </div>
        <ArrowRight className="ps-arch-arrow" size={22} aria-hidden="true" />
        <div className="ps-arch-col ps-arch-core">
          <span className="ps-arch-label">{p(tech.api)}</span>
          {tech.layers.map((layer, i) => <div key={layer.name[1]} className="ps-layer-node"><b>{String(i + 1).padStart(2, "0")} · {p(layer.name)}</b><small>{p(layer.detail)}</small></div>)}
        </div>
        <ArrowRight className="ps-arch-arrow" size={22} aria-hidden="true" />
        <div className="ps-arch-col">
          <span className="ps-arch-label">{p(["Шешім, 0–100 балл", "Решение, 0–100 баллов"])}</span>
          {tech.decisions.map(item => <div key={item.range} className={`ps-decision ps-d-${item.tone}`}><b>{item.range}</b><span>{p(item.label)}</span></div>)}
        </div>
        <ArrowRight className="ps-arch-arrow" size={22} aria-hidden="true" />
        <div className="ps-arch-col">
          <span className="ps-arch-label">{p(["Нәтиже", "Результат"])}</span>
          {tech.outputs.map(item => <span key={item[1]} className="ps-node">{p(item)}</span>)}
        </div>
      </div>
      <div className="ps-principle"><p>{p(tech.principle)}</p><small>{p(tech.infra)}</small></div>
    </section>

    <section id="proof" className="ps-section" aria-labelledby="proof-title">
      <header className="ps-head"><p className="eyebrow">{p(proof.eyebrow)}</p><h2 id="proof-title" className="ps-h2">{p(proof.title)}</h2></header>
      <ul className="ps-metrics">{proof.metrics.map((metric, i) => <li key={metric.value} data-reveal style={{ transitionDelay: `${(i % 3) * 90}ms` }}>
        <CountUp value={metric.value} />
        <p>{p(metric.label)}</p>
        <a href={`${REPO}${metric.file}`} target="_blank" rel="noopener noreferrer"><FileText size={14} />{metric.file}</a>
      </li>)}</ul>
      <p className="ps-note">{p(proof.note)}</p>
    </section>

    <section id="fit" className="ps-section" aria-labelledby="fit-title">
      <header className="ps-head"><p className="eyebrow">{p(fit.eyebrow)}</p><h2 id="fit-title" className="ps-h2">{p(fit.title)}</h2></header>
      <div className="ps-req" role="table" aria-label={p(fit.title)} data-reveal>
        <div className="ps-req-row ps-req-head" role="row"><span role="columnheader">{LT("reqColAsk")}</span><span role="columnheader">{LT("reqColDone")}</span><span role="columnheader">{LT("reqColProof")}</span></div>
        {[1, 2, 3, 4, 5, 6].map(n => <div key={n} className="ps-req-row" role="row">
          <span role="cell" className="ps-req-ask"><i>{n}</i>{LT(`req${n}Ask` as LandingKey)}</span>
          <span role="cell">{LT(`req${n}Done` as LandingKey)}</span>
          <span role="cell" className="ps-req-proof"><Check size={15} />{LT(`req${n}Proof` as LandingKey)}</span>
        </div>)}
      </div>
      <h3 className="ps-h3">{p(fit.competitorsTitle)}</h3>
      <div className="ps-table-wrap"><table className="ps-compare">
        <thead><tr><th scope="col"><span className="sr-only">{p(["Мүмкіндік", "Возможность"])}</span></th>{fit.competitors.map(name => <th key={name} scope="col" className={name === "Saq Bol" ? "ours" : undefined}>{name}</th>)}</tr></thead>
        <tbody>{fit.rows.map(row => <tr key={row.feature[1]}><th scope="row">{p(row.feature)}</th>{row.cells.map((cell, i) => <td key={fit.competitors[i]} className={`${cell}${i === fit.competitors.length - 1 ? " ours" : ""}`}>
          <span className="ps-cell">{cell === "yes" ? <Check size={17} /> : cell === "no" ? <Minus size={15} /> : <CircleDashed size={15} />}<span>{p(fit.cell[cell])}</span></span>
        </td>)}</tr>)}</tbody>
      </table></div>
      <p className="ps-note">{p(fit.note)}</p>
    </section>

    <section id="pilot" className="ps-band ps-close" aria-labelledby="pilot-title">
      <header className="ps-head ps-head-light"><p className="ps-eyebrow">{p(pilot.eyebrow)}</p><h2 id="pilot-title" className="ps-h2">{p(pilot.title)}</h2></header>
      <ol className="ps-phases">{pilot.phases.map((phase, i) => <li key={phase.name[1]} data-reveal style={{ transitionDelay: `${i * 100}ms` }}><span>{i + 1}</span><b>{p(phase.name)}</b><p>{p(phase.detail)}</p></li>)}</ol>
      <blockquote className="ps-final">{p(pilot.final)}</blockquote>
      <ul className="ps-team">{pilot.team.map(member => <li key={member.name[1]}><b>{p(member.name)}</b><span>{p(member.role)}</span></li>)}</ul>
      <div className="ps-actions">
        <Link className="ps-btn ps-btn-light" href="/mobile?tour=1">{T("demo")}<ArrowRight size={18} /></Link>
        <Link className="ps-btn ps-btn-ghost" href="/download/android"><Download size={18} />{T("android")}</Link>
        <Link className="ps-btn ps-btn-ghost" href="/pitch/console"><MessageSquareText size={18} />{T("console")}</Link>
        <a className="ps-btn ps-btn-ghost" href={GITHUB} target="_blank" rel="noopener noreferrer">GitHub<ArrowRight size={18} /></a>
      </div>
    </section>

    <footer className="ps-footer"><span><BrandMark size={24} />Saq Bol</span><span>{T("footer")}</span></footer>

    <aside className="ps-hud" aria-label={T("keys")}>
      {notes && <div className="ps-notes" role="note"><b>{String(index + 1).padStart(2, "0")} · ~{slide.seconds} {p(["сек", "сек"])}</b><p>{p(slide.note)}</p></div>}
      <div className="ps-hud-bar">
        <button type="button" onClick={() => go(index - 1)} disabled={index === 0} aria-label={T("prev")}><ChevronLeft size={18} /></button>
        <span className="ps-hud-count">{String(index + 1).padStart(2, "0")} / {String(slides.length).padStart(2, "0")}</span>
        <button type="button" onClick={() => go(index + 1)} disabled={index === slides.length - 1} aria-label={T("next")}><ChevronRight size={18} /></button>
        <span className="ps-hud-sep" />
        <span className={`ps-hud-clock${left === 0 ? " is-over" : ""}`} role="timer" aria-label={T("timer")} data-running={running || undefined}>{clock}</span>
        <button type="button" onClick={() => setRunning(value => !value)} aria-label={T(running ? "pause" : "start")}>{running ? <Pause size={16} /> : <Play size={16} />}</button>
        <button type="button" onClick={reset} aria-label={T("reset")}><RotateCcw size={15} /></button>
        <button type="button" onClick={() => setNotes(value => !value)} aria-pressed={notes} aria-label={T("notes")}><StickyNote size={16} /></button>
      </div>
      <div className="ps-hud-progress" aria-hidden="true">{slides.map((item, i) => <i key={item.id} style={{ flexGrow: item.seconds }} className={i < index ? "done" : i === index ? "now" : undefined} />)}</div>
    </aside>
  </div>;
}
