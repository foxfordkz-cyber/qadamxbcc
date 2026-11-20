"use client";

import { useEffect, useRef, useState } from "react";
import { ContactRound, PhoneCall } from "lucide-react";
import { pickCallbackNumbers, type PhoneContactPicker } from "@/lib/family-callback";
import { useLocale } from "@/lib/i18n";
import { mobileText } from "@/lib/mobile-copy";

interface Props {
  amount: string;
  recipient: string;
  onDiscard: () => void;
  onReturn: () => void;
}

export function FamilyCallback({ amount, recipient, onDiscard, onReturn }: Props) {
  const { lang } = useLocale();
  const m = (key: Parameters<typeof mobileText>[1]) => mobileText(lang, key);
  const heading = useRef<HTMLHeadingElement>(null);
  const [numbers, setNumbers] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [usePhoneBook, setUsePhoneBook] = useState(false);
  const picker = typeof window !== "undefined" && window.isSecureContext && window.top === window.self
    ? (navigator as Navigator & { contacts?: PhoneContactPicker }).contacts : undefined;
  useEffect(() => { heading.current?.focus(); }, []);

  async function choose() {
    if (!picker || picking) return;
    setPicking(true);
    setUsePhoneBook(false);
    setNumbers([]);
    try {
      const selected = await pickCallbackNumbers(picker);
      setNumbers(selected);
      setUsePhoneBook(!selected.length);
    } catch {
      setUsePhoneBook(true);
    } finally {
      setPicking(false);
    }
  }

  return <section className="phone-section family-callback" aria-labelledby="callback-heading">
    <h3 id="callback-heading" ref={heading} tabIndex={-1}>{m("familyCallbackTitle")}</h3>
    <p>{m("familyCallbackInstruction")}</p>
    <dl className="family-payment">
      <div><dt>{m("howMuch")}</dt><dd>{amount}</dd></div>
      <div><dt>{m("recipientName")}</dt><dd>{recipient}</dd></div>
    </dl>
    {picker && <button type="button" className="secondary" disabled={picking} onClick={() => void choose()}>
      <ContactRound size={17} aria-hidden="true" />{m("familyPickContact")}
    </button>}
    {numbers.map(number => <a key={number} className="secondary family-dial" href={`tel:${number}`}>
      <PhoneCall size={17} aria-hidden="true" />{m("familyDial")} · •••• {number.slice(-4)}
    </a>)}
    {(!picker || usePhoneBook) && <p className="family-manual" role="status">{m("familyManual")}</p>}
    <button type="button" className="primary family-discard" onClick={onDiscard}>{m("familyDiscard")}</button>
    <button type="button" className="secondary family-return" onClick={onReturn}>{m("familyReturn")}</button>
  </section>;
}
