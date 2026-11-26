"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LanguageSwitch } from "@/components/language-switch";
import { LocaleProvider, useLocale } from "@/lib/i18n";
import { walletDestination } from "@/lib/wallet-warmup";

function WalletEntry() {
  const params = useSearchParams();
  const stand = params.get("stand") ?? "wallet";
  const destination = walletDestination(stand);
  const { lang } = useLocale();
  const kk = lang === "kk";
  const [expired, setExpired] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!destination) return;
    if (process.env.NEXT_PUBLIC_BCC_STATIC === "1") {
      window.location.replace(destination);
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = setTimeout(() => { controller.abort(); setExpired(true); }, 90_000);
    async function check() {
      try {
        const response = await fetch("/api/wallet-readiness?stand=" + encodeURIComponent(stand), {
          cache: "no-store", credentials: "omit", signal: controller.signal,
        });
        if (response.ok && (await response.json()).ready === true && !controller.signal.aborted) {
          clearTimeout(timeout);
          window.location.replace(destination!);
          return;
        }
      } catch { /* The finite deadline also covers the first request. */ }
      if (!controller.signal.aborted) timer = setTimeout(check, 4000);
    }
    void check();
    return () => { controller.abort(); clearTimeout(timer); clearTimeout(timeout); };
  }, [stand, destination, attempt]);
  return <main className="shell"><LanguageSwitch /><section aria-live="polite">
    <h1>{!destination ? (kk ? "Стенд табылмады" : "Стенд не найден") : expired ?
      (kk ? "Стенд әзірге жауап бермеді" : "Стенд пока не ответил") :
      (kk ? "Стендке қосылып жатырмыз" : "Подключаемся к стенду")}</h1>
    {destination && !expired && <p>{kk ? "Алғашқы қосылу шамамен бір минут алуы мүмкін. Стенд дайын болғанда автоматты түрде ашылады." :
      "Первый запуск может занять около минуты. Когда стенд будет готов, он откроется автоматически."}</p>}
    {destination && expired && <button type="button" onClick={() => { setExpired(false); setAttempt(n => n + 1); }}>
      {kk ? "Қайта тексеру" : "Проверить ещё раз"}</button>}
    {destination && <p><a href={destination}>{stand === "wallet"
      ? (kk ? "Әмиянды тікелей ашу" : "Открыть кошелёк напрямую")
      : (kk ? "Стендті тікелей ашу" : "Открыть стенд напрямую")}</a></p>}
    <p><Link href="/mobile">{kk ? "Аударым симуляторын ашу" : "Открыть симулятор перевода"}</Link></p>
  </section></main>;
}

export default function ConnectPage() {
  return <LocaleProvider><Suspense><WalletEntry /></Suspense></LocaleProvider>;
}
