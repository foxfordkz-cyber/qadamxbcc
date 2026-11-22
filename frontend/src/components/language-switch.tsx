"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";

export function LanguageSwitch() {
  const { lang, setLang, t } = useLocale();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  return <div className="language" role="group" aria-label={t("language")} aria-busy={!ready}>
    {(["kk", "ru"] as const).map(locale => <button key={locale} type="button" disabled={!ready}
      aria-pressed={lang === locale} onClick={() => setLang(locale)}>
      {locale === "kk" ? "ҚАЗ" : "РУС"}
    </button>)}
  </div>;
}
