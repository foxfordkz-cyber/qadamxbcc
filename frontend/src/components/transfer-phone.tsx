"use client";

import { useRef, type Dispatch, type SetStateAction } from "react";
import { ArrowLeft, ArrowRight, BatteryFull, Check, ChevronDown, ChevronRight, CreditCard, Landmark, LoaderCircle, LockKeyhole, PhoneCall, ShieldCheck, Signal, Smartphone, Wifi } from "lucide-react";
import type { AppConfig, Preset, PresetForm } from "@/lib/contracts";
import { money, useLocale, type MessageKey } from "@/lib/i18n";

export type RecipientType = "phone" | "card" | "iban";
interface Props {
  config: AppConfig;
  form: PresetForm;
  setForm: Dispatch<SetStateAction<PresetForm>>;
  recipientType: RecipientType;
  setRecipientType: (type: RecipientType) => void;
  busy: boolean;
  error: MessageKey | null;
  onSubmit: () => void;
}

export function TransferPhone({ config, form, setForm, recipientType, setRecipientType, busy, error, onSubmit }: Props) {
  const { lang, t } = useLocale();
  const senderDetails = useRef<HTMLDetailsElement>(null);
  const contacts = [
    { key: "normal", name: config.mode === "demo" ? "Данияр" : t("contactOne"), initials: "ДА", tone: "mint" },
    { key: "scam", name: config.mode === "demo" ? "Алексей" : t("contactTwo"), initials: "АК", tone: "lilac" },
    { key: "hub", name: config.mode === "demo" ? "Марат" : t("contactThree"), initials: "МТ", tone: "peach" },
  ] satisfies { key: Preset; name: string; initials: string; tone: string }[];

  return <div className="phone-stage">
    <div className="phone-caption"><Smartphone size={15} />bcc.kz <span>{t("simulator")}</span></div>
    <section className="phone-frame" aria-label={t("mobile")}>
      <div className="phone-status" aria-hidden="true"><span>9:41</span><i /><div><Signal size={15} /><Wifi size={15} /><BatteryFull size={20} /></div></div>
      <div className="phone-heading"><ArrowLeft size={21} aria-hidden="true" /><h2>{t("transfer")}</h2><ShieldCheck size={22} className="text-bcc" aria-hidden="true" /></div>
      <form className="phone-form" onSubmit={event => {
        event.preventDefault(); onSubmit();
      }} onInvalid={() => { if (senderDetails.current) senderDetails.current.open = true; }}>
        <fieldset disabled={busy} className="phone-fields">
          <div className="source-section"><p className="field-label">{t("sourceCard")}</p>
            <div className="source-card"><div className="source-top"><strong>bcc.kz</strong><span>#картакарта</span></div><div className="source-bottom"><CreditCard size={23} strokeWidth={1.3} /><div><span>•••• 4821</span><small>KZT · ₸</small></div><ShieldCheck size={20} /></div><span className="card-orbit" aria-hidden="true" /></div>
            <details ref={senderDetails} className="sender-details"><summary><span>{t("cardSettings")}</span><ChevronDown size={14} /></summary><label className="field">{t("sender")}<input required value={form.sender} onChange={e => setForm(v => ({ ...v, sender: e.target.value }))} placeholder="00000000-0000-4000-8000-000000000001" autoComplete="off" spellCheck={false} /></label></details>
          </div>
          <section aria-labelledby="quick-contacts-label"><p id="quick-contacts-label" className="field-label">{t("quickContacts")}</p><div className="contact-list">
            {contacts.map(contact => {
              const phone = config.presets[contact.key].recipient;
              const active = recipientType === "phone" && form.recipient === phone;
              return <button key={contact.key} type="button" className={`contact ${active ? "selected" : ""}`} disabled={busy || !phone} aria-pressed={active} aria-label={`${t("contactHint")}: ${contact.name}`} onClick={() => {
                setRecipientType("phone");
                setForm(v => ({ ...v, recipient: phone, context: { ...v.context, is_new_recipient: undefined } }));
              }}><span className={`avatar ${contact.tone}`}>{config.mode === "demo" ? contact.initials : contact.name.slice(-1)}{active && <i><Check size={11} /></i>}</span><span>{contact.name}</span></button>;
            })}
          </div></section>
          <div className="recipient-section"><div className="field-heading"><label htmlFor="recipient">{t("recipient")}</label><div className="segmented">{(["phone", "card", "iban"] as const).map(type => <button key={type} type="button" aria-pressed={recipientType === type} onClick={() => {
            setRecipientType(type); setForm(v => ({ ...v, recipient: "", context: { ...v.context, is_new_recipient: undefined } }));
          }}>{t(type)}</button>)}</div></div>
            <div className="recipient-input"><input id="recipient" required value={form.recipient} inputMode={recipientType === "iban" ? "text" : "tel"} autoComplete="off" placeholder={recipientType === "phone" ? "+7 701 000 00 02" : recipientType === "card" ? "4400 0000 0000 0002" : "KZ000000000000000002"} onChange={e => setForm(v => ({ ...v, recipient: e.target.value, context: { ...v.context, is_new_recipient: undefined } }))} /><ChevronRight size={18} aria-hidden="true" /></div>
            {recipientType === "card" && <p className="muted input-hint">{t("cardHint")}</p>}
          </div>
          <div className="amount-section"><label htmlFor="transfer-amount" className="field-label">{t("transferAmount")}</label><div className="amount-input"><input id="transfer-amount" required type="number" min="0.01" max="1000000000" step="0.01" inputMode="decimal" value={form.amount} onChange={e => setForm(v => ({ ...v, amount: e.target.value }))} /><span aria-hidden="true">₸</span></div><div className="amount-pills" aria-label={t("quickAmounts")}>{[5000, 25000, 100000].map(amount => <button key={amount} type="button" aria-pressed={Number(form.amount) === amount} onClick={() => setForm(v => ({ ...v, amount: String(amount) }))}>{money(amount, lang)}</button>)}</div></div>
          <section className="context-box" aria-labelledby="context-title"><p id="context-title" className="field-label">{t("context")}</p>{(["active_call", "from_deposit", "is_new_device"] as const).map(key => {
            const Icon = key === "active_call" ? PhoneCall : key === "from_deposit" ? Landmark : Smartphone;
            return <button className="toggle-row" type="button" role="switch" aria-checked={form.context[key]} key={key} onClick={() => setForm(v => ({ ...v, context: { ...v.context, [key]: !v.context[key] } }))}><span><Icon size={17} />{t(key)}</span><i className={form.context[key] ? "on" : ""}><b /></i></button>;
          })}</section>
          {error && <p className="error" role="alert">{t(error)}</p>}
          <button className="primary transfer-cta" disabled={busy}>{busy ? <LoaderCircle className="animate-spin" size={18} /> : <LockKeyhole size={17} />}<span>{t(busy ? "evaluating" : "transferCta")}</span><ArrowRight size={18} /></button>
        </fieldset>
        <p className="phone-security"><ShieldCheck size={13} />{t("protected")}</p>
      </form><div className="home-indicator" aria-hidden="true" />
    </section>
  </div>;
}
