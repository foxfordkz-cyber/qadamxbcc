"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Clock3, FileText, PhoneCall, RotateCcw, Send, ShieldCheck, ShieldX, UserRound } from "lucide-react";
import type { Graph } from "@/lib/contracts";
import { money, useLocale, type MessageKey } from "@/lib/i18n";
import { legalReferences, policeReportHtml } from "@/lib/police-report";
import { newTour, nextTour, nextTourStep, prepareTour, readTour, saveTour, senderCount, tourCall, tourCase, tourStep, tourSteps, warmupLimit, type TourSession, type TourView } from "@/lib/jury-tour";
import { BrandMark } from "./brand-mark";
import { CallCheckButton, CallLogResult } from "./call-log-result";
import { PoliceReportButton } from "./case-inspector";
import { CoolingQuestion } from "./cooling-modal";
import { FxCard } from "./fx-card";
import { LanguageSwitch } from "./language-switch";
import { MLInspector } from "./ml-inspector";
import NetworkGraph from "./network-graph";
import { Badge, Gauge } from "./risk";
import { FeedTransferButton } from "./soc-dashboard";
import { TransferAmount, TransferConfirmButton } from "./transfer-phone";
import { SuspicionReply } from "./trusted-circle";
import "./jury-tour.css";



const titles = {
  transfer: "tourTransfer", caller: "tourPause", payee: "tourPause", call: "sigBankLog", verdict: "tourNoCall",
  telegram: "tourTelegram", blocked: "tourBlocked", feed: "tourFeed", graph: "tourGraph", model: "tourModel",
  report: "caseDetails", document: "policeReport", saved: "tourBlocked",
} as const satisfies Record<TourView, MessageKey>;
const hints = {
  transfer: "tourHintTransfer", caller: "tourHintCaller", payee: "tourHintPayee", call: "tourHintCall",
  verdict: "tourHintVerdict", telegram: "tourHintTelegram", blocked: "tourHintBlocked", feed: "tourHintFeed",
  graph: "tourHintGraph", model: "tourHintModel", report: "tourHintReport", document: "tourHintDocument",
} as const satisfies Record<Exclude<TourView, "saved">, MessageKey>;

function Warmup({ onSkip }: { onSkip: () => void }) {
  const { t } = useLocale();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const timer = setInterval(() => setElapsed(Math.min(warmupLimit, performance.now() - start)), 250);
    return () => clearInterval(timer);
  }, []);
  return <section className="tour-warmup">
    <BrandMark size={56} />
    <h1 role="status">{t("tourPrepare")}</h1><p>{t("tourWait")}</p>
    <progress value={elapsed} max={warmupLimit} aria-label={t("tourPrepare")} />
    <button type="button" className="tour-skip" onClick={onSkip}>{t("tourSkip")}</button>
  </section>;
}

function TourScreen({ state, graph, advance }: { state: TourSession; graph: Graph; advance: (answer?: boolean) => void }) {
  const { t, lang } = useLocale();
  const detail = tourCase(state);
  const amount = money(detail.amount, lang);
  const view = state.view;
  switch (view) {
    case "transfer": return <>
      <div className="tour-call"><PhoneCall aria-hidden /><div><small>{t("tourIncoming")}</small><strong>{t("tourCaller")}</strong></div></div>
      <p className="tour-caption">{t("tourCallSimulated")}</p>
      <div className="tour-account"><FxCard size="wallet" label={t("tourCard")} allow3d={false} /><TransferAmount amount={detail.amount} /></div>
      <dl className="tour-facts"><div><dt>{t("is_new_recipient")}</dt><dd>•••• 0004</dd></div></dl>
      <div className="tour-focus"><TransferConfirmButton amount={detail.amount} onSubmit={() => advance()} /></div>
    </>;
    case "caller": case "payee": {
      const question = view === "caller" ? "caller_claims_bank_or_police" : "knows_recipient_personally";
      const pause = new Intl.NumberFormat(lang === "kk" ? "kk-KZ" : "ru-KZ").format(detail.context.hesitation_ms / 1000);
      return <>
        <div className="tour-account"><FxCard size="wallet" state="frozen" label={t("tourHeldCard")} allow3d={false} /><Badge status="cooling_off" /></div>
        <ul className="tour-signals">
          <li><PhoneCall size={16} />{t("sigCall")} · {t("sigCallOn")}</li>
          <li><FileText size={16} />{t("tourPasted")}</li>
          <li><Clock3 size={16} />{t("tourCadence")} · {pause} {t("tourSeconds")}</li>
        </ul>
        <div className="tour-focus tour-question"><CoolingQuestion key={question} question={question} answer={state.answers[question]} onAnswer={advance} /></div>
      </>;
    }
    case "call": return <>
      <div className="tour-symbol"><PhoneCall /></div><p>{t("tourCaller")}</p>
      <p className="tour-caption">{t("tourCallSimulated")}</p>
      <div className="tour-focus"><CallCheckButton onCheck={() => advance()} /></div>
    </>;
    case "verdict": return <div className="tour-focus tour-result"><CallLogResult check={tourCall(state)} showHotline={false} /></div>;
    case "telegram": return <>
      <div className="tour-channel"><Send size={20} />Telegram</div><p className="tour-caption">{t("tourTelegramSimulated")}</p>
      <div className="tour-message"><strong>Saq Bol</strong><p>{t("tourTelegramBody")}</p><b>{amount}</b></div>
      <div className="tour-focus"><SuspicionReply label={t("tourFraud")} onReport={() => advance()} /></div>
    </>;
    case "blocked": return <div className="tour-focus tour-result"><ShieldX className="tour-symbol-icon" />
      <Badge status={detail.status} /><strong className="tour-amount">{amount}</strong><p>{t("tourContactReason")}</p></div>;
    case "feed": return <>
      <div className="tour-case-meta"><Badge status={detail.status} /><Gauge compact score={detail.risk_score} /></div>
      <strong className="tour-amount">{amount}</strong>
      <div className="tour-focus"><FeedTransferButton sender={t("tourMother")} recipient={detail.recipient.display_name} onSelect={() => advance()}>
        {t("caseId")} · …{state.id.slice(-8)}
      </FeedTransferButton></div>
      <p>{t("tourGraphCaption").replace("{n}", String(senderCount(graph)))} {t("tourTopFactor")} {(lang === "kk" ? detail.ml_contributors[0].label_kk : detail.ml_contributors[0].label_ru).toLocaleLowerCase(lang)}.</p>
    </>;
    case "graph": return <>
      <p>{detail.recipient.display_name} · {detail.recipient.iban_masked}</p>
      <div className="tour-focus tour-graph"><NetworkGraph graph={graph} /></div>
      <p className="tour-caption">{t("tourGraphCaption").replace("{n}", String(senderCount(graph)))}</p>
      <button type="button" className="secondary" onClick={() => advance()}>{t("tourModel")}<ArrowRight size={17} /></button>
    </>;
    case "model": return <><p>{t("tourModelCaption")}</p>
      <div className="tour-focus tour-analysis"><MLInspector details={detail} reasons={detail.reasons} /></div></>;
    case "report": return <>
      <div className="tour-case-meta"><Badge status={detail.status} /><b>{amount}</b></div>
      <p>{t("tourContactReason")}</p>
      <div className="tour-focus"><PoliceReportButton onOpen={() => advance()} /></div>
      <section className="tour-laws"><h3>{t("tourLaws")}</h3>{legalReferences(lang).map(law => <a key={law.label} href={law.url} target="_blank" rel="noopener noreferrer">{law.label}</a>)}</section>
    </>;
    case "document": return <iframe className="tour-document tour-focus" title={t("policeReport")}
      sandbox="allow-scripts allow-modals allow-popups allow-popups-to-escape-sandbox"
      srcDoc={policeReportHtml(detail, lang, t, new Date(state.blocked ?? state.started), state.answers)} />;
    case "saved": return <div className="tour-saved"><span className="tour-saved-icon"><ShieldCheck size={44} /></span><h2>{t("tourSaved").replace("{amount}", amount)}</h2>
      <p>{t("tourContactReason")}</p></div>;
  }
}

export default function JuryTour() {
  const router = useRouter();
  const { t } = useLocale();
  const [state, setState] = useState<TourSession | null>(null);
  const [stand, setStand] = useState<Awaited<ReturnType<typeof prepareTour>> | null>(null);
  const [run, setRun] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    const session = run ? newTour() : readTour();
    setState(session); saveTour(session);
    void prepareTour(controller.signal).then(data => { if (!controller.signal.aborted) setStand(data); });
    return () => controller.abort();
  }, [run]);
  useEffect(() => {
    if (stand) {
      viewport.current?.scrollTo({ top: 0 });
      heading.current?.focus({ preventScroll: true });
    }
  }, [stand, state?.view]);
  function move(next: TourSession) {
    setState(next); saveTour(next);
  }
  function skip() { saveTour(null); router.replace("/mobile"); }
  const step = state ? tourStep(state.view) : 1;
  const tone = state?.view === "blocked" ? "blocked" : step === 2 || step === 3 ? "held" : undefined;
  return <main className="jury-tour" data-state={tone}>
    <header className="tour-brand"><div><BrandMark size={32} /><strong>Saq Bol</strong></div><LanguageSwitch /></header>
    {!state || !stand ? <Warmup onSkip={skip} /> : <div className="tour-layout" data-tour-view={state.view} data-source={stand.source}>
      <section className="tour-phone" aria-labelledby="tour-view-title" data-case-id={state.id}>
        <header><small>{step === 1 || step === 2 || step === 3 ? <UserRound size={15} /> : step === 4 && state.view === "telegram" ? <Send size={15} /> : <ShieldCheck size={15} />}
          {step < 4 ? t("tourMother") : state.view === "telegram" ? t("tourSon") : step === 5 || state.view === "report" || state.view === "document" ? `SOC · …${state.id.slice(-8)}` : "Saq Bol"}
        </small><h1 id="tour-view-title" ref={heading} tabIndex={-1}>{t(titles[state.view])}</h1></header>
        <div className="tour-screen" ref={viewport}><TourScreen state={state} graph={stand.graph} advance={answer => move(nextTour(state, answer))} /></div>
      </section>
      <aside className="tour-guide" aria-label={t("tourName")}>
        <div className="tour-guide-head"><strong aria-live="polite">{t("tourProgress").replace("{n}", String(step))}</strong>
          {state.view !== "saved" && <button type="button" className="tour-skip" onClick={skip}>{t("tourSkip")}</button>}
        </div>
        <div className="tour-progress" aria-hidden="true">{tourSteps.map((_, i) => <i key={i} className={i < step ? "active" : ""} />)}</div>
        <ol className="tour-steps" aria-hidden="true">{tourSteps.map((views, i) => <li key={views[0]} className={i + 1 < step || state.view === "saved" ? "done" : i + 1 === step ? "current" : undefined}>
          <i>{i + 1 < step || state.view === "saved" ? <Check size={14} /> : i + 1}</i><span>{t(titles[views[0]])}</span>
        </li>)}</ol>
        {state.view === "saved" ? <button type="button" className="primary" onClick={() => { setStand(null); setRun(n => n + 1); }}>
          <RotateCcw size={18} />{t("tourRestart")}</button> : <>
          <p className="tour-hint" aria-live="polite">{t(hints[state.view])}</p>
          <button type="button" className="primary tour-next" onClick={() => move(nextTourStep(state))}>{t("tourNext")}{state.view === "document" ? <Check size={19} /> : <ArrowRight size={19} />}</button>
        </>}
      </aside>
    </div>}
  </main>;
}
