"use client";

import { Suspense, useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import Link from "next/link";
import { AndroidDownload } from "./android-download";
import connectedWallet from "@/lib/connected-wallet.json";
import { Activity, ArrowRight, CircleHelp, LogIn, Network, PhoneCall, Smartphone } from "lucide-react";
import { BrandMark } from "./brand-mark";
import { api, ApiError, transferSchema, type AbandonResult, type Answers, type AppConfig, type CallCheck, type Context, type Evaluation, type Preset, type PresetForm } from "@/lib/contracts";
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
import { TransferSelection } from "@/lib/transfer-selection";
import { acceptsEvaluation, digestDraft, draftIdentity, findDraftReceipt, receipt, recoveryBatch, unresolved } from "@/lib/recovery";
import { useRecovery, withIntentLock } from "./use-recovery";
import { RecoveryPanel } from "./recovery-panel";
import { retainCoolingDraft } from "@/lib/cooling-flow";
import { reconcileCoolingDrafts } from "@/lib/mobile-session";
import { randomId } from "@/lib/secure-fallback";
import { mobileRecovery } from "@/lib/mobile-recovery";
import { resetStaticDemo } from "@/lib/static-api";
import type { RecoveryRecord } from "@/lib/recovery";
import { readAppTab, saveAppTab, type AppTab } from "@/lib/app-tab-session";
import { CollectionComparison, CollectionReplayInspector } from "./collection-comparison";

const STATIC_DEMO = process.env.NEXT_PUBLIC_BCC_STATIC === "1";


const presetIcons = { normal: ArrowRight, scam: PhoneCall, hub: Network };
export type AppLayout = "full" | "phone" | "officer";
function App({ config, layout = "full" }: { config: AppConfig; layout?: AppLayout }) {
  const { lang, setLang, t } = useLocale();
  const [tab, setTabState] = useState<AppTab>("mobile");
  const activeTab = useRef<AppTab>("mobile");
  const setTab = useCallback((value: AppTab) => {
    const next = layout === "phone" ? "mobile" : value;
    activeTab.current = next;
    setTabState(next);
    if (layout === "full") { try { saveAppTab(next, window.sessionStorage); } catch { /* Storage may be blocked. */ } }
  }, [layout]);
  useEffect(() => {
    // Read after hydration. The standalone client never restores an operator tab.
    if (layout !== "full") return;
    try { const saved = readAppTab(window.sessionStorage); activeTab.current = saved; setTabState(saved); } catch { /* Keep the mobile default. */ }
  }, [layout]);
  const [form, writeForm] = useState<PresetForm>(config.presets.normal);
  function setForm(update: SetStateAction<PresetForm>) {
    writeForm(previous => {
      const next = typeof update === "function" ? update(previous) : update;
      if (next.context.payment_requested_after_call && (next.context.active_call
        || next.sender !== previous.sender || next.recipient !== previous.recipient || next.amount !== previous.amount)) {
        return { ...next, context: { ...next.context, payment_requested_after_call: undefined } };
      }
      return next;
    });
  }
  const [recipientType, setRecipientType] = useState<"phone" | "card" | "iban">("phone");
  const [result, setResult] = useState<Evaluation | null>(null);
  const [resultAmount, setResultAmount] = useState("0");
  const [roundtrip, setRoundtrip] = useState(0);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const selection = useRef(new TransferSelection());
  const [storage] = useState(() => mobileRecovery(`${config.mode}.${config.presets.normal.sender}`, () => window.localStorage));
  const restoreDialog = useRef<string | null>(null);
  const [draftFailed, setDraftFailed] = useState(false);
  useEffect(() => {
    if (layout === "officer") return;
    const id = storage.selection();
    if (id) { selection.current.select(id); restoreDialog.current = id; }
  }, [storage, layout]);
  function selectTransfer(id: string | null) {
    selection.current.select(id);
    storage.select(id);
    restoreDialog.current = null;
  }
  const [error, setError] = useState<MessageKey | null>(null);
  const [submissionRetryAt, setSubmissionRetryAt] = useState(0);
  useEffect(() => {
    if (!submissionRetryAt) return;
    const timer = setTimeout(() => {
      setSubmissionRetryAt(0);
      setError(previous => previous === "submissionCooldown" ? null : previous);
    }, Math.max(0, submissionRetryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [submissionRetryAt]);
  const [callVerdict, setCallVerdict] = useState<CallCheck | "unavailable" | null>(null);
  const [modal, setModal] = useState(false);
  const [coolingDrafts, setCoolingDrafts] = useState<Record<string, Partial<Answers>>>({});
  const [revision, setRevision] = useState(0);
  const [socFocus, setSocFocus] = useState(false);
  const consumeSocFocus = useCallback(() => setSocFocus(false), []);
  const [preset, setPreset] = useState<Preset | null>(null);
  const sensor = useBiometrics();
  const [resultContext, setResultContext] = useState<Partial<Context>>({});
  const [evaluations, setEvaluations] = useState<Record<string, Evaluation>>({});
  const latestEvaluations = useRef<Record<string, Evaluation>>({});
  const [traffic, setTraffic] = useState<Record<string, TrafficRecord>>({});
  const recovery = useRecovery();
  const attempt = useRef<TransferAttempt | null>(null);
  const attemptIdentity = useRef<string | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [completedIdentity, setCompletedIdentity] = useState<string | null>(null);
  const [checkingRecovery, setCheckingRecovery] = useState(false);
  const identity = draftIdentity(form, recipientType);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
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
    const id = evaluation.transaction_id;
    const persisted = storage.read(id);
    const disk = reconcileCoolingDrafts(persisted ? { [id]: persisted } : {}, evaluation);
    if (persisted && !disk[id]) storage.save(id, null);
    setCoolingDrafts(drafts => reconcileCoolingDrafts(disk[id] && !drafts[id] ? { ...drafts, [id]: disk[id] } : drafts, evaluation));
    recovery.record(receipt(evaluation, stored));
    return evaluation;
  }, [recovery.record, recovery.get, storage]);
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
  // GitHub Pages demo only: the transfer lives in this browser's demo store. When that
  // store no longer holds it (cleared, or another tab of an older build overwrote it),
  // the receipt is closed instead of blocking every new transfer forever. The server
  // build keeps such IDs open until the bank confirms them.
  const closeLost = useCallback(async (record: RecoveryRecord) => {
    if (!STATIC_DEMO || Date.now() - record.updatedAt < 10000) return;
    if (record.state === "unknown") {
      const value = await api<AbandonResult>(`transfers/requests/${record.id}/abandon`, { method: "POST", body: "{}" });
      if (value.status === "processed" && value.evaluation) { remember(value.evaluation); return; }
    }
    recovery.record({ id: record.id, state: "abandoned", updatedAt: Date.now() });
  }, [remember, recovery.record]);
  const reconciling = useRef(false);
  const recoveryCursor = useRef(0);
  const lastReconciledAt = useRef(-Infinity);
  const reconcilePending = useCallback(async () => {
    if (reconciling.current || performance.now() - lastReconciledAt.current < 15000) return;
    lastReconciledAt.current = performance.now();
    reconciling.current = true; setCheckingRecovery(true);
    try {
      const batch = recoveryBatch(recovery.refresh(), recoveryCursor.current, selection.current.id, STATIC_DEMO ? 500 : 4);
      recoveryCursor.current = batch.nextCursor;
      await Promise.allSettled(batch.records.map(async record => {
        let fetched: Evaluation;
        try { fetched = await api<Evaluation>(`transfers/${record.id}`); }
        catch (failure) { if (failure instanceof ApiError && failure.status === 404) await closeLost(record); throw failure; }
        const value = remember(fetched);
        if (!value) return;
        const matchesAttempt = attempt.current?.input.request_id === value.transaction_id;
        if (matchesAttempt) setUnknown(false);
        // A receipt may settle an earlier attempt without taking over a newer
        // selection or a form the user has started editing while reads run.
        if (!selection.current.acceptsRecovery(value.transaction_id)) return;
        if (matchesAttempt && currentIdentity.current === attemptIdentity.current) setCompletedIdentity(attemptIdentity.current);
        setError(null);
        setResult(value); setResultAmount(value.amount ?? "0"); setResultContext(value.context ?? {});
        if (restoreDialog.current === value.transaction_id) {
          restoreDialog.current = null;
          setModal(value.status === "cooling_off" && activeTab.current === "mobile");
        } else if (value.status !== "cooling_off") setModal(false);
      }));
    } finally { reconciling.current = false; setCheckingRecovery(false); }
  }, [recovery.refresh, remember, closeLost]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void reconcilePending(); };
    refresh(); const timer = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [reconcilePending]);
  useEffect(() => {
    if (identity !== previousIdentity.current) {
      if (completedIdentity !== null) forceNext.current = true;
      previousIdentity.current = identity; selectTransfer(null); setResult(null); setModal(false); setCompletedIdentity(null); setError(null);
    }
  }, [identity, completedIdentity]);

  async function review(id: string) {
    if (lock.current) return;
    selectTransfer(id);
    if (result?.transaction_id !== id) { setResult(null); setModal(false); }
    lock.current = true; setBusy(true); setError(null);
    try {
      const value = remember(await api<Evaluation>(`transfers/${id}`));
      if (!value) { setError("staleData"); return; }
      if (attempt.current?.input.request_id === id) { setUnknown(false); sensor.complete(); setCompletedIdentity(attemptIdentity.current); }
      setResult(value); setResultAmount(value.amount ?? "0"); setResultContext(value.context ?? {}); setModal(value.status === "cooling_off");
      if (value.status !== "cooling_off") { stream.stop(); setTab("mobile"); }
    } catch (failure) {
      setError(errorKey(failure));
      const lost = failure instanceof ApiError && failure.status === 404 ? recovery.get().find(record => record.id === id) : undefined;
      if (lost) void closeLost(lost).catch(() => undefined);
    }
    finally { lock.current = false; setBusy(false); }
  }
  async function execute(current: TransferAttempt, chosen?: Preset) {
    selectTransfer(current.input.request_id!);
    lock.current = true; setBusy(true); setError(null); setResult(null); setPreset(chosen ?? null); setModal(false); setUnknown(false);
    const started = performance.now();
    try {
      const evaluated = remember(await current.execute());
      if (!evaluated) throw new Error("outcomeUnknown");
      setRoundtrip(performance.now() - started); setResult(evaluated); setResultAmount(evaluated.amount ?? current.input.amount); setRevision(n => n + 1);
      setResultContext(evaluated.context ?? current.input.context); sensor.complete(); setCompletedIdentity(attemptIdentity.current);
      setModal(evaluated.status === "cooling_off");
      if (chosen) { setSocFocus(true); if (chosen !== "hub") stream.stop(); setTab(chosen === "hub" ? "soc" : "mobile"); }
    } catch (failure) {
      const ambiguous = isUnknownOutcome(failure);
      if (failure instanceof ApiError && failure.code === "submissionCooldown") {
        setSubmissionRetryAt(Date.now() + (failure.retryAfter || 60) * 1000);
        await retireUnused(current.input.request_id!);
        setUnknown(recovery.get().some(record => record.id === current.input.request_id && record.state === "unknown"));
        setError("submissionCooldown");
      } else {
        setUnknown(true); setError(ambiguous ? "outcomeUnknown" : errorKey(failure));
      }
      setTab("mobile");
    } finally { lock.current = false; setBusy(false); }
  }

  async function evaluate(value: PresetForm, type = recipientType, chosen?: Preset, duress = false) {
    if (lock.current || hasUnknown || submissionRetryAt > Date.now()) return;
    const draft = draftIdentity(value, type);
    if (!chosen && !forceNext.current && completedIdentity === draft) return;
    const recipient = value.recipient.replace(/[\s()-]/g, "").toUpperCase();
    let context = chosen ? value.context : { ...value.context, ...sensor.context(), ...(duress ? { duress: true } : {}) };
    // During a call the app asks the bank's outbound log by itself; nobody has to press anything.
    if (context.active_call && !context.bank_call_check_id && value.sender.trim()) {
      try {
        const check = await api<CallCheck>("call-check", { method: "POST", body: JSON.stringify({ customer_id: value.sender.trim() }) });
        context = { ...context, bank_call_check_id: check.check_id };
      } catch { /* No answer from the log: score the transfer without this signal. */ }
    }
    const parsed = transferSchema.safeParse({ sender_id: value.sender.trim(), [`recipient_${type}`]: recipient, amount: value.amount, currency: "KZT", context });
    if (!parsed.success) { setError(chosen && (!value.sender || !value.recipient) ? "presetMissing" : "invalid"); setTab("mobile"); return; }
    selectTransfer(null);
    lock.current = true; setBusy(true); setError(null);
    try {
      const hash = await digestDraft(draft);
      const reserved = await withIntentLock(() => {
        const records = recovery.refresh();
        if (records.some(record => record.state === "unknown") || records.filter(unresolved).length >= 250) return null;
        const previous = !chosen && !forceNext.current ? findDraftReceipt(records, hash) : undefined;
        if (previous) return { id: previous.id, existing: true };
        const id = randomId();
        if (!recovery.record({ id, draftKey: hash, state: "unknown", updatedAt: Date.now() }, true)) throw new Error("recoveryUnavailable");
        return { id, existing: false };
      });
      if (!reserved) { setError("recoveryRequired"); return; }
      forceNext.current = false; attemptIdentity.current = draft;
      if (reserved.existing) {
        selectTransfer(reserved.id);
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
    if (!accepted || selection.current.id !== accepted.transaction_id) return;
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
        selectTransfer(accepted.transaction_id);
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
    setForm(v => v.context.payment_requested_after_call ? { ...v, context: { ...v.context, payment_requested_after_call: undefined } } : v);
    selectTransfer(null); forceNext.current = true; attempt.current = null;
    setCompletedIdentity(null); sensor.reset(); setResult(null); setPreset(null); setError(null);
  }
  const cooling = modal && result?.status === "cooling_off" && <CoolingModal key={result.transaction_id} result={result} context={resultContext}
    answers={coolingDrafts[result.transaction_id] ?? result.verification_answers ?? {}} draftFailed={draftFailed}
    onAnswersChange={answers => {
      setDraftFailed(!storage.save(result.transaction_id, answers));
      setCoolingDrafts(drafts => retainCoolingDraft(drafts, result.transaction_id, answers));
    }} onClose={() => setModal(false)} onResolved={resolved} />;
  const languageSwitch = <div className="language" role="group" aria-label={t("language")}>{(["kk", "ru"] as const).map(l => <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>{l === "kk" ? "ҚАЗ" : "РУС"}</button>)}</div>;
  const showWallet = config.demoActionsEnabled !== false && (!STATIC_DEMO || process.env.NEXT_PUBLIC_BCC_PAGES_WALLET === "1");
  const showCollectionReplay = config.demoActionsEnabled !== false && config.accountMode !== "pilot";
  const walletLink = showWallet && <a className="pitch-link" href={connectedWallet.url}>{t("connectedWallet")}<ArrowRight size={15} aria-hidden="true" /></a>;
  const androidDownload = config.demoActionsEnabled !== false && config.accountMode !== "pilot" && (
    <AndroidDownload kk={lang === "kk"} />
  );
  const juryEntry = config.demoActionsEnabled !== false && config.accountMode !== "pilot" && (
    <a className="jury-entry" href={connectedWallet.juryUrl}><LogIn size={17} aria-hidden="true" />{t("juryLogin")}</a>
  );
  if (layout === "officer") return <>
    <header className="topbar"><div className="topbar-inner"><div className="brand">
      <BrandMark /><div><strong>Saq Bol<span> × BCC</span></strong><small>{t("officerWorkspace")}</small></div>
    </div>{juryEntry}{languageSwitch}</div></header>
    <main className="shell">
      {showWallet && <a className="pitch-link" href={connectedWallet.url}>{t("staffWalletLogin")}<ArrowRight size={15} aria-hidden="true" /></a>}
      {showCollectionReplay && <Suspense fallback={null}><CollectionReplayInspector /></Suspense>}
      <SocDashboard privateStoryAccess={config.privateStoryAccess} liveLedger={config.mode === "live" && !STATIC_DEMO} readOnly={config.publicSocReadOnly} initialSelection={null} revision={revision} evaluations={evaluations} traffic={traffic}
      onTrafficSync={syncTraffic} stream={{ ...stream, canStart: stream.canStart && !hasUnknown }} busy={busy} />
      <footer className="page-footer"><Link href="/">{t("bothWorkspaces")}</Link><span>{t(config.accountMode === "test" ? "testDataScope" : "prototypeIdentity")}</span></footer>
    </main>
  </>;
  // /mobile: the same client logic on a real smartphone — no bezel, decision panel or SOC tab.
  if (layout === "phone") return <>
    <header className="topbar mobile-topbar"><div className="topbar-inner">
      <div className="brand"><BrandMark /><div><strong>Saq Bol<span> × BCC</span></strong></div></div>
      {juryEntry}{languageSwitch}
    </div></header>
    <main className="mobile-shell">
      <div className="wallet-links">{walletLink}{androidDownload}</div>
      <RecoveryPanel records={recovery.records} persisted={recovery.persisted} busy={busy} refreshing={checkingRecovery} onReview={id => void review(id)} onAbandon={id => void abandon(id)} onRefresh={() => void reconcilePending()} />
      {hasUnknown && <div className="pending-panel"><p role="status">{t("recoveryRequired")}</p>{unknown && attempt.current && <button className="secondary" disabled={busy} onClick={() => { if (attempt.current && !lock.current) void execute(attempt.current); }}>{t("retryTransfer")}</button>}</div>}
      <TransferPhone bare config={config} form={form} setForm={setForm} recipientType={recipientType} setRecipientType={setRecipientType} busy={busy} blocked={hasUnknown} submissionPaused={!!submissionRetryAt} completed={completedIdentity === identity} error={error} sensor={sensor} onSubmit={duress => void evaluate(form, undefined, undefined, duress)} result={result} amount={resultAmount} onReview={() => result && void review(result.transaction_id)} onReviewReturn={id => void review(id)} onNewTransfer={freshTransfer} />
    </main>
    {cooling}
  </>;
  return <>
    <header className="topbar"><div className="topbar-inner">
      <div className="brand"><BrandMark /><div><strong>Saq Bol<span> × BCC</span></strong><small>{t("prototypeIdentity")}</small></div></div>
      {juryEntry}<div className="header-right"><span className="mode" title={t(config.mode)}><span className="live-dot" /><span className="mode-text">{config.mode === "demo" ? t("demoMarker") : t("live")}</span></span>{languageSwitch}</div>
    </div></header>
    <main className="shell">
      <section className="demo-bar" aria-label={t("presets")}>
        <div className="demo-bar-label"><CircleHelp size={16} aria-hidden="true" /><span>{t(config.demoActionsEnabled === false ? "pilotMode" : "demoScenarios")}</span></div>
        <div className="preset-buttons">{(["normal", "scam", "hub"] as const).map(key => { const Icon = presetIcons[key]; return <button key={key} type="button" className={`preset ${preset === key ? "chosen" : ""}`} disabled={busy || !!submissionRetryAt || hasUnknown || config.demoActionsEnabled === false} onClick={() => runPreset(key)}><Icon size={15} aria-hidden="true" />{t(key)}</button>; })}</div>
        {STATIC_DEMO && <button type="button" className="demo-reset" disabled={busy} onClick={() => { if (window.confirm(t("resetDemoConfirm"))) { resetStaticDemo(); window.location.reload(); } }}>{t("resetDemo")}</button>}
        <div className="wallet-links">{walletLink}{androidDownload}</div>
        {config.demoActionsEnabled !== false && <Link href="/pitch" className="pitch-link">{t("pitchLink")}<ArrowRight size={15} aria-hidden="true" /></Link>}
      </section>
      {showCollectionReplay && <CollectionComparison />}
      <RecoveryPanel records={recovery.records} persisted={recovery.persisted} busy={busy} refreshing={checkingRecovery} onReview={id => void review(id)} onAbandon={id => void abandon(id)} onRefresh={() => void reconcilePending()} />
      {hasUnknown && <div className="pending-panel"><p role="status">{t("recoveryRequired")}</p>{unknown && attempt.current && <button className="secondary" disabled={busy} onClick={() => { if (attempt.current && !lock.current) void execute(attempt.current); }}>{t("retryTransfer")}</button>}</div>}
      {error && tab === "soc" && <p className="error" role="alert">{t(error)}</p>}
      <div className="tabs" role="tablist" aria-label="Saq Bol">{(["mobile", "soc"] as const).map(key => { const Icon = key === "mobile" ? Smartphone : Activity; return <button key={key} type="button" role="tab" id={`tab-${key}`} aria-selected={tab === key} aria-controls={`panel-${key}`} tabIndex={tab === key ? 0 : -1} onKeyDown={e => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) { e.preventDefault(); const next = e.key === "Home" ? "mobile" : e.key === "End" ? "soc" : key === "mobile" ? "soc" : "mobile"; changeTab(next); document.getElementById(`tab-${next}`)?.focus(); } }} onClick={() => changeTab(key)}><Icon size={17} />{t(key === "mobile" ? "tabMobile" : "tabSoc")}</button>; })}</div>
      <div className="role-summary"><p>{t(tab === "mobile" ? "customerPurpose" : "officerPurpose")} {config.accountMode === "test" && t("testDataScope")}</p>
        <Link href={tab === "mobile" ? "/mobile" : "/soc"}>{t(tab === "mobile" ? "openCustomer" : "openOfficer")} <ArrowRight size={15} /></Link></div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "soc" ? <SocDashboard privateStoryAccess={config.privateStoryAccess} liveLedger={config.mode === "live" && !STATIC_DEMO} readOnly={config.publicSocReadOnly} initialSelection={result?.transaction_id ?? null} revision={revision} evaluations={evaluations} traffic={traffic} onTrafficSync={syncTraffic} stream={{ ...stream, canStart: stream.canStart && !hasUnknown }} onReview={id => void review(id)} busy={busy} focusTransfer={socFocus} onFocusConsumed={consumeSocFocus} /> : <>
          <div className="client-wrap">
          <div className="transfer-grid">
            <TransferPhone config={config} form={form} setForm={setForm} recipientType={recipientType} setRecipientType={setRecipientType} busy={busy} blocked={hasUnknown} submissionPaused={!!submissionRetryAt} completed={completedIdentity === identity} error={error} sensor={sensor} onSubmit={duress => void evaluate(form, undefined, undefined, duress)} result={result} amount={resultAmount} onReview={() => result && void review(result.transaction_id)} onReviewReturn={id => void review(id)} onNewTransfer={freshTransfer} onCallCheck={setCallVerdict} />
            <Telemetry result={result} amount={resultAmount} roundtrip={roundtrip} busy={busy} error={error} sensor={sensor} sender={form.sender} context={form.context} callCheck={callVerdict} onReview={() => result && void review(result.transaction_id)} />
          </div>
          </div>
        </>}
      </div>
      <footer className="page-footer"><a href="https://github.com/foxfordkz-cyber/qadamxbcc" target="_blank" rel="noopener noreferrer">Saq Bol × BCC · foxfordkz-cyber/qadamxbcc</a><span>{t("prototypeIdentity")} · {config.mode === "demo" ? t("demoExplain") : t("protected")}</span></footer>
    </main>
    {cooling}
  </>;
}
export default function ShieldApp({ config, layout = "full" }: { config: AppConfig; layout?: AppLayout }) {
  return <LocaleProvider><App config={config} layout={layout} /></LocaleProvider>;
}
