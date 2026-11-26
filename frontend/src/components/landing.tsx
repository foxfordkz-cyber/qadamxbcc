"use client";

import { walletEntry } from "@/lib/wallet-warmup";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, ChevronDown, Download, FileText, MessageSquareWarning, Menu, PhoneOff, RotateCcw, ShoppingBag, UserCheck, X, Link2Off } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { landingText, type LandingKey } from "@/lib/landing-copy";
import { BrandMark } from "./brand-mark";
import { LanguageSwitch } from "./language-switch";
import { MobileQr } from "./mobile-qr";
import { DropNetwork } from "./drop-network";
import { HeroDemo } from "./hero-demo";
import { FxCard } from "./fx-card";
import type { DropStage } from "./drop-scene";
import { ScenarioPolicy } from "./scenario-policy";
import { ModelTrial } from "./model-trial";
import { SettlementTrial } from "./settlement-trial";
import "./landing.css";

const dropSteps = [1, 2, 3, 4] as const;
const requirements = [1, 2, 3, 4, 5, 6] as const;
const sampleSize = 60;
const proofGroups = [
  { group: "fraud", count: 57, title: "proofFraud", outcome: "proofStopped", rest: "proofMissed" },
  { group: "ordinary", count: 4, title: "proofOrdinary", outcome: "proofHeld", rest: "proofPassed" },
] as const;
/** Synthetic stand rows shown in the SOC preview. */
const feed = [
  { time: "13:05", from: "Сәуле А.", to: "Дархан Б.", amount: "450 000 ₸", status: "held", score: 68 },
  { time: "13:04", from: "Ерлан М.", to: "Дархан Б.", amount: "120 000 ₸", status: "blocked", score: 91 },
  { time: "13:02", from: "Айгерім С.", to: "Әлия Н.", amount: "15 000 ₸", status: "approved", score: 8 },
  { time: "12:58", from: "Мұрат К.", to: "Дархан Б.", amount: "300 000 ₸", status: "blocked", score: 88 },
] as const;
/** Anchors inside the collapsed analysis that README and docs link to directly. */
const analysisAnchors = ["analysis", "risk-policy", "settlement-proof", "model-trial"];
const GITHUB = "https://github.com/foxfordkz-cyber/qadamxbcc";

export function Landing({ tourEnabled }: { tourEnabled: boolean }) {
  const { lang, t } = useLocale();
  const L = (key: LandingKey) => landingText(lang, key);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropStage, setDropStage] = useState<DropStage>(0);
  const dropNodes = useRef<(HTMLLIElement | null)[]>([]);
  const analysis = useRef<HTMLDetailsElement>(null);
  const [held, setHeld] = useState(false);
  // The hero card: the glass shield closes and frosts over the card, then clears again.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setHeld(true); return; }
    const timer = setInterval(() => setHeld(value => !value), 3600);
    return () => clearInterval(timer);
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
    { key: "navHow", href: "#features" },
    { key: "navBank", href: "#bank" },
    { key: "navResults", href: "#results" },
    { key: "navTech", href: "#tech" },
    { key: "navApp", href: "/download/android" },
  ] as const;
  const status = { held: L("socHeld"), blocked: L("socBlocked"), approved: L("socApproved") };
  return <div className="public-home">
    <header className="public-header">
      <div className="public-mast">
        <a className="public-brand" href="#overview" aria-label="Saq Bol"><BrandMark /><strong>Saq Bol</strong></a>
        <nav id="public-nav" className="public-nav" data-open={menuOpen || undefined} aria-label={L("nav")}>
          {sections.map(({ key, href }) => <Link key={key} href={href} onClick={() => setMenuOpen(false)}>{L(key)}</Link>)}
        </nav>
        <div className="public-tools"><LanguageSwitch />
          <a className="public-signin" href={walletEntry("wallet")}>{L("access")}</a>
          <button className="public-menu-toggle" type="button" aria-label={L("menu")} aria-controls="public-nav" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}>
            {menuOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
      </div>
    </header>
    <main>
    <section id="overview" className="land-hero" aria-labelledby="land-title" data-tour={tourEnabled || undefined}>
      <div className="land-copy">
        <h1 id="land-title" className="land-title"><span>{L("heroTitleA")}</span><span className="land-title-b">{L("heroTitleB")}</span></h1>
        <p className="land-lead">{L("heroLead")}</p>
        <ul className="land-checks">{(["heroCheck1", "heroCheck2", "heroCheck3"] as const).map(key => <li key={key}><Check size={18} aria-hidden="true" />{L(key)}</li>)}</ul>
        <div className="land-cta">
          {tourEnabled && <Link className="land-btn" href="/mobile?tour=1" prefetch={false}>{t("tourEntry")}<ArrowRight size={18} aria-hidden="true" /></Link>}
          <Link className={tourEnabled ? "land-btn land-btn-ghost" : "land-btn"} href="/download/android"><Download size={18} aria-hidden="true" />{L("heroDownload")}</Link>
        </div>
      </div>
      <div className="land-stage" data-held={held || undefined} aria-hidden="true">
        <FxCard size="hero" state={held ? "frozen" : "idle"} ring={held ? 1 : 0} label={L("heroCardLabel")} />
        <div className="land-toast land-toast-pause"><i className="land-toast-dot" /><span><b>{L("heroToastPause")}</b><small>{L("heroToastPauseSub")}</small></span></div>
        <div className="land-toast land-toast-call"><span className="land-toast-icon"><PhoneOff size={17} /></span><span><b>{L("demoNotBank")}</b><small>{L("heroToastCallSub")}</small></span></div>
      </div>
    </section>

    <section id="features" className="land-features" aria-labelledby="feat-title">
      <header className="land-head"><p className="eyebrow">{L("featEyebrow")}</p><h2 id="feat-title">{L("featTitle")}</h2><p>{L("featLead")}</p></header>
      <article className="feat-hero">
        <div className="feat-copy">
          <h3>{L("fPauseTitle")}</h3>
          <ul className="land-checks">{(["fPause1", "fPause2", "fPause3"] as const).map(key => <li key={key}><Check size={18} aria-hidden="true" />{L(key)}</li>)}</ul>
          {tourEnabled && <Link className="land-btn" href="/mobile?tour=1" prefetch={false}>{t("tourEntry")}<ArrowRight size={18} aria-hidden="true" /></Link>}
        </div>
        <HeroDemo />
      </article>
      <div className="feat-grid">
        <article className="feat-card">
          <div className="feat-mini mini-call"><span className="mini-icon mini-red"><PhoneOff size={18} /></span><span><b>{L("demoNotBank")}</b><small>{L("heroToastCallSub")}</small></span></div>
          <h3>{L("fCallTitle")}</h3><p>{L("fCallText")}</p><a href={walletEntry("wallet")}>{lang === "kk" ? "Оқу әмияны · қоңыраудан кейін банкоматта 15 минут кідіру" : "Учебный кошелёк · пауза 15 минут при снятии по просьбе звонящего"}</a>
        </article>
        <article className="feat-card">
          <div className="feat-mini mini-chat"><span className="mini-bubble">{L("demoBotText")}</span><span className="mini-choices"><i className="mini-scam">{L("demoScam")}</i><i>{L("demoFine")}</i></span></div>
          <h3>{L("fFamilyTitle")}</h3><p>{L("fFamilyText")}</p>
        </article>
        <article className="feat-card">
          <div className="feat-mini mini-sms"><span>{L("miniSms")}</span><small><MessageSquareWarning size={14} />{L("miniSmsVerdict")}</small></div>
          <h3>{L("fSmsTitle")}</h3><p>{L("fSmsText")}</p><a href={walletEntry("soc")}>{lang === "kk" ? "SOC · жалған домендер мен Telegram аккаунттары туралы хабарлау" : "SOC · журнал подозрительных доменов и Telegram-аккаунтов"}</a>
        </article>
        <article className="feat-card">
          <div className="feat-mini mini-payee"><span><UserCheck size={16} />{L("miniPayeeBank")}</span><small>{L("miniPayeeContact")}</small></div>
          <h3>{L("fPayeeTitle")}</h3><p>{L("fPayeeText")}</p>
        </article>
        <article className="feat-card">
          <div className="feat-mini mini-return"><span>{L("miniReturn")}</span><i><RotateCcw size={14} />{L("miniReturnAction")}</i></div>
          <h3>{L("fReturnTitle")}</h3><p>{L("fReturnText")}</p><a href={walletEntry("soc")}>{lang === "kk" ? "Даулы аударым бойынша екі тараптың жауабы · SOC" : "Объяснения отправителя и получателя спорного платежа · SOC"}</a>
        </article>
        <article className="feat-card">
          <div className="feat-mini mini-shop"><span className="mini-icon mini-amber"><ShoppingBag size={17} /></span><span>{L("miniShop")}</span></div>
          <h3>{L("fShopTitle")}</h3><p>{L("fShopText")}</p>
        </article>
        <article className="feat-card">
          <div className="feat-mini mini-link"><span className="mini-url">bcc-kz.secure-pay.top</span><small><Link2Off size={14} />{L("miniLinkVerdict")}</small></div>
          <h3>{L("fLinkTitle")}</h3><p>{L("fLinkText")}</p>
        </article>
        <article className="feat-card">
          <div className="feat-mini mini-report"><FileText size={18} /><span>{L("miniReport")}</span><i /><i /><i /></div>
          <h3>{L("fReportTitle")}</h3><p>{L("fReportText")}</p>
        </article>
      </div>
    </section>

    <section id="requirements" className="land-req" aria-labelledby="req-title">
      <header className="land-head"><p className="eyebrow">{L("reqEyebrow")}</p><h2 id="req-title">{L("reqTitle")}</h2></header>
      <div className="req-table" role="table" aria-labelledby="req-title">
        <div className="req-row req-row-head" role="row"><span role="columnheader">{L("reqColAsk")}</span><span role="columnheader">{L("reqColDone")}</span><span role="columnheader">{L("reqColProof")}</span></div>
        {requirements.map(n => <div className="req-row" role="row" key={n}>
          <span role="cell" className="req-ask"><i>{n}</i>{L(`req${n}Ask` as LandingKey)}</span>
          <span role="cell" className="req-done">{L(`req${n}Done` as LandingKey)}</span>
          <span role="cell" className="req-proof">{L(`req${n}Proof` as LandingKey)}</span>
        </div>)}
      </div>
    </section>

    <section id="drops" className="land-drops" aria-labelledby="drops-title">
      <header className="land-head"><p className="eyebrow">{L("dropsEyebrow")}</p><h2 id="drops-title">{L("dropsTitle")}</h2></header>
      <div className="drops-grid">
        <div className="drops-sticky">
          <DropNetwork stage={dropStage} label={L("dropsLabel")} legend={{ client: L("legendClient"), drop: L("legendDrop"), hub: L("legendHub"), cash: L("legendCash") }} />
        </div>
        <ol className="drops-steps">{dropSteps.map((n, index) => <li key={n} data-stage={index} ref={node => { dropNodes.current[index] = node; }} className={dropStage === index ? "is-active" : ""}>
          <span className="drops-dot" aria-hidden="true">{n}</span>
          <h3>{L(`d${n}Title` as LandingKey)}</h3>
          <p>{L(`d${n}Text` as LandingKey)}</p>
        </li>)}</ol>
      </div>
    </section>

    <section id="bank" className="land-bank" aria-labelledby="bank-title">
      <div className="bank-copy">
        <p className="eyebrow">{L("bankEyebrow")}</p>
        <h2 id="bank-title">{L("bankTitle")}</h2>
        <p>{L("bankLead")}</p>
        <ul className="bank-features">{(["bankF1", "bankF2", "bankF3", "bankF4", "bankF5", "bankF6"] as const).map(key => <li key={key}>{L(key)}</li>)}</ul>
      </div>
      <figure className="soc-mock" aria-label={L("socTitle")}>
        <div className="soc-mock-bar"><strong><BrandMark size={22} />{L("socTitle")}</strong><span>{L("socPeriod")}</span></div>
        <div className="soc-kpis">
          <div><small>{L("socK1")}</small><b>57 / 60</b></div>
          <div><small>{L("socK2")}</small><b>4 / 60</b></div>
          <div><small>{L("socK3")}</small><b>5 мс</b></div>
          <div><small>{L("socK4")}</small><b>3</b></div>
        </div>
        <div className="soc-panels">
          <div className="soc-feed"><p>{L("socFeed")}</p>
            <ul>{feed.map(row => <li key={row.time + row.from} data-status={row.status}>
              <time>{row.time}</time>
              <span className="soc-parties">{row.from} → {row.to}</span>
              <b>{row.amount}</b>
              <span className="soc-status">{status[row.status]}</span>
              <span className="soc-score"><i style={{ width: `${row.score}%` }} />{row.score}</span>
            </li>)}</ul>
          </div>
          <div className="soc-graph-card"><p>{L("socGraph")}</p>
            <svg viewBox="0 0 220 150" aria-hidden="true">
              {[[24, 22], [18, 62], [26, 104], [60, 136], [70, 10], [44, 82]].map(([x, y], i) => <g key={i}><line x1={x} y1={y} x2="130" y2="75" className="sg-in" /><circle cx={x} cy={y} r="6" className="sg-node" /></g>)}
              {[[196, 40], [200, 112]].map(([x, y], i) => <g key={`o${i}`}><line x1="130" y1="75" x2={x} y2={y} className="sg-out" /><circle cx={x} cy={y} r="6" className="sg-node" /></g>)}
              <circle cx="130" cy="75" r="18" className="sg-halo" /><circle cx="130" cy="75" r="10" className="sg-hub" />
            </svg>
            <small>{L("socHub")}</small>
            <span className="soc-report"><FileText size={14} />{L("socReport")}</span>
          </div>
        </div>
        <figcaption>{L("socNote")}</figcaption>
      </figure>
    </section>

    <section id="results" className="land-proof" aria-labelledby="proof-title">
      <div className="proof-head">
        <div><p className="eyebrow">{L("resultsEyebrow")}</p><h2 id="proof-title">{L("proofTitle")}</h2></div>
        <p className="proof-time"><strong>5 мс</strong><span>{L("proofSpeed")}</span></p>
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
      <article className="real-card" aria-labelledby="real-title">
        <div><h3 id="real-title">{L("realTitle")}</h3><p>{L("realText")}</p></div>
        <dl>
          <div><dt>91 / 114</dt><dd>{L("realCaught")}</dd></div>
          <div><dt>1,3</dt><dd>{L("realFp")}</dd></div>
        </dl>
        <p className="real-note">{L("realNote")}</p>
      </article>
      <details className="land-more" id="analysis" ref={analysis}>
        <summary>
          <span><strong>{L("moreTitle")}</strong><small>{L("moreHint")}</small></span>
          <ChevronDown className="land-more-chevron" size={22} aria-hidden="true" />
        </summary>
        <ScenarioPolicy />
        <SettlementTrial />
        <ModelTrial />
      </details>
    </section>

    <section id="tech" className="land-tech" aria-labelledby="tech-title">
      <header className="land-head"><p className="eyebrow">{L("techEyebrow")}</p><h2 id="tech-title">{L("techTitle")}</h2><p>{L("techLead")}</p></header>
      <div className="arch">
        <div className="arch-node"><b>{L("archClient")}</b><small>{L("archClientSub")}</small></div>
        <div className="arch-node"><b>{L("archGateway")}</b><small>{L("archGatewaySub")}</small></div>
        <div className="arch-node arch-engine"><b>{L("archEngine")}</b><small>{L("archEngineSub")}</small>
          <div className="arch-bands"><span data-band="ok">{L("bandApprove")}</span><span data-band="hold">{L("bandHold")}</span><span data-band="block">{L("bandBlock")}</span></div>
        </div>
        <div className="arch-outs">
          <div className="arch-node"><b>{L("archSoc")}</b><small>{L("archSocSub")}</small></div>
          <div className="arch-node"><b>{L("archGuardian")}</b><small>{L("archGuardianSub")}</small></div>
          <div className="arch-node"><b>{L("archNbk")}</b><small>{L("archNbkSub")}</small></div>
        </div>
        <div className="arch-node arch-store"><b>{L("archStore")}</b><small>{L("archStoreSub")}</small></div>
      </div>
      <ul className="tech-facts">
        {(["techF1", "techF2", "techF3"] as const).map(key => <li key={key}><b>{L(key)}</b><span>{L(`${key}Sub` as LandingKey)}</span></li>)}
      </ul>
    </section>

    <section className="public-app" id={tourEnabled ? "jury" : "app"} aria-labelledby="app-title">
      <div>
        <h2 id="app-title">{L("appTitle")}</h2>
        <p>{L("appText")}</p>
      </div>
      <div className="public-app-actions">
        {tourEnabled && <Link href="/mobile?tour=1" className="land-btn" prefetch={false}>{t("tourEntry")}<ArrowRight size={18} /></Link>}
        <Link href="/download/android" className={tourEnabled ? "land-btn land-btn-ghost" : "land-btn"}><Download size={18} />{L("heroDownload")}</Link>
        {tourEnabled && <MobileQr tourEnabled />}
      </div>
    </section>
    </main>
    <footer className="public-footer">
      <div className="footer-brand"><span><BrandMark size={30} /><strong>Saq Bol</strong></span><p>{L("footLegal")}</p></div>
      <nav aria-label={L("footProduct")}><b>{L("footProduct")}</b>{sections.slice(0, 4).map(({ key, href }) => <a key={key} href={href}>{L(key)}</a>)}</nav>
      <nav aria-label={L("footResources")}><b>{L("footResources")}</b>
        <Link href="/download/android">{L("heroDownload")}</Link><a href={walletEntry("wallet")}>{L("footWallet")}</a><a href={walletEntry("soc")}>{L("footSoc")}</a><a href={GITHUB} target="_blank" rel="noopener noreferrer">{L("footCode")}</a>
      </nav>
    </footer>
  </div>;
}
