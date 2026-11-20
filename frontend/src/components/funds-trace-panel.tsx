"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown, Route } from "lucide-react";
import { api, ApiError, type Status } from "@/lib/contracts";
import type { FundsTrace } from "@/lib/funds-trace";
import { errorKey, money, useLocale } from "@/lib/i18n";
import styles from "./funds-trace-panel.module.css";

const copy = {
  ru: {
    title: "Путь средств", open: "Проверить", refresh: "Обновить", loading: "Проверяем журнал переводов…",
    held: "Перевод не исполнен. Для поиска дальнейших переводов выберите исполненное поступление.",
    offline: "Для проверки нужен сервер с журналом исполненных переводов.",
    possible: "Возможное движение средств", none: "За выбранное время дальнейших переводов не найдено.",
    unclear: "Записей недостаточно, чтобы однозначно построить последовательность.",
    method: "Один возможный вариант распределения суммы по более поздним переводам. При смешении средств их происхождение установить нельзя.",
    first: "На первом шаге", original: "Исходная сумма", step: "Шаг", of: "из",
    ambiguous: "Переводы с неоднозначным порядком или распределением", limited: "Достигнут лимит записей. Часть переводов могла не попасть в расчёт.",
    period: "Период проверки", hops: "Максимум шагов", show: "Показать все", hide: "Свернуть список",
    allocation: "Возможная часть суммы", paid: "Сумма перевода", until: "по",
  },
  kk: {
    title: "Қаражаттың қозғалысы", open: "Тексеру", refresh: "Жаңарту", loading: "Аударымдар журналы тексеріліп жатыр…",
    held: "Аударым орындалмады. Кейінгі аударымдарды көру үшін шотқа түскен төлемді таңдаңыз.",
    offline: "Тексеру үшін орындалған аударымдар журналы бар сервер қажет.",
    possible: "Қаражат қозғалысының ықтимал бағыты", none: "Осы кезеңде кейінгі аударымдар табылмады.",
    unclear: "Аударымдардың ретін анықтау үшін дерек жеткіліксіз.",
    method: "Бұл — соманың кейінгі аударымдарға бөлінуінің бір ықтимал нұсқасы. Шоттағы қаражат араласса, оның қайдан түскенін дәл анықтау мүмкін емес.",
    first: "Бірінші қадамда", original: "Бастапқы сома", step: "Қадам", of: "/",
    ambiguous: "Реті немесе соманың бөлінуі белгісіз аударымдар", limited: "Жазбалар саны шегіне жетті. Кейбір аударымдар есепке кірмеуі мүмкін.",
    period: "Тексерілген кезең", hops: "Қадам санының шегі", show: "Барлығын көрсету", hide: "Тізімді ықшамдау",
    allocation: "Соманың ықтимал бөлігі", paid: "Аударым сомасы", until: "—",
  },
};

export function FundsTracePanel({ id, status, initiallyOpen = false }: { id: string; status: Status; initiallyOpen?: boolean }) {
  const { lang, t } = useLocale();
  const c = copy[lang];
  const panel = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(initiallyOpen);
  const [revision, setRevision] = useState(0);
  const [report, setReport] = useState<FundsTrace | null>(null);
  const [failure, setFailure] = useState<Error | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (initiallyOpen) panel.current?.scrollIntoView({ block: "center", behavior: "instant" });
  }, [initiallyOpen]);

  useEffect(() => {
    if (!open || status !== "approved") return;
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 12_000);
    setReport(null); setFailure(null); setShowAll(false);
    void api<FundsTrace>(`soc/transfers/${id}/funds-trace`, { signal: controller.signal })
      .then(value => { if (active) setReport(value); })
      .catch((error: unknown) => { if (active) setFailure(error instanceof Error ? error : new Error()); })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [id, status, open, revision]);

  const time = (value: string) => new Date(value).toLocaleString(lang === "ru" ? "ru-KZ" : "kk-KZ", {
    timeZone: "Asia/Almaty", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  return <section ref={panel} className={styles.panel} data-testid="funds-trace">
    <div className={styles.head}><h3><Route size={18} />{c.title}</h3>
      {status === "approved" && <button type="button" className={styles.button} aria-label={c.title} aria-expanded={open}
        onClick={() => setOpen(value => !value)} data-testid="funds-trace-open">{open ? <ChevronDown size={16} /> : c.open}</button>}
    </div>
    {status !== "approved" && <p>{c.held}</p>}
    {status === "approved" && open && <div className={styles.body} aria-live="polite">
      {failure ? <p role="alert">{failure instanceof ApiError && failure.status === 501 ? c.offline : t(errorKey(failure))}</p>
        : !report ? <p>{c.loading}</p> : <>
          <strong>{report.outcome === "possible_flow" ? c.possible : report.outcome === "no_match" ? c.none : report.outcome === "not_settled" ? c.held : c.unclear}</strong>
          {report.settled_at && <p>{c.period} (UTC+5) · {time(report.settled_at)} {c.until} {time(report.observed_until)} · {c.hops} {report.max_hops}</p>}
          {report.links.length > 0 && <>
            <dl className={styles.totals}><div><dt>{c.first}</dt><dd>{money(report.first_hop_amount, lang)}</dd></div>
              <div><dt>{c.original}</dt><dd>{money(report.amount, lang)}</dd></div></dl>
            <p>{c.method}</p>
            <ol className={styles.links}>{(showAll ? report.links : report.links.slice(0, 6)).map(edge =>
              <li key={edge.transaction_id} data-testid="funds-trace-edge">
                <div><b>{c.step} {edge.first_hop}{edge.last_hop !== edge.first_hop && `–${edge.last_hop}`}</b>
                  <time dateTime={edge.settled_at}>{time(edge.settled_at)}</time></div>
                <div className={styles.accounts}><code title={edge.sender_id}>{edge.sender_id.slice(-8)}</code><ArrowRight size={13} /><code title={edge.recipient_id}>{edge.recipient_id.slice(-8)}</code></div>
                <p><span title={c.allocation}>{money(edge.allocated_amount, lang)}</span> {c.of} <span title={c.paid}>{money(edge.transaction_amount, lang)}</span></p>
              </li>)}</ol>
            {report.links.length > 6 && <button type="button" className={styles.button} onClick={() => setShowAll(value => !value)}>{showAll ? c.hide : `${c.show} (${report.links.length})`}</button>}
          </>}
          {report.ambiguous_count > 0 && <p className={styles.warning}>{c.ambiguous} · {report.ambiguous_count}</p>}
          {report.truncated && <p className={styles.warning}>{c.limited}</p>}
        </>}
      {(failure || report) && <button type="button" className={styles.button} onClick={() => setRevision(value => value + 1)}>{c.refresh}</button>}
    </div>}
  </section>;
}
