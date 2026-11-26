"use client";

import { useEffect, useState } from "react";
import { Activity, Clock3, RefreshCw, ShieldCheck } from "lucide-react";
import { api, ApiError } from "@/lib/contracts";
import type { HoldMetrics, IncidentTimeline, IntegrationHealth, IncidentSummary } from "@/lib/soc-integrations";
import { integrationCopy, integrationText, type IntegrationMessage } from "@/lib/soc-integration-copy";
import { useLocale } from "@/lib/i18n";
import "./soc-integration-insights.css";

function useSnapshot<T>(path: string | null, revision: number) {
  const [state, setState] = useState<{ path: string; data: T | null; loading: boolean; error: ApiError | null; retryAt: number } | null>(null);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    let disposed = false;
    setState(previous => ({ path, data: previous?.path === path ? previous.data : null, loading: true, error: null, retryAt: 0 }));
    void api<T>(path, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]) }).then(data => {
      if (!disposed) setState({ path, data, loading: false, error: null, retryAt: 0 });
    }).catch(error => {
      if (!disposed) setState(previous => ({ path, data: error instanceof ApiError && [401, 403, 404, 410].includes(error.status) ? null : previous?.path === path ? previous.data : null, loading: false,
        error: error instanceof ApiError ? error : new ApiError("apiError"), retryAt: Date.now() + (error instanceof ApiError && error.status === 429 ? error.retryAfter ?? 60 : 0) * 1000 }));
    });
    return () => { disposed = true; controller.abort(); };
  }, [path, revision]);
  return state?.path === path ? state : { path, data: null, loading: !!path, error: null, retryAt: 0 };
}

export function HoldOutcomesPanel({ revision }: { revision: number }) {
  const { lang } = useLocale();
  const kk = lang === "kk";
  const [days, setDays] = useState(7);
  const [retry, setRetry] = useState(0);
  const state = useSnapshot<HoldMetrics>("integrations/guardian/soc/cases/outcomes?days=" + days, revision + retry);
  const report = state.data;
  return <section className="panel" aria-labelledby="hold-outcomes-title">
    <h3 id="hold-outcomes-title">{kk ? "Кідіртілген аударымдардың нәтижесі" : "Исходы удержанных переводов"}</h3>
    <label>{kk ? "Кезең, күн" : "Период, дни"} <select value={days} onChange={e => setDays(Number(e.target.value))}>
      {[7, 30, 90].map(period => <option key={period}>{period}</option>)}
    </select></label>
    <p>{kk ? "Бір аударым SOC ісіне де, кейін бас тартылған төлемдерге де кіруі мүмкін. Адал төлемдер жабылған істер бойынша саналады."
      : "У одного удержания может быть и дело SOC, и последующая отмена. Ложные паузы считаются по подтверждённым исходам закрытых дел."}</p>
    {state.loading && <p role="status">{kk ? "Жүктелуде…" : "Загрузка…"}</p>}
    {state.error && <button type="button" onClick={() => setRetry(n => n + 1)}>{kk ? "Есепті қайта жүктеу" : "Загрузить отчёт ещё раз"}</button>}
    {report && !state.error && <><dl>{report.rows.map(row => <div key={row.key}><dt>{row[lang]}</dt>
      <dd>{row.value?.toLocaleString(kk ? "kk-KZ" : "ru-KZ", {maximumFractionDigits: 2}) ?? "—"}</dd></div>)}</dl>
      <a download={"soc-" + days + ".csv"} href={"data:text/csv;charset=utf-8," + encodeURIComponent("\uFEFF" + report.csv)}>
        {kk ? "CSV жүктеп алу" : "Скачать CSV"}</a></>}
  </section>;
}

export function SocIntegrationInsights({ transactionId, revision }: { transactionId: string | null; revision: number }) {
  const { lang } = useLocale();
  const t = (key: IntegrationMessage) => integrationText(lang, key);
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [page, setPage] = useState<{ id: string; cursor: string | null }>({ id: "", cursor: null });
  const [history, setHistory] = useState<{ id: string; asOf: string; events: IncidentTimeline["events"]; next: string | null } | null>(null);
  const cursor = page.id === transactionId ? page.cursor : null;
  const summary = useSnapshot<IncidentSummary>(transactionId ? `integrations/soc/transactions/${transactionId}/summary` : null, refresh + revision);
  const health = useSnapshot<IntegrationHealth>(transactionId ? null : "integrations/health/details", refresh + revision);
  const timeline = useSnapshot<IncidentTimeline>(transactionId ? `integrations/soc/transactions/${transactionId}/timeline?limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}` : null, refresh + revision);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!timeline.data || !transactionId) return;
    const data = timeline.data;
    setHistory(previous => {
      const retained = cursor && previous?.id === transactionId && previous.asOf === data.as_of ? previous.events : [];
      return { id: transactionId, asOf: data.as_of, events: [...new Map([...retained, ...data.events].map(event => [event.id, event])).values()], next: data.next_cursor };
    });
  }, [timeline.data, transactionId, cursor]);
  useEffect(() => {
    if (timeline.error && [401, 403, 404, 410].includes(timeline.error.status)) setHistory(null);
  }, [timeline.error]);
  const currentHistory = history?.id === transactionId ? history : null;
  const status = summary.data?.health ?? health.data;
  const healthError = transactionId ? summary.error : health.error;
  const busy = summary.loading || health.loading || timeline.loading;
  const retryAt = Math.max(summary.retryAt, health.retryAt, timeline.retryAt);
  const wait = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const date = (value: string) => new Date(value).toLocaleString(lang === "kk" ? "kk-KZ" : "ru-KZ", { timeZone: "Asia/Qyzylorda", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const errorText = (error: ApiError) => error.code === "integrationsUnavailable" ? t("disabled") : error.status === 401 || error.status === 403 ? t("denied") : error.status === 429 ? `${t("rateLimited")}: ${wait} ${t("seconds")}` : error.status === 422 && cursor ? t("resetCursor") : t("failed");
  const refreshAll = () => { setPage({ id: transactionId ?? "", cursor: null }); setHistory(null); setRefresh(value => value + 1); };
  const stateLabel = (value: string) => value === "disabled" ? t("off") : value === "fake_enabled" ? t("fake") : value === "test_enabled" ? t("test") : value === "mock_ready" ? t("mock") : value in integrationCopy ? t(value as IntegrationMessage) : t("unknown");
  return <section className="soc-integration-insights" data-testid="soc-integration-insights">
    <div className="integration-toolbar"><div><h2><ShieldCheck size={20} />{t("snapshot")}</h2><p>{t("manualRefresh")}</p></div><button className="secondary" data-testid="incident-refresh" onClick={refreshAll} disabled={busy || wait > 0}><RefreshCw size={16} className={busy ? "animate-spin" : ""} />{t("refresh")}{wait > 0 && ` (${wait})`}</button></div>
    <p className="integration-advisory">{t("readOnly")}</p>
    <div className="integration-columns">
      <section className="panel integration-health" data-testid="integration-health" aria-busy={health.loading || summary.loading}>
        <h3><Activity size={18} />{t("health")}</h3>
        {healthError && <p role="alert" className="error">{errorText(healthError)}</p>}
        {status ? <><p className={`integration-status ${status.status === "ok" && !healthError ? "good" : "attention"}`}>{healthError ? t("stale") : t(status.status)}</p>
          <dl className="integration-facts">{(["database", "redis", "worker", "telegram", "gateway"] as const).map(key => <div key={key}><dt>{t(key)}</dt><dd>{stateLabel(status[key])}</dd></div>)}</dl>
          {status.queue ? <div className="integration-queue">{([ ["queued", status.queue.notifications_queued], ["delayed", status.queue.notifications_delayed], ["deliveryFailed", status.queue.notifications_failed], ["pending", status.queue.runs_pending] ] as const).map(([label, value]) => <div key={label}><strong className="tabular-nums">{value}</strong><span>{t(label)}</span></div>)}</div> : <p className="integration-advisory">{t("queueUnknown")}</p>}
          <p className="integration-meta">{t("asOf")}: {date(status.checked_at)}</p><p className="integration-meta">{t("lastSuccess")}: {status.last_successful_processing ? date(status.last_successful_processing) : t("unknown")}</p><p className="integration-meta">{t("notProbed")}</p>
        </> : !healthError && <p className="muted">{t("loading")}</p>}
      </section>
      <section className="panel incident-timeline" data-testid="incident-timeline" aria-busy={timeline.loading}>
        <h3><Clock3 size={18} />{t("timeline")}</h3>
        {transactionId && <code className="integration-id">{transactionId}</code>}
        {timeline.error && <p role="alert" className="error">{errorText(timeline.error)}</p>}
        {!transactionId ? <p className="empty">{t("select")}</p> : <>
          {currentHistory && <p className="integration-meta">{t("asOf")}: {date(currentHistory.asOf)}{timeline.error && ` · ${t("stale")}`}</p>}
          <ol className="incident-events">{currentHistory?.events.map(event => <li key={event.id} className={event.importance === "attention" ? "attention" : ""}>
            <div><span className="incident-category">{t(event.category)}</span><time dateTime={event.timestamp}>{date(event.timestamp)}</time></div><p>{lang === "kk" ? event.description_kk : event.description_ru}</p>
            <small>{t(event.source === "persisted_core" ? "core" : "orchestration")} · <code>{event.code}</code></small>
            {event.correlation_id && <details><summary>{t("correlation")}</summary><code className="integration-id">{event.correlation_id}</code></details>}
          </li>)}</ol>
          {!currentHistory?.events.length && <p className="empty">{t(timeline.loading ? "loading" : "empty")}</p>}
          {currentHistory?.next && <button className="secondary" data-testid="incident-more" disabled={timeline.loading || !!timeline.error || wait > 0} onClick={() => setPage({ id: transactionId, cursor: currentHistory.next })}>{t("more")}</button>}
        </>}
      </section>
    </div>
    {summary.data && <div className="integration-columns">
      <section className="panel integration-notifications"><h3>{t("notification")}</h3><p>{lang === "kk" ? summary.data.description_kk : summary.data.description_ru}</p>
        {!!summary.data.manual_review_reasons.length && <div className="integration-advisory"><strong>{t("review")}</strong><ul>{summary.data.manual_review_reasons.map(reason => <li key={reason}>{reason in integrationCopy ? t(reason as IntegrationMessage) : t("review")}</li>)}</ul></div>}
        {summary.data.notifications.length ? <ul className="notification-list">{summary.data.notifications.map(item => <li key={item.id}><span className={`integration-status ${item.state === "SUSPICION_REPORTED" || item.state === "DELIVERY_FAILED" ? "attention" : ""}`}>{t(item.state)}</span><small>{t("until")}: {date(item.expires_at)}</small></li>)}</ul> : <p className="muted">{t("noNotification")}</p>}
        <p className="integration-meta">{t("notifyScope")}</p>
      </section>
      <section className="panel integration-gateway"><h3>{t("gatewayTitle")}</h3><p>{t("gatewayHint")}</p>
        {summary.data.gateway_results.length ? <ul className="gateway-results">{summary.data.gateway_results.map(item => {
          const fresh = item.fresh && item.result.verified && Date.parse(item.result.expires_at) > now && !summary.error;
          return <li key={item.id}><div><span className="integration-status attention">MOCK · {t(item.result.status)}</span><span className={`integration-status ${fresh ? "good" : "attention"}`}>{t(fresh ? "fresh" : "expired")}</span></div><p>{lang === "kk" ? item.description_kk : item.description_ru}</p><small>{t("checked")}: {date(item.result.checked_at)} · {t("until")}: {date(item.result.expires_at)}</small></li>;
        })}</ul> : <p className="muted">{t("noChecks")}</p>}
      </section>
    </div>}
  </section>;
}
