"use client";

import { useState } from "react";
import { ArrowRight, History } from "lucide-react";
import { money, useLocale } from "@/lib/i18n";
import type { PriorReceipts } from "@/lib/recipient-lookback";
import { useSocPoll } from "./use-soc-poll";

const copy = {
  ru: {
    title: "Кто уже перевёл деньги?", hint: "В списке переводы в тенге, начатые и исполненные до пометки SOC. Откройте операцию, чтобы проверить обстоятельства с клиентом.",
    period: "Период до пометки", day: "24 часа", week: "7 дней", month: "30 дней", sender: "Отправитель",
    empty: "За выбранный период поступлений нет.", open: "Открыть операцию", loading: "Читаем журнал…",
    failed: "Журнал недоступен. Проверьте состояние пометки и повторите запрос.", previous: "Назад", next: "Дальше", page: "Страница",
  },
  kk: {
    title: "Кім ақша аударып үлгерді?", hint: "Тізімде SOC белгісі қойылғанға дейін басталып, орындалған теңгемен аударымдар көрсетілген. Мән-жайды клиентпен нақтылау үшін операцияны ашыңыз.",
    period: "Белгіге дейінгі кезең", day: "24 сағат", week: "7 күн", month: "30 күн", sender: "Жіберуші",
    empty: "Таңдалған кезеңде түсімдер жоқ.", open: "Операцияны ашу", loading: "Журнал оқылып жатыр…",
    failed: "Журнал қолжетімсіз. Белгінің күйін тексеріп, қайта сұраңыз.", previous: "Артқа", next: "Әрі қарай", page: "Бет",
  },
};

export function RecipientLookback({ accountId, version, onSelect }: {
  accountId: string; version: number; onSelect: (transactionId: string) => void;
}) {
  const { lang, t } = useLocale();
  const c = copy[lang];
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(7);
  const [cursors, setCursors] = useState<string[]>([]);
  const [refresh, setRefresh] = useState(0);
  const cursor = cursors.at(-1);
  const path = `soc/recipients/${accountId}/prior-receipts?version=${version}&days=${days}${cursor ? "&cursor=" + cursor : ""}`;
  const result = useSocPoll<PriorReceipts>(open ? path : null, refresh, 60_000);
  const report = result.error ? null : result.data;
  const format = new Intl.DateTimeFormat(lang === "kk" ? "kk-KZ" : "ru-KZ", { timeZone: "Asia/Qyzylorda", dateStyle: "short", timeStyle: "short" });
  return <details className="recipient-lookback" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><History size={16} aria-hidden="true" />{c.title}</summary>
    {open && <>
      <p>{c.hint}</p>
      <label>{c.period} <select value={days} onChange={event => { setDays(Number(event.target.value)); setCursors([]); }}>
        <option value={1}>{c.day}</option><option value={7}>{c.week}</option><option value={30}>{c.month}</option>
      </select></label>
      {result.error && <p role="alert">{c.failed} <button type="button" className="secondary" onClick={() => setRefresh(v => v + 1)}>{t("retryCase")}</button></p>}
      {!result.error && !report && <p role="status">{c.loading}</p>}
      {report && <>
        <p><time dateTime={report.from_time}>{format.format(new Date(report.from_time))}</time> – <time dateTime={report.flagged_at}>{format.format(new Date(report.flagged_at))}</time> · UTC+5</p>
        {!report.items.length && <p>{c.empty}</p>}
        <ul>{report.items.map(receipt => <li key={receipt.transaction_id}>
          <div><strong>{money(receipt.amount, lang)}</strong> · {t(receipt.status)}<br />
            <small>{c.sender} · {receipt.sender_ref} · <time dateTime={receipt.settled_at}>{format.format(new Date(receipt.settled_at))}</time></small></div>
          <button type="button" className="secondary" onClick={() => onSelect(receipt.transaction_id)} aria-label={`${c.open} ${receipt.transaction_id}`}>
            {c.open}<ArrowRight size={14} aria-hidden="true" /></button>
        </li>)}</ul>
        {(cursor || report.next_cursor) && <div className="recipient-lookback-pages">
          <button type="button" className="secondary" disabled={!cursor} onClick={() => setCursors(current => current.slice(0, -1))}>{c.previous}</button>
          <span>{c.page} {cursors.length + 1}</span>
          <button type="button" className="secondary" disabled={!report.next_cursor} onClick={() => { if (report.next_cursor) setCursors([...cursors, report.next_cursor]); }}>{c.next}</button>
        </div>}
      </>}
    </>}
  </details>;
}
