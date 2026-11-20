"use client";

import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { money, useLocale } from "@/lib/i18n";
import type { TraceAnchors } from "@/lib/trace-anchors";
import { useSocPoll } from "./use-soc-poll";
import styles from "./trace-anchor-picker.module.css";

export function TraceAnchorPicker({ accountId, onSelect }: { accountId: string; onSelect: (id: string) => void }) {
  const { lang, t } = useLocale();
  const [open, setOpen] = useState(false);
  const anchors = useSocPoll<TraceAnchors>(open ? `soc/accounts/${accountId}/trace-anchors` : null, 0, 60_000);
  const kk = lang === "kk";
  return <details className={styles.picker} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{kk ? "Осы шотқа түскен аударымдар" : "Поступления на этот счёт"}</summary>
    <p>{kk ? "Соңғы 64 операцияның ішінен орындалған аударымды таңдаңыз. Одан кейін қаражат қозғалысын тексере аласыз."
      : "Выберите зачисление среди последних 64 операций по получателю, чтобы проверить дальнейший путь средств."}</p>
    {anchors.error && <p role="alert">{t(anchors.error)}</p>}
    {anchors.loading && !anchors.data && <p role="status">{t("refreshing")}</p>}
    {anchors.data?.items.length === 0 && <p>{kk ? "Орындалған теңгелік түсімдер табылмады." : "Среди этих операций нет исполненных поступлений в тенге."}</p>}
    {anchors.data?.items.map(item => <button type="button" key={item.transaction_id} data-transaction-id={item.transaction_id} onClick={() => onSelect(item.transaction_id)}>
      <time dateTime={item.settled_at}>{new Date(item.settled_at).toLocaleString(kk ? "kk-KZ" : "ru-KZ", {
        timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
      })}</time>
      <strong>{money(item.amount, lang)}</strong><ArrowRight size={15} aria-hidden="true" />
    </button>)}
  </details>;
}
