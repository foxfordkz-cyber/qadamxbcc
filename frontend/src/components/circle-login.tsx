"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { LockKeyhole, Send } from "lucide-react";
import { api, ApiError } from "@/lib/contracts";
import { useLocale } from "@/lib/i18n";

const labels = {
  kk: {
    title: "Сенімді адамдарға жеке кіру", help: "Тестке тіркелген болсаңыз, ботқа жеке чатта /connect жіберіңіз. Бір реттік код 3 минут жарамды.",
    open: "Telegram-ботты ашу", code: "Бот берген код", enter: "Жеке тізімді ашу", exit: "Жеке тізімнен шығу",
    invalid: "Код жарамсыз немесе мерзімі өтті. Боттан жаңа код алыңыз.", wait: "Сұраулар тым көп. Біраздан кейін қайталаңыз.",
    error: "Сервермен байланыс орнатылмады. Қайталап көріңіз.",
    checking: "Қауіпсіз кіру қызметі тексерілуде…", ready: "Кодпен кіру қолжетімді", retry: "Байланысты тексеру",
  },
  ru: {
    title: "Личный доступ к доверенным людям", help: "Если вы участник теста, отправьте /connect боту в личном чате. Одноразовый код действует 3 минуты.",
    open: "Открыть Telegram-бота", code: "Код из бота", enter: "Открыть мой список", exit: "Выйти из личного списка",
    invalid: "Код неверен или истёк. Получите новый код у бота.", wait: "Слишком много запросов. Повторите чуть позже.",
    error: "Не удалось связаться с сервером. Попробуйте ещё раз.",
    checking: "Проверяем сервис входа…", ready: "Вход по коду доступен", retry: "Проверить связь",
  },
};
export const isCircleGuest = (error: unknown) => error instanceof ApiError && error.code === "circle_login_required";
export const circleLogoutLabel = (lang: keyof typeof labels) => labels[lang].exit;
export function CircleLogin({ onUnlocked }: { onUnlocked: () => void }) {
  const { lang } = useLocale();
  const t = labels[lang];
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"invalid" | "wait" | "error" | null>(null);
  const pending = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"checking" | "ready" | "error">("checking");
  useEffect(() => {
    let active = true;
    setStatus("checking");
    void api("trusted-circle/session").then(() => { if (active) setStatus("ready"); })
      .catch(() => { if (active) setStatus("error"); });
    return () => { active = false; };
  }, [attempt]);
  async function enter(event: FormEvent) {
    event.preventDefault();
    if (pending.current || !/^[0-9A-F]{16}$/.test(code)) return;
    pending.current = true; setBusy(true); setError(null);
    try {
      await api("trusted-circle/session", { method: "POST", body: JSON.stringify({ code }) });
      setCode(""); onUnlocked();
    } catch (failure) {
      setError(failure instanceof ApiError && failure.code === "invalid_or_expired_code" ? "invalid"
        : failure instanceof ApiError && failure.status === 429 ? "wait" : "error");
    } finally { pending.current = false; setBusy(false); }
  }
  return <section className="trusted-circle grid gap-3">
    <h3><LockKeyhole size={17} aria-hidden="true" />{t.title}</h3><p>{t.help}</p>
    <p role="status">{t[status]} {status === "error" && <button type="button" className="secondary" onClick={() => setAttempt(n => n + 1)}>{t.retry}</button>}</p>
    <p><a className="secondary" href="https://t.me/bekzat_bcc_shield_test_bot" target="_blank" rel="noopener noreferrer"><Send size={16} aria-hidden="true" /> {t.open}</a></p>
    <form className="grid gap-3" onSubmit={enter}>
      <label className="grid gap-1 text-sm font-medium">{t.code}<input type="password" dir="ltr" autoComplete="one-time-code" spellCheck={false}
        className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-mono tracking-widest focus:outline-emerald-700"
        aria-invalid={error === "invalid"}
        maxLength={20} disabled={busy} value={code} onChange={e => setCode(e.target.value.replace(/[\s-]/g, "").toUpperCase())} /></label>
      <button className="primary" type="submit" disabled={busy || !/^[0-9A-F]{16}$/.test(code)}>{t.enter}</button>
    </form>
    {error && <p className="error" role="alert">{t[error]}</p>}
  </section>;
}
