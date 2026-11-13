"use client";

import { useCallback, useRef, useState } from "react";
import { Activity, ArrowRight, CircleHelp, Network, PhoneCall, ShieldCheck, Smartphone } from "lucide-react";
import { api, transferSchema, type AppConfig, type Context, type Decision, type Evaluation, type Preset, type PresetForm } from "@/lib/contracts";
import { reconcileTraffic, type TrafficRecord } from "@/lib/traffic";
import type { FeedItem } from "@/lib/contracts";
import { useBiometrics } from "./use-biometrics";
import { errorKey, LocaleProvider, useLocale, type MessageKey } from "@/lib/i18n";
import { TransferPhone } from "./transfer-phone";
import { Telemetry } from "./telemetry";
import { CoolingModal } from "./cooling-modal";
import { SocDashboard } from "./soc-dashboard";

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
  const [error, setError] = useState<MessageKey | null>(null);
  const [modal, setModal] = useState(false);
  const [revision, setRevision] = useState(0);
  const [preset, setPreset] = useState<Preset | null>(null);
  const sensor = useBiometrics();
  const [resultContext, setResultContext] = useState<Partial<Context>>({});
  const [evaluations, setEvaluations] = useState<Record<string, Evaluation>>({});
  const [traffic, setTraffic] = useState<Record<string, TrafficRecord>>({});
  const remember = useCallback((evaluation: Evaluation) => setEvaluations(previous => Object.fromEntries([...Object.entries(previous).slice(-399), [evaluation.transaction_id, evaluation]])), []);
  const recordTraffic = useCallback((record: TrafficRecord) => {
    remember(record.evaluation);
    setTraffic(previous => ({ ...previous, [record.evaluation.transaction_id]: record }));
  }, [remember]);
  const syncTraffic = useCallback((items: FeedItem[]) => setTraffic(previous => reconcileTraffic(previous, items)), []);

  async function evaluate(value: PresetForm, type = recipientType, chosen?: Preset) {
    if (lock.current) return;
    const recipient = value.recipient.replace(/[\s()-]/g, "").toUpperCase();
    const context = chosen ? value.context : { ...value.context, ...sensor.context() };
    const parsed = transferSchema.safeParse({ sender_id: value.sender.trim(), [`recipient_${type}`]: recipient, amount: value.amount, currency: "KZT", context });
    if (!parsed.success) { setError(chosen && (!value.sender || !value.recipient) ? "presetMissing" : "invalid"); setTab("mobile"); return; }
    lock.current = true; setBusy(true); setError(null); setResult(null); setPreset(chosen ?? null); setModal(false);
    const started = performance.now();
    try {
      const evaluated = await api<Evaluation>("transfers/evaluate", { method: "POST", body: JSON.stringify(parsed.data) });
      setRoundtrip(performance.now() - started); setResult(evaluated); setResultAmount(value.amount); setRevision(n => n + 1);
      setResultContext(context); remember(evaluated);
      setModal(evaluated.status === "cooling_off");
      if (chosen) setTab(chosen === "hub" ? "soc" : "mobile");
    } catch (e) { setError(errorKey(e)); setTab("mobile"); }
    finally { lock.current = false; setBusy(false); }
  }
  function runPreset(key: Preset) {
    if (lock.current) return;
    const next = { ...config.presets[key], context: { ...config.presets[key].context } };
    sensor.reset();
    setForm(next); setRecipientType("phone"); void evaluate(next, "phone", key);
  }
  function resolved(value: Decision) {
    setEvaluations(previous => previous[value.transaction_id] ? { ...previous, [value.transaction_id]: { ...previous[value.transaction_id], ...value } } : previous);
    setResult(previous => previous ? { ...previous, ...value, cooling_off_until: null } : null);
    setModal(false); setRevision(n => n + 1);
  }
  return <>
    <header className="topbar"><div className="brand"><div className="brand-mark"><ShieldCheck size={25} /></div><div><strong>bcc<span> shield</span></strong><small>{t("tagline")}</small></div></div>
      <div className="header-right"><span className="mode"><span className="live-dot" />{t(config.mode)}</span><div className="language" aria-label={t("language")}>{(["kk", "ru"] as const).map(l => <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>{l === "kk" ? "ҚАЗ" : "РУС"}</button>)}</div></div>
    </header>
    <main className="shell">
      <section className="demo-bar" aria-label={t("presets")}><div className="flex items-center gap-2 text-sm"><CircleHelp size={16} /><span>{t("presets")}</span></div><div className="preset-buttons">{(["normal", "scam", "hub"] as const).map((key, index) => { const Icon = presetIcons[key]; return <button key={key} className={`preset ${preset === key ? "chosen" : ""}`} disabled={busy} onClick={() => runPreset(key)}><span className="preset-number">0{index + 1}</span><Icon size={15} />{t(key)}</button>; })}</div></section>
      <div className="tabs" role="tablist" aria-label="BCC Shield">{(["mobile", "soc"] as const).map(key => { const Icon = key === "mobile" ? Smartphone : Activity; return <button key={key} role="tab" id={`tab-${key}`} aria-selected={tab === key} aria-controls={`panel-${key}`} tabIndex={tab === key ? 0 : -1} onKeyDown={e => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) { e.preventDefault(); const next = e.key === "Home" ? "mobile" : e.key === "End" ? "soc" : key === "mobile" ? "soc" : "mobile"; setTab(next); document.getElementById(`tab-${next}`)?.focus(); } }} onClick={() => setTab(key)}><Icon size={17} />{t(key)}</button>; })}</div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "soc" ? <SocDashboard initialSelection={result?.transaction_id ?? null} revision={revision} config={config} evaluations={evaluations} traffic={traffic} onTraffic={recordTraffic} onTrafficSync={syncTraffic} /> : <>
          <div className="section-heading"><div><p className="eyebrow">{t("eyebrow")}</p><h1>{t("title")}</h1><p className="muted max-w-2xl">{t("intro")}</p></div><span className="security-seal"><ShieldCheck size={20} />BCC Shield</span></div>
          <div className="transfer-grid">
            <TransferPhone config={config} form={form} setForm={setForm} recipientType={recipientType} setRecipientType={setRecipientType} busy={busy} error={error} sensor={sensor} onSubmit={() => void evaluate(form)} />
            <Telemetry result={result} amount={resultAmount} roundtrip={roundtrip} busy={busy} sensor={sensor} onReview={() => setModal(true)} />
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
