"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Activity, ArrowLeft, ArrowRight, BrainCircuit, CheckCheck, Clock3, Minimize2, Network, Play, Presentation, RefreshCw, Search, ShieldCheck, ShieldX, Square, Timer, X } from "lucide-react";
import { type Evaluation, type Feed, type FeedItem, type Graph, type Status } from "@/lib/contracts";
import { preventedLoss, type TrafficRecord } from "@/lib/traffic";
import { initialCaseSelection, SOC_MAX_OFFSET, SOC_PAGE_SIZE, socFeedPath } from "@/lib/soc-feed";
import type { TrafficStream } from "./use-traffic-stream";
import { money, useLocale } from "@/lib/i18n";
import { Badge, Explain, Gauge } from "./risk";
import { MLInspector } from "./ml-inspector";
import { countBlockedHubs } from "@/lib/feed-summary";
import { useSocPoll } from "./use-soc-poll";
import { CaseInspector } from "./case-inspector";
import { ScenarioResults } from "./scenario-results";
import { TraceAnchorPicker } from "./trace-anchor-picker";
import { TransferStory } from "./transfer-story";
import { MobileQr } from "./mobile-qr";
import { SocCasesWorkspace } from "./soc-cases-workspace";
import { SocIntegrationInsights } from "./soc-integration-insights";
import { integrationText } from "@/lib/soc-integration-copy";
import { readSocDashboardSession, writeSocDashboardSession, SOC_SESSION_KEY } from "@/lib/soc-dashboard-session";

const NetworkGraph = dynamic(() => import("./network-graph"), { ssr: false });
export function SocDashboard({ liveLedger, initialSelection, revision, traffic, onTrafficSync, stream, onReview, readOnly, privateStoryAccess, busy, focusTransfer, onFocusConsumed }: { liveLedger: boolean; initialSelection: string | null; revision: number; evaluations: Record<string, Evaluation>; traffic: Record<string, TrafficRecord>; onTrafficSync: (items: FeedItem[]) => void; stream: TrafficStream; onReview?: (id: string) => void; readOnly?: boolean; privateStoryAccess?: boolean; busy: boolean; focusTransfer?: boolean; onFocusConsumed?: () => void }) {
  const { lang, t } = useLocale();
  const [refresh, setRefresh] = useState(0);
  const [selection, setSelection] = useState(initialSelection);
  const [traceFocus, setTraceFocus] = useState<{ id: string; revision: number } | null>(null);
  const [filter, setFilter] = useState<Status | "all">("all");
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [stage, setStage] = useState(false);
  const [showStageFeed, setShowStageFeed] = useState(false);
  const [graphDepth, setGraphDepth] = useState<1 | 2>(1);
  const [mode, setMode] = useState<"transfers" | "cases">("transfers");
  const [caseTransactionId, setCaseTransactionId] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    try {
      const saved = readSocDashboardSession(sessionStorage.getItem(SOC_SESSION_KEY));
      setMode(readOnly ? "transfers" : saved.mode); setGraphDepth(saved.graphDepth);
      setAlertsOnly(saved.alertsOnly ?? false);
      if (!initialSelection) { setSelection(saved.selectedId); setFilter(saved.filter); }
    } catch { /* Unavailable storage keeps a functional in-memory workspace. */ }
    setRestored(true);
    // Restore once. Explicit later preset selections are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (focusTransfer) { setMode("transfers"); onFocusConsumed?.(); }
  }, [focusTransfer, onFocusConsumed]);
  useEffect(() => {
    if (!restored) return;
    try { sessionStorage.setItem(SOC_SESSION_KEY, writeSocDashboardSession({ mode, selectedId: selection, filter, graphDepth, alertsOnly })); } catch { /* Storage is optional. */ }
  }, [mode, selection, filter, graphDepth, alertsOnly, restored]);
  const dashboard = useRef<HTMLDivElement>(null);
  const stageToggle = useRef<HTMLButtonElement>(null);
  const searchPending = search.trim() !== query;
  const streaming = stream.active;
  const feed = useSocPoll<Feed>(restored && mode === "transfers" ? socFeedPath(filter, query, offset, alertsOnly) : null, revision + refresh, 3000);
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
    if (initialSelection) { setSelection(initialSelection); setFilter("all"); setAlertsOnly(false); setSearch(""); setQuery(""); setOffset(0); }
  }, [initialSelection]);
  useEffect(() => {
    if (feed.data) setSelection(previous => initialCaseSelection(previous, feed.data!.items.map(item => item.transaction_id)));
  }, [feed.data]);
  const items = feed.data?.items ?? [];
  const inspectedId = mode === "cases" ? caseTransactionId : selection;
  const detail = useSocPoll<Evaluation>(restored && inspectedId ? `transfers/${inspectedId}` : null, revision + refresh, mode === "cases" ? 30_000 : 3000);
  const selected = detail.data;
  const graph = useSocPoll<Graph>(selected ? `soc/graph/${selected.recipient.id}?depth=${graphDepth}` : null, revision + refresh, mode === "cases" ? 30_000 : 6000);
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
  const resetFilters = () => { setSearch(""); setQuery(""); setFilter("all"); setAlertsOnly(false); setOffset(0); };
  const time = (value: number | string) => new Date(value).toLocaleTimeString(lang === "kk" ? "kk-KZ" : "ru-KZ", { timeZone: "Asia/Qyzylorda", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const locale = lang === "kk" ? "kk-KZ" : "ru-KZ";
  const hubCount = stats?.blocked_hubs ?? (feed.data ? countBlockedHubs(items) : undefined);
  return <div ref={dashboard} className={`soc-dashboard${stage ? " is-stage" : ""}${mode === "cases" ? " soc-cases-mode" : ""}`}>
    <div className="section-heading soc-heading"><div><h1>{t("socTitle")}</h1><p className="muted">{t(readOnly ? "socPublicView" : stage ? "stageHint" : "socIntro")}</p></div><div className="soc-actions">
      {mode === "transfers" && <button className={streaming ? "traffic-button active" : "traffic-button"} aria-pressed={streaming} disabled={!streaming && (!canStream || stream.inFlight)} onClick={stream.toggle}>{streaming ? <Square size={15} /> : <Play size={15} />}{t(streaming ? "trafficStop" : "liveTraffic")}</button>}
      <button ref={stageToggle} className="secondary soc-stage-toggle" aria-pressed={stage} aria-keyshortcuts={stage ? "Escape" : undefined} onClick={toggleStage}>{stage ? <Minimize2 size={16} /> : <Presentation size={16} />}{t(stage ? "stageExit" : "stageMode")}</button>
      <MobileQr />
      {mode === "transfers" && <button className="secondary icon-button" onClick={() => setRefresh(n => n + 1)} disabled={feed.loading} aria-label={t("refresh")} title={t("refresh")}><RefreshCw size={16} className={feed.loading ? "animate-spin" : ""} /></button>}
    </div></div>
    {!readOnly && <nav className="soc-investigation-nav" aria-label={t("socTitle")}>{(["transfers", "cases"] as const).map(value => <button type="button" data-testid={`soc-mode-${value}`} key={value} aria-pressed={mode === value} onClick={() => { setMode(value); if (value === "cases" && streaming) stream.toggle(); }}>{integrationText(lang, value)}</button>)}</nav>}
    {!readOnly && restored && mode === "cases" && <><SocCasesWorkspace revision={revision} onSelectTransaction={setCaseTransactionId} /><SocIntegrationInsights key={caseTransactionId ?? "unlinked"} transactionId={caseTransactionId} revision={revision} /></>}
    {mode === "transfers" && <>
    <div className="traffic-strip"><span className={`live-dot ${streaming ? "" : "offline"}`} /><p>{t(stream.inFlight && !streaming ? "trafficDraining" : canStream ? "trafficHint" : "trafficMissing")}</p><span className="tabular-nums">{t("trafficSession")}: {Object.keys(traffic).length}</span></div>
    {stream.error && <p className="error" role="alert">{t(stream.error)}</p>}
    <div className="soc-kpis">
      <div className={`stat money prevented ${streaming ? "is-streaming" : ""}`}><div className="stat-title"><span>{t("socKpiPrevented")}</span><i><ShieldCheck size={18} /></i></div><strong className="tabular-nums" aria-live="polite">{money(loss, lang)}</strong><small>{t("preventedHint")}</small></div>
      <div className="stat money held"><div className="stat-title"><span>{t("socKpiHeld")}</span><i><Clock3 size={18} /></i></div><strong className="tabular-nums">{stats?.held_amount === undefined ? "—" : money(stats.held_amount, lang)}</strong><small>{t("socKpiHeldHint")}</small></div>
      {metrics.map(({ key, label, hint, value, icon: Icon }) => <div className={`stat ${key}`} key={key}><div className="stat-title"><span>{t(label)}</span><i><Icon size={18} /></i></div><strong className="tabular-nums">{key === "blocked" ? hubCount ?? "—" : value ?? "—"}</strong><small>{t(hint)}</small></div>)}
      <div className="stat scorer-latency" aria-describedby="soc-latency-scope"><div className="stat-title"><span>{t("p95Latency")}</span><i><Timer size={18} /></i></div><strong className="tabular-nums">{p95 == null ? "—" : p95.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<span className="stat-unit">{p95 == null ? "" : t("ms")}</span></strong><small className="tabular-nums">{p95 == null ? t("latencyEmpty") : `${t("latencySample")}: ${stats?.latency_sample_size ?? "—"} / ${stats?.latency_sample_limit ?? 500}`}</small><p id="soc-latency-scope" className="soc-latency-scope">{t("latencyScope")}</p></div>
    </div>
    {stats?.submission_limits && <section className="submission-metrics" aria-label={t("submissionTitle")}>
      <ShieldCheck size={20} /><div><strong>{t("submissionTitle")}</strong>
      <p>{t("submissionRule").replace("{limit}", String(stats.submission_limits.limit)).replace("{window}", String(stats.submission_limits.window_seconds)).replace("{cooldown}", String(stats.submission_limits.cooldown_seconds))}</p></div>
      <dl><div><dt>{t("activePauses")}</dt><dd>{stats.submission_limits.active}</dd></div><div><dt>{t("rejectedRequests")}</dt><dd>{stats.submission_limits.rejected}</dd></div></dl>
    </section>}
    {stage && <button type="button" className="secondary soc-stage-feed-toggle" aria-controls="soc-feed-panel" aria-expanded={showStageFeed} onClick={() => setShowStageFeed(value => !value)}><Activity size={17} />{t(showStageFeed ? "stageHideFeed" : "stageShowFeed")}</button>}
    <section id="soc-feed-panel" hidden={stage && !showStageFeed} className="panel feed-panel" aria-busy={feed.loading || searchPending}>
      <div className="panel-heading"><div><h2><Activity size={18} />{t("feed")}</h2><p className="panel-subtitle">{t("liveFeed")}{feed.receivedAt !== null && <span role="status"> · {feed.error ? `${t("staleData")} · ` : ""}{t("lastUpdated")}: <span className="tabular-nums">{time(feed.receivedAt)}</span></span>}</p></div><span className="feed-connection"><span className={`live-dot ${feed.error ? "offline" : ""}`} />{t(feed.loading || searchPending ? "refreshing" : "connected")}</span></div>
      {feed.error && <p role="alert" className="error panel-error">{t(feed.error)}</p>}
      <div className="feed-toolbar">
        <div className="soc-search"><label htmlFor="soc-search" className="sr-only">{t("socSearch")}</label><div className="soc-search-input"><Search size={16} aria-hidden="true" /><input id="soc-search" type="search" value={search} maxLength={128} autoComplete="off" aria-describedby="soc-search-hint" placeholder={t("socSearch")} onChange={event => setSearch(event.target.value)} />{search && <button type="button" aria-label={t("clearSearch")} onClick={() => setSearch("")}><X size={16} /></button>}</div><p id="soc-search-hint" className="sr-only">{t("socSearchHint")}</p></div>
        <div className="filter-row" role="group" aria-label={t("feedToolbar")}><button type="button" data-testid="soc-alerts-only" className={alertsOnly ? "active" : ""} aria-pressed={alertsOnly} onClick={() => { setAlertsOnly(value => !value); setFilter("all"); setOffset(0); }}>{t("alertsOnly")}</button>{(["all", "approved", "cooling_off", "blocked", "cancelled"] as const).map(key => <button key={key} className={filter === key && !alertsOnly ? "active" : ""} aria-pressed={filter === key && !alertsOnly} onClick={() => { setFilter(key); setAlertsOnly(false); setOffset(0); }}>{t(key)}</button>)}</div>
      </div>
      {searchPending && <p className="panel-note" role="status">{t("pageUpdating")}</p>}
      <div className="soc-table-scroll"><table><thead><tr><th scope="col">{t("updatedTime")}</th><th scope="col">{t("route")}</th><th scope="col" className="num">{t("amount")}</th><th scope="col">{t("risk")}</th><th scope="col">{t("status")}</th><th scope="col" className="num">{t("latency")}</th></tr></thead><tbody>
        {items.map(item => <tr key={item.transaction_id} data-transaction-id={item.transaction_id} className={selection === item.transaction_id ? "selected" : ""}><td><time className="soc-feed-time" dateTime={item.updated_at ?? item.created_at}><strong className="tabular-nums">{time(item.updated_at ?? item.created_at)}</strong><span className="tabular-nums">{new Date(item.updated_at ?? item.created_at).toLocaleDateString(locale, { timeZone: "Asia/Qyzylorda", day: "2-digit", month: "2-digit", year: "numeric" })}</span></time></td><td><button className="row-select" onClick={() => setSelection(item.transaction_id)} aria-pressed={selection === item.transaction_id}><strong>{item.sender.full_name} <span aria-hidden="true">→</span> {item.recipient.full_name}</strong><small>•••• {item.recipient.iban.slice(-4)}{traffic[item.transaction_id] && <> · {t("simulatedRoute")}: {t(traffic[item.transaction_id].from)} → {t(traffic[item.transaction_id].to)}</>}</small></button></td><td className="num amount-cell tabular-nums">{money(item.amount, lang)}</td><td><Gauge compact score={item.risk_score} /></td><td><Badge status={item.status} /></td><td className="num tabular-nums">{item.latency_ms.toFixed(2)} {t("ms")}</td></tr>)}
      </tbody></table></div>{!items.length && <div className="empty"><p>{t(feed.loading || searchPending ? "refreshing" : filter !== "all" || alertsOnly || query || offset ? "noMatches" : "empty")}</p>{!feed.loading && (filter !== "all" || alertsOnly || query || offset > 0) && <button className="secondary" onClick={resetFilters}>{t("resetFilters")}</button>}</div>}
      <div className="soc-pagination" aria-label={t("recoveryPages")}><p role="status">{t("resultsCount")}: <strong className="tabular-nums">{pagination ? `${items.length ? offset + 1 : 0}–${items.length ? offset + items.length : 0} / ${pagination.total_filtered}` : "—"}</strong>{selection && <a className="soc-open-case" href="#soc-investigation">{t("openCaseDetails")}<ArrowRight size={14} /></a>}</p><div><button type="button" className="secondary" disabled={!offset || feed.loading || searchPending} onClick={() => setOffset(0)}>{t("firstPage")}</button><button type="button" className="secondary icon-button" aria-label={t("pagePrevious")} disabled={!offset || feed.loading || searchPending} onClick={() => setOffset(value => Math.max(0, value - SOC_PAGE_SIZE))}><ArrowLeft size={16} /></button><button type="button" className="secondary icon-button" aria-label={t("pageNext")} disabled={!pagination?.has_more || offset + SOC_PAGE_SIZE > SOC_MAX_OFFSET || feed.loading || !!feed.error || searchPending} onClick={() => setOffset(value => value + SOC_PAGE_SIZE)}><ArrowRight size={16} /></button></div></div>
    </section>
    {outsidePage && <p className="soc-selection-note" role="status"><ShieldCheck size={17} /><span>{t("selectedOutsidePage")}</span><a className="soc-open-case" href="#soc-investigation">{t("openCaseDetails")}<ArrowRight size={14} /></a></p>}
    </>}
    {(mode === "transfers" || caseTransactionId) &&
    <div className="soc-bottom" id="soc-investigation" tabIndex={-1}>
      <TransferStory detail={selected && selected.transaction_id === inspectedId ? selected : null} privateAccess={!readOnly && !!privateStoryAccess} revision={revision} />
      <section className="panel graph-panel"><div className="panel-heading"><div><h2><Network size={18} />{t("graph")}</h2><p className="panel-subtitle">{t("graphHint")}</p></div><div className="graph-depth-controls segmented" role="group" aria-label={t("graph")}><button type="button" aria-pressed={graphDepth === 1} onClick={() => setGraphDepth(1)}>{t("graphDirect")}</button><button type="button" aria-pressed={graphDepth === 2} onClick={() => setGraphDepth(2)}>{t("graphExpanded")}</button></div></div>
        <div className="graph-meta">{graph.data && <p className="graph-scope" role="status">{t("graphScope")}: <strong className="tabular-nums">{graph.data.nodes.length} / {graph.data.edges.length}</strong></p>}{graph.receivedAt !== null && <p role="status">{graph.error ? `${t("staleData")} · ` : ""}{t("lastUpdated")}: <span className="tabular-nums">{time(graph.receivedAt)}</span></p>}</div>
        {graph.error && <p role="alert" className="error panel-error">{t(graph.error)}</p>}
        {selected && <p className="soc-center-recipient">{integrationText(lang, "selectedRecipient")}: <strong>{selected.recipient.display_name}</strong> · {selected.recipient.iban_masked}</p>}
        {liveLedger && mode === "transfers" && selected?.transaction_id === inspectedId && selected && <TraceAnchorPicker
          key={selected.recipient.id} accountId={selected.recipient.id} onSelect={id => {
            setSelection(id);
            setTraceFocus(previous => ({ id, revision: (previous?.revision ?? 0) + 1 }));
          }} />}
        {graph.data ? <NetworkGraph graph={graph.data} streaming={streaming} /> : <p className="empty">{t(selected ? "refreshing" : "select")}</p>}</section>
      <section className="panel analysis-panel" aria-labelledby="analysis-title"><div className="panel-heading"><div><h2 id="analysis-title"><BrainCircuit size={18} />{t("analysisPanel")}</h2><p className="panel-subtitle">{t("caseSnapshotHint")}</p></div></div>
        <div className="analysis-body">{selected && selected.transaction_id === inspectedId ? <><div className="analysis-score"><Gauge score={selected.risk_score} /><div><Badge status={selected.status} /><p className="result-headline">{lang === "kk" ? selected.headline_kk : selected.headline_ru}</p></div></div><MLInspector details={selected} reasons={selected.reasons} /><Explain kk={selected.reasons_kk} ru={selected.reasons_ru} /></> : <p className="empty">{t("analysisEmpty")}</p>}</div></section>
      <CaseInspector traceRevision={traceFocus && traceFocus.id === inspectedId ? traceFocus.revision : 0} detail={selected} loading={detail.loading} error={detail.error} receivedAt={detail.receivedAt} selectedId={inspectedId} onReview={onReview} onSelectReceipt={id => { setSelection(id); setMode("transfers"); }} readOnly={readOnly} busy={busy} onRetry={() => setRefresh(value => value + 1)} />
    </div>}
    {!stage && <ScenarioResults />}
  </div>;
}
