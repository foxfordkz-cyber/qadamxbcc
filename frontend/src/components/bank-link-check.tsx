"use client";

import { useState } from "react";
import { inspectBankLink, type BankLinkResult } from "@/lib/bank-link";
import { useLocale } from "@/lib/i18n";

const copy = {
  title: ["Сілтемені тексеру", "Проверить ссылку"],
  label: ["Хабарламадағы сілтеме", "Ссылка из сообщения"],
  privacy: ["Сілтеме осы құрылғыда тексеріледі. Сайт ашылмайды.", "Проверка выполняется на устройстве. Страница по ссылке не открывается."],
  check: ["Доменді тексеру", "Сверить домен"],
  host: ["Сайт мекенжайы", "Адрес сайта"],
  matches: ["Мекенжай bcc.kz доменіне жатады", "Адрес относится к домену bcc.kz"],
  external: ["Сілтеме басқа доменге апарады", "У ссылки другой домен"],
  unusual: ["Мекенжайды мұқият тексеріңіз", "Адрес требует осторожности"],
  invalid: ["Бір веб-мекенжай енгізіңіз. Оны мекенжай жолынан толық көшіріп алуға болады.", "Введите один веб-адрес. Его можно целиком скопировать из адресной строки."],
  matchedAdvice: ["Тексеру тек доменді салыстырады. Күмәнді өтінішті банк қолданбасы арқылы нақтылаңыз.", "Проверен только домен. Если просьба вызывает сомнения, уточните её в приложении банка."],
  caution: ["Егер хабарлама банк атынан келсе, банк қолданбасын өзіңіз ашып тексеріңіз.", "Если сообщение пришло от имени банка, откройте приложение банка самостоятельно."],
} as const;

export function BankLinkCheck() {
  const { lang } = useLocale();
  const t = (key: keyof typeof copy) => copy[key][lang === "kk" ? 0 : 1];
  const [value, setValue] = useState("");
  const [result, setResult] = useState<BankLinkResult | null>(null);
  return <details className="bank-link-check">
    <summary>{t("title")}</summary>
    <form onSubmit={event => {
      event.preventDefault();
      setResult(inspectBankLink(value));
      setValue("");
    }}>
      <label htmlFor="bank-link-input">{t("label")}</label>
      <input id="bank-link-input" type="text" inputMode="url" dir="ltr" maxLength={4096} autoCapitalize="none" autoCorrect="off"
        autoComplete="off" spellCheck={false} value={value} onChange={event => {
          setValue(event.target.value);
          setResult(null);
        }} />
      <p className="muted">{t("privacy")}</p>
      <button type="submit" className="secondary" disabled={!value.trim()}>{t("check")}</button>
    </form>
    {result && <div className="safety-result" data-outcome={result.kind} role="status">
      <strong>{t(result.kind)}</strong>
      {result.kind !== "invalid" && <>
        <p>{t("host")} · <bdi dir="ltr" className="break-all">{result.host}</bdi></p>
        <p>{t(result.kind === "matches" ? "matchedAdvice" : "caution")}</p>
      </>}
    </div>}
  </details>;
}
