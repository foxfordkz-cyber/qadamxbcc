"use client";

import { useState } from "react";
import type { RecoveryRecord } from "@/lib/recovery";
import { unresolved } from "@/lib/recovery";
import { useLocale } from "@/lib/i18n";

export function RecoveryPanel({ records, busy, refreshing, persisted, onReview, onAbandon, onRefresh }: { records: RecoveryRecord[]; busy: boolean; refreshing: boolean; persisted: boolean; onReview: (id: string) => void; onAbandon: (id: string) => void; onRefresh: () => void }) {
  const { t } = useLocale();
  const [showHistory, setShowHistory] = useState(false);
  const [page, setPage] = useState(0);
  const visible = records.filter(record => showHistory || unresolved(record));
  const pageCount = Math.max(1, Math.ceil(visible.length / 5));
  const currentPage = Math.min(page, pageCount - 1);
  if (!records.length && persisted) return null;
  return <section className="pending-panel" aria-label={t("recoveryCenter")}>
    <div><strong>{t("recoveryCenter")} · {records.filter(unresolved).length}</strong><p className="muted">{t("recoveryHint")}</p>{!persisted && <p className="error" role="status">{t("recoveryStorageUnavailable")}</p>}</div>
    <div className="recovery-toolbar"><button className="secondary" disabled={busy || refreshing} onClick={onRefresh}>{t("refresh")}</button><button className="secondary" aria-pressed={showHistory} onClick={() => { setShowHistory(value => !value); setPage(0); }}>{t(showHistory ? "pendingTransfers" : "recentReceipts")}</button></div>
    <ul className="recovery-list">{visible.slice(currentPage * 5, (currentPage + 1) * 5).map(record => <li key={record.id}>
      <div><strong>{record.state === "unknown" ? t("outcomeUnconfirmed") : record.state === "abandoned" ? t("attemptAbandoned") : t(record.status ?? "cooling_off")}</strong><small>•••• {record.id.slice(-8)}</small></div>
      <div className="flex flex-wrap gap-2">{record.state !== "abandoned" && <button className="secondary" disabled={busy} onClick={() => onReview(record.id)}>{t("recoverTransfer")}</button>}{record.state === "unknown" && <button className="danger-button" disabled={busy} onClick={() => onAbandon(record.id)}>{t("abandonAttempt")}</button>}</div>
    </li>)}</ul>
    {pageCount > 1 && <nav className="recovery-toolbar" aria-label={t("recoveryPages")}><button className="secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t("previousPage")}</button><span aria-live="polite">{currentPage + 1} / {pageCount}</span><button className="secondary" disabled={currentPage + 1 === pageCount} onClick={() => setPage(currentPage + 1)}>{t("nextPage")}</button></nav>}
  </section>;
}
