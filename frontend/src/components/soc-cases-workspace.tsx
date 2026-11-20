"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, Clock3, FileText, History, LoaderCircle, MessageSquare, Plus, RefreshCw, ShieldCheck, UserRound } from "lucide-react";
import { api, ApiError } from "@/lib/contracts";
import { useLocale } from "@/lib/i18n";
import { randomId } from "@/lib/secure-fallback";
import { caseActionSchema, openCaseSchema, type CaseAction, type CaseAnalytics, type CaseEvidence, type CaseOut, type CasePage, type ContentPage, type EventPage } from "@/lib/soc-integrations";
import { caseText, type SocCaseMessage } from "@/lib/soc-case-copy";
import { actionAllowed, CASE_SESSION_KEY, caseCategories, caseQuestions, caseReasons, caseStaff, caseStates, caseTransitions, emptyCaseSession, filterCases, intentMarker, mergeCases, readCaseSession, rebaseCaseAction, serializeCaseSession, type CaseIntent, type CaseSession } from "@/lib/soc-case-session";
import "./soc-cases.css";

const BASE = "integrations/guardian/soc/cases";
type Props = { revision: number; onSelectTransaction?: (id: string | null) => void };
type ReadState<T> = { data: T | null; loading: boolean; error: SocCaseMessage | null };
const readState = <T,>(): ReadState<T> => ({ data: null, loading: false, error: null });
function messageFor(error: unknown): SocCaseMessage {
  if (!(error instanceof ApiError)) return "unavailable";
  if (error.status === 401 || error.status === 403) return "sessionExpired";
  if (["integrationsUnavailable", "integrations_disabled", "integration_disabled"].includes(error.code)) return "disabled";
  if (error.status === 410) return "expired";
  if (error.status === 404) return "missing";
  if (error.status === 429) return "rateLimited";
  if (error.code === "case_cursor_invalid") return "cursorExpired";
  if (error.code === "case_information_channel_unavailable") return "infoUnavailable";
  if (error.code === "case_information_pending") return "caseInformationPending";
  if (error.code === "case_action_limit") return "actionLimit";
  if (error.status === 422) return "invalid";
  return "unavailable";
}
function definiteRejection(error: unknown) {
  return error instanceof ApiError && [400, 401, 403, 404, 409, 410, 413, 415, 422, 429].includes(error.status);
}

export function SocCasesWorkspace({ revision, onSelectTransaction }: Props) {
  const { lang } = useLocale();
  const c = (key: SocCaseMessage) => caseText(lang, key);
  const [session, setSession] = useState<CaseSession>(emptyCaseSession);
  const sessionRef = useRef(session); sessionRef.current = session;
  const [ready, setReady] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const [rows, setRows] = useState<CaseOut[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const loadedExtra = useRef(false);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<SocCaseMessage | null>(null);
  const [analytics, setAnalytics] = useState<CaseAnalytics | null>(null);
  const [analyticsError, setAnalyticsError] = useState<SocCaseMessage | null>(null);
  const [detail, setDetail] = useState<CaseOut | null>(null);
  const detailRef = useRef<CaseOut | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<SocCaseMessage | null>(null);
  const [readAt, setReadAt] = useState<number | null>(null);
  const [history, setHistory] = useState<ReadState<EventPage>>(readState);
  const [notes, setNotes] = useState<ReadState<ContentPage>>(readState);
  const [evidence, setEvidence] = useState<ReadState<CaseEvidence>>(readState);
  const [clock, setClock] = useState(Date.now);
  const [retryUntil, setRetryUntil] = useState(0);
  const retryUntilRef = useRef(0);
  const [reportId, setReportId] = useState("");
  const [kind, setKind] = useState<CaseAction["action"]>("assign");
  const [assignee, setAssignee] = useState<string>("demo_analyst_a");
  const [nextState, setNextState] = useState<string>("IN_REVIEW");
  const [reason, setReason] = useState<string>("review_started");
  const [category, setCategory] = useState<string>("impersonation");
  const [question, setQuestion] = useState<string>("caller_request");
  const [note, setNote] = useState("");
  const [proposal, setProposal] = useState<CaseIntent | null>(null);
  const [pending, setPending] = useState<CaseIntent | null>(null);
  const [conflict, setConflict] = useState<CaseIntent | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<SocCaseMessage | null>(null);
  const [actionError, setActionError] = useState<SocCaseMessage | null>(null);
  const lock = useRef(false);
  const listLock = useRef(false);
  const currentId = useRef<string | null>(null); currentId.current = session.selectedId;
  const mounted = useRef(true);
  const transactionCallback = useRef(onSelectTransaction); transactionCallback.current = onSelectTransaction;
  const loadSerial = useRef(0);
  const contentSerial = useRef({ history: 0, notes: 0, evidence: 0 });
  const unresolved = !!session.pending;
  const throttled = retryUntil > clock;
  const current = detail?.id === session.selectedId && Date.parse(detail.expires_at) > clock ? detail : null;
  const editable = !!current && !detailLoading && !detailError && !busy && !unresolved && !conflict && !throttled;
  const date = (value: string | number) => new Date(value).toLocaleString(lang === "kk" ? "kk-KZ" : "ru-KZ", { timeZone: "Asia/Qyzylorda", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const staff = (value: CaseOut["assignee"]) => c(value === null ? "unassigned" : value === "demo_analyst_a" ? "analystA" : "analystB");
  const showError = (key: SocCaseMessage | null) => key && <p className="soc-case-error" role="alert"><AlertTriangle size={16} />{c(key)}</p>;

  useEffect(() => {
    mounted.current = true;
    try { setSession(readCaseSession(sessionStorage.getItem(CASE_SESSION_KEY))); } catch { setStorageFailed(true); }
    setReady(true);
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), retryUntil > Date.now() ? 1_000 : 30_000);
    return () => clearInterval(timer);
  }, [retryUntil]);
  useEffect(() => {
    if (!ready) return;
    try { sessionStorage.setItem(CASE_SESSION_KEY, serializeCaseSession(session)); } catch { setStorageFailed(true); }
  }, [session, ready]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (sessionRef.current.pending) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);

  const observeBackoff = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 429) {
      const seconds = Number.isFinite(error.retryAfter) ? Math.max(1, error.retryAfter!) : 60;
      retryUntilRef.current = Math.max(retryUntilRef.current, Date.now() + seconds * 1_000);
      setRetryUntil(retryUntilRef.current); setClock(Date.now());
    }
  }, []);

  const loadList = useCallback(async (cursor: string | null = null, reset = false) => {
    if (listLock.current || retryUntilRef.current > Date.now()) return;
    listLock.current = true; setListLoading(true);
    try {
      const value = await api<CasePage>(`${BASE}?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (!mounted.current) return;
      setRows(previous => mergeCases(reset ? [] : previous, value.items).filter(item => Date.parse(item.expires_at) > Date.now()));
      if (reset) loadedExtra.current = false;
      if (cursor) loadedExtra.current = true;
      if (cursor || !loadedExtra.current) setNextCursor(value.next_cursor);
      setListError(null);
    } catch (error) { if (mounted.current) { observeBackoff(error); setListError(messageFor(error)); } }
    finally { listLock.current = false; if (mounted.current) setListLoading(false); }
  }, [observeBackoff]);
  const loadAnalytics = useCallback(async () => {
    if (retryUntilRef.current > Date.now()) return;
    try { const value = await api<CaseAnalytics>(`${BASE}/analytics`); if (mounted.current) { setAnalytics(value); setAnalyticsError(null); } }
    catch (error) { if (mounted.current) { observeBackoff(error); setAnalyticsError(messageFor(error)); } }
  }, [observeBackoff]);
  const loadHistory = useCallback(async (id: string, after = 0) => {
    if (retryUntilRef.current > Date.now()) return;
    const serial = ++contentSerial.current.history;
    setHistory(previous => ({ ...previous, loading: true, error: null }));
    try {
      const value = await api<EventPage>(`${BASE}/${id}/history?limit=20&after_version=${after}`);
      if (mounted.current && currentId.current === id && serial === contentSerial.current.history) setHistory(previous => ({ data: { ...value, items: after ? [...(previous.data?.items ?? []), ...value.items.filter(item => !previous.data?.items.some(old => old.id === item.id))] : value.items }, loading: false, error: null }));
    } catch (error) { if (mounted.current && currentId.current === id && serial === contentSerial.current.history) { observeBackoff(error); setHistory(previous => ({ ...previous, loading: false, error: messageFor(error) })); } }
  }, [observeBackoff]);
  const loadNotes = useCallback(async (id: string, after = 0) => {
    if (retryUntilRef.current > Date.now()) return;
    const serial = ++contentSerial.current.notes;
    setNotes(previous => ({ ...previous, loading: true, error: null }));
    try {
      const value = await api<ContentPage>(`${BASE}/${id}/notes?limit=20&after_version=${after}`);
      if (mounted.current && currentId.current === id && serial === contentSerial.current.notes) setNotes(previous => ({ data: { ...value, items: after ? [...(previous.data?.items ?? []), ...value.items.filter(item => !previous.data?.items.some(old => old.event_id === item.event_id))] : value.items }, loading: false, error: null }));
    } catch (error) { if (mounted.current && currentId.current === id && serial === contentSerial.current.notes) { observeBackoff(error); setNotes(previous => ({ ...previous, loading: false, error: messageFor(error) })); } }
  }, [observeBackoff]);
  const loadEvidence = useCallback(async (id: string) => {
    if (retryUntilRef.current > Date.now()) return;
    const serial = ++contentSerial.current.evidence;
    setEvidence(previous => ({ ...previous, loading: true, error: null }));
    try {
      const value = await api<CaseEvidence>(`${BASE}/${id}/evidence`);
      if (mounted.current && currentId.current === id && serial === contentSerial.current.evidence) { setEvidence({ data: value, loading: false, error: null }); transactionCallback.current?.(value.transaction_id); }
    } catch (error) { if (mounted.current && currentId.current === id && serial === contentSerial.current.evidence) { observeBackoff(error); setEvidence({ data: null, loading: false, error: messageFor(error) }); transactionCallback.current?.(null); } }
  }, [observeBackoff]);
  const loadDetail = useCallback(async (id: string, force = false, refreshEvidence = false) => {
    if (retryUntilRef.current > Date.now()) return null;
    const serial = ++loadSerial.current;
    setDetailLoading(true);
    try {
      const value = await api<CaseOut>(`${BASE}/${id}`);
      if (!mounted.current || currentId.current !== id || serial !== loadSerial.current) return null;
      const previous = detailRef.current;
      if (previous?.id === value.id && previous.version > value.version) return previous;
      detailRef.current = value; setDetail(value); setDetailError(null); setReadAt(Date.now());
      setRows(items => items.some(item => item.id === value.id) ? mergeCases(items, [value]) : items);
      if (force || previous?.id !== id || previous.version !== value.version) {
        void loadHistory(id); void loadNotes(id);
      }
      if (refreshEvidence || previous?.id !== id) void loadEvidence(id);
      return value;
    } catch (error) {
      if (mounted.current && currentId.current === id && serial === loadSerial.current) {
        observeBackoff(error);
        const message = messageFor(error); setDetailError(message);
        if (["missing", "expired", "sessionExpired"].includes(message)) { contentSerial.current.history++; contentSerial.current.notes++; contentSerial.current.evidence++; setDetail(null); detailRef.current = null; setHistory(readState()); setNotes(readState()); setEvidence(readState()); transactionCallback.current?.(null); }
      }
      return null;
    } finally { if (mounted.current && currentId.current === id && serial === loadSerial.current) setDetailLoading(false); }
  }, [loadHistory, loadNotes, loadEvidence, observeBackoff]);

  useEffect(() => {
    if (!ready) return;
    void loadList(); void loadAnalytics();
    // Case evidence and content refresh on selection or an explicit operator action.
    const timer = setInterval(() => { if (document.visibilityState === "visible" && !lock.current) { void loadList(); void loadAnalytics(); } }, 60_000);
    return () => clearInterval(timer);
  }, [ready, revision, loadList, loadAnalytics, loadDetail]);
  useEffect(() => {
    if (!ready) return;
    contentSerial.current.history++; contentSerial.current.notes++; contentSerial.current.evidence++;
    setDetail(null); detailRef.current = null; setDetailError(null); setHistory(readState()); setNotes(readState()); setEvidence(readState()); setReadAt(null);
    setProposal(null); setConflict(null); setActionError(null); setNotice(null); setNote("");
    transactionCallback.current?.(null);
    if (session.selectedId) void loadDetail(session.selectedId, true);
  }, [session.selectedId, ready, loadDetail]);
  useEffect(() => {
    if (!detail) return;
    const remaining = Date.parse(detail.expires_at) - Date.now();
    if (remaining > 0) { const timer = setTimeout(() => setClock(Date.now()), Math.min(remaining + 1, 2_147_483_647)); return () => clearTimeout(timer); }
    contentSerial.current.history++; contentSerial.current.notes++; contentSerial.current.evidence++; loadSerial.current++;
    setDetail(null); detailRef.current = null; setDetailLoading(false); setDetailError("expired");
    setHistory(readState()); setNotes(readState()); setEvidence(readState()); setProposal(null); setNote(""); transactionCallback.current?.(null);
  }, [detail, clock]);
  useEffect(() => {
    if (!current) return;
    if (!caseTransitions[current.state].includes(nextState as CaseOut["state"])) setNextState(caseTransitions[current.state][0]);
    if (current.state === "CLOSED") setReason("reopened");
  }, [current?.state, nextState]);

  const refresh = () => { void loadList(null, true); void loadAnalytics(); if (currentId.current) void loadDetail(currentId.current, true, true); };
  function select(id: string) { if (!busy && !unresolved && !throttled) setSession(value => ({ ...value, selectedId: id })); }
  function persistMarker(marker: CaseSession["pending"]) {
    const next = { ...sessionRef.current, pending: marker }; sessionRef.current = next; setSession(next);
    // Synchronous write before POST means reload can warn even if the response is lost.
    try { sessionStorage.setItem(CASE_SESSION_KEY, serializeCaseSession(next)); } catch { setStorageFailed(true); }
  }
  function prepareAction() {
    if (!current || !editable) return;
    const fields = kind === "assign" ? { assignee: assignee || null } : kind === "transition" ? { state: nextState, reason }
      : kind === "note" ? { body: note.trim() } : kind === "categorize" ? { category } : { question };
    const parsed = caseActionSchema.safeParse({ action: kind, expected_version: current.version, ...fields });
    if (!parsed.success || !actionAllowed(current, parsed.data)) { setActionError("invalid"); return; }
    setActionError(null); setNotice(null); setProposal({ caseId: current.id, key: randomId(), body: parsed.data, createdAt: Date.now() });
  }
  function prepareOpen() {
    const parsed = openCaseSchema.safeParse({ report_id: reportId.trim() });
    if (!parsed.success || busy || unresolved || throttled) { setActionError("invalid"); return; }
    setActionError(null); setNotice(null); setProposal({ caseId: null, key: randomId(), body: parsed.data, createdAt: Date.now() });
  }
  async function perform(intent: CaseIntent) {
    if (lock.current || retryUntilRef.current > Date.now()) return;
    const retryingUnknown = pending?.key === intent.key && sessionRef.current.pending?.key === intent.key;
    lock.current = true; setBusy(true); setActionError(null); setNotice(null); setProposal(null); setConflict(null); setPending(intent); persistMarker(intentMarker(intent));
    try {
      const value = await api<CaseOut>(intent.caseId ? `${BASE}/${intent.caseId}/actions` : BASE, { method: "POST", headers: { "Idempotency-Key": intent.key }, body: JSON.stringify(intent.body) });
      if (!mounted.current) return;
      persistMarker(null); setPending(null); setNotice("saved"); setNote(""); setReportId("");
      setRows(previous => mergeCases(previous, [value]));
      if (!intent.caseId) { currentId.current = value.id; setSession(previous => ({ ...previous, selectedId: value.id })); }
      // An idempotent replay may return an older receipt. GET reconciles the current version.
      if (currentId.current === value.id) {
        if (!detailRef.current || detailRef.current.id !== value.id || detailRef.current.version <= value.version) { detailRef.current = value; setDetail(value); }
        await loadDetail(value.id, true);
      }
      void loadAnalytics();
    } catch (error) {
      if (!mounted.current) return;
      observeBackoff(error);
      // Rejecting a retry does not prove that the original timed-out request failed.
      if (retryingUnknown) { setActionError(messageFor(error)); }
      else if (error instanceof ApiError && error.status === 409 && ["case_version_conflict", "case_write_conflict"].includes(error.code) && intent.caseId) {
        persistMarker(null); setPending(null); setConflict(intent);
        const fresh = await loadDetail(intent.caseId, true);
        setActionError(fresh ? (rebaseCaseAction(intent, fresh) ? "conflict" : "conflictInvalid") : "unavailable");
      } else if (definiteRejection(error)) {
        persistMarker(null); setPending(null); setActionError(messageFor(error));
        if (intent.caseId && !(error instanceof ApiError && error.status === 429)) await loadDetail(intent.caseId, true);
      } else { setActionError("unknown"); }
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  function confirmConflict() {
    if (!conflict || !current || detailError || detailLoading) return;
    const rebased = rebaseCaseAction(conflict, current);
    if (!rebased) { setActionError("conflictInvalid"); return; }
    void perform({ ...conflict, body: rebased, key: randomId(), createdAt: Date.now() });
  }
  const visible = filterCases(rows.filter(item => Date.parse(item.expires_at) > clock), session);
  const expireMessage = detail && !current ? "expired" : null;
  const proposalBody = proposal?.body;
  const pendingDescription = proposalBody && "action" in proposalBody ? c(proposalBody.action) : c("openCase");

  return <section className="soc-cases-workspace panel" aria-labelledby="soc-cases-title">
    <header className="soc-cases-heading"><div><span className="soc-case-eyebrow">SAQ BOL / SOC</span><h2 id="soc-cases-title"><ClipboardList size={21} />{c("title")}</h2><p>{c("subtitle")}</p></div><button type="button" className="secondary case-refresh" onClick={refresh} disabled={!ready || busy || listLoading || throttled}><RefreshCw size={16} />{c("refresh")}</button></header>
    <p className="soc-case-advisory"><ShieldCheck size={17} />{c("advisory")}</p>
    {throttled && <p className="soc-case-warning case-rate-limit" role="status">{c("rateLimited")} {Math.ceil((retryUntil - clock) / 1_000)} {c("seconds")}</p>}
    {storageFailed && <p className="soc-case-warning" role="status">{c("storageUnavailable")}</p>}
    {analytics && <><div className="soc-case-kpis">{(["total", "open", "closed", "escalated"] as const).map(key => <div key={key}><span>{c(key)}</span><strong>{key === "escalated" ? analytics.escalated_cases : analytics[key]}</strong></div>)}</div><p className="soc-case-scope">{c("analyticsScope")} · {date(analytics.as_of)}</p></>}{showError(analyticsError)}
    <div className="soc-cases-layout"><aside className="soc-cases-list" aria-label={c("filters")}>
      <div className="soc-case-filters"><label htmlFor="soc-case-status">{c("status")}<select id="soc-case-status" value={session.status} onChange={event => setSession(value => ({ ...value, status: event.target.value as CaseSession["status"] }))}><option value="all">{c("all")}</option>{caseStates.map(state => <option key={state} value={state}>{c(state)}</option>)}</select></label><label htmlFor="soc-case-assignee">{c("assignee")}<select id="soc-case-assignee" value={session.assignee} onChange={event => setSession(value => ({ ...value, assignee: event.target.value as CaseSession["assignee"] }))}><option value="all">{c("all")}</option><option value="unassigned">{c("unassigned")}</option>{caseStaff.map(value => <option key={value} value={value}>{staff(value)}</option>)}</select></label><label htmlFor="soc-case-since">{c("since")}<input id="soc-case-since" type="date" value={session.since} onChange={event => setSession(value => ({ ...value, since: event.target.value }))} /></label><button type="button" className="soc-case-reset" onClick={() => setSession(value => ({ ...value, status: "all", assignee: "all", since: "" }))}>{c("reset")}</button></div>
      <p className="soc-case-scope">{c("filterScope")}</p>{showError(listError)}
      <ul className="soc-case-rows" aria-busy={listLoading}>{visible.map(item => <li key={item.id}><button type="button" className={`soc-case-row${session.selectedId === item.id ? " selected" : ""}`} data-case-id={item.id} aria-pressed={session.selectedId === item.id} disabled={busy || unresolved || throttled} onClick={() => select(item.id)}><span className={`soc-case-badge state-${item.state}`}>{c(item.state)}</span><strong>{c(item.category)}</strong><small>{c(item.source)} · {staff(item.assignee)}</small><time dateTime={item.created_at}>{date(item.created_at)}</time><code>{item.id}</code></button></li>)}</ul>
      {!visible.length && !listError && <p className="soc-case-empty">{c(listLoading ? "loading" : rows.length ? "noMatches" : "empty")}</p>}
      <p className="soc-case-scope">{c("loaded")}: {rows.length}</p>{nextCursor && <button type="button" className="secondary case-load-more" disabled={listLoading || busy || throttled} onClick={() => void loadList(nextCursor)}>{c("loadMore")}</button>}
      <details className="soc-case-open"><summary><Plus size={15} />{c("openCase")}</summary><form onSubmit={event => { event.preventDefault(); prepareOpen(); }}><label htmlFor="soc-case-report">{c("reportId")}<input id="soc-case-report" value={reportId} onChange={event => setReportId(event.target.value)} maxLength={36} autoComplete="off" placeholder="00000000-0000-4000-8000-000000000000" disabled={busy || unresolved || throttled} /></label><p>{c("openHint")}</p><button className="secondary" disabled={busy || unresolved || !ready || throttled}>{c("preview")}</button></form></details>
    </aside>
    <div className="soc-case-detail" data-case-id={session.selectedId ?? ""} aria-busy={detailLoading}>
      {unresolved && <aside className="case-unknown soc-case-warning" role="alert"><AlertTriangle size={20} /><div><p>{c(pending ? "unknown" : "reloadUnknown")}</p><p>{c("pendingBlocksNavigation")}</p>{pending ? <button type="button" className="secondary case-unknown-retry" disabled={busy || throttled} onClick={() => void perform(pending)}>{busy ? c("applying") : c("exactRetry")}</button> : <><button type="button" className="secondary" disabled={detailLoading || busy || throttled} onClick={refresh}>{c("retry")}</button><button type="button" className="secondary case-reload-ack" disabled={throttled || detailLoading || !!detailError || history.loading || !!history.error || (!!session.pending?.caseId && (!current || !history.data || history.data.next_after_version !== null))} onClick={() => { persistMarker(null); setActionError(null); }}>{c("reviewedHistory")}</button></>}</div></aside>}
      {proposal && <aside className="case-action-preview"><h3>{c("confirm")}</h3><p>{pendingDescription}</p>{proposalBody && "action" in proposalBody ? <><p>{c("version")}: {proposalBody.expected_version}</p>{proposalBody.action === "assign" && <strong>{staff(proposalBody.assignee)}</strong>}{proposalBody.action === "transition" && <strong>{c(proposalBody.state)} · {c(proposalBody.reason)}</strong>}{proposalBody.action === "note" && <p className="soc-case-text">{proposalBody.body}</p>}{proposalBody.action === "categorize" && <strong>{c(proposalBody.category)}</strong>}{proposalBody.action === "request_information" && <p>{c(proposalBody.question === "remote_access" ? "remote_access_question" : proposalBody.question)}</p>}</> : proposalBody && <code>{proposalBody.report_id}</code>}<div><button type="button" className="primary case-action-confirm" disabled={busy || unresolved || throttled || (proposal.caseId !== null && (!current || !!detailError || detailLoading))} onClick={() => void perform(proposal)}>{c("confirm")}</button><button type="button" className="secondary" disabled={busy || throttled} onClick={() => setProposal(null)}>{c("back")}</button></div></aside>}
      {showError(detailError ?? expireMessage)}
      {!current ? <p className="soc-case-empty">{c(detailLoading ? "loading" : "selectCase")}</p> : <>
        <div className="soc-case-detail-heading"><div><h3>{c("detail")}</h3><code>{current.id}</code></div><span className={`soc-case-badge state-${current.state}`}>{c(current.state)}</span></div>
        <dl className="soc-case-meta"><div><dt>{c("assignee")}</dt><dd><UserRound size={14} />{staff(current.assignee)}</dd></div><div><dt>{c("category")}</dt><dd>{c(current.category)}</dd></div><div><dt>{c("source")}</dt><dd>{c(current.source)}</dd></div><div><dt>{c("version")}</dt><dd className="tabular-nums">{current.version}</dd></div><div><dt>{c("created")}</dt><dd>{date(current.created_at)}</dd></div><div><dt>{c("expires")}</dt><dd>{date(current.expires_at)}</dd></div></dl>
        {readAt && <p className="soc-case-scope">{c("latest")}: {date(readAt)} · UTC+5</p>}
        {evidence.data?.transaction_id ? <button type="button" className="soc-case-transfer" onClick={() => transactionCallback.current?.(evidence.data!.transaction_id)}>{c("relatedTransfer")}<code>{evidence.data.transaction_id}</code><ArrowRight size={15} /></button> : !evidence.loading && !evidence.error && <p className="soc-case-scope">{c("noTransfer")}</p>}{showError(evidence.error)}
        {conflict && <aside className="case-conflict soc-case-warning" role="alert"><p>{c("conflict")}</p><p>{c("version")}: {current.version}</p><button type="button" className="primary case-conflict-confirm" disabled={busy || throttled || detailLoading || !!detailError || !rebaseCaseAction(conflict, current)} onClick={confirmConflict}>{c("reconfirm")}</button><button type="button" className="secondary" onClick={() => { setConflict(null); setActionError(null); }}>{c("back")}</button></aside>}
        {showError(actionError)}{notice && <p className="soc-case-success" role="status"><CheckCircle2 size={16} />{c(notice)}</p>}
        <form className="soc-case-composer" onSubmit={event => { event.preventDefault(); prepareAction(); }}><fieldset disabled={!editable || !!proposal}><legend>{c("action")}</legend><label htmlFor="case-action-kind">{c("action")}<select id="case-action-kind" value={kind} onChange={event => { setKind(event.target.value as CaseAction["action"]); setActionError(null); }}>{(["assign", "transition", "note", "request_information", "categorize"] as const).map(value => <option key={value} value={value} disabled={value !== "transition" && ["CLOSED", "RESOLVED"].includes(current.state)}>{c(value)}</option>)}</select></label>
          {kind === "assign" && <label htmlFor="case-assignee">{c("assignee")}<select id="case-assignee" value={assignee} onChange={event => setAssignee(event.target.value)}><option value="">{c("unassigned")}</option>{caseStaff.map(value => <option key={value} value={value}>{staff(value)}</option>)}</select></label>}
          {kind === "transition" && <div className="soc-case-form-row"><label htmlFor="case-next-state">{c("nextState")}<select id="case-next-state" value={nextState} onChange={event => setNextState(event.target.value)}>{caseTransitions[current.state].map(value => <option key={value} value={value}>{c(value)}</option>)}</select></label><label htmlFor="case-reason">{c("reason")}<select id="case-reason" value={reason} disabled={current.state === "CLOSED"} onChange={event => setReason(event.target.value)}>{caseReasons.map(value => <option key={value} value={value}>{c(value)}</option>)}</select></label></div>}
          {kind === "note" && <label htmlFor="case-note">{c("note")}<textarea id="case-note" rows={3} minLength={10} maxLength={500} value={note} onChange={event => setNote(event.target.value)} aria-describedby="case-note-hint" /><small id="case-note-hint">{c("noteHint")}</small></label>}
          {kind === "categorize" && <label htmlFor="case-category">{c("category")}<select id="case-category" value={category} onChange={event => setCategory(event.target.value)}>{caseCategories.map(value => <option key={value} value={value}>{c(value)}</option>)}</select></label>}
          {kind === "request_information" && <><label htmlFor="case-question">{c("question")}<select id="case-question" value={question} onChange={event => setQuestion(event.target.value)}>{caseQuestions.map(value => <option key={value} value={value}>{c(value === "remote_access" ? "remote_access_question" : value)}</option>)}</select></label><p className="soc-case-scope">{c(current.source === "trusted_contact" ? "infoUnavailable" : "infoHint")}</p></>}
          {["CLOSED", "RESOLVED"].includes(current.state) && <p className="soc-case-scope">{c("closedHint")}</p>}
          <button className="primary case-action-submit" disabled={!editable || (kind !== "transition" && ["CLOSED", "RESOLVED"].includes(current.state)) || (kind === "request_information" && (current.source === "trusted_contact" || !["IN_REVIEW", "ESCALATED"].includes(current.state)))}>{busy ? <LoaderCircle size={16} className="animate-spin" /> : <ShieldCheck size={16} />}{c("preview")}</button>
        </fieldset></form>
        <section className="case-history"><h3><History size={17} />{c("history")}</h3>{showError(history.error)}{!history.data?.items.length && <p className="soc-case-empty">{c(history.loading ? "loading" : "historyEmpty")}</p>}<ol>{history.data?.items.map(event => <li key={event.id}><span className="soc-case-event-dot" /><div><strong>{lang === "kk" ? event.description_kk : event.description_ru}</strong><p>{c(event.state)} · {c(event.actor_role === "soc" ? "operator" : "customer")}</p><small><Clock3 size={12} />{date(event.timestamp)} · v{event.version}</small></div></li>)}</ol>{history.data?.next_after_version !== null && history.data?.next_after_version !== undefined && <button type="button" className="secondary case-history-more" disabled={history.loading || throttled} onClick={() => void loadHistory(current.id, history.data!.next_after_version!)}>{c("moreHistory")}</button>}</section>
        <section className="case-notes"><h3><MessageSquare size={17} />{c("notes")}</h3>{showError(notes.error)}{!notes.data?.items.filter(item => Date.parse(item.expires_at) > clock).length && <p className="soc-case-empty">{c(notes.loading ? "loading" : "notesEmpty")}</p>}{notes.data?.items.filter(item => Date.parse(item.expires_at) > clock).map(item => { const event = history.data?.items.find(value => value.id === item.event_id); return <article key={item.event_id}><strong><FileText size={14} />{event ? lang === "kk" ? event.description_kk : event.description_ru : c("notes")}</strong><p className="soc-case-text">{item.body}</p><small>{c("contentExpiry")}: {date(item.expires_at)}</small></article>; })}{notes.data?.next_after_version !== null && notes.data?.next_after_version !== undefined && <button type="button" className="secondary case-notes-more" disabled={notes.loading || throttled} onClick={() => void loadNotes(current.id, notes.data!.next_after_version!)}>{c("moreNotes")}</button>}</section>
      </>}
      {!current && showError(actionError)}
    </div></div>
  </section>;
}

