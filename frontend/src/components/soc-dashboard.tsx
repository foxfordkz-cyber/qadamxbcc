"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Activity, ArrowLeft, ArrowRight, CheckCheck, Clock3, Minimize2, Network, Play, Presentation, RefreshCw, Search, ShieldCheck, ShieldX, Square, Timer, X } from "lucide-react";
import { type Evaluation, type Feed, type FeedItem, type Graph, type Status } from "@/lib/contracts";
import { preventedLoss, type TrafficRecord } from "@/lib/traffic";
import { initialCaseSelection, SOC_MAX_OFFSET, SOC_PAGE_SIZE, socFeedPath } from "@/lib/soc-feed";
import type { TrafficStream } from "./use-traffic-stream";
import { money, useLocale } from "@/lib/i18n";
import { Badge, Gauge } from "./risk";
import { countBlockedHubs } from "@/lib/feed-summary";
import { useSocPoll } from "./use-soc-poll";
import { CaseInspector } from "./case-inspector";
import "./soc-workspace.css";

const NetworkGraph = dynamic(() => import("./network-graph"), { ssr: false });
export function SocDashboard({ initialSelection, revision, traffic, onTrafficSync, stream, onReview, busy }: { initialSelection: string | null; revision: number; evaluations: Record<string, Evaluation>; traffic: Record<string, TrafficRecord>; onTrafficSync: (items: FeedItem[]) => void; stream: TrafficStream; onReview: (id: string) => void; busy: boolean }) {
  const { lang, t } = useLocale();
  const [refresh, setRefresh] = useState(0);
  const [selection, setSelection] = useState(initialSelection);
  const [filter, setFilter] = useState<Status | "all">("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [stage, setStage] = useState(false);
  const [showStageFeed, setShowStageFeed] = useState(false);
  const [graphDepth, setGraphDepth] = useState<1 | 2>(1);
  const dashboard = useRef<HTMLDivElement>(null);
  const stageToggle = useRef<HTMLButtonElement>(null);
  const searchPending = search.trim() !== query;
  const streaming = stream.active;
  const feed = useSocPoll<Feed>(socFeedPath(filter, query, offset), revision + refresh, 3000);
  useEffect(() => {
    if (!stage) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("dialog[open]")) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true']")) return;
      setStage(false);
      stageToggle.current?.focus();
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [stage]);
  useEffect(() => {
    if (search.trim() === query) return;
    const timer = setTimeout(() => { setQuery(search.trim()); setOffset(0); }, 300);
    return () => clearTimeout(timer);
  }, [search, query]);
  useEffect(() => { if (feed.data) onTrafficSync(feed.data.items); }, [feed.data, onTrafficSync]);
  useEffect(() => {
    if (initialSelection) { setSelection(initialSelection); setFilter("all"); setSearch(""); setQuery(""); setOffset(0); }
  }, [initialSelection]);
  useEffect(() => {
    if (feed.data) setSelection(previous => initialCaseSelection(previous, feed.data!.items.map(item => item.transaction_id)));
  }, [feed.data]);
  const items = feed.data?.items ?? [];
  const detail = useSocPoll<Evaluation>(selection ? `transfers/${selection}` : null, revision + refresh, 3000);
  const selected = detail.data;
  const graph = useSocPoll<Graph>(selected ? `soc/graph/${selected.recipient.id}?depth=${graphDepth}` : null, revision + refresh, 6000);
  const stats = feed.data?.stats;
  const pagination = feed.data?.pagination;
  const outsidePage = selection !== null && !!feed.data && !items.some(item => item.transaction_id === selection);
  const loss = preventedLoss(traffic, items);
  const canStream = stream.canStart;
  const p95 = stats?.p95_latency_ms;
  const toggleStage = () => {
    setStage(value => !value);
    if (!stage) dashboard.current?.scrollIntoView({ block: "start", behavior: "instant" });
  };
  const metrics = [
    { key: "total", label: "totalChecked", hint: "allEvaluations", value: stats?.total, icon: Activity },
    { key: "approved", label: "approved", hint: "releasedTransfers", value: stats?.approved, icon: CheckCheck },
    { key: "cooling_off", label: "coolingPrevented", hint: "currentlyHeld", value: stats?.cooling_off, icon: Clock3 },
    { key: "blocked", label: "blockedHubs", hint: stats?.blocked_hubs === undefined ? "visibleHubScope" : "allHubScope", value: stats?.blocked_hubs ?? (feed.data ? countBlockedHubs(items) : undefined), icon: ShieldX },
  ] as const;
  const resetFilters = () => { setSearch(""); setQuery(""); setFilter("all"); setOffset(0); };
  const time = (value: number | string) => new Date(value).toLocaleTimeString(lang === "kk" ? "kk-KZ" : "ru-KZ", { timeZone: "Asia/Qyzylorda", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return <div ref={dashboard} className={`soc-dashboard space-y-6${stage ? " is-stage" : ""}`}>
    <div className="section-heading"><div><p className="eyebrow">BCC SHIELD / SOC</p><h1>{t("socTitle")}</h1><p className="muted">{t(stage ? "stageHint" : "socIntro")}</p></div><div className="soc-actions"><button ref={stageToggle} className="secondary soc-stage-toggle" aria-pressed={stage} aria-keyshortcuts={stage ? "Escape" : undefined} onClick={toggleStage}>{stage ? <Minimize2 size={16} /> : <Presentation size={16} />}{t(stage ? "stageExit" : "stageMode")}</button><button className={streaming ? "traffic-button active" : "traffic-button"} aria-pressed={streaming} disabled={!streaming && (!canStream || stream.inFlight)} onClick={stream.toggle}>{streaming ? <Square size={15} /> : <Play size={15} />}{t(streaming ? "trafficStop" : "liveTraffic")}</button><button className="secondary" onClick={() => setRefresh(n => n + 1)} disabled={feed.loading}><RefreshCw size={16} className={feed.loading ? "animate-spin" : ""} />{t("refresh")}</button></div></div>
    <div className="traffic-strip"><span className={`live-dot ${streaming ? "" : "offline"}`} /><p>{t(stream.inFlight && !streaming ? "trafficDraining" : canStream ? "trafficHint" : "trafficMissing")}</p><span className="tabular-nums">{t("trafficSession")}: {Object.keys(traffic).length}</span></div>
    {stream.error && <p className="error" role="alert">{t(stream.error)}</p>}
    <section className={`prevented-card ${streaming ? "is-streaming" : ""}`}><span className="prevented-icon"><ShieldCheck size={32} /></span><div><p>{t("preventedLoss")}</p><strong className="tabular-nums" aria-live="polite">{money(loss, lang)}</strong><small>{t("preventedHint")}</small></div><div className="city-chips">{(["astana", "almaty", "shymkent", "atyrau"] as const).map(city => <span key={city}>{t(city)}</span>)}</div></section>
    {stats?.held_amount !== undefined && <p className="muted">{t("heldAmount")}: <strong className="tabular-nums">{money(stats.held_amount, lang)}</strong> · {t("currentlyHeld")}</p>}
    <div className="stats-grid soc-kpis">{metrics.map(({ key, label, hint, value, icon: Icon }) => <div className={`stat ${key}`} key={key}><div className="stat-title"><span>{t(label)}</span><i><Icon size={21} /></i></div><strong className="tabular-nums">{value ?? "—"}</strong><small>{t(hint)}</small></div>)}<div className="stat scorer-latency" aria-describedby="soc-latency-scope"><div className="stat-title"><span>{t("p95Latency")}</span><i><Timer size={21} /></i></div><strong className="tabular-nums">{p95 == null ? "—" : p95.toLocaleString(lang === "kk" ? "kk-KZ" : "ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<span className="stat-unit">{p95 == null ? "" : t("ms")}</span></strong><small>{p95 == null ? t("latencyEmpty") : `${t("latencySample")}: ${stats?.latency_sample_size ?? "—"} / ${stats?.latency_sample_limit ?? 500}`}</small></div></div>
    <p id="soc-latency-scope" className="soc-latency-scope"><Timer size={14} /><span>{t("latencyScope")}</span></p>
    {stage && <button type="button" className="secondary soc-stage-feed-toggle" aria-controls="soc-feed-panel" aria-expanded={showStageFeed} onClick={() => setShowStageFeed(value => !value)}><Activity size={17} />{t(showStageFeed ? "stageHideFeed" : "stageShowFeed")}</button>}
    <section id="soc-feed-panel" hidden={stage && !showStageFeed} className="panel feed-panel overflow-hidden" aria-busy={feed.loading || searchPending}><div className="panel-heading"><div><h2><Activity size={20} />{t("feed")}</h2><p className="muted panel-subtitle">{t("liveFeed")}</p></div><span className="feed-connection"><span className={`live-dot ${feed.error ? "offline" : ""}`} />{t(feed.loading || searchPending ? "refreshing" : "connected")}</span></div>
      {feed.error && <p role="alert" className="error mx-5">{t(feed.error)}</p>}
      {feed.receivedAt !== null && <p className="muted mx-5 text-xs" role="status">{feed.error ? `${t("staleData")} · ` : ""}{t("lastUpdated")}: {time(feed.receivedAt)}</p>}
      <div className="soc-search"><label htmlFor="soc-search"><Search size={16} />{t("socSearch")}</label><div className="soc-search-input"><input id="soc-search" type="search" value={search} maxLength={128} autoComplete="off" aria-describedby="soc-search-hint" placeholder={t("socSearchHint")} onChange={event => setSearch(event.target.value)} />{search && <button type="button" aria-label={t("clearSearch")} onClick={() => setSearch("")}><X size={17} /></button>}</div><p id="soc-search-hint" className="muted">{t("socSearchHint")}</p></div>
      <div className="filter-row">{(["all", "approved", "cooling_off", "blocked", "cancelled"] as const).map(key => <button key={key} className={filter === key ? "active" : ""} aria-pressed={filter === key} onClick={() => { setFilter(key); setOffset(0); }}>{t(key)}</button>)}</div>
      {searchPending && <p className="muted mx-5 text-xs" role="status">{t("pageUpdating")}</p>}
      <div className="overflow-x-auto soc-table-scroll"><table><thead><tr><th>{t("updatedTime")}</th><th>{t("route")}</th><th>{t("amount")}</th><th>{t("risk")}</th><th>{t("status")}</th><th>{t("latency")}</th></tr></thead><tbody>
        {items.map(item => <tr key={item.transaction_id} className={selection === item.transaction_id ? "selected" : ""}><td><time className="soc-feed-time" dateTime={item.updated_at ?? item.created_at}><strong>{new Date(item.updated_at ?? item.created_at).toLocaleDateString(lang === "kk" ? "kk-KZ" : "ru-KZ", { timeZone: "Asia/Qyzylorda", day: "2-digit", month: "2-digit", year: "numeric" })}</strong><span>{time(item.updated_at ?? item.created_at)}</span></time></td><td><button className="row-select" onClick={() => setSelection(item.transaction_id)} aria-pressed={selection === item.transaction_id}><strong>{item.sender.full_name} <span>→</span> {item.recipient.full_name}</strong><small>•••• {item.recipient.iban.slice(-4)}{traffic[item.transaction_id] && <> · {t("simulatedRoute")}: {t(traffic[item.transaction_id].from)} → {t(traffic[item.transaction_id].to)}</>}</small></button></td><td className="whitespace-nowrap font-semibold">{money(item.amount, lang)}</td><td><Gauge compact score={item.risk_score} /></td><td><Badge status={item.status} /></td><td>{item.latency_ms.toFixed(2)} {t("ms")}</td></tr>)}
      </tbody></table></div>{!items.length && <div className="empty"><p>{t(feed.loading || searchPending ? "refreshing" : filter !== "all" || query || offset ? "noMatches" : "empty")}</p>{!feed.loading && (filter !== "all" || query || offset > 0) && <button className="secondary mt-3" onClick={resetFilters}>{t("resetFilters")}</button>}</div>}
      <div className="soc-pagination" aria-label={t("recoveryPages")}><p role="status">{t("resultsCount")}: <strong className="tabular-nums">{pagination ? `${items.length ? offset + 1 : 0}–${items.length ? offset + items.length : 0} / ${pagination.total_filtered}` : "—"}</strong>{selection && <a className="soc-open-case" href="#soc-investigation">{t("openCaseDetails")}<ArrowRight size={14} /></a>}</p><div><button type="button" className="secondary" disabled={!offset || feed.loading || searchPending} onClick={() => setOffset(0)}>{t("firstPage")}</button><button type="button" className="secondary" aria-label={t("pagePrevious")} disabled={!offset || feed.loading || searchPending} onClick={() => setOffset(value => Math.max(0, value - SOC_PAGE_SIZE))}><ArrowLeft size={16} /></button><button type="button" className="secondary" aria-label={t("pageNext")} disabled={!pagination?.has_more || offset + SOC_PAGE_SIZE > SOC_MAX_OFFSET || feed.loading || !!feed.error || searchPending} onClick={() => setOffset(value => value + SOC_PAGE_SIZE)}><ArrowRight size={16} /></button></div></div>
    </section>
    {outsidePage && <p className="soc-selection-note" role="status"><ShieldCheck size={17} /><span>{t("selectedOutsidePage")}</span><a className="soc-open-case" href="#soc-investigation">{t("openCaseDetails")}<ArrowRight size={14} /></a></p>}
    <div className="soc-bottom" id="soc-investigation" tabIndex={-1}><section className="panel overflow-hidden"><div className="panel-heading"><div><h2><Network size={18} />{t("graph")}</h2><p className="muted mt-2 text-xs">{t("liveGraphHint")}</p><p className="muted mt-2 text-xs">{t("graphHint")}</p></div><span className="soc-live-graph">{t("liveGraph")}</span></div><div className="graph-depth-controls" role="group" aria-label={t("graph")}><button type="button" aria-pressed={graphDepth === 1} onClick={() => setGraphDepth(1)}>{t("graphDirect")}</button><button type="button" aria-pressed={graphDepth === 2} onClick={() => setGraphDepth(2)}>{t("graphExpanded")}</button></div>{graph.data && <p className="graph-scope" role="status">{t("graphScope")}: <strong className="tabular-nums">{graph.data.nodes.length} / {graph.data.edges.length}</strong></p>}{graph.error && <p role="alert" className="error mx-5">{t(graph.error)}</p>}{graph.receivedAt !== null && <p className="muted mx-5 text-xs" role="status">{graph.error ? `${t("staleData")} · ` : ""}{t("lastUpdated")}: {time(graph.receivedAt)}</p>}{graph.data ? <NetworkGraph graph={graph.data} streaming={streaming} /> : <p className="empty">{t(selected ? "refreshing" : "select")}</p>}</section>
      <CaseInspector detail={selected} loading={detail.loading} error={detail.error} receivedAt={detail.receivedAt} selectedId={selection} onReview={onReview} busy={busy} onRetry={() => setRefresh(value => value + 1)} />
    </div>
  </div>;
}
