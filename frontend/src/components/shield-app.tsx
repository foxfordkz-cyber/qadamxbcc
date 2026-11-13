"use client";

import { useRef, useState } from "react";
import { Activity, ArrowDownLeft, ArrowRight, Check, CircleHelp, Clock3, Landmark, LoaderCircle, LockKeyhole, Network, PhoneCall, ShieldCheck, ShieldX, Smartphone, Wallet } from "lucide-react";
import { api, transferSchema, type AppConfig, type Decision, type Evaluation, type Preset, type PresetForm } from "@/lib/contracts";
import { errorKey, LocaleProvider, money, useLocale, type MessageKey } from "@/lib/i18n";
import { Badge, Explain, Gauge } from "./risk";
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

  async function evaluate(value: PresetForm, type = recipientType, chosen?: Preset) {
    if (lock.current) return;
    const recipient = value.recipient.replace(/[\s()-]/g, "").toUpperCase();
    const parsed = transferSchema.safeParse({ sender_id: value.sender.trim(), [`recipient_${type}`]: recipient, amount: value.amount, currency: "KZT", context: value.context });
    if (!parsed.success) { setError(chosen && (!value.sender || !value.recipient) ? "presetMissing" : "invalid"); setTab("mobile"); return; }
    lock.current = true; setBusy(true); setError(null); setResult(null); setPreset(chosen ?? null); setModal(false);
    const started = performance.now();
    try {
      const evaluated = await api<Evaluation>("transfers/evaluate", { method: "POST", body: JSON.stringify(parsed.data) });
      setRoundtrip(performance.now() - started); setResult(evaluated); setResultAmount(value.amount); setRevision(n => n + 1);
      setModal(evaluated.status === "cooling_off");
      if (chosen) setTab(chosen === "hub" ? "soc" : "mobile");
    } catch (e) { setError(errorKey(e)); setTab("mobile"); }
    finally { lock.current = false; setBusy(false); }
  }
  function runPreset(key: Preset) {
    if (lock.current) return;
    const next = { ...config.presets[key], context: { ...config.presets[key].context } };
    setForm(next); setRecipientType("phone"); void evaluate(next, "phone", key);
  }
  function resolved(value: Decision) {
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
        {tab === "soc" ? <SocDashboard initialSelection={result?.transaction_id ?? null} revision={revision} /> : <>
          <div className="section-heading"><div><p className="eyebrow">{t("eyebrow")}</p><h1>{t("title")}</h1><p className="muted max-w-2xl">{t("intro")}</p></div><span className="security-seal"><ShieldCheck size={20} />BCC Shield</span></div>
          <div className="transfer-grid"><section className="panel transfer-panel"><div className="panel-heading"><h2><ArrowDownLeft size={19} />{t("transfer")}</h2><span className="muted text-xs">KZT / ₸</span></div>
            <form className="p-6" onSubmit={e => { e.preventDefault(); void evaluate(form); }}>
              <fieldset disabled={busy} className="space-y-5 border-0 p-0">
                <label className="field">{t("sender")}<input required value={form.sender} onChange={e => setForm(v => ({ ...v, sender: e.target.value }))} placeholder="00000000-0000-4000-8000-000000000001" autoComplete="off" spellCheck={false} /></label>
                <div><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><label htmlFor="recipient">{t("recipient")}</label><div className="segmented">{(["phone", "card", "iban"] as const).map(type => <button type="button" key={type} aria-pressed={recipientType === type} onClick={() => { setRecipientType(type); setForm(v => ({ ...v, recipient: "", context: { ...v.context, is_new_recipient: undefined } })); }}>{t(type)}</button>)}</div></div><input id="recipient" required value={form.recipient} inputMode={recipientType === "iban" ? "text" : "tel"} autoComplete="off" placeholder={recipientType === "phone" ? "+7 701 000 00 02" : recipientType === "card" ? "4400 0000 0000 0002" : "KZ000000000000000002"} onChange={e => setForm(v => ({ ...v, recipient: e.target.value, context: { ...v.context, is_new_recipient: undefined } }))} />{recipientType === "card" && <p className="muted mt-2 text-xs">{t("cardHint")}</p>}</div>
                <label className="field">{t("amount")}<div className="amount-input"><input required type="number" min="0.01" max="1000000000" step="0.01" inputMode="decimal" value={form.amount} onChange={e => setForm(v => ({ ...v, amount: e.target.value }))} /><span>₸</span></div></label>
                <div className="context-box"><p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">{t("context")}</p>{(["active_call", "from_deposit", "is_new_device"] as const).map(key => { const Icon = key === "active_call" ? PhoneCall : key === "from_deposit" ? Landmark : Smartphone; return <button className="toggle-row" type="button" role="switch" aria-checked={form.context[key]} key={key} onClick={() => setForm(v => ({ ...v, context: { ...v.context, [key]: !v.context[key] } }))}><span><Icon size={17} />{t(key)}</span><i className={form.context[key] ? "on" : ""}><b /></i></button>; })}</div>
                {error && <p className="error" role="alert">{t(error)}</p>}
                <button className="primary w-full" disabled={busy}>{busy ? <LoaderCircle className="animate-spin" size={18} /> : <ShieldCheck size={18} />}{t(busy ? "evaluating" : "evaluate")}<ArrowRight size={17} className="ml-auto" /></button>
              </fieldset><p className="muted mt-4 flex items-center justify-center gap-2 text-xs"><LockKeyhole size={12} />{t("protected")}</p>
            </form></section>
            <div className="space-y-5"><section className="panel result-panel" aria-live="polite" aria-busy={busy}><div className="panel-heading"><h2>{t("decision")}</h2>{result && <Badge status={result.status} />}</div>
              {result ? <div className="p-6"><div className="decision-top"><Gauge score={result.risk_score} /><div><p className="muted text-xs">{t("amount")}</p><strong className="result-amount">{money(resultAmount, lang)}</strong><p className="mt-3 font-medium">{lang === "kk" ? result.headline_kk : result.headline_ru}</p><p className="muted mt-1 text-sm">{result.recipient.display_name} · {result.recipient.iban_masked}</p></div></div><div className="latency-strip"><span>{t("latency")}<strong>{result.latency_ms.toFixed(2)} {t("ms")}</strong></span><span>{t("roundtrip")}<strong>{roundtrip.toFixed(0)} {t("ms")}</strong></span></div><Explain kk={result.reasons_kk} ru={result.reasons_ru} />{result.status === "cooling_off" && <button className="secondary mt-5 w-full" onClick={() => setModal(true)}><Clock3 size={16} />{t("review")}</button>}</div>
                : <div className="awaiting"><div className="shield-orbit">{busy ? <LoaderCircle size={44} className="animate-spin" /> : <ShieldCheck size={44} />}</div><h3>{t(busy ? "evaluating" : "awaiting")}</h3><p>{t("awaitingText")}</p></div>}
            </section><section className="panel p-6"><h2 className="mb-5">{t("pipeline")}</h2><div className="pipeline">{([{ key: "behavior", icon: Wallet, time: 15 }, { key: "network", icon: Network, time: 25 }, { key: "adaptive", icon: ShieldCheck, time: 10 }] as const).map(({ key, icon: Icon, time }, index) => <div key={key}><span className="pipeline-icon"><Icon size={18} /></span><span><small>0{index + 1}</small><strong>{t(key)}</strong></span><em>{t("target")} &lt;{time} {t("ms")}</em></div>)}</div><div className="thresholds"><span><Check size={13} />0–39</span><span><Clock3 size={13} />40–74</span><span><ShieldX size={13} />75–100</span></div></section></div>
          </div>
        </>}
      </div>
      <footer><span>BCC Shield · ITU Hackathon 2026</span><span>{config.mode === "demo" ? t("demoExplain") : t("protected")}</span></footer>
    </main>
    {modal && result?.status === "cooling_off" && <CoolingModal key={result.transaction_id} result={result} onClose={() => setModal(false)} onResolved={resolved} />}
  </>;
}
export default function ShieldApp({ config }: { config: AppConfig }) {
  return <LocaleProvider><App config={config} /></LocaleProvider>;
}
