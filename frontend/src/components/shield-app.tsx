"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, ArrowRight, CircleHelp, Network, PhoneCall, ShieldCheck, Smartphone } from "lucide-react";
import { api, transferSchema, type AppConfig, type Context, type Evaluation, type Preset, type PresetForm } from "@/lib/contracts";
import { reconcileTraffic, type TrafficRecord } from "@/lib/traffic";
import type { FeedItem } from "@/lib/contracts";
import { useBiometrics } from "./use-biometrics";
import { errorKey, LocaleProvider, useLocale, type MessageKey } from "@/lib/i18n";
import { TransferPhone } from "./transfer-phone";
import { Telemetry } from "./telemetry";
import { CoolingModal } from "./cooling-modal";
import { SocDashboard } from "./soc-dashboard";
import { useTrafficStream } from "./use-traffic-stream";
import { isUnknownOutcome, readPending, TransferAttempt, writePending } from "@/lib/transfer-session";

const presetIcons = { normal: ArrowRight, scam: PhoneCall, hub: Network };
function App({ config }: { config: AppConfig }) {
  const { lang, setLang, t } = useLocale();
  const [tab, setTab] = useState<"mobile" | "soc">("mobile");
  const [form, setForm] = useState<PresetForm>(config.presets.normal);
  const [recipientType, setRecipientType] = useState<"phone" | "card" | "iban">("phone");
  const [result, setResult] = useState<Evaluation | null>(null);
  const [resultAmount, setResultAmount] = useState("0");
  const [roundtrip, setRoundtrip] = useState(0);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const interacted = useRef(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [modal, setModal] = useState(false);
  const [revision, setRevision] = useState(0);
  const [preset, setPreset] = useState<Preset | null>(null);
  const sensor = useBiometrics();
  const [resultContext, setResultContext] = useState<Partial<Context>>({});
  const [evaluations, setEvaluations] = useState<Record<string, Evaluation>>({});
  const [traffic, setTraffic] = useState<Record<string, TrafficRecord>>({});
  const [pending, setPending] = useState<string[]>([]);
  const pendingRef = useRef<string[]>([]);
  const attempt = useRef<TransferAttempt | null>(null);
  const [unknown, setUnknown] = useState(false);
  const updatePending = useCallback((update: (ids: string[]) => string[]) => {
    const next = [...new Set(update(pendingRef.current))].slice(-250);
    pendingRef.current = next; setPending(next);
    try { if (typeof window !== "undefined") writePending(next, window.sessionStorage); } catch { /* Browser storage can be disabled. */ }
  }, []);
  const addPending = useCallback((id: string) => updatePending(ids => [...ids, id]), [updatePending]);
  const dropPending = useCallback((id: string) => updatePending(ids => ids.filter(value => value !== id)), [updatePending]);
  const remember = useCallback((evaluation: Evaluation) => {
    setEvaluations(previous => Object.fromEntries([...Object.entries(previous).slice(-399), [evaluation.transaction_id, evaluation]]));
    if (evaluation.status === "cooling_off") addPending(evaluation.transaction_id); else dropPending(evaluation.transaction_id);
  }, [addPending, dropPending]);
  const recordTraffic = useCallback((record: TrafficRecord) => {
    remember(record.evaluation);
    setTraffic(previous => ({ ...previous, [record.evaluation.transaction_id]: record }));
    setRevision(value => value + 1);
  }, [remember]);
  const syncTraffic = useCallback((items: FeedItem[]) => setTraffic(previous => reconcileTraffic(previous, items)), []);
  const stream = useTrafficStream(config, recordTraffic, addPending, dropPending);
  useEffect(() => {
    let ids: string[] = [];
    try { ids = readPending(window.sessionStorage); } catch { /* Browser storage can be disabled. */ }
    pendingRef.current = ids; setPending(ids);
    let disposed = false;
    if (ids.length) void api<Evaluation>(`transfers/${ids[ids.length - 1]}`).then(value => {
      if (disposed) return;
      remember(value);
      if (!interacted.current) { setResult(value); setResultAmount(value.amount ?? "0"); setResultContext(value.context ?? {}); }
    }).catch(() => { /* Keep the ID recoverable even after a temporary outage. */ });
    return () => { disposed = true; };
  }, [remember]);

  async function review(id: string) {
    if (lock.current) return;
    interacted.current = true;
    lock.current = true; setBusy(true); setError(null);
    try {
      const value = await api<Evaluation>(`transfers/${id}`);
      if (attempt.current?.input.request_id === id) { attempt.current = null; setUnknown(false); sensor.complete(); }
      remember(value); setResult(value); setResultAmount(value.amount ?? "0"); setResultContext(value.context ?? {}); setModal(value.status === "cooling_off");
      if (value.status !== "cooling_off") { stream.stop(); setTab("mobile"); }
    } catch (failure) { setError(errorKey(failure)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function execute(current: TransferAttempt, chosen?: Preset) {
    interacted.current = true;
    lock.current = true; setBusy(true); setError(null); setPreset(chosen ?? null); setModal(false); setUnknown(false);
    addPending(current.input.request_id!);
    const started = performance.now();
    try {
      const evaluated = await current.execute();
      setRoundtrip(performance.now() - started); setResult(evaluated); setResultAmount(evaluated.amount ?? current.input.amount); setRevision(n => n + 1);
      setResultContext(evaluated.context ?? current.input.context); remember(evaluated); sensor.complete(); attempt.current = null;
      setModal(evaluated.status === "cooling_off");
      if (chosen) { if (chosen !== "hub") stream.stop(); setTab(chosen === "hub" ? "soc" : "mobile"); }
    } catch (failure) {
      const ambiguous = isUnknownOutcome(failure);
      if (!ambiguous) { dropPending(current.input.request_id!); attempt.current = null; }
      setUnknown(ambiguous); setError(ambiguous ? "outcomeUnknown" : errorKey(failure)); setTab("mobile");
    } finally { lock.current = false; setBusy(false); }
  }

  async function evaluate(value: PresetForm, type = recipientType, chosen?: Preset) {
    if (lock.current || attempt.current) return;
    const recipient = value.recipient.replace(/[\s()-]/g, "").toUpperCase();
    const context = chosen ? value.context : { ...value.context, ...sensor.context() };
    const parsed = transferSchema.safeParse({ sender_id: value.sender.trim(), [`recipient_${type}`]: recipient, amount: value.amount, currency: "KZT", context });
    if (!parsed.success) { setError(chosen && (!value.sender || !value.recipient) ? "presetMissing" : "invalid"); setTab("mobile"); return; }
    attempt.current = new TransferAttempt(parsed.data);
    await execute(attempt.current, chosen);
  }
  function runPreset(key: Preset) {
    if (lock.current || attempt.current || config.demoActionsEnabled === false) return;
    const next = { ...config.presets[key], context: { ...config.presets[key].context } };
    sensor.reset();
    setForm(next); setRecipientType("phone"); void evaluate(next, "phone", key);
  }
  function resolved(value: Evaluation) {
    remember(value); setResult(value); setResultAmount(value.amount ?? resultAmount); setResultContext(value.context ?? {});
    setTraffic(previous => previous[value.transaction_id] ? { ...previous, [value.transaction_id]: { ...previous[value.transaction_id], evaluation: value } } : previous);
    setModal(value.status === "cooling_off"); setRevision(n => n + 1);
  }
  function changeTab(value: "mobile" | "soc") { if (value === "mobile") stream.stop(); setTab(value); }
  return <>
    <header className="topbar"><div className="brand"><div className="brand-mark"><ShieldCheck size={25} /></div><div><strong>bcc<span> shield</span></strong><small>{t("tagline")}</small></div></div>
      <div className="header-right"><span className="mode"><span className="live-dot" />{t(config.mode)}</span><div className="language" aria-label={t("language")}>{(["kk", "ru"] as const).map(l => <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>{l === "kk" ? "ҚАЗ" : "РУС"}</button>)}</div></div>
    </header>
    <main className="shell">
      <section className="demo-bar" aria-label={t("presets")}><div className="flex items-center gap-2 text-sm"><CircleHelp size={16} /><span>{t(config.demoActionsEnabled === false ? "pilotMode" : "presets")}</span></div><div className="preset-buttons">{(["normal", "scam", "hub"] as const).map((key, index) => { const Icon = presetIcons[key]; return <button key={key} className={`preset ${preset === key ? "chosen" : ""}`} disabled={busy || unknown || config.demoActionsEnabled === false} onClick={() => runPreset(key)}><span className="preset-number">0{index + 1}</span><Icon size={15} />{t(key)}</button>; })}</div></section>
      {pending.length > 0 && <section className="pending-panel"><div><strong>{t("pendingTransfers")} · {pending.length}</strong><p className="muted">{t("recoveryHint")}</p></div><div className="flex flex-wrap gap-2">{pending.slice(-5).map(id => <button type="button" className="secondary" disabled={busy} key={id} onClick={() => void review(id)}>{t("recoverTransfer")} · {id.slice(-6)}</button>)}</div></section>}
      {unknown && <div className="pending-panel"><p role="alert">{t("outcomeUnknown")}</p><button className="secondary" disabled={busy} onClick={() => { if (attempt.current && !lock.current) void execute(attempt.current); }}>{t("retryTransfer")}</button></div>}
      {error && tab === "soc" && <p className="error" role="alert">{t(error)}</p>}
      <div className="tabs" role="tablist" aria-label="BCC Shield">{(["mobile", "soc"] as const).map(key => { const Icon = key === "mobile" ? Smartphone : Activity; return <button key={key} role="tab" id={`tab-${key}`} aria-selected={tab === key} aria-controls={`panel-${key}`} tabIndex={tab === key ? 0 : -1} onKeyDown={e => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) { e.preventDefault(); const next = e.key === "Home" ? "mobile" : e.key === "End" ? "soc" : key === "mobile" ? "soc" : "mobile"; changeTab(next); document.getElementById(`tab-${next}`)?.focus(); } }} onClick={() => changeTab(key)}><Icon size={17} />{t(key)}</button>; })}</div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "soc" ? <SocDashboard initialSelection={result?.transaction_id ?? null} revision={revision} evaluations={evaluations} traffic={traffic} onTrafficSync={syncTraffic} stream={stream} onReview={id => void review(id)} busy={busy} /> : <>
          <div className="section-heading"><div><p className="eyebrow">{t("eyebrow")}</p><h1>{t("title")}</h1><p className="muted max-w-2xl">{t("intro")}</p></div><span className="security-seal"><ShieldCheck size={20} />BCC Shield</span></div>
          <div className="transfer-grid">
            <TransferPhone config={config} form={form} setForm={setForm} recipientType={recipientType} setRecipientType={setRecipientType} busy={busy || unknown} error={error} sensor={sensor} onSubmit={() => void evaluate(form)} />
            <div><Telemetry result={result} amount={resultAmount} roundtrip={roundtrip} busy={busy} sensor={sensor} onReview={() => result && void review(result.transaction_id)} />{result && !unknown && <button className="secondary mt-4" disabled={busy} onClick={() => { sensor.reset(); setResult(null); setPreset(null); setError(null); }}>{t("freshTransfer")}</button>}</div>
          </div>
        </>}
      </div>
      <footer><span>BCC Shield · ITU Hackathon 2026</span><span>{config.mode === "demo" ? t("demoExplain") : t("protected")}</span></footer>
    </main>
    {modal && result?.status === "cooling_off" && <CoolingModal key={result.transaction_id} result={result} context={resultContext} onClose={() => setModal(false)} onResolved={resolved} />}
  </>;
}
export default function ShieldApp({ config }: { config: AppConfig }) {
  return <LocaleProvider><App config={config} /></LocaleProvider>;
}
