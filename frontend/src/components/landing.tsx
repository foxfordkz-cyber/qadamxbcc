"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, BadgeCheck, ChartColumn, FileText, Menu, Phone, PhoneOff, ScanLine, ShieldAlert, ShieldCheck, ShieldX, Smartphone, Timer, X } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { landingText, type LandingKey } from "@/lib/landing-copy";
import { FxCard } from "./fx-card";
import { BrandMark } from "./brand-mark";
import { LanguageSwitch } from "./language-switch";
import { MobileQr } from "./mobile-qr";
import { ScenarioPolicy } from "./scenario-policy";
import { ModelTrial } from "./model-trial";
import { SettlementTrial } from "./settlement-trial";
import wallets from "@/lib/connected-wallet.json";
import "./landing.css";

const steps = [1, 2, 3, 4, 5] as const;
const media = (process.env.NEXT_PUBLIC_BASE_PATH ?? "") + "/media";

const sampleSize = 60;
const proofGroups = [
  { group: "fraud", count: 57, title: "proofFraud", outcome: "proofStopped", rest: "proofMissed" },
  { group: "ordinary", count: 4, title: "proofOrdinary", outcome: "proofHeld", rest: "proofPassed" },
] as const;

export function Landing({ tourEnabled }: { tourEnabled: boolean }) {
  const { lang, t } = useLocale();
  const L = (key: LandingKey) => landingText(lang, key);
  const hero = useRef<HTMLElement>(null);
  const [ring, setRing] = useState(0);
  const [active, setActive] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const stepNodes = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0; const height = hero.current?.offsetHeight ?? 800;
      setRing(Math.min(1, Math.max(0, window.scrollY / (height * .45))));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update(); window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, []);

  useEffect(() => {
    const io = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.step));
    }, { rootMargin: "-45% 0px -45% 0px" });
    stepNodes.current.forEach(node => node && io.observe(node));
    return () => io.disconnect();
  }, []);

  const locked = ring > .97;
  const sections = [
    { key: "how", href: "#story", Icon: ShieldCheck },
    { key: "results", href: "#results", Icon: ChartColumn },
    { key: "application", href: "/download/android", Icon: Smartphone },
    ...(tourEnabled ? [{ key: "jury", href: "#jury", Icon: ScanLine } as const] : []),
  ] as const;
  return <div className="public-home">
    <header className="public-header">
      <div className="public-mast">
        <a className="public-brand" href="#overview" aria-label="Saq Bol × BCC"><BrandMark /><strong>Saq Bol <span>× BCC</span></strong></a>
        <div className="public-tools"><LanguageSwitch />
          <a className="public-signin" href={wallets.url}>{L("access")}<ArrowRight size={18} aria-hidden="true" /></a>
          <button className="public-menu-toggle" type="button" aria-label={L("menu")} aria-controls="public-nav" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}>
            {menuOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
      </div>
      <nav id="public-nav" className="public-nav" data-open={menuOpen || undefined} aria-label={L("nav")}>
        {sections.map(({ key, href, Icon }) => <Link key={key} href={href} onClick={() => setMenuOpen(false)}>
          <span aria-hidden="true"><Icon size={23} /></span>{L(key)}</Link>)}
      </nav>
    </header>
    <main>
    <section id="overview" className="land-hero" ref={hero} aria-labelledby="land-title" data-tour={tourEnabled || undefined}>
      <picture className="land-photo" aria-hidden="true">
        <source media="(max-width: 680px)" srcSet={media + "/alatau-640.webp"} />
        <img src={media + "/alatau-wide.webp"} alt="" fetchPriority="high" width="1600" height="2000" />
      </picture>
      <div className="land-aurora" aria-hidden="true" />
      <div className="land-hero-inner">
        <div className="land-copy">
          <h1 id="land-title" className="land-title"><span>{L("titleA")}</span><span className="land-title-b">{L("titleB")}</span></h1>
          <p className="land-lead">{L("lead")}</p>
          <div className="land-cta">
            {tourEnabled && <Link className="land-btn" href="/mobile?tour=1" prefetch={false}>{t("tourEntry")}<ArrowRight size={17} aria-hidden="true" /></Link>}
            <a className={tourEnabled ? "land-link" : "land-btn"} href="#story">{L("ctaStory")}<ArrowRight size={17} aria-hidden="true" /></a>
          </div>
        </div>
        <div className="land-visual">
          <FxCard size="hero" state={locked ? "locked" : "idle"} ring={ring} label={L("cardLabel")} />
        </div>
      </div>
    </section>

    <section id="results" className="land-proof" aria-labelledby="proof-title">
      <div className="proof-head">
        <h2 id="proof-title">{L("proofTitle")}</h2>
        <p className="proof-time"><Timer size={21} aria-hidden="true" /><strong>5 мс</strong><span>{L("proofSpeed")}</span></p>
      </div>
      <div className="proof-grid">{proofGroups.map(({ group, count, title, outcome, rest }) =>
        <article className="proof-card" data-group={group} key={group}>
          <h3>{L(title)}</h3>
          <p className="proof-result"><strong>{count}<span> / {sampleSize}</span></strong><span>{L(outcome)}</span></p>
          <div className="proof-marks" aria-hidden="true">{Array.from({ length: sampleSize }, (_, index) =>
            <i key={index} className={index < count ? "counted" : undefined} />)}</div>
          <p className="proof-remainder">{L(rest).replace("{n}", String(sampleSize - count))}</p>
        </article>
      )}</div>
      <ScenarioPolicy />
      <SettlementTrial />
      <ModelTrial />
    </section>

    <section id="story" className="land-story" aria-labelledby="story-title">
      <header className="land-section-head">
        <p className="eyebrow">{L("storyEyebrow")}</p>
        <h2 id="story-title">{L("storyTitle")}</h2>
      </header>
      <div className="story-grid">
        <ol className="story-steps">
          {steps.map((n, index) => <li key={n} data-step={index} ref={node => { stepNodes.current[index] = node; }} className={active === index ? "is-active" : ""}>
            <span className="story-time">{L(`s${n}Time` as LandingKey)}</span>
            <h3>{L(`s${n}Title` as LandingKey)}</h3>
            <p>{L(`s${n}Text` as LandingKey)}</p>
          </li>)}
        </ol>
        <div className="story-phone-wrap" aria-hidden="true">
          <div className="story-phone" data-active={active}>
            <div className="story-notch" />
            <div className={`story-screen screen-call ${active === 0 ? "is-on" : ""}`}>
              <div className="call-avatar"><ShieldAlert size={34} /></div>
              <strong>{L("callFrom")}</strong><span>+7 727 ••• •• ••</span><small>{L("callTimer")}</small>
              <div className="call-actions"><i className="call-end"><PhoneOff size={22} /></i><i className="call-ok"><Phone size={22} /></i></div>
            </div>
            <div className={`story-screen screen-pause ${active === 1 ? "is-on" : ""}`}>
              <span className="pause-badge">{L("pauseLabel")}</span>
              <FxCard size="wallet" state={active === 1 ? "frozen" : "idle"} allow3d={false} label="" />
              <strong className="pause-amount">450 000 ₸</strong>
              <div className="pause-clock"><b>14:59</b><span>{L("pauseLeft")}</span></div>
              <span className="pause-safe"><BadgeCheck size={16} />{L("pauseSafe")}</span>
            </div>
            <div className={`story-screen screen-check ${active === 2 ? "is-on" : ""}`}>
              <div className="check-icon"><ShieldX size={40} /></div>
              <strong>{L("bankCheck")}</strong>
              <p>{L("bankCheckHint")}</p>
              <span className="check-call"><PhoneOff size={18} />505</span>
            </div>
            <div className={`story-screen screen-tg ${active === 3 ? "is-on" : ""}`}>
              <div className="tg-head"><span className="tg-avatar">S</span><div><b>Saq Bol</b><small>bot</small></div></div>
              <div className="tg-bubble">{L("tgBot")}<div className="tg-buttons"><span className="tg-scam">{L("tgScam")}</span><span>{L("tgOk")}</span></div></div>
              <div className="tg-done"><ShieldX size={16} />{L("tgDone")}</div>
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

    {tourEnabled && <section className="public-jury" id="jury">
      <div><h2>{L("juryTitle")}</h2><p>{L("juryHint")}</p></div>
      <div className="public-jury-actions"><Link href="/mobile?tour=1" className="land-btn" prefetch={false}>{t("tourEntry")}<ArrowRight size={17} /></Link><MobileQr tourEnabled /></div>
    </section>}
    </main>
    <footer className="public-footer"><strong>Saq Bol × BCC</strong><Link href="/download/android">{L("application")}</Link><a href={wallets.url}>{L("teamAccess")}</a></footer>
  </div>;
}
