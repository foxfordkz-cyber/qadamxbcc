"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Activity, ArrowRight, CircleHelp, Network, PhoneCall, ShieldCheck, Smartphone } from "lucide-react";
import { api, transferSchema, type AbandonResult, type Answers, type AppConfig, type Context, type Evaluation, type Preset, type PresetForm } from "@/lib/contracts";
import { reconcileTraffic, type TrafficRecord } from "@/lib/traffic";
import type { FeedItem } from "@/lib/contracts";
import { useBiometrics } from "./use-biometrics";
import { errorKey, LocaleProvider, useLocale, type MessageKey } from "@/lib/i18n";
import { TransferPhone } from "./transfer-phone";
import { Telemetry } from "./telemetry";
import { CoolingModal } from "./cooling-modal";
import { SocDashboard } from "./soc-dashboard";
import { useTrafficStream } from "./use-traffic-stream";
import { isUnknownOutcome, TransferAttempt } from "@/lib/transfer-session";
import { acceptsEvaluation, digestDraft, draftIdentity, findDraftReceipt, receipt, recoveryBatch, unresolved } from "@/lib/recovery";
import { useRecovery, withIntentLock } from "./use-recovery";
import { RecoveryPanel } from "./recovery-panel";
import { retainCoolingDraft } from "@/lib/cooling-flow";
import { reconcileCoolingDrafts, shouldRestoreAttempt } from "@/lib/mobile-session";

const presetIcons = { normal: ArrowRight, scam: PhoneCall, hub: Network };
export type AppLayout = "full" | "phone";
function App({ config, layout = "full" }: { config: AppConfig; layout?: AppLayout }) {
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
  const [coolingDrafts, setCoolingDrafts] = useState<Record<string, Partial<Answers>>>({});
  const [revision, setRevision] = useState(0);
  const [preset, setPreset] = useState<Preset | null>(null);
  const sensor = useBiometrics();
  const [resultContext, setResultContext] = useState<Partial<Context>>({});
  const [evaluations, setEvaluations] = useState<Record<string, Evaluation>>({});
  const latestEvaluations = useRef<Record<string, Evaluation>>({});
  const [traffic, setTraffic] = useState<Record<string, TrafficRecord>>({});
  const recovery = useRecovery();
  const attempt = useRef<TransferAttempt | null>(null);
  const attemptIdentity = useRef<string | null>(null);
  const currentResultId = useRef<string | null>(null);
  currentResultId.current = result?.transaction_id ?? null;
  const [unknown, setUnknown] = useState(false);
  const [completedIdentity, setCompletedIdentity] = useState<string | null>(null);
  const [checkingRecovery, setCheckingRecovery] = useState(false);
  const identity = draftIdentity(form, recipientType);
  const previousIdentity = useRef(identity);
  const forceNext = useRef(false);
  const hasUnknown = recovery.records.some(record => record.state === "unknown");
  const addPending = useCallback((id: string, cancelled: () => boolean) => withIntentLock(() => {
    if (cancelled()) return false;
    const records = recovery.refresh();
    if (records.some(record => record.state === "unknown") || records.filter(unresolved).length >= 250) return false;
    if (!recovery.record({ id, state: "unknown", updatedAt: Date.now() }, true)) throw new Error("recoveryUnavailable");
    return true;
  }), [recovery.refresh, recovery.record]);
  const remember = useCallback((evaluation: Evaluation) => {
    const stored = recovery.get().find(record => record.id === evaluation.transaction_id);
    const previous = latestEvaluations.current[evaluation.transaction_id];
    if (!acceptsEvaluation(evaluation, stored, previous)) return previous && acceptsEvaluation(previous, stored) ? previous : null;
    const next = Object.fromEntries([...Object.entries(latestEvaluations.current).filter(([id]) => id !== evaluation.transaction_id).slice(-399), [evaluation.transaction_id, evaluation]]);
    latestEvaluations.current = next; setEvaluations(next);
    setCoolingDrafts(drafts => reconcileCoolingDrafts(drafts, evaluation));
    recovery.record(receipt(evaluation, stored));
    return evaluation;
  }, [recovery.record, recovery.get]);
  const retireUnused = useCallback(async (id: string) => {
    try {
      const value = await api<AbandonResult>(`transfers/requests/${id}/abandon`, { method: "POST", body: "{}" });
      if (value.status === "processed" && value.evaluation) remember(value.evaluation);
      else recovery.record({ id, state: "abandoned", updatedAt: Date.now() });
    } catch { /* Keep the unknown ID visible until the server can confirm abandonment. */ }
  }, [remember, recovery.record]);
  const recordTraffic = useCallback((record: TrafficRecord) => {
    const evaluation = remember(record.evaluation);
    if (!evaluation) return;
    setTraffic(previous => ({ ...previous, [evaluation.transaction_id]: { ...record, evaluation } }));
    setRevision(value => value + 1);
  }, [remember]);
  const syncTraffic = useCallback((items: FeedItem[]) => setTraffic(previous => reconcileTraffic(previous, items)), []);
  const stream = useTrafficStream(config, recordTraffic, addPending, retireUnused);
  const reconciling = useRef(false);
  const recoveryCursor = useRef(0);
  const lastReconciledAt = useRef(-Infinity);
  const reconcilePending = useCallback(async () => {
    if (reconciling.current || performance.now() - lastReconciledAt.current < 15000) return;
    lastReconciledAt.current = performance.now();
    reconciling.current = true; setCheckingRecovery(true);
    try {
      const batch = recoveryBatch(recovery.refresh(), recoveryCursor.current, currentResultId.current);
      recoveryCursor.current = batch.nextCursor;
      await Promise.allSettled(batch.records.map(async record => {
        const value = remember(await api<Evaluation>(`transfers/${record.id}`));
        if (!value) return;
        if (attempt.current?.input.request_id === value.transaction_id) {
          setUnknown(false); setCompletedIdentity(attemptIdentity.current); setError(null);
          if (shouldRestoreAttempt(value.transaction_id, attempt.current.input.request_id ?? null, currentResultId.current)) {
            setResult(value); setResultAmount(value.amount ?? "0"); setResultContext(value.context ?? {});
          }
        }
        setResult(previous => previous?.transaction_id === value.transaction_id ? value : previous);
        if (currentResultId.current === value.transaction_id && value.status !== "cooling_off") setModal(false);
        if (!interacted.current) { interacted.current = true; setResult(value); setResultAmount(value.amount ?? "0"); setResultContext(value.context ?? {}); }
      }));
    } finally { reconciling.current = false; setCheckingRecovery(false); }
  }, [recovery.refresh, remember]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void reconcilePending(); };
    refresh(); const timer = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [reconcilePending]);
  useEffect(() => {
    if (identity !== previousIdentity.current) {
      if (completedIdentity !== null) forceNext.current = true;
      previousIdentity.current = identity; interacted.current = true; setResult(null); setCompletedIdentity(null); setError(null);
    }
  }, [identity, completedIdentity]);

  async function review(id: string) {
    if (lock.current) return;
    interacted.current = true;
    lock.current = true; setBusy(true); setError(null);
    try {
      const value = remember(await api<Evaluation>(`transfers/${id}`));
      if (!value) { setError("staleData"); return; }
      if (attempt.current?.input.request_id === id) { setUnknown(false); sensor.complete(); setCompletedIdentity(attemptIdentity.current); }
      setResult(value); setResultAmount(value.amount ?? "0"); setResultContext(value.context ?? {}); setModal(value.status === "cooling_off");
      if (value.status !== "cooling_off") { stream.stop(); setTab("mobile"); }
    } catch (failure) { setError(errorKey(failure)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function execute(current: TransferAttempt, chosen?: Preset) {
    interacted.current = true;
    lock.current = true; setBusy(true); setError(null); setResult(null); setPreset(chosen ?? null); setModal(false); setUnknown(false);
    const started = performance.now();
    try {
      const evaluated = remember(await current.execute());
      if (!evaluated) throw new Error("outcomeUnknown");
      setRoundtrip(performance.now() - started); setResult(evaluated); setResultAmount(evaluated.amount ?? current.input.amount); setRevision(n => n + 1);
      setResultContext(evaluated.context ?? current.input.context); sensor.complete(); setCompletedIdentity(attemptIdentity.current);
      setModal(evaluated.status === "cooling_off");
      if (chosen) { if (chosen !== "hub") stream.stop(); setTab(chosen === "hub" ? "soc" : "mobile"); }
    } catch (failure) {
      const ambiguous = isUnknownOutcome(failure);
      setUnknown(true); setError(ambiguous ? "outcomeUnknown" : errorKey(failure)); setTab("mobile");
    } finally { lock.current = false; setBusy(false); }
  }

  async function evaluate(value: PresetForm, type = recipientType, chosen?: Preset) {
    if (lock.current || hasUnknown) return;
    const draft = draftIdentity(value, type);
    if (!chosen && !forceNext.current && completedIdentity === draft) return;
    const recipient = value.recipient.replace(/[\s()-]/g, "").toUpperCase();
    const context = chosen ? value.context : { ...value.context, ...sensor.context() };
    const parsed = transferSchema.safeParse({ sender_id: value.sender.trim(), [`recipient_${type}`]: recipient, amount: value.amount, currency: "KZT", context });
    if (!parsed.success) { setError(chosen && (!value.sender || !value.recipient) ? "presetMissing" : "invalid"); setTab("mobile"); return; }
    lock.current = true; setBusy(true); setError(null);
    try {
      const hash = await digestDraft(draft);
      const reserved = await withIntentLock(() => {
        const records = recovery.refresh();
        if (records.some(record => record.state === "unknown") || records.filter(unresolved).length >= 250) return null;
        const previous = !chosen && !forceNext.current ? findDraftReceipt(records, hash) : undefined;
        if (previous) return { id: previous.id, existing: true };
        const id = crypto.randomUUID();
        if (!recovery.record({ id, draftKey: hash, state: "unknown", updatedAt: Date.now() }, true)) throw new Error("recoveryUnavailable");
        return { id, existing: false };
      });
      if (!reserved) { setError("recoveryRequired"); return; }
      forceNext.current = false; attemptIdentity.current = draft;
      if (reserved.existing) {
        const value = remember(await api<Evaluation>(`transfers/${reserved.id}`));
        if (!value) { setError("staleData"); return; }
        setResult(value); setResultAmount(value.amount ?? parsed.data.amount); setResultContext(value.context ?? {}); setCompletedIdentity(draft); setModal(value.status === "cooling_off");
        return;
      }
      attempt.current = new TransferAttempt(parsed.data, reserved.id);
      await execute(attempt.current, chosen);
    } catch (failure) { setError(errorKey(failure)); }
    finally { lock.current = false; setBusy(false); }
  }
  function runPreset(key: Preset) {
    if (lock.current || hasUnknown || config.demoActionsEnabled === false) return;
    const next = { ...config.presets[key], context: { ...config.presets[key].context } };
    sensor.reset();
    setForm(next); setRecipientType("phone"); void evaluate(next, "phone", key);
  }
  function resolved(value: Evaluation) {
    const accepted = remember(value);
    if (!accepted || currentResultId.current !== accepted.transaction_id) return;
    value = accepted; setResult(value); setResultAmount(value.amount ?? resultAmount); setResultContext(value.context ?? {});
    setTraffic(previous => previous[value.transaction_id] ? { ...previous, [value.transaction_id]: { ...previous[value.transaction_id], evaluation: value } } : previous);
    setModal(value.status === "cooling_off"); setRevision(n => n + 1);
  }
  async function abandon(id: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      const value = await api<AbandonResult>(`transfers/requests/${id}/abandon`, { method: "POST", body: "{}" });
      if (value.status === "processed" && value.evaluation) {
        const accepted = remember(value.evaluation);
        if (!accepted) { setError("staleData"); return; }
        setResult(accepted); setResultAmount(accepted.amount ?? "0"); setResultContext(accepted.context ?? {}); setModal(accepted.status === "cooling_off");
      }
      else recovery.record({ id, state: "abandoned", updatedAt: Date.now() });
      if (attempt.current?.input.request_id === id) { attempt.current = null; setUnknown(false); }
    } catch (failure) { setError(errorKey(failure)); }
    finally { lock.current = false; setBusy(false); }
  }
  function changeTab(value: "mobile" | "soc") { if (value === "mobile") stream.stop(); setTab(value); }
  function freshTransfer() {
    if (lock.current || hasUnknown) return;
    interacted.current = true; forceNext.current = true; attempt.current = null;
    setCompletedIdentity(null); sensor.reset(); setResult(null); setPreset(null); setError(null);
  }
  const cooling = modal && result?.status === "cooling_off" && <CoolingModal key={result.transaction_id} result={result} context={resultContext} answers={coolingDrafts[result.transaction_id] ?? result.verification_answers ?? {}} onAnswersChange={answers => setCoolingDrafts(drafts => retainCoolingDraft(drafts, result.transaction_id, answers))} onClose={() => setModal(false)} onResolved={resolved} />;
  const languageSwitch = <div className="language" role="group" aria-label={t("language")}>{(["kk", "ru"] as const).map(l => <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>{l === "kk" ? "ҚАЗ" : "РУС"}</button>)}</div>;
  // /mobile: the same client logic on a real smartphone — no bezel, decision panel or SOC tab.
  if (layout === "phone") return <>
    <header className="topbar mobile-topbar"><div className="topbar-inner">
      <div className="brand"><span className="brand-mark" aria-hidden="true"><ShieldCheck size={18} /></span><div><strong>bcc<span> shield</span></strong></div></div>
      {languageSwitch}
    </div></header>
    <main className="mobile-shell">
      <RecoveryPanel records={recovery.records} persisted={recovery.persisted} busy={busy} refreshing={checkingRecovery} onReview={id => void review(id)} onAbandon={id => void abandon(id)} onRefresh={() => void reconcilePending()} />
      {hasUnknown && <div className="pending-panel"><p role="status">{t("recoveryRequired")}</p>{unknown && attempt.current && <button className="secondary" disabled={busy} onClick={() => { if (attempt.current && !lock.current) void execute(attempt.current); }}>{t("retryTransfer")}</button>}</div>}
      <TransferPhone bare config={config} form={form} setForm={setForm} recipientType={recipientType} setRecipientType={setRecipientType} busy={busy} blocked={hasUnknown} completed={completedIdentity === identity} error={error} sensor={sensor} onSubmit={() => void evaluate(form)} result={result} amount={resultAmount} onReview={() => result && void review(result.transaction_id)} onNewTransfer={freshTransfer} />
    </main>
    {cooling}
  </>;
  return <>
    <header className="topbar"><div className="topbar-inner">
      <div className="brand"><span className="brand-mark" aria-hidden="true"><ShieldCheck size={20} /></span><div><strong>bcc<span> shield</span></strong><small>{t("tagline")}</small></div></div>
      <div className="header-right"><span className="mode" title={t(config.mode)}><span className="live-dot" /><span className="mode-text">{config.mode === "demo" ? t("demoMarker") : t("live")}</span></span>{languageSwitch}</div>
    </div></header>
    <main className="shell">
      <section className="demo-bar" aria-label={t("presets")}>
        <div className="demo-bar-label"><CircleHelp size={16} aria-hidden="true" /><span>{t(config.demoActionsEnabled === false ? "pilotMode" : "demoScenarios")}</span></div>
        <div className="preset-buttons">{(["normal", "scam", "hub"] as const).map((key, index) => { const Icon = presetIcons[key]; return <button key={key} type="button" className={`preset ${preset === key ? "chosen" : ""}`} disabled={busy || hasUnknown || config.demoActionsEnabled === false} onClick={() => runPreset(key)}><span className="preset-number tabular-nums">0{index + 1}</span><Icon size={15} aria-hidden="true" />{t(key)}</button>; })}</div>
        {config.demoActionsEnabled !== false && <Link href="/pitch" className="pitch-link">{t("pitchLink")}<ArrowRight size={15} aria-hidden="true" /></Link>}
      </section>
      <RecoveryPanel records={recovery.records} persisted={recovery.persisted} busy={busy} refreshing={checkingRecovery} onReview={id => void review(id)} onAbandon={id => void abandon(id)} onRefresh={() => void reconcilePending()} />
      {hasUnknown && <div className="pending-panel"><p role="status">{t("recoveryRequired")}</p>{unknown && attempt.current && <button className="secondary" disabled={busy} onClick={() => { if (attempt.current && !lock.current) void execute(attempt.current); }}>{t("retryTransfer")}</button>}</div>}
      {error && tab === "soc" && <p className="error" role="alert">{t(error)}</p>}
      <div className="tabs" role="tablist" aria-label="BCC Shield">{(["mobile", "soc"] as const).map(key => { const Icon = key === "mobile" ? Smartphone : Activity; return <button key={key} type="button" role="tab" id={`tab-${key}`} aria-selected={tab === key} aria-controls={`panel-${key}`} tabIndex={tab === key ? 0 : -1} onKeyDown={e => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) { e.preventDefault(); const next = e.key === "Home" ? "mobile" : e.key === "End" ? "soc" : key === "mobile" ? "soc" : "mobile"; changeTab(next); document.getElementById(`tab-${next}`)?.focus(); } }} onClick={() => changeTab(key)}><Icon size={17} />{t(key === "mobile" ? "tabMobile" : "tabSoc")}</button>; })}</div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "soc" ? <SocDashboard initialSelection={result?.transaction_id ?? null} revision={revision} evaluations={evaluations} traffic={traffic} onTrafficSync={syncTraffic} stream={{ ...stream, canStart: stream.canStart && !hasUnknown }} onReview={id => void review(id)} busy={busy} /> : <>
          <div className="client-wrap">
          <div className="section-heading"><div><h1>{t("heroTitle")}</h1><p className="muted">{t("heroIntro")}</p></div></div>
          <div className="transfer-grid">
            <TransferPhone config={config} form={form} setForm={setForm} recipientType={recipientType} setRecipientType={setRecipientType} busy={busy} blocked={hasUnknown} completed={completedIdentity === identity} error={error} sensor={sensor} onSubmit={() => void evaluate(form)} result={result} amount={resultAmount} onReview={() => result && void review(result.transaction_id)} onNewTransfer={freshTransfer} />
            <Telemetry result={result} amount={resultAmount} roundtrip={roundtrip} busy={busy} error={error} sensor={sensor} sender={form.sender} onReview={() => result && void review(result.transaction_id)} />
          </div>
          </div>
        </>}
      </div>
      <footer className="page-footer"><span>BCC Shield · ITU Hackathon 2026</span><span>{config.mode === "demo" ? t("demoExplain") : t("protected")}</span></footer>
    </main>
    {cooling}
  </>;
}
export default function ShieldApp({ config, layout = "full" }: { config: AppConfig; layout?: AppLayout }) {
  return <LocaleProvider><App config={config} layout={layout} /></LocaleProvider>;
}
