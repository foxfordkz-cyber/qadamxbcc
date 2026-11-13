"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Activity, CheckCheck, Clock3, Network, Play, RefreshCw, ShieldCheck, ShieldX, Square } from "lucide-react";
import { api, type AppConfig, type Evaluation, type Feed, type FeedItem, type Graph, type Status } from "@/lib/contracts";
import { preventedLoss, trafficScenario, type TrafficRecord } from "@/lib/traffic";
import { MLInspector } from "./ml-inspector";
import { errorKey, money, useLocale, type MessageKey } from "@/lib/i18n";
import { Badge, Explain, Gauge } from "./risk";
import { countBlockedHubs } from "@/lib/feed-summary";

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
export function SocDashboard({ initialSelection, revision, config, evaluations, traffic, onTraffic, onTrafficSync }: { initialSelection: string | null; revision: number; config: AppConfig; evaluations: Record<string, Evaluation>; traffic: Record<string, TrafficRecord>; onTraffic: (record: TrafficRecord) => void; onTrafficSync: (items: FeedItem[]) => void }) {
  const { lang, t } = useLocale();
  const [refresh, setRefresh] = useState(0);
  const [selection, setSelection] = useState(initialSelection);
  const [filter, setFilter] = useState<Status | "all">("all");
  const [streaming, setStreaming] = useState(false);
  const [streamError, setStreamError] = useState<MessageKey | null>(null);
  const attempts = useRef(Object.keys(traffic).length);
  const sequence = useRef(Object.keys(traffic).length);
  useEffect(() => {
    if (!streaming) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    async function tick() {
      if (attempts.current >= 200) { setStreamError("trafficLimit"); setStreaming(false); return; }
      const scenario = trafficScenario(config.trafficAccounts ?? [], sequence.current++, config.presets);
      if (!scenario) { setStreamError("trafficMissing"); setStreaming(false); return; }
      attempts.current++;
      controller = new AbortController();
      try {
        const evaluation = await api<Evaluation>("transfers/evaluate", { method: "POST", body: JSON.stringify(scenario.input), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) });
        if (!disposed) {
          onTraffic({ evaluation, amount: scenario.input.amount, from: scenario.from, to: scenario.to });
          setRefresh(n => n + 1);
          timer = setTimeout(() => void tick(), 2500);
        }
      } catch (error) { if (!disposed) { setStreamError(errorKey(error)); setStreaming(false); setRefresh(n => n + 1); } }
    }
    void tick();
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); };
  }, [streaming, config.trafficAccounts, config.presets, onTraffic]);
  const feed = usePoll<Feed>("soc/feed?limit=50", revision + refresh, 3000);
  useEffect(() => { if (feed.data) onTrafficSync(feed.data.items); }, [feed.data, onTrafficSync]);
  useEffect(() => { setSelection(initialSelection); setFilter("all"); }, [initialSelection]);
  const items = feed.data?.items ?? [];
  const selected = items.find(i => i.transaction_id === selection) ?? items[0];
  const graph = usePoll<Graph>(selected ? `soc/graph/${selected.recipient.id}` : null, revision + refresh, 6000);
  const visible = items.filter(i => filter === "all" || i.status === filter);
  const stats = feed.data?.stats;
  const loss = preventedLoss(traffic, items);
  const canStream = trafficScenario(config.trafficAccounts ?? [], 0, config.presets) !== null;
  const metrics = [
    { key: "total", label: "totalChecked", hint: "allEvaluations", value: stats?.total, icon: Activity },
    { key: "approved", label: "approved", hint: "releasedTransfers", value: stats?.approved, icon: CheckCheck },
    { key: "cooling_off", label: "coolingPrevented", hint: "currentlyHeld", value: stats?.cooling_off, icon: Clock3 },
    { key: "blocked", label: "blockedHubs", hint: "visibleHubScope", value: feed.data ? countBlockedHubs(items) : undefined, icon: ShieldX },
  ] as const;
  return <div className="space-y-6">
    <div className="section-heading"><div><p className="eyebrow">BCC SHIELD / SOC</p><h1>{t("socTitle")}</h1><p className="muted">{t("socIntro")}</p></div><div className="soc-actions"><button className={streaming ? "traffic-button active" : "traffic-button"} aria-pressed={streaming} disabled={!streaming && (!canStream || attempts.current >= 200)} onClick={() => { setStreamError(null); setSelection(null); setStreaming(value => !value); }}>{streaming ? <Square size={15} /> : <Play size={15} />}{t(streaming ? "trafficStop" : "liveTraffic")}</button><button className="secondary" onClick={() => setRefresh(n => n + 1)} disabled={feed.loading}><RefreshCw size={16} className={feed.loading ? "animate-spin" : ""} />{t("refresh")}</button></div></div>
    <div className="traffic-strip"><span className={`live-dot ${streaming ? "" : "offline"}`} /><p>{t(canStream ? "trafficHint" : "trafficMissing")}</p><span className="tabular-nums">{t("trafficSession")}: {Object.keys(traffic).length}</span></div>
    {streamError && <p className="error" role="alert">{t(streamError)}</p>}
    <section className={`prevented-card ${streaming ? "is-streaming" : ""}`}><span className="prevented-icon"><ShieldCheck size={32} /></span><div><p>{t("preventedLoss")}</p><strong className="tabular-nums" aria-live="polite">{money(loss, lang)}</strong><small>{t("preventedHint")}</small></div><div className="city-chips">{(["astana", "almaty", "shymkent", "atyrau"] as const).map(city => <span key={city}>{t(city)}</span>)}</div></section>
    <div className="stats-grid">{metrics.map(({ key, label, hint, value, icon: Icon }) => <div className={`stat ${key}`} key={key}><div className="stat-title"><span>{t(label)}</span><i><Icon size={21} /></i></div><strong className="tabular-nums">{value ?? "—"}</strong><small>{t(hint)}</small></div>)}</div>
    <section className="panel feed-panel overflow-hidden"><div className="panel-heading"><div><h2><Activity size={20} />{t("feed")}</h2><p className="muted panel-subtitle">{t("liveFeed")}</p></div><span className="feed-connection"><span className={`live-dot ${feed.error ? "offline" : ""}`} />{t(feed.loading ? "refreshing" : "connected")}</span></div>
      {feed.error && <p role="alert" className="error mx-5">{t(feed.error)}</p>}
      <div className="filter-row">{(["all", "approved", "cooling_off", "blocked"] as const).map(key => <button key={key} className={filter === key ? "active" : ""} aria-pressed={filter === key} onClick={() => setFilter(key)}>{t(key)}</button>)}</div>
      <div className="overflow-x-auto"><table><thead><tr><th>{t("time")}</th><th>{t("route")}</th><th>{t("amount")}</th><th>{t("risk")}</th><th>{t("status")}</th><th>{t("latency")}</th></tr></thead><tbody>
        {visible.map(item => <tr key={item.transaction_id} className={selected?.transaction_id === item.transaction_id ? "selected" : ""}><td>{new Date(item.created_at).toLocaleTimeString(lang === "kk" ? "kk-KZ" : "ru-KZ", { timeZone: "Asia/Qyzylorda", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td><td><button className="row-select" onClick={() => setSelection(item.transaction_id)} aria-pressed={selected?.transaction_id === item.transaction_id}><strong>{item.sender.full_name} <span>→</span> {item.recipient.full_name}</strong><small>•••• {item.recipient.iban.slice(-4)}{traffic[item.transaction_id] && <> · {t("simulatedRoute")}: {t(traffic[item.transaction_id].from)} → {t(traffic[item.transaction_id].to)}</>}</small></button></td><td className="whitespace-nowrap font-semibold">{money(item.amount, lang)}</td><td><Gauge compact score={item.risk_score} /></td><td><Badge status={item.status} /></td><td>{item.latency_ms.toFixed(2)} {t("ms")}</td></tr>)}
      </tbody></table></div>{!visible.length && <p className="empty">{t(feed.loading ? "refreshing" : "empty")}</p>}
    </section>
    <div className="soc-bottom"><section className="panel overflow-hidden"><div className="panel-heading"><div><h2><Network size={18} />{t("graph")}</h2><p className="muted mt-2 text-xs">{t("graphHint")}</p></div></div>{graph.error && <p role="alert" className="error mx-5">{t(graph.error)}</p>}{graph.data ? <NetworkGraph graph={graph.data} streaming={streaming} /> : <p className="empty">{t(selected ? "refreshing" : "select")}</p>}</section>
      <section className="panel case-panel">{selected ? <><div className="case-heading"><h2>{t("caseDetails")}</h2><Badge status={selected.status} /></div><Gauge score={selected.risk_score} /><p className="case-amount tabular-nums">{money(selected.amount, lang)}</p><p className="case-recipient">{selected.recipient.full_name} · •••• {selected.recipient.iban.slice(-4)}</p><MLInspector details={evaluations[selected.transaction_id] ?? selected} reasons={selected.reasons} /><Explain kk={selected.reasons.map(r => r.reason_kk)} ru={selected.reasons.map(r => r.reason_ru)} /></> : <p className="empty">{t("select")}</p>}</section>
    </div>
  </div>;
}
