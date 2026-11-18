"use client";

import { useRef, type Dispatch, type SetStateAction } from "react";
import { ArrowLeft, ArrowLeftRight, ArrowRight, BatteryFull, Check, ChevronDown, ChevronRight, Clock3, CreditCard, History, House, Landmark, LoaderCircle, LockKeyhole, Menu, PhoneCall, ReceiptText, ShieldCheck, ShieldX, Signal, Smartphone, Wifi, XCircle } from "lucide-react";
import type { AppConfig, Evaluation, Preset, PresetForm } from "@/lib/contracts";
import { money, useLocale, type MessageKey } from "@/lib/i18n";
import { mobileText } from "@/lib/mobile-copy";
import { groupAmount, rawAmount } from "@/lib/amount";
import { Badge } from "./risk";
import type { Biometrics } from "./use-biometrics";
import "./mobile-client.css";

export type RecipientType = "phone" | "card" | "iban";
interface Props {
  config: AppConfig;
  form: PresetForm;
  setForm: Dispatch<SetStateAction<PresetForm>>;
  recipientType: RecipientType;
  setRecipientType: (type: RecipientType) => void;
  busy: boolean;
  blocked?: boolean;
  completed?: boolean;
  error: MessageKey | null;
  onSubmit: () => void;
  sensor: Biometrics;
  result: Evaluation | null;
  amount: string;
  onReview: () => void;
  onNewTransfer: () => void;
}

export function TransferPhone({ config, form, setForm, recipientType, setRecipientType, busy, blocked = false, completed = false, error, onSubmit, sensor, result, amount, onReview, onNewTransfer }: Props) {
  const { lang, t } = useLocale();
  const m = (key: Parameters<typeof mobileText>[1]) => mobileText(lang, key);
  const senderDetails = useRef<HTMLDetailsElement>(null);
  const receipt = result && !blocked ? result : null;
  const ReceiptIcon = receipt?.status === "approved" ? Check : receipt?.status === "cooling_off" ? Clock3 : receipt?.status === "cancelled" ? XCircle : ShieldX;
  const receiptCopy = receipt?.status === "approved" ? "receiptApproved" : receipt?.status === "cooling_off" ? "receiptHeld" : receipt?.status === "cancelled" ? "receiptCancelled" : "receiptBlocked";
  const contacts = [
    { key: "normal", name: config.mode === "demo" ? "Данияр" : t("contactOne"), initials: "ДА", tone: "mint" },
    { key: "scam", name: config.mode === "demo" ? "Алексей" : t("contactTwo"), initials: "АК", tone: "lilac" },
    { key: "hub", name: config.mode === "demo" ? "Марат" : t("contactThree"), initials: "МТ", tone: "peach" },
  ] satisfies { key: Preset; name: string; initials: string; tone: string }[];

  return <div className="phone-stage">
    <div className="phone-caption"><Smartphone size={15} />bcc.kz <span>{t("simulator")}</span></div>
    <section className="phone-frame" aria-label={t("mobile")}>
      <div className="phone-appbar">
        <div className="phone-status" aria-hidden="true"><span>9:41</span><i /><div><Signal size={15} /><Wifi size={15} /><BatteryFull size={20} /></div></div>
        <div className="phone-heading"><span className="appbar-icon" aria-hidden="true"><ArrowLeft size={19} /></span><h2>{receipt ? m("receiptTitle") : t("transfer")}</h2><span className="appbar-icon" aria-hidden="true"><ShieldCheck size={19} /></span></div>
        <p className="appbar-note"><ShieldCheck size={13} aria-hidden="true" />{t("protected")}</p>
      </div>
      <div className="phone-sheet">
      {receipt ? <section className={`phone-receipt receipt-${receipt.status}`} data-transaction-id={receipt.transaction_id} aria-labelledby="phone-receipt-title">
        <div className="receipt-symbol" aria-hidden="true"><ReceiptIcon size={36} strokeWidth={1.6} /></div>
        <Badge status={receipt.status} />
        <h3 id="phone-receipt-title">{lang === "kk" ? receipt.headline_kk : receipt.headline_ru}</h3>
        <strong className="receipt-amount">{money(receipt.amount ?? amount, lang)}</strong>
        <p className="receipt-recipient">{receipt.recipient.display_name}<span>{receipt.recipient.iban_masked}</span></p>
        <p className="receipt-explanation" role="status">{m(receiptCopy)}</p>
        <dl className="receipt-reference"><dt>{m("receiptId")}</dt><dd>{receipt.transaction_id}</dd></dl>
        {error && <p className="error" role="alert">{t(error)}</p>}
        {receipt.status === "cooling_off" && <button type="button" className="primary receipt-review" disabled={busy} onClick={onReview}>{busy ? <LoaderCircle className="animate-spin" size={17} /> : <ShieldCheck size={17} />}{t("review")}<ArrowRight size={16} /></button>}
        <button type="button" className={receipt.status === "cooling_off" ? "secondary receipt-new" : "primary receipt-new"} disabled={busy} onClick={onNewTransfer}>{m("receiptNext")}<ArrowRight size={16} /></button>
        <p className="receipt-disclaimer">{m("receiptHint")}</p>
      </section> : <form className="phone-form" onSubmit={event => {
        event.preventDefault(); onSubmit();
      }} onInvalid={() => { if (senderDetails.current) senderDetails.current.open = true; }}>
        <fieldset disabled={busy || blocked} className="phone-fields">
          <div className="source-section"><p className="field-label">{t("sourceCard")}</p>
            <div className="source-card"><div className="source-top"><strong>bcc.kz</strong><span>#картакарта</span></div><div className="source-bottom"><CreditCard size={23} strokeWidth={1.3} /><div><span>•••• 4821</span><small>KZT · ₸</small></div><ShieldCheck size={20} /></div><span className="card-orbit" aria-hidden="true" /></div>
            <details ref={senderDetails} className="sender-details"><summary><span>{t("cardSettings")}</span><ChevronDown size={14} /></summary><label className="field">{t("sender")}<input required value={form.sender} onChange={e => { sensor.reset(); setForm(v => ({ ...v, sender: e.target.value })); }} placeholder="00000000-0000-4000-8000-000000000001" autoComplete="off" spellCheck={false} /></label></details>
          </div>
          <section aria-labelledby="quick-contacts-label"><p id="quick-contacts-label" className="field-label">{t("quickContacts")}</p><div className="contact-list">
            {contacts.map(contact => {
              const phone = config.presets[contact.key].recipient;
              const active = recipientType === "phone" && form.recipient === phone;
              return <button key={contact.key} type="button" className={`contact ${active ? "selected" : ""}`} disabled={busy || !phone} aria-pressed={active} aria-label={`${t("contactHint")}: ${contact.name}`} onClick={() => {
                sensor.reset(); setRecipientType("phone");
                setForm(v => ({ ...v, recipient: phone, context: { ...v.context, is_new_recipient: undefined } }));
              }}><span className={`avatar ${contact.tone}`}>{config.mode === "demo" ? contact.initials : contact.name.slice(-1)}{active && <i><Check size={11} /></i>}</span><span>{contact.name}</span></button>;
            })}
          </div></section>
          <div className="recipient-section"><div className="field-heading"><label htmlFor="recipient">{t("recipient")}</label><div className="segmented">{(["phone", "card", "iban"] as const).map(type => <button key={type} type="button" aria-pressed={recipientType === type} onClick={() => {
            sensor.reset(); setRecipientType(type); setForm(v => ({ ...v, recipient: "", context: { ...v.context, is_new_recipient: undefined } }));
          }}>{t(type)}</button>)}</div></div>
            <div className="recipient-input"><input id="recipient" required value={form.recipient} inputMode={recipientType === "iban" ? "text" : "tel"} autoComplete="off" placeholder={recipientType === "phone" ? "+7 701 000 00 02" : recipientType === "card" ? "4400 0000 0000 0002" : "KZ000000000000000002"} onFocus={e => sensor.focus("recipient", e.target.value.length)} onBlur={() => sensor.blur("recipient")} onPaste={() => sensor.paste("recipient")} onChange={e => { sensor.input("recipient", e); setForm(v => ({ ...v, recipient: e.target.value, context: { ...v.context, is_new_recipient: undefined } })); }} /><ChevronRight size={18} aria-hidden="true" /></div>
            {recipientType === "card" && <p className="muted input-hint">{t("cardHint")}</p>}
          </div>
          <div className="amount-section"><label htmlFor="transfer-amount" className="field-label">{t("transferAmount")}</label><div className="amount-input"><input id="transfer-amount" required type="text" inputMode="decimal" autoComplete="off" maxLength={18} pattern="[0-9\s\u00a0]*[1-9][0-9\s\u00a0]*([.,][0-9]{1,2})?|[0\s\u00a0]*[.,]([1-9][0-9]?|0[1-9])" value={groupAmount(form.amount)} onFocus={e => sensor.focus("amount", e.target.value.length)} onBlur={() => sensor.blur("amount")} onPaste={() => sensor.paste("amount")} onChange={e => { const raw = rawAmount(e.target.value); if (raw === null) return; sensor.input("amount", e); setForm(v => ({ ...v, amount: raw })); }} /><span aria-hidden="true">₸</span></div><div className="amount-pills" aria-label={t("quickAmounts")}>{[5000, 25000, 100000].map(amount => <button key={amount} type="button" aria-pressed={Number(form.amount) === amount} onClick={() => { sensor.blur("amount"); setForm(v => ({ ...v, amount: String(amount) })); }}>{money(amount, lang)}</button>)}</div></div>
          <section className="context-box" aria-labelledby="context-title"><p id="context-title" className="field-label">{t("context")}</p>{config.mode === "demo" && <p className="context-demo-hint">{m("demoContextHint")}</p>}{(["active_call", "from_deposit", "is_new_device"] as const).map(key => {
            const Icon = key === "active_call" ? PhoneCall : key === "from_deposit" ? Landmark : Smartphone;
            return <button className="toggle-row" type="button" role="switch" aria-checked={form.context[key]} key={key} onClick={() => setForm(v => ({ ...v, context: { ...v.context, [key]: !v.context[key] } }))}><span><Icon size={17} />{t(key)}</span><i className={form.context[key] ? "on" : ""}><b /></i></button>;
          })}</section>
          {error && <p className="error" role="alert">{t(error)}</p>}
          <button className="primary transfer-cta" disabled={busy || blocked || completed}>{busy ? <LoaderCircle className="animate-spin" size={18} /> : <LockKeyhole size={17} />}<span>{t(busy ? "evaluating" : blocked ? "checkPreviousTransfer" : completed ? "transferCompleted" : "transferCta")}</span><ArrowRight size={18} /></button>
        </fieldset>
      </form>}</div>
      <nav className="phone-tabbar" aria-hidden="true">{([["tabHome", House], ["tabPayments", ReceiptText], ["tabTransfers", ArrowLeftRight], ["tabHistory", History], ["tabMore", Menu]] as const).map(([key, Icon]) => <span key={key} className={key === "tabTransfers" ? "active" : ""}><Icon size={20} strokeWidth={key === "tabTransfers" ? 2.2 : 1.7} />{m(key)}</span>)}</nav>
      <div className="home-indicator" aria-hidden="true" />
    </section>
  </div>;
}
