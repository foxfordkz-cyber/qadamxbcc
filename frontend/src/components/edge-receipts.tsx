"use client";

import { ArrowRight } from "lucide-react";
import type { Graph } from "@/lib/contracts";
import type { EdgeReceipts } from "@/lib/edge-receipts";
import { money, useLocale } from "@/lib/i18n";
import { useSocPoll } from "./use-soc-poll";
import styles from "./edge-receipts.module.css";

export function EdgeReceiptPicker({ graph, anchor, edgeId, onEdge, onReceipt }: {
  graph: Graph; anchor: string; edgeId: string; onEdge: (id: string) => void; onReceipt: (id: string) => void;
}) {
  const { lang, t } = useLocale();
  const kk = lang === "kk";
  const links = graph.edges.filter(link => link.source === graph.center || link.target === graph.center);
  const active = links.find(link => link.id === edgeId);
  const path = active?.data.edge_type === "transfer"
    ? `soc/transfers/${anchor}/edge-receipts?source=${active.source}&target=${active.target}` : null;
  const result = useSocPoll<EdgeReceipts>(path, 0, 60_000);
  const names = new Map(graph.nodes.map(node => [node.id, node.data.label]));
  const formatTime = (at: string) => new Intl.DateTimeFormat(kk ? "kk-KZ" : "ru-KZ", {
    timeZone: "Asia/Almaty", dateStyle: "short", timeStyle: "short",
  }).format(new Date(at));
  if (!links.length) return null;
  return <section className={styles.evidence} aria-label={kk ? "Байланыстың негізі" : "Основание связи"}>
    <label>{kk ? "Алушымен қалай байланысты?" : "Чем подтверждается связь с получателем?"}
      <select value={active?.id ?? ""} onChange={event => onEdge(event.target.value)}>
        <option value="">{kk ? "Графтан немесе тізімнен байланысты таңдаңыз" : "Выберите связь на графе или в списке"}</option>
        {links.map(link => <option key={link.id} value={link.id}>{names.get(link.source)} → {names.get(link.target)}
          {link.data.edge_type === "shared_device" ? ` · ${t("shared")}` : ""}</option>)}
      </select>
    </label>
    {active?.data.edge_type === "shared_device" && <p>{kk ? "Екі шотта бір құрылғы тіркелген. Бұл байланыс ақша қозғалысын көрсетпейді."
      : "У счетов общее устройство. Эта связь сама по себе не подтверждает движение денег."}</p>}
    {result.error && <p role="alert">{t(result.error)}</p>}
    {result.loading && !result.data && <p role="status">{t("refreshing")}</p>}
    {result.data && <><p>{kk ? "Шешім қабылданғанға дейінгі 24 сағатта орындалған аударымдар" : "Исполненные переводы за 24 часа до решения"}
      {" · "}{formatTime(result.data.before_time)} (UTC+5)</p>
      {!result.data.items.length && <p>{kk ? "Осы уақытта осы бағытта орындалған теңгелік аударым табылмады." : "За это время в выбранном направлении зачислений в тенге нет."}</p>}
      {result.data.items.map(row => <button key={row.transaction_id} type="button" onClick={() => onReceipt(row.transaction_id)}>
        <time dateTime={row.settled_at}>{formatTime(row.settled_at)}</time><strong>{money(row.amount, lang)}</strong>
        <span>#{row.transaction_id.slice(-8)}</span><ArrowRight size={16} aria-hidden="true" />
      </button>)}
      {result.data.has_more && <p>{kk ? "Соңғы 12 аударым көрсетілді." : "Показаны последние 12 переводов."}</p>}
    </>}
  </section>;
}
