"use client";

import { BrandMark } from "./brand-mark";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { AlertTriangle, ArrowLeft, ArrowLeftRight, BatteryFull, Check, ChevronDown, ChevronRight, Clock3, House, Landmark, LoaderCircle, LockKeyhole, Users, PhoneCall, ScanText, ShieldCheck, ShieldX, Signal, SlidersHorizontal, Smartphone, Wifi, XCircle } from "lucide-react";
import { api, type AppConfig, type CallCheck, type Evaluation, type PresetForm } from "@/lib/contracts";
import { money, useLocale, type MessageKey } from "@/lib/i18n";
import { mobileText } from "@/lib/mobile-copy";
import { groupAmount, rawAmount } from "@/lib/amount";
import { Badge } from "./risk";
import { IncomingReturns, returnsTitle } from "./incoming-returns";
import { RotateCcw } from "lucide-react";
import { CircleMembers } from "./circle-members";
import { FamilyCallback } from "./family-callback";
import { MessageCheck } from "./message-check";
import { MarketOrderCheck } from "./market-order-check";
import { PayeeCheck } from "./payee-check";
import { fixtureContactName, recipientRef } from "@/lib/payee-check";
import { ids } from "@/lib/demo-ids";
import { CallLogResult } from "./call-log-result";
import { TrustedCircle } from "./trusted-circle";
import type { Biometrics } from "./use-biometrics";
import "./mobile-client.css";
import "./mobile-tools.css";

/** Holding «Перевести» this long sends the silent alarm instead of a normal confirmation. */
export const DURESS_HOLD_MS = 1500;

export type RecipientType = "phone" | "card" | "iban";
interface Props {
  config: AppConfig;
  form: PresetForm;
  setForm: Dispatch<SetStateAction<PresetForm>>;
  recipientType: RecipientType;
  setRecipientType: (type: RecipientType) => void;
  busy: boolean;
  blocked?: boolean;
  submissionPaused?: boolean;
  completed?: boolean;
  error: MessageKey | null;
  /** duress: the client held the confirm button — the silent alarm («тихий код»). */
  onSubmit: (duress?: boolean) => void;
  sensor: Biometrics;
  result: Evaluation | null;
  amount: string;
  onReview: () => void;
  onReviewReturn?: (id: string) => void;
  onNewTransfer: () => void;
  /** The bank-log answer for the current call, for the decision panel next to the phone. */
  onCallCheck?: (value: CallCheck | "unavailable" | null) => void;
  /** Full-screen on a real smartphone (/mobile): no bezel, fake status bar or caption. */
  bare?: boolean;
}

/** Synthetic balance of the demo card. It is labelled as a demo value wherever it is shown. */
const DEMO_BALANCE = 1_250_000;
const contextKeys = ["active_call", "from_deposit", "is_new_device"] as const;
const contactSlots = [
  { key: "normal", fallback: "contactOne", tone: "mint" },
  { key: "scam", fallback: "contactTwo", tone: "lilac" },
  { key: "hub", fallback: "contactThree", tone: "peach" },
] as const;

function maskRecipient(value: string, type: RecipientType) {
  const compact = value.replace(/[\s()-]/g, "");
  if (type === "phone" && /^\+?7\d{10}$/.test(compact)) {
    const digits = compact.replace(/^\+?7/, "");
    return `+7 ••• ••• ${digits.slice(6, 8)} ${digits.slice(8)}`;
  }
  if (type === "card" && compact.length >= 4) return `•••• ${compact.slice(-4)}`;
  if (type === "iban" && compact.length > 8) return `${compact.slice(0, 4)} •••• ${compact.slice(-4)}`;
  return value;
}

export function TransferPhone({ config, form, setForm, recipientType, setRecipientType, busy, blocked = false, submissionPaused = false, completed = false, error, onSubmit, sensor, result, amount, onReview, onReviewReturn, onNewTransfer, onCallCheck, bare = false }: Props) {
  const { lang, t } = useLocale();
  const m = (key: Parameters<typeof mobileText>[1]) => mobileText(lang, key);
  const contextDetails = useRef<HTMLDetailsElement>(null);
  const confirmHeading = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState<"details" | "confirm" | "family" | "discarded">("details");
  const [screen, setScreen] = useState<"home" | "transfer" | "circle" | "scam" | "returns">(bare ? "home" : "transfer");
  const [offline, setOffline] = useState(false);
  const [verifiedFor, setVerifiedFor] = useState<string | null>(null);
  const payeeEnabled = !!config.demoActionsEnabled && (config.mode === "demo" || config.accountMode === "test");
  const payeeKey = recipientType + ":" + form.recipient;
  const payeeRef = recipientRef(recipientType, form.recipient);
  const awaitingPayee = payeeEnabled && !!payeeRef && verifiedFor !== payeeKey;
  const [largeText, setLargeText] = useState(false);
  useEffect(() => {
    try { setLargeText(localStorage.getItem("saqbol.a11y.large") === "true"); } catch { /* Storage is optional. */ }
  }, []);
  function toggleText() {
    const value = !largeText;
    setLargeText(value);
    try { localStorage.setItem("saqbol.a11y.large", String(value)); } catch { /* Keep the preference for this visit. */ }
  }
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update(); window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  useEffect(() => { if (result?.transaction_id) setScreen("transfer"); }, [result?.transaction_id]);
  const [callCheck, setCallCheck] = useState<CallCheck | null>(null);
  const [callChecking, setCallChecking] = useState(false);
  const [callCheckFailed, setCallCheckFailed] = useState(false);
  const [bankCallStarted, setBankCallStarted] = useState(false);
  const onCall = form.context.active_call;
  const callRequest = useRef<AbortController | null>(null);
  const outboundRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    setBankCallStarted(false);
    return () => { outboundRequest.current?.abort(); };
  }, [form.sender]);
  // A previous customer's reply must not update the current transfer.
  useEffect(() => {
    setCallCheck(null); setCallChecking(false); setCallCheckFailed(false); onCallCheck?.(null);
    setForm(v => v.context.bank_call_check_id ? { ...v, context: { ...v.context, bank_call_check_id: undefined } } : v);
    if (!onCall || !/^[0-9a-f-]{36}$/i.test(form.sender.trim())) return;
    const timer = setTimeout(() => void checkBankCall(), 300);
    return () => { clearTimeout(timer); callRequest.current?.abort(); outboundRequest.current?.abort(); };
  }, [onCall, form.sender]); // eslint-disable-line react-hooks/exhaustive-deps
  async function checkBankCall() {
    callRequest.current?.abort();
    const controller = new AbortController();
    callRequest.current = controller;
    const customer = form.sender.trim();
    setCallChecking(true); setCallCheck(null); setCallCheckFailed(false); onCallCheck?.(null);
    setForm(v => v.context.bank_call_check_id ? { ...v, context: { ...v.context, bank_call_check_id: undefined } } : v);
    try {
      const value = await api<CallCheck>("call-check", { method: "POST", body: JSON.stringify({ customer_id: customer }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) });
      if (controller.signal.aborted) return;
      setCallCheck(value); onCallCheck?.(value);
      setForm(v => v.sender.trim() === customer && v.context.active_call ? { ...v, context: { ...v.context, bank_call_check_id: value.check_id } } : v);
    } catch {
      if (controller.signal.aborted) return;
      setCallCheckFailed(true); onCallCheck?.("unavailable");
    } finally { if (!controller.signal.aborted) setCallChecking(false); }
  }
  async function startBankCall() {
    outboundRequest.current?.abort();
    const controller = new AbortController();
    outboundRequest.current = controller;
    const customer = form.sender.trim();
    try {
      await api("call-check/demo/bank-call", { method: "POST", body: JSON.stringify({ customer_id: customer }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) });
      if (controller.signal.aborted) return;
      setBankCallStarted(true); setCallCheck(null);
      setForm(v => v.sender.trim() === customer ? { ...v, context: { ...v.context, active_call: true, bank_call_check_id: undefined } } : v);
      if (onCall) void checkBankCall();
    } catch {
      if (!controller.signal.aborted) { setBankCallStarted(false); setCallCheck(null); setCallCheckFailed(true); onCallCheck?.("unavailable"); }
    }
  }
  const receipt = result && !blocked ? result : null;
  useEffect(() => { if (receipt) setStep("details"); }, [receipt?.transaction_id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (step === "confirm" && !busy) confirmHeading.current?.focus({ preventScroll: true }); }, [step]); // eslint-disable-line react-hooks/exhaustive-deps
  // Silent alarm: the bank has blocked the transfer, but a fraudster looking at the
  // screen sees an ordinary "processing" receipt and has no reason to push harder.
  const silent = !!receipt?.reasons?.some(reason => reason.code === "DURESS_SIGNAL");
  const hold = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({ timer: null, fired: false });
  const pressStart = () => {
    hold.current.fired = false;
    if (hold.current.timer) clearTimeout(hold.current.timer);
    hold.current.timer = setTimeout(() => { hold.current.fired = true; hold.current.timer = null; }, DURESS_HOLD_MS);
  };
  const pressEnd = () => { if (hold.current.timer) { clearTimeout(hold.current.timer); hold.current.timer = null; } };
  const ReceiptIcon = silent ? Clock3 : receipt?.status === "approved" ? Check : receipt?.status === "cooling_off" ? Clock3 : receipt?.status === "cancelled" ? XCircle : ShieldX;
  const receiptCopy = silent ? "receiptProcessing" : receipt?.status === "approved" ? "receiptApproved" : receipt?.status === "cooling_off" ? "receiptHeld" : receipt?.status === "cancelled" ? "receiptCancelled" : "receiptBlocked";
  const contactName = fixtureContactName(config, recipientType, form.recipient);
  const hasDemoSource = (config.mode === "demo" || config.accountMode === "test") && form.sender.trim() === ids.sender;
  const sourceName = hasDemoSource ? "#картакарта" : m("senderAccount");
  const sourceCard = <div className="source-card">
    <span className={hasDemoSource ? "card-thumbnail" : "source-account-icon"} aria-hidden="true">{hasDemoSource ? <BrandMark size={17} className="card-mark" /> : <Landmark size={20} />}</span>
    <div className="source-name"><b className="card-brand">{sourceName}</b>{hasDemoSource && <small className="card-number">•••• 4821</small>}</div>
    <div className="source-balance">{hasDemoSource
      ? <><b className="tabular-nums">{money(DEMO_BALANCE, lang)}</b><small>{m("demoBalance")}</small></>
      : <small>{m("balanceUnavailable")}</small>}</div>
  </div>;
  const activeContext = contextKeys.filter(key => form.context[key]).length;
  const numericAmount = Number(form.amount);
  const title = screen === "returns" ? returnsTitle(lang) : screen === "home" ? m("tabHome") : screen === "circle" ? m("circle") : screen === "scam" ? m("scam")
    : receipt ? m("receiptTitle") : step === "family" ? m("familyCallbackTitle")
    : step === "discarded" ? m("familyDiscarded") : step === "confirm" ? m("stepConfirm") : t("transfer");
  const showUnknown = blocked && !receipt;
  const reviewingFamily = step === "family" && !showUnknown && !busy && !completed && !submissionPaused;
  function discardFamilyDraft() {
    if (!reviewingFamily || receipt) return;
    onNewTransfer();
    setForm(previous => ({ ...previous, recipient: "", amount: "", context: { ...previous.context, is_new_recipient: undefined } }));
    setStep("discarded");
  }

  return <div className={`phone-stage${bare ? " is-bare" : ""}`}>
    <section className="phone-frame" aria-label={t("mobile")}>
      {!bare && <div className="phone-status" aria-hidden="true"><span>9:41</span><i /><div><Signal size={14} /><Wifi size={14} /><BatteryFull size={19} /></div></div>}
      <header className="phone-appbar">
        {screen === "transfer" && step === "family" && !receipt
          ? <button type="button" className="appbar-back" disabled={busy} onClick={() => setStep("confirm")} aria-label={m("familyReturn")}><ArrowLeft size={20} /></button>
          : screen === "transfer" && step === "confirm" && !receipt
          ? <button type="button" className="appbar-back" disabled={busy} onClick={() => setStep("details")} aria-label={m("editCta")}><ArrowLeft size={20} /></button>
          : screen !== "home" ? <button className="appbar-back" type="button" aria-label={m("tabHome")} disabled={busy} onClick={() => setScreen("home")}><ArrowLeft size={20} /></button> : <span />}
        <div className="appbar-title"><h2>{title}</h2>{screen === "transfer" && !receipt && (step === "details" || step === "confirm") && <small>{step === "confirm" ? 2 : 1} / 2 · {m("stepOf")}</small>}</div>
        <div className="phone-toolbar-actions"><button type="button" className="phone-text-size" aria-label={m("largeText")} title={m("largeText")} aria-pressed={largeText} onClick={toggleText}>Аа</button><span className="demo-tag">{config.accountMode === "test" ? t("testAccounts") : config.mode === "demo" ? m("demoBadge") : t("pilotMode")}</span></div>
      </header>
      <div className="phone-body">
        {offline && <p className="phone-alert warning" role="status">{m("offline")}</p>}
        {screen === "home" ? <section className="mobile-tool home-tools">
          <section className="wallet-home-account" aria-labelledby="wallet-accounts-title">
            <h3 id="wallet-accounts-title">{m("myAccounts")}</h3>
            {sourceCard}
            <button type="button" className="primary" onClick={() => { if (receipt && !blocked) onNewTransfer(); if (step === "discarded") setStep("details"); setScreen("transfer"); }}><ArrowLeftRight size={18} aria-hidden="true"/>{m("homeTransfer")}</button>
          </section>
          <section className="wallet-home-services" aria-labelledby="wallet-protection-title">
            <h3 id="wallet-protection-title">{m("homeProtection")}</h3>
            <button type="button" className="secondary" onClick={() => setScreen("circle")}><Users size={19} aria-hidden="true"/>{m("circle")}<ChevronRight size={16} aria-hidden="true"/></button>
            {config.mode === "live" && config.accountMode === "test" && config.demoActionsEnabled && <button type="button" className="secondary" onClick={() => setScreen("returns")}><RotateCcw size={19} aria-hidden="true"/>{returnsTitle(lang)}<ChevronRight size={16} aria-hidden="true"/></button>}
            <button type="button" className="secondary" onClick={() => setScreen("scam")}><ScanText size={19} aria-hidden="true"/>{m("scam")}<ChevronRight size={16} aria-hidden="true"/></button>
          </section>
        </section> : screen === "returns" ? <IncomingReturns onReview={onReviewReturn} transferDisabled={busy || blocked || submissionPaused} /> : screen === "circle" ? <CircleMembers /> : screen === "scam" ? <MessageCheck /> : receipt ? <section className={`phone-receipt receipt-${silent ? "processing" : receipt.status}`} data-transaction-id={receipt.transaction_id} aria-labelledby="phone-receipt-title">
          <div className="receipt-symbol" aria-hidden="true"><ReceiptIcon size={32} strokeWidth={1.8} /></div>
          {silent ? <span className="badge processing">{m("processingBadge")}</span> : <Badge status={receipt.status} />}
          <strong className="receipt-amount">{money(receipt.amount ?? amount, lang)}</strong>
          <h3 id="phone-receipt-title">{silent ? m("processingTitle") : lang === "kk" ? receipt.headline_kk : receipt.headline_ru}</h3>
          <dl className="receipt-details">
            <div><dt>{m("recipientName")}</dt><dd>{receipt.recipient.display_name}<small>{receipt.recipient.iban_masked}</small></dd></div>
            <div><dt>{m("fromCard")}</dt><dd>{sourceName}{hasDemoSource && " •••• 4821"}</dd></div>
            <div><dt>{m("operationShort")}</dt><dd className="tabular-nums" title={receipt.transaction_id}>…{receipt.transaction_id.slice(-8)}</dd></div>
          </dl>
          <p className="receipt-explanation" role="status">{m(receiptCopy)}</p>
          {receipt.status === "cancelled" && receipt.reasons.some(r => r.code === "POST_CALL_SCAM_REPORTED") && <a className="secondary post-call-bank" href="tel:505"><PhoneCall size={17} />{m("postCallBank")} · 505</a>}
          {error && <p className="error" role="alert">{t(error)}</p>}
          <div className="receipt-actions">
            {receipt.status === "cooling_off" && <button type="button" className="primary receipt-review" disabled={busy} onClick={onReview}>{busy ? <LoaderCircle className="animate-spin" size={18} /> : <ShieldCheck size={18} />}{t("review")}</button>}
            <button type="button" className={receipt.status === "cooling_off" ? "secondary receipt-new" : "primary receipt-new"} disabled={busy} onClick={onNewTransfer}>{m("receiptNext")}</button>
          </div>
          <p className="receipt-disclaimer">{m("receiptHint")}</p>
          {config.mode === "live" && receipt.status !== "cooling_off" && <TrustedCircle key={receipt.transaction_id} transactionId={receipt.transaction_id} active={false} historyOnly />}
        </section>
        : step === "discarded" && !showUnknown ? <section className="phone-section family-callback">
          <h3 role="status">{m("familyDiscarded")}</h3><p>{m("familyReport")}</p>
          <a className="secondary" href="tel:505"><PhoneCall size={17} aria-hidden="true" />{m("postCallBank")} · 505</a>
          <button type="button" className="primary" onClick={() => setStep("details")}>{m("receiptNext")}</button>
        </section>
        : reviewingFamily ? <FamilyCallback amount={money(form.amount, lang)} recipient={maskRecipient(form.recipient, recipientType)}
          onDiscard={discardFamilyDraft} onReturn={() => setStep("confirm")} />
        : step === "confirm" || step === "family" ? <section className="phone-confirm" aria-labelledby="confirm-title" aria-busy={busy}>
          <h3 id="confirm-title" ref={confirmHeading} tabIndex={-1} className="sr-only">{m("stepConfirm")}</h3>
          <div className="confirm-amount"><span>{t("transferAmount")}</span><strong className="tabular-nums">{money(form.amount, lang)}</strong></div>
          <dl className="confirm-list">
            <div><dt>{m("recipientName")}</dt><dd>{contactName ? <><b>{contactName}</b><small>{maskRecipient(form.recipient, recipientType)}</small></> : <><b>{maskRecipient(form.recipient, recipientType)}</b><small>{m("recipientUnverified")}</small></>}</dd></div>
            <div><dt>{m("fromCard")}</dt><dd><b>{sourceName}{hasDemoSource && " •••• 4821"}</b><small>{hasDemoSource ? `${m("demoBalance")} · ${money(DEMO_BALANCE, lang)}` : m("balanceUnavailable")}</small></dd></div>
            <div><dt>{m("feeLabel")}</dt><dd><b>{m("feeValue")}</b></dd></div>
            <div><dt>{m("creditTime")}</dt><dd><b>{m("creditValue")}</b></dd></div>
            <div className="confirm-total"><dt>{m("totalLabel")}</dt><dd><b className="tabular-nums">{money(form.amount, lang)}</b></dd></div>
          </dl>
          <p className="confirm-note"><ShieldCheck size={16} aria-hidden="true" />{m("confirmNote")}</p>
          {payeeEnabled && <PayeeCheck key={payeeKey} draftKey={payeeKey} recipient={payeeRef} disabled={busy || submissionPaused || blocked || completed} onVerified={setVerifiedFor}/>}
          {!onCall && <label className="reported-call-request"><input type="checkbox" checked={!!form.context.payment_requested_after_call}
            disabled={busy || blocked || completed || submissionPaused}
            onChange={event => { const checked = event.target.checked; setForm(v => ({ ...v, context: { ...v.context, payment_requested_after_call: checked || undefined } })); }} />
            <span>{t("payment_requested_after_call")}</span></label>}
          {config.demoActionsEnabled && (config.mode === "demo" || config.accountMode === "test") &&
            <MarketOrderCheck key={form.recipient + recipientType} phone={recipientType === "phone" ? form.recipient : ""} disabled={busy || submissionPaused || blocked} onEdit={() => setStep("details")} />}
          {showUnknown && <div className="phone-alert warning" role="status"><AlertTriangle size={18} aria-hidden="true" /><div><strong>{m("unknownTitle")}</strong><p>{m("unknownText")}</p></div></div>}
          {error && !showUnknown && <p className="error" role="alert">{t(error)}</p>}
          <div className="confirm-actions">
            <button type="button" className="secondary family-check-start" disabled={busy || blocked || completed || submissionPaused} onClick={() => setStep("family")}>
              <PhoneCall size={17} aria-hidden="true" />{m("familyStart")}
            </button>
            <button type="button" className="primary transfer-confirm" disabled={busy || submissionPaused || blocked || completed || offline || awaitingPayee} onPointerDown={pressStart} onPointerUp={pressEnd} onPointerCancel={pressEnd} onPointerLeave={pressEnd} onContextMenu={event => event.preventDefault()}
              onClick={() => { const duress = hold.current.fired; hold.current.fired = false; onSubmit(duress); }}>{busy ? <><LoaderCircle className="animate-spin" size={18} />{m("checking")}</> : <><LockKeyhole size={17} />{m("confirmCta")} {money(form.amount, lang)}</>}</button>
            <button type="button" className="secondary transfer-edit" disabled={busy} onClick={() => setStep("details")}>{m("editCta")}</button>
          </div>
        </section>
        : <form className="phone-form" onSubmit={event => { event.preventDefault(); if (!busy && !blocked && !completed) setStep("confirm"); }} onInvalid={event => {
          const target = event.target as HTMLElement;
          if (contextDetails.current && contextDetails.current.contains(target)) contextDetails.current.open = true;
        }}>
          <fieldset disabled={busy || blocked} className="phone-fields">
            <section className="phone-section" aria-labelledby="source-label">
              <p id="source-label" className="field-label">{m("fromCard")}</p>
              {sourceCard}
            </section>
            <section className="phone-section" aria-labelledby="recipient-label">
              <div className="field-heading"><label id="recipient-label" htmlFor="recipient">{m("toWhom")}</label><div className="segmented" role="group" aria-label={t("recipient")}>{(["phone", "card", "iban"] as const).map(type => <button key={type} type="button" aria-pressed={recipientType === type} onClick={() => {
                sensor.reset(); setRecipientType(type); setForm(v => ({ ...v, recipient: "", context: { ...v.context, is_new_recipient: undefined } }));
              }}>{t(type)}</button>)}</div></div>
              {recipientType === "phone" && <div className="contact-list" role="group" aria-label={t("quickContacts")}>
                {contactSlots.map((contact, index) => {
                  const phone = config.presets[contact.key].recipient;
                  const active = !!phone && form.recipient === phone;
                  const displayName = fixtureContactName(config, "phone", phone);
                  const label = displayName?.split(" ")[0] ?? t(contact.fallback);
                  const initials = displayName?.split(" ").map(part => part[0]).join("") ?? String(index + 1);
                  return <button key={contact.key} type="button" className={`contact ${active ? "selected" : ""}`} disabled={busy || !phone} aria-pressed={active} aria-label={`${t("contactHint")}: ${displayName ?? label}`} onClick={() => {
                    sensor.reset(); setRecipientType("phone");
                    setForm(v => ({ ...v, recipient: phone, context: { ...v.context, is_new_recipient: undefined } }));
                  }}><span className={`avatar ${contact.tone}`} aria-hidden="true">{initials}{active && <i><Check size={10} strokeWidth={3} /></i>}</span><span className="contact-name">{label}</span></button>;
                })}
              </div>}
              <div className="recipient-input"><input id="recipient" required value={form.recipient} inputMode={recipientType === "iban" ? "text" : "tel"} autoComplete="off" placeholder={recipientType === "phone" ? "+7 701 000 00 02" : recipientType === "card" ? "4400 0000 0000 0002" : "KZ000000000000000002"} onFocus={e => sensor.focus("recipient", e.target.value.length)} onBlur={() => sensor.blur("recipient")} onPaste={() => sensor.paste("recipient")} onChange={e => { sensor.input("recipient", e); setForm(v => ({ ...v, recipient: e.target.value, context: { ...v.context, is_new_recipient: undefined } })); }} /></div>
              {recipientType === "card" && <p className="input-hint">{t("cardHint")}</p>}
            </section>
            <section className="phone-section amount-section" aria-labelledby="amount-label">
              <label id="amount-label" htmlFor="transfer-amount" className="field-label">{m("howMuch")}</label>
              <div className="amount-input"><input id="transfer-amount" required type="text" inputMode="decimal" autoComplete="off" maxLength={18} aria-describedby="amount-hint" pattern="[0-9\s ]*[1-9][0-9\s ]*([.,][0-9]{1,2})?|[0\s ]*[.,]([1-9][0-9]?|0[1-9])" value={groupAmount(form.amount)} onFocus={e => sensor.focus("amount", e.target.value.length)} onBlur={() => sensor.blur("amount")} onPaste={() => sensor.paste("amount")} onChange={e => { const raw = rawAmount(e.target.value); if (raw === null) return; sensor.input("amount", e); setForm(v => ({ ...v, amount: raw })); }} /><span aria-hidden="true">₸</span></div>
              <div className="amount-pills" role="group" aria-label={t("quickAmounts")}>{[5000, 25000, 100000].map(value => <button key={value} type="button" aria-pressed={numericAmount === value} onClick={() => { sensor.blur("amount"); setForm(v => ({ ...v, amount: String(value) })); }}>{money(value, lang)}</button>)}</div>
              <p id="amount-hint" className={`input-hint${hasDemoSource && numericAmount > DEMO_BALANCE ? " warn" : ""}`}>{m("feeLabel")}: {m("feeValue")}{hasDemoSource && numericAmount > DEMO_BALANCE ? ` · ${m("demoBalance")} · ${money(DEMO_BALANCE, lang)}` : ""}</p>
            </section>
            <details ref={contextDetails} className="demo-context">
              <summary><SlidersHorizontal size={16} aria-hidden="true" /><span>{m("demoContextTitle")}</span>{activeContext > 0 && <em>{activeContext} {m("demoContextActive")}</em>}<ChevronDown size={16} aria-hidden="true" className="chevron" /></summary>
              <div className="demo-context-body">
                {config.mode === "demo" && <p className="context-demo-hint">{m("demoContextHint")}</p>}
                {config.mode === "demo" && <p className="context-demo-hint">{m("duressHint")}</p>}
                {contextKeys.map(key => {
                  const Icon = key === "active_call" ? PhoneCall : key === "from_deposit" ? Landmark : Smartphone;
                  return <button className="toggle-row" type="button" role="switch" aria-checked={form.context[key]} key={key} onClick={() => setForm(v => ({ ...v, context: { ...v.context, [key]: !v.context[key] } }))}><span><Icon size={16} aria-hidden="true" />{t(key)}</span><i className={form.context[key] ? "on" : ""}><b /></i></button>;
                })}
                {config.demoActionsEnabled !== false && <button type="button" className="secondary bank-call-demo" onClick={() => void startBankCall()}><PhoneCall size={16} aria-hidden="true" />{bankCallStarted ? m("bankCallStarted") : m("bankCallDemo")}</button>}
                <label className="field sender-field">{m("demoSender")}<input required value={form.sender} onChange={e => { sensor.reset(); setForm(v => ({ ...v, sender: e.target.value })); }} placeholder="00000000-0000-4000-8000-000000000001" autoComplete="off" spellCheck={false} /></label>
              </div>
            </details>
            {onCall && <section className="call-check" aria-live="polite">
              <div className="call-check-row"><span className="call-check-icon"><PhoneCall size={18} aria-hidden="true" /></span><div><strong>{m("callActive")}</strong><p>{m("callCheckHint")}</p></div></div>
              <button type="button" className="call-check-cta" disabled={callChecking || !form.sender.trim()} onClick={() => void checkBankCall()}>{callChecking ? <LoaderCircle className="animate-spin" size={16} aria-hidden="true" /> : <ShieldCheck size={16} aria-hidden="true" />}{callChecking ? m("callChecking") : callCheck ? m("callRecheck") : m("callCheckCta")}</button>
              {(callCheck || callCheckFailed) && <CallLogResult check={callCheck} />}
            </section>}
            {showUnknown && <div className="phone-alert warning" role="status"><AlertTriangle size={18} aria-hidden="true" /><div><strong>{m("unknownTitle")}</strong><p>{m("unknownText")}</p></div></div>}
            {error && !showUnknown && <p className="error" role="alert">{t(error)}</p>}
            <button className="primary transfer-cta" disabled={busy || blocked || completed}>{busy ? <><LoaderCircle className="animate-spin" size={18} />{m("checking")}</> : blocked ? t("checkPreviousTransfer") : completed ? t("transferCompleted") : m("continueCta")}</button>
          </fieldset>
        </form>}
      </div>
      <nav className="phone-tabbar" aria-label={t("mobile")}>
        {([["home", "tabHome", House], ["transfer", "tabTransfers", ArrowLeftRight], ["circle", "circle", Users], ["scam", "scam", ScanText]] as const).map(([page, label, Icon]) =>
          <button key={page} type="button" className={screen === page ? "active" : ""} aria-current={screen === page ? "page" : undefined}
            disabled={busy} onClick={() => setScreen(page)}><Icon size={18} aria-hidden="true" />{m(label)}</button>)}
      </nav>
      {!bare && <div className="home-indicator" aria-hidden="true" />}
    </section>
    {!bare && <p className="phone-caption">{m("phoneCaption")}</p>}
  </div>;
}
