"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowRight, BadgeCheck, FileText, Phone, PhoneOff, ShieldAlert, ShieldX } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { landingText, type LandingKey } from "@/lib/landing-copy";
import { FxCard } from "./fx-card";
import { useReducedMotion } from "./use-fx-tier";
import "./landing.css";

const steps = [1, 2, 3, 4, 5] as const;

function Counter({ value, decimals = 0, prefix = "", suffix = "" }: { value: number; decimals?: number; prefix?: string; suffix?: string }) {
  const node = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (reduced) { setShown(value); return; }
    const element = node.current; if (!element) return;
    let raf = 0;
    const io = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      io.disconnect(); const start = performance.now();
      const tick = (now: number) => {
        const k = Math.min(1, (now - start) / 1400); const eased = 1 - Math.pow(1 - k, 4);
        setShown(value * eased); if (k < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, { threshold: .6 });
    io.observe(element);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [value, reduced]);
  return <strong ref={node} className="land-stat-value">{prefix}{shown.toFixed(decimals).replace(".", ",")}{suffix}</strong>;
}

export function Landing() {
  const { lang } = useLocale();
  const L = (key: LandingKey) => landingText(lang, key);
  const hero = useRef<HTMLElement>(null);
  const [ring, setRing] = useState(0);
  const [active, setActive] = useState(0);
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
  return <>
    <section className="land-hero" ref={hero} aria-labelledby="land-title">
      <div className="land-aurora" aria-hidden="true" />
      <div className="land-hero-inner">
        <div className="land-copy">
          <p className="eyebrow land-eyebrow"><span className="live-dot" />{L("eyebrow")}</p>
          <h1 id="land-title" className="land-title"><span>{L("titleA")}</span><span className="land-title-b">{L("titleB")}</span></h1>
          <p className="land-lead">{L("lead")}</p>
          <div className="land-cta">
            <a className="primary" href="#story">{L("ctaStory")}<ArrowDown size={17} aria-hidden="true" /></a>
            <Link className="secondary" href="/mobile">{L("ctaClient")}</Link>
            <Link className="land-link" href="/soc">{L("ctaSoc")}<ArrowRight size={16} aria-hidden="true" /></Link>
          </div>
        </div>
        <div className="land-visual">
          <FxCard size="hero" state={locked ? "locked" : "idle"} ring={ring} label={L("cardLabel")} />
          <span className={`land-scroll ${ring > .05 ? "is-hidden" : ""}`} aria-hidden="true">{L("scrollHint")}<i /></span>
        </div>
      </div>
      <dl className="land-stats">
        <div><dt>{L("statStopped")}</dt><dd><Counter value={57} suffix=" / 60" /></dd></div>
        <div><dt>{L("statFalse")}</dt><dd><Counter value={4} suffix=" / 60" /></dd></div>
        <div><dt>{L("statSpeed")}</dt><dd><Counter value={5} suffix=" мс" /></dd></div>
        <p className="land-stats-note">{L("statNote")}</p>
      </dl>
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

    <section className="land-live" aria-labelledby="live-title">
      <p className="eyebrow">{L("liveEyebrow")}</p>
      <h2 id="live-title">{L("liveTitle")}</h2>
      <p>{L("liveText")}</p>
    </section>
  </>;
}
