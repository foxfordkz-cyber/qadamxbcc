"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, FileText, Home, Menu, Phone, PhoneOff, X } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { landingText, type LandingKey } from "@/lib/landing-copy";
import { BrandMark } from "./brand-mark";
import { LanguageSwitch } from "./language-switch";
import { MobileQr } from "./mobile-qr";
import { DropNetwork } from "./drop-network";
import type { DropStage } from "./drop-scene";
import { ScenarioPolicy } from "./scenario-policy";
import { ModelTrial } from "./model-trial";
import { SettlementTrial } from "./settlement-trial";
import wallets from "@/lib/connected-wallet.json";
import "@fontsource-variable/roboto-flex";
import "./landing.css";

const steps = [1, 2, 3, 4, 5] as const;
const dropSteps = [1, 2, 3, 4] as const;
const media = (process.env.NEXT_PUBLIC_BASE_PATH ?? "") + "/media";
/** Glossy 3D objects shared with the Android wallet (android-app/www/img3d). */
const art = (name: string) => `${media}/3d/${name}.webp`;

const sampleSize = 60;
const proofGroups = [
  { group: "fraud", count: 57, title: "proofFraud", outcome: "proofStopped", rest: "proofMissed" },
  { group: "ordinary", count: 4, title: "proofOrdinary", outcome: "proofHeld", rest: "proofPassed" },
] as const;
const layers = [
  { n: 1, art: "phone" },
  { n: 2, art: "clock" },
  { n: 3, art: "family" },
  { n: 4, art: "search" },
] as const;
const quick = [
  { key: "qTransfer", art: "transfer" },
  { key: "qHistory", art: "clock" },
  { key: "qSafety", art: "shield" },
  { key: "qCheck", art: "search" },
] as const;
const stepArt = ["phone", "clock", "warning", "chat", "chart"] as const;
/** Anchors inside the collapsed analysis that README and docs link to directly. */
const analysisAnchors = ["analysis", "risk-policy", "settlement-proof", "model-trial"];

export function Landing({ tourEnabled }: { tourEnabled: boolean }) {
  const { lang, t } = useLocale();
  const L = (key: LandingKey) => landingText(lang, key);
  const [active, setActive] = useState(0);
  const [dropStage, setDropStage] = useState<DropStage>(0);
  const dropNodes = useRef<(HTMLLIElement | null)[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const stepNodes = useRef<(HTMLLIElement | null)[]>([]);
  const analysis = useRef<HTMLDetailsElement>(null);
  const visual = useRef<HTMLDivElement>(null);

  // The phone and the 3D objects lean towards the pointer (desktop only).
  function tilt(event: React.PointerEvent) {
    if (event.pointerType === "touch" || !visual.current) return;
    const box = event.currentTarget.getBoundingClientRect();
    visual.current.style.setProperty("--px", ((event.clientX - box.left) / box.width * 2 - 1).toFixed(3));
    visual.current.style.setProperty("--py", ((event.clientY - box.top) / box.height * 2 - 1).toFixed(3));
  }
  function untilt() { visual.current?.style.setProperty("--px", "0"); visual.current?.style.setProperty("--py", "0"); }

  useEffect(() => {
    const io = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.step));
    }, { rootMargin: "-45% 0px -45% 0px" });
    stepNodes.current.forEach(node => node && io.observe(node));
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const io = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) setDropStage(Number((entry.target as HTMLElement).dataset.stage) as DropStage);
    }, { rootMargin: "-40% 0px -40% 0px" });
    dropNodes.current.forEach(node => node && io.observe(node));
    return () => io.disconnect();
  }, []);

  // Deep links such as /#model-trial must land on an expanded section.
  useEffect(() => {
    const reveal = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!analysisAnchors.includes(id) || !analysis.current) return;
      analysis.current.open = true;
      requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);

  const sections = [
    { key: "how", href: "#how", art: "shield" },
    { key: "dropsNav", href: "#drops", art: "family" },
    { key: "results", href: "#results", art: "chart" },
    { key: "application", href: "/download/android", art: "phone" },
    ...(tourEnabled ? [{ key: "jury", href: "#jury", art: "search" } as const] : []),
  ] as const;
  return <div className="public-home">
    <header className="public-header">
      <div className="public-mast">
        <a className="public-brand" href="#overview" aria-label="Saq Bol × BCC"><BrandMark /><strong>Saq Bol <span>× BCC</span></strong></a>
        <nav id="public-nav" className="public-nav" data-open={menuOpen || undefined} aria-label={L("nav")}>
          {sections.map(({ key, href, art: name }) => <Link key={key} href={href} onClick={() => setMenuOpen(false)}>
            <img src={art(name)} alt="" width="30" height="30" loading="lazy" />{L(key)}</Link>)}
        </nav>
        <div className="public-tools"><LanguageSwitch />
          <a className="public-signin" href={wallets.url}>{L("access")}<ArrowRight size={17} aria-hidden="true" /></a>
          <button className="public-menu-toggle" type="button" aria-label={L("menu")} aria-controls="public-nav" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}>
            {menuOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
      </div>
    </header>
    <main>
    <section id="overview" className="land-hero" aria-labelledby="land-title" data-tour={tourEnabled || undefined} onPointerMove={tilt} onPointerLeave={untilt}>
      <div className="land-hero-inner">
        <div className="land-copy">
          <p className="land-eyebrow"><img src={art("shield")} alt="" width="22" height="22" />{L("eyebrow")}</p>
          <h1 id="land-title" className="land-title"><span>{L("titleA")}</span><span className="land-title-b">{L("titleB")}</span></h1>
          <p className="land-lead">{L("lead")}</p>
          <div className="land-cta">
            {tourEnabled && <Link className="land-btn" href="/mobile?tour=1" prefetch={false}>{t("tourEntry")}<ArrowRight size={18} aria-hidden="true" /></Link>}
            <a className={tourEnabled ? "land-link" : "land-btn"} href="#story">{L("ctaStory")}<ArrowRight size={17} aria-hidden="true" /></a>
          </div>
          <dl className="land-stats">
            <div><dt>57 / 60</dt><dd>{L("heroStatFraud")}</dd></div>
            <div><dt>5 мс</dt><dd>{L("proofSpeed")}</dd></div>
            <div><dt>15 мин</dt><dd>{L("heroStatPause")}</dd></div>
          </dl>
        </div>
        <div className="land-visual" aria-hidden="true" ref={visual}>
          <img className="land-float land-float-card" src={art("card")} alt="" width="150" height="150" />
          <div className="app-phone">
            <div className="app-screen">
              <div className="app-head">
                <div className="app-hello"><span className="app-avatar">СА</span><span><small>{L("phoneHello")}</small><b>Сәуле</b></span></div>
                <p className="app-label">{L("phoneAccounts")}</p>
                <strong className="app-balance">850 000 ₸</strong>
                <span className="app-cardline">{L("phoneCard")} · •••• 4821</span>
                <img className="app-card-art" src={art("card")} alt="" width="120" height="120" />
              </div>
              <div className="app-body">
                <div className="app-quick">{quick.map(({ key, art: name }) => <span key={key}><i><img src={art(name)} alt="" width="26" height="26" /></i>{L(key)}</span>)}</div>
                <div className="app-hold">
                  <span className="app-pill">{L("pauseLabel")}</span>
                  <div className="app-hold-row"><strong>450 000 ₸</strong><b>14:59</b></div>
                  <small>{L("phoneHoldReason")}</small>
                  <img src={art("lock")} alt="" width="58" height="58" />
                </div>
                <div className="app-tabbar"><span className="is-on"><Home size={15} />{L("tabHome")}</span><i /><i /><i /><i /></div>
              </div>
            </div>
          </div>
          <img className="land-float land-float-shield" src={art("shield")} alt="" width="190" height="190" />
        </div>
      </div>
    </section>

    <section id="how" className="land-layers" aria-labelledby="layers-title">
      <header className="land-section-head">
        <p className="eyebrow">{L("layersEyebrow")}</p>
        <h2 id="layers-title">{L("layersTitle")}</h2>
        <p>{L("layersLead")}</p>
      </header>
      <ol className="layer-grid">{layers.map(({ n, art: name }) => <li key={n} className="layer-card">
        <img src={art(name)} alt="" width="84" height="84" loading="lazy" />
        <h3>{L(`l${n}Title` as LandingKey)}</h3>
        <p>{L(`l${n}Text` as LandingKey)}</p>
      </li>)}</ol>
    </section>

    <section id="drops" className="land-drops" aria-labelledby="drops-title">
      <header className="land-section-head">
        <p className="eyebrow">{L("dropsEyebrow")}</p>
        <h2 id="drops-title">{L("dropsTitle")}</h2>
      </header>
      <div className="drops-grid">
        <div className="drops-sticky">
          <DropNetwork stage={dropStage} label={L("dropsLabel")} legend={{ client: L("legendClient"), drop: L("legendDrop"), hub: L("legendHub"), cash: L("legendCash") }} />
        </div>
        <ol className="drops-steps">{dropSteps.map((n, index) => <li key={n} data-stage={index} ref={node => { dropNodes.current[index] = node; }} className={dropStage === index ? "is-active" : ""}>
          <span className="drops-dot" aria-hidden="true" />
          <h3>{L(`d${n}Title` as LandingKey)}</h3>
          <p>{L(`d${n}Text` as LandingKey)}</p>
        </li>)}</ol>
      </div>
    </section>

    <section id="results" className="land-proof" aria-labelledby="proof-title">
      <div className="proof-head">
        <div><p className="eyebrow">{L("resultsEyebrow")}</p><h2 id="proof-title">{L("proofTitle")}</h2></div>
        <p className="proof-time"><img src={art("clock")} alt="" width="34" height="34" loading="lazy" /><strong>5 мс</strong><span>{L("proofSpeed")}</span></p>
      </div>
      <div className="proof-grid">{proofGroups.map(({ group, count, title, outcome, rest }) =>
        <article className="proof-card" data-group={group} key={group}>
          <img className="proof-art" src={art(group === "fraud" ? "shield" : "warning")} alt="" width="96" height="96" loading="lazy" />
          <h3>{L(title)}</h3>
          <p className="proof-result"><strong>{count}<span> / {sampleSize}</span></strong><span>{L(outcome)}</span></p>
          <div className="proof-marks" aria-hidden="true">{Array.from({ length: sampleSize }, (_, index) =>
            <i key={index} className={index < count ? "counted" : undefined} />)}</div>
          <p className="proof-remainder">{L(rest).replace("{n}", String(sampleSize - count))}</p>
        </article>
      )}</div>
      <details className="land-more" id="analysis" ref={analysis}>
        <summary>
          <img src={art("chart")} alt="" width="52" height="52" loading="lazy" />
          <span><strong>{L("moreTitle")}</strong><small>{L("moreHint")}</small></span>
          <ChevronDown className="land-more-chevron" size={22} aria-hidden="true" />
        </summary>
        <ScenarioPolicy />
        <SettlementTrial />
        <ModelTrial />
      </details>
    </section>

    <section id="story" className="land-story" aria-labelledby="story-title">
      <header className="land-section-head">
        <p className="eyebrow">{L("storyEyebrow")}</p>
        <h2 id="story-title">{L("storyTitle")}</h2>
      </header>
      <div className="story-grid">
        <ol className="story-steps">
          {steps.map((n, index) => <li key={n} data-step={index} ref={node => { stepNodes.current[index] = node; }} className={active === index ? "is-active" : ""}>
            <img src={art(stepArt[index])} alt="" width="64" height="64" loading="lazy" />
            <div>
              <span className="story-time">{L(`s${n}Time` as LandingKey)}</span>
              <h3>{L(`s${n}Title` as LandingKey)}</h3>
              <p>{L(`s${n}Text` as LandingKey)}</p>
            </div>
          </li>)}
        </ol>
        <div className="story-phone-wrap" aria-hidden="true">
          <div className="story-phone" data-active={active}>
            <div className="story-notch" />
            <div className={`story-screen screen-call ${active === 0 ? "is-on" : ""}`}>
              <div className="call-avatar"><img src={art("phone")} alt="" width="58" height="58" /></div>
              <strong>{L("callFrom")}</strong><span>+7 727 ••• •• ••</span><small>{L("callTimer")}</small>
              <div className="call-actions"><i className="call-end"><PhoneOff size={22} /></i><i className="call-ok"><Phone size={22} /></i></div>
            </div>
            <div className={`story-screen screen-pause ${active === 1 ? "is-on" : ""}`}>
              <span className="pause-badge">{L("pauseLabel")}</span>
              <div className="pause-art"><img src={art("card")} alt="" width="150" height="150" /><img className="pause-lock" src={art("lock")} alt="" width="64" height="64" /></div>
              <strong className="pause-amount">450 000 ₸</strong>
              <div className="pause-clock"><b>14:59</b><span>{L("pauseLeft")}</span></div>
              <span className="pause-safe">{L("pauseSafe")}</span>
            </div>
            <div className={`story-screen screen-check ${active === 2 ? "is-on" : ""}`}>
              <img className="check-icon" src={art("warning")} alt="" width="92" height="92" />
              <strong>{L("bankCheck")}</strong>
              <p>{L("bankCheckHint")}</p>
              <span className="check-call"><Phone size={18} />505</span>
            </div>
            <div className={`story-screen screen-tg ${active === 3 ? "is-on" : ""}`}>
              <div className="tg-head"><BrandMark className="tg-avatar" size={38} /><div><b>Saq Bol</b><small>bot</small></div></div>
              <div className="tg-bubble">{L("tgBot")}<div className="tg-buttons"><span className="tg-scam">{L("tgScam")}</span><span>{L("tgOk")}</span></div></div>
              <div className="tg-done">{L("tgDone")}</div>
            </div>
            <div className={`story-screen screen-soc ${active === 4 ? "is-on" : ""}`}>
              <svg viewBox="0 0 240 260" className="soc-graph">
                {[[30, 40], [40, 120], [28, 200], [90, 24], [96, 236], [70, 160]].map(([x, y], i) => <g key={i}>
                  <path d={`M${x} ${y} Q ${(x + 150) / 2} ${(y + 130) / 2 - 20} 150 130`} className="soc-edge" style={{ animationDelay: `${i * .25}s` }} />
                  <circle cx={x} cy={y} r="7" className="soc-node" />
                </g>)}
                {[[214, 70], [220, 190]].map(([x, y], i) => <g key={`o${i}`}><path d={`M150 130 L ${x} ${y}`} className="soc-edge soc-out" style={{ animationDelay: `${.4 + i * .3}s` }} /><circle cx={x} cy={y} r="6" className="soc-node" /></g>)}
                <circle cx="150" cy="130" r="22" className="soc-hub-glow" /><circle cx="150" cy="130" r="13" className="soc-hub" />
              </svg>
              <span className="soc-label">{L("socHub")} · 13 → 1</span>
              <span className="soc-report"><FileText size={16} />{L("socReport")}</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section className="public-app" id={tourEnabled ? "jury" : "app"} aria-labelledby="app-title">
      <div className="public-app-copy">
        <p className="eyebrow">{L(tourEnabled ? "jury" : "application")}</p>
        <h2 id="app-title">{L(tourEnabled ? "juryTitle" : "appTitle")}</h2>
        <p>{L(tourEnabled ? "juryHint" : "appText")}</p>
        <div className="public-app-actions">
          {tourEnabled && <Link href="/mobile?tour=1" className="land-btn" prefetch={false}>{t("tourEntry")}<ArrowRight size={18} /></Link>}
          <Link href="/download/android" className={tourEnabled ? "land-btn land-btn-ghost" : "land-btn"}>{L("appDownload")}<ArrowRight size={18} /></Link>
          {tourEnabled && <MobileQr tourEnabled />}
        </div>
      </div>
      <div className="public-app-art" aria-hidden="true">
        <img src={art("phone")} alt="" width="230" height="230" loading="lazy" />
        <img src={art("shield")} alt="" width="130" height="130" loading="lazy" />
      </div>
    </section>
    </main>
    <footer className="public-footer"><span className="public-footer-brand"><BrandMark size={28} /><strong>Saq Bol × BCC</strong></span><Link href="/download/android">{L("application")}</Link><a href={wallets.url}>{L("teamAccess")}</a></footer>
  </div>;
}
