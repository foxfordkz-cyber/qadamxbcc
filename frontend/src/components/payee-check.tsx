"use client";

import { useEffect, useState } from "react";
import { BadgeCheck, CircleAlert, Search } from "lucide-react";
import { api } from "@/lib/contracts";
import { useLocale } from "@/lib/i18n";
import type { PayeeInput, PayeeResult } from "@/lib/payee-check";
import "./payee-check.css";

const text = {
  ru: {
    title: "Сверка получателя", directory: "Учебный справочник", edit: "Сверить имя и банк",
    bank: "Банк получателя", other: "Другой банк", name: "Как зовут получателя?", check: "Сверить",
    loading: "Сверяем реквизиты…", pending: "Сверьте изменённые данные.",
    identified: "Получатель найден", match: "Имя совпадает", close: "Имя совпало частично. Сверьте написание.",
    mismatch: "Имя отличается. Проверьте получателя.", unavailable: "Сверка недоступна. Проверьте банк или повторите запрос.",
    outside: "Сверка доступна для трёх учебных контактов.",
  },
  kk: {
    title: "Алушыны тексеру", directory: "Оқу анықтамалығы", edit: "Аты мен банкін тексеру",
    bank: "Алушының банкі", other: "Басқа банк", name: "Алушының аты кім?", check: "Тексеру",
    loading: "Деректемелер тексерілуде…", pending: "Өзгертілген деректерді тексеріңіз.",
    identified: "Алушы табылды", match: "Аты сәйкес келеді", close: "Аты ішінара сәйкес. Жазылуын тексеріңіз.",
    mismatch: "Аты сәйкес емес. Алушыны тексеріңіз.", unavailable: "Тексеру қолжетімсіз. Банкті тексеріңіз немесе қайта көріңіз.",
    outside: "Тексеру үш оқу контактісі үшін қолжетімді.",
  },
};

type Props = {
  recipient: PayeeInput["recipient"] | null; draftKey: string; disabled: boolean;
  onVerified: (key: string | null) => void;
};

export function PayeeCheck({ recipient, draftKey, disabled, onVerified }: Props) {
  const {lang} = useLocale();
  const t = text[lang];
  const [bank, setBank] = useState<PayeeInput["bank"]>("bcc");
  const [name, setName] = useState("");
  const [request, setRequest] = useState<PayeeInput | null>(() => recipient ? {recipient, bank: "bcc", expected_name: ""} : null);
  const [result, setResult] = useState<PayeeResult | null>(null);

  useEffect(() => {
    onVerified(null);
    if (!request) return;
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 11_000);
    let current = true;
    (async () => {
      try {
        const response = await api<PayeeResult>("payee-check", {method: "POST", body: JSON.stringify(request), signal: controller.signal});
        if (response.recipient !== request.recipient || response.bank !== request.bank) throw new Error("scope");
        if (!current) return;
        setResult(response);
        if (["identified", "match", "close"].includes(response.status)) onVerified(draftKey);
      } catch {
        if (current) setResult({recipient: request.recipient, bank: request.bank, source: "synthetic_directory", status: "unavailable", display_name: null});
      } finally { clearTimeout(deadline); }
    })();
    return () => { current = false; clearTimeout(deadline); controller.abort(); onVerified(null); };
  }, [request, draftKey, onVerified]);

  const refresh = (nextBank: PayeeInput["bank"]) => {
    onVerified(null);
    setResult(null);
    if (recipient) setRequest({recipient, bank: nextBank, expected_name: name.trim()});
  };
  const clear = (value: string) => {
    onVerified(null); setName(value); setRequest(null); setResult(null);
  };
  const warning = !recipient || (result && ["close", "mismatch", "unavailable"].includes(result.status));
  const Icon = warning ? CircleAlert : result ? BadgeCheck : Search;
  return <section className="payee-verification" aria-label={t.title}>
    <div className="payee-heading"><Icon size={19} aria-hidden="true"/><strong>{t.title}</strong><small>{t.directory}</small></div>
    <div role="status" data-payee-status={result?.status ?? (request ? "checking" : "unchecked")}>
      {result?.display_name && <b>{result.display_name} · Bank CenterCredit</b>}
      <p>{!recipient ? t.outside : result ? t[result.status] : request ? t.loading : t.pending}</p>
    </div>
    {recipient && <details><summary>{t.edit}</summary>
      <label>{t.bank}<select disabled={disabled} value={bank} onChange={e => {
        const value = e.target.value === "bcc" ? "bcc" : "other"; setBank(value); refresh(value);
      }}><option value="bcc">Bank CenterCredit</option><option value="other">{t.other}</option></select></label>
      <label>{t.name}<input disabled={disabled} autoComplete="off" maxLength={80} value={name} onChange={e => clear(e.target.value)}/></label>
      <button type="button" className="secondary" disabled={disabled || (!!request && !result)} onClick={() => refresh(bank)}>{t.check}</button>
    </details>}
  </section>;
}
