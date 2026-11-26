"use client";

import { Suspense, useEffect, useState } from "react";
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
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = setTimeout(() => { controller.abort(); setExpired(true); }, 60_000);
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
      (kk ? "Сервер іске қосылуда" : "Сервер просыпается")}</h1>
    {destination && !expired && <p>{kk ? "Әдетте 20–40 секунд қажет. Әмиян дайын болғанда өзі ашылады." :
      "Обычно это занимает 20–40 секунд. Кошелёк откроется, когда сервер будет готов."}</p>}
    {destination && expired && <button type="button" onClick={() => { setExpired(false); setAttempt(n => n + 1); }}>
      {kk ? "Қайта тексеру" : "Проверить ещё раз"}</button>}
    <p><a href="/mobile">{kk ? "Аударым симуляторын ашу" : "Открыть симулятор перевода"}</a></p>
  </section></main>;
}

export default function ConnectPage() {
  return <LocaleProvider><Suspense><WalletEntry /></Suspense></LocaleProvider>;
}
