"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Activity, Network, RefreshCw } from "lucide-react";
import { api, type Feed, type Graph, type Status } from "@/lib/contracts";
import { errorKey, money, useLocale, type MessageKey } from "@/lib/i18n";
import { Badge, Explain, Gauge } from "./risk";

const NetworkGraph = dynamic(() => import("./network-graph"), { ssr: false });
function usePoll<T>(path: string | null, revision: number, interval: number) {
  const [data, setData] = useState<{ path: string; value: T } | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!path) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    setError(null);
    const poll = async () => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      setLoading(true);
      try {
        const value = await api<T>(path, { signal: controller.signal });
        if (!disposed) { setData({ path, value }); setError(null); }
      } catch (e) { if (!disposed) setError(errorKey(e)); }
      finally {
        clearTimeout(timeout);
        if (!disposed) { setLoading(false); timer = setTimeout(() => void poll(), interval); }
      }
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); };
  }, [path, revision, interval]);
  return { data: data?.path === path ? data.value : null, error, loading };
}
export function SocDashboard({ initialSelection, revision }: { initialSelection: string | null; revision: number }) {
  const { lang, t } = useLocale();
  const [refresh, setRefresh] = useState(0);
  const [selection, setSelection] = useState(initialSelection);
  const [filter, setFilter] = useState<Status | "all">("all");
  const feed = usePoll<Feed>("soc/feed?limit=50", revision + refresh, 3000);
  useEffect(() => { setSelection(initialSelection); setFilter("all"); }, [initialSelection]);
  const items = feed.data?.items ?? [];
  const selected = items.find(i => i.transaction_id === selection) ?? items[0];
  const graph = usePoll<Graph>(selected ? `soc/graph/${selected.recipient.id}` : null, revision + refresh, 6000);
  const visible = items.filter(i => filter === "all" || i.status === filter);
  const stats = feed.data?.stats;
  return <div className="space-y-6">
    <div className="section-heading"><div><p className="eyebrow">BCC SHIELD / SOC</p><h1>{t("socTitle")}</h1><p className="muted">{t("socIntro")}</p></div><button className="secondary" onClick={() => setRefresh(n => n + 1)} disabled={feed.loading}><RefreshCw size={16} className={feed.loading ? "animate-spin" : ""} />{t("refresh")}</button></div>
    <div className="stats-grid">{(["total", "approved", "cooling_off", "blocked"] as const).map(key => <div className={`stat ${key}`} key={key}><span>{t(key)}</span><strong>{stats?.[key] ?? "—"}</strong><Activity size={20} /></div>)}</div>
    <section className="panel overflow-hidden"><div className="panel-heading"><h2><Activity size={18} />{t("feed")}</h2><span className="muted text-xs"><span className={`live-dot ${feed.error ? "offline" : ""}`} />{t(feed.loading ? "refreshing" : "connected")}</span></div>
      {feed.error && <p role="alert" className="error mx-5">{t(feed.error)}</p>}
      <div className="filter-row">{(["all", "approved", "cooling_off", "blocked"] as const).map(key => <button key={key} className={filter === key ? "active" : ""} aria-pressed={filter === key} onClick={() => setFilter(key)}>{t(key)}</button>)}</div>
      <div className="overflow-x-auto"><table><thead><tr><th>{t("time")}</th><th>{t("route")}</th><th>{t("amount")}</th><th>{t("risk")}</th><th>{t("status")}</th><th>{t("latency")}</th></tr></thead><tbody>
        {visible.map(item => <tr key={item.transaction_id} className={selected?.transaction_id === item.transaction_id ? "selected" : ""}><td>{new Date(item.created_at).toLocaleTimeString(lang === "kk" ? "kk-KZ" : "ru-KZ", { timeZone: "Asia/Qyzylorda", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td><td><button className="row-select" onClick={() => setSelection(item.transaction_id)} aria-pressed={selected?.transaction_id === item.transaction_id}><strong>{item.sender.full_name} <span>→</span> {item.recipient.full_name}</strong><small>•••• {item.recipient.iban.slice(-4)}</small></button></td><td className="whitespace-nowrap font-semibold">{money(item.amount, lang)}</td><td><Gauge compact score={item.risk_score} /></td><td><Badge status={item.status} /></td><td>{item.latency_ms.toFixed(2)} {t("ms")}</td></tr>)}
      </tbody></table></div>{!visible.length && <p className="empty">{t(feed.loading ? "refreshing" : "empty")}</p>}
    </section>
    <div className="soc-bottom"><section className="panel overflow-hidden"><div className="panel-heading"><div><h2><Network size={18} />{t("graph")}</h2><p className="muted mt-2 text-xs">{t("graphHint")}</p></div></div>{graph.error && <p role="alert" className="error mx-5">{t(graph.error)}</p>}{graph.data ? <NetworkGraph graph={graph.data} /> : <p className="empty">{t(selected ? "refreshing" : "select")}</p>}</section>
      <section className="panel p-6">{selected ? <><div className="flex items-center justify-between"><h2>{t("decision")}</h2><Badge status={selected.status} /></div><Gauge score={selected.risk_score} /><Explain kk={selected.reasons.map(r => r.reason_kk)} ru={selected.reasons.map(r => r.reason_ru)} /></> : <p className="empty">{t("select")}</p>}</section>
    </div>
  </div>;
}
