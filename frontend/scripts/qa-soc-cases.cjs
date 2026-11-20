/* SOC browser contract QA. ALL API requests are mocked; no real case, transfer or Telegram mutation. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const target = process.argv[2];
assert.ok(target && ['localhost', '127.0.0.1'].includes(new URL(target).hostname), 'Pass an explicit localhost preview URL');
const output = path.resolve(process.env.QA_OUTPUT || path.join(__dirname, '../../.local-checks', `soc-cases-${Date.now()}`));
const uuid = value => `30000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
const now = () => new Date().toISOString();
const expires = () => new Date(Date.now() + 86400000).toISOString();
const caseA = uuid(1), caseB = uuid(2), caseC = uuid(3), transactionId = uuid(70);
const base = '/api/v1/integrations/guardian/soc/cases';
const sensitiveNote = 'QA синтетическая заметка для проверки восстановления';
const records = new Map([1, 2, 3].map(value => [uuid(value), {
  id: uuid(value), report_id: uuid(100 + value), source: value === 2 ? 'trusted_contact' : 'owner_demo',
  category: value === 2 ? 'remote_access' : 'safe_account', state: value === 1 ? 'NEW' : 'IN_REVIEW',
  assignee: value === 2 ? 'demo_analyst_b' : null, version: 1,
  created_at: now(), status_since: now(), expires_at: expires(), demonstration_only: true,
}]));
const history = new Map(), notes = new Map(), receipts = new Map();
const presetTransfers = new Map();
let eventId = 1000;
function append(item, code, body, actor = 'soc') {
  const event = { id: uuid(eventId++), actor_id: uuid(actor === 'soc' ? 80 : 81), version: item.version,
    code, actor_role: actor, timestamp: now(), state: item.state, category: item.category,
    assignee: item.assignee, reason: null, description_ru: `QA: ${code} сохранено`, description_kk: `QA: ${code} сақталды` };
  history.set(item.id, [...(history.get(item.id) || []), event]);
  if (body) notes.set(item.id, [...(notes.get(item.id) || []), { event_id: event.id, body, expires_at: expires() }]);
}
for (const item of records.values()) append(item, 'OPENED');
append(records.get(caseA), 'INFORMATION_RECEIVED', 'QA синтетический ответ клиента', 'owner');
const fixture = { disabled: false, conflict: false, unknown: false, throttle: false, expired: new Set(), timelineAsOf: now() };
const health = () => ({ status: 'degraded', checked_at: now(), cache_seconds: 5, database: 'ok', redis: 'unavailable', worker: 'unknown', telegram: 'test_enabled', gateway: 'mock_ready', queue: null, last_successful_processing: null, real_provider_probed: false });
const report = { target, mocked_api: true, started_at: now(), checks: [], requests: [], mutations: [], errors: [], screenshots: [] };
const check = (name, passed, detail) => { report.checks.push({ name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) }); assert.ok(passed, name); };
function analytics() {
  const items = [...records.values()]; const by_state = {};
  for (const item of items) by_state[item.state] = (by_state[item.state] || 0) + 1;
  return { as_of: now(), total: items.length, open: items.filter(item => item.state !== 'CLOSED').length,
    closed: by_state.CLOSED || 0, by_state, by_source: { owner_demo: 2, trusted_contact: 1 },
    escalated_cases: by_state.ESCALATED || 0, manually_reviewed_cases: 1, manual_review_share: 1 / 3,
    oldest_current_status_seconds: { NEW: 15, IN_REVIEW: 30 }, demonstration_only: true };
}
function apply(item, body) {
  item.version += 1;
  if (body.action === 'assign') item.assignee = body.assignee;
  if (body.action === 'categorize') item.category = body.category;
  if (body.action === 'transition') { item.state = body.state; item.status_since = now(); }
  if (body.action === 'request_information') { item.state = 'NEEDS_INFORMATION'; item.status_since = now(); }
  append(item, body.action.toUpperCase(), body.action === 'note' ? body.body : null);
  return structuredClone(item);
}
async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ru-KZ', reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.addInitScript(() => { if (!localStorage.getItem('bcc-shield.locale')) localStorage.setItem('bcc-shield.locale', 'ru'); });
  await context.route('**/*', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.abort('blockedbyclient'));
  await context.route('**/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method(), pathname = url.pathname;
    report.requests.push({ method, path: pathname, search: url.search, time: Date.now() });
    const body = method === 'POST' ? request.postDataJSON() : null;
    const key = request.headers()['idempotency-key'];
    if (method === 'POST') report.mutations.push({ path: pathname, body, key, intercepted: true });
    if (pathname === '/api/v1/transfers/evaluate' && method === 'POST') {
      const id = body.request_id;
      if (!presetTransfers.has(id)) presetTransfers.set(id, { transaction_id: id, status: 'blocked', risk_score: 90,
        amount: body.amount, server_time: now(), created_at: now(), updated_at: now(), context: body.context,
        headline_kk: 'QA: дроппер бұғатталды', headline_ru: 'QA: дроппер заблокирован', reasons_kk: [], reasons_ru: [], reasons: [],
        latency_ms: 1.3, layer_latency_ms: {}, cooling_off_until: null, is_new_recipient: true, is_new_device: false,
        recipient: { id: uuid(72), display_name: 'QA Drop Hub', iban_masked: '•••• 4821' }, verification_answers: null });
      return route.fulfill({ json: presetTransfers.get(id) });
    }
    if (pathname.startsWith('/api/v1/transfers/') && presetTransfers.has(pathname.split('/').at(-1))) return route.fulfill({ json: presetTransfers.get(pathname.split('/').at(-1)) });
    if (pathname.startsWith('/api/v1/integrations/') && fixture.disabled) return route.fulfill({ status: 503, json: { error: 'integrationsUnavailable' } });
    if (pathname === base && method === 'GET') return route.fulfill({ json: { items: url.searchParams.has('cursor') ? [records.get(caseC)] : [records.get(caseA), records.get(caseB)], next_cursor: url.searchParams.has('cursor') ? null : 'qa-next-page' } });
    if (pathname === `${base}/analytics`) return route.fulfill({ json: analytics() });
    const match = pathname.match(/\/guardian\/soc\/cases\/([0-9a-f-]{36})(?:\/(actions|history|notes|evidence|export))?$/i);
    if (match) {
      const item = records.get(match[1]);
      if (!item) return route.fulfill({ status: 404, json: { error: 'case_not_found' } });
      if (fixture.expired.has(item.id)) return route.fulfill({ status: 410, json: { error: 'case_expired' } });
      if (match[2] === 'actions' && method === 'POST') {
        if (fixture.throttle) { fixture.throttle = false; return route.fulfill({ status: 429, headers: { 'Retry-After': '1' }, json: { error: 'rate_limited' } }); }
        if (receipts.has(key)) return route.fulfill({ json: receipts.get(key) });
        if (fixture.conflict) { fixture.conflict = false; item.version += 1; append(item, 'ASSIGN'); return route.fulfill({ status: 409, json: { error: 'case_version_conflict' } }); }
        if (body.expected_version !== item.version) return route.fulfill({ status: 409, json: { error: 'case_version_conflict' } });
        const result = apply(item, body); receipts.set(key, result);
        if (fixture.unknown) { fixture.unknown = false; return route.fulfill({ status: 503, json: { error: 'apiError' } }); }
        return route.fulfill({ json: result });
      }
      if (match[2] === 'history') return route.fulfill({ json: { items: history.get(item.id) || [], next_after_version: null } });
      if (match[2] === 'notes') return route.fulfill({ json: { items: notes.get(item.id) || [], next_after_version: null } });
      if (match[2] === 'evidence') return route.fulfill({ json: { report_available: true, transaction_id: item.id === caseA ? transactionId : null, report_events: [], advisory_only: true } });
      if (match[2] === 'export') return route.fulfill({ json: { category: item.category, state: item.state, source: item.source, created_at: item.created_at, events: (history.get(item.id) || []).map(event => ({ code: event.code, state: event.state, timestamp: event.timestamp })), demonstration_only: true } });
      return route.fulfill({ json: item });
    }
    if (pathname === '/api/v1/integrations/health/details') return route.fulfill({ json: health() });
    if (pathname === `/api/v1/integrations/soc/transactions/${transactionId}/timeline`) return route.fulfill({ json: {
      transaction_id: transactionId, as_of: fixture.timelineAsOf, events: [{ id: url.searchParams.has('cursor') ? 'qa-event-second' : 'qa-event-first', timestamp: now(),
        category: 'gateway', importance: 'attention', code: 'MOCK_UNAVAILABLE', correlation_id: uuid(80), source: 'integration_audit',
        description_ru: url.searchParams.has('cursor') ? 'QA: продолжение истории' : 'QA: внешняя проверка недоступна',
        description_kk: url.searchParams.has('cursor') ? 'QA: тарихтың жалғасы' : 'QA: сыртқы тексеріс қолжетімсіз' }],
      next_cursor: url.searchParams.has('cursor') ? null : 'qa-timeline-cursor', advisory_only: true,
    } });
    if (pathname === `/api/v1/integrations/soc/transactions/${transactionId}/summary`) return route.fulfill({ json: {
      transaction_id: transactionId, core_status: 'cooling_off', cooling_until: expires(), cooling_active: true,
      consents: [], notifications: [], recent_events: [], manual_review_reasons: ['gateway_unavailable'], manual_review_requested: true,
      description_ru: 'QA: рекомендовано ручное рассмотрение', description_kk: 'QA: қолмен қарау ұсынылды', health: health(), advisory_only: true,
      gateway_results: [{ id: uuid(90), correlation_id: uuid(80), transaction_id: transactionId, fresh: false, cache_hit: false,
        description_ru: 'QA: результат устарел', description_kk: 'QA: нәтиже ескірген',
        result: { source: 'MOCK', identifier: 'SYN-QA-DEMO', status: 'UNAVAILABLE', markers: [], checked_at: now(), expires_at: expires(),
          verified: false, error_code: 'EXPIRED_RESULT', advisory_only: true } }],
    } });
    if (pathname === `/api/v1/transfers/${transactionId}`) return route.fulfill({ json: {
      transaction_id: transactionId, status: 'cooling_off', risk_score: 65, amount: '150000', server_time: now(),
      headline_kk: 'QA: аударым күтілуде', headline_ru: 'QA: перевод на удержании', reasons_kk: [], reasons_ru: [], reasons: [],
      latency_ms: 1.3, layer_latency_ms: {}, cooling_off_until: expires(), is_new_recipient: true, is_new_device: false,
      recipient: { id: uuid(71), display_name: 'QA алушы', iban_masked: '•••• 4821' }, verification_answers: null,
    } });
    if (pathname.includes('/soc/graph/')) return route.fulfill({ json: { center: url.pathname.split('/').at(-1), depth: Number(url.searchParams.get('depth') || 1), nodes: [], edges: [] } });
    if (pathname.endsWith('/soc/feed')) return route.fulfill({ json: { server_time: now(), items: [], pagination: { total_filtered: 0, offset: 0, limit: 25, has_more: false }, stats: { total: 0, approved: 0, cooling_off: 0, blocked: 0, blocked_hubs: 0, avg_latency_ms: 0, max_latency_ms: 0, p95_latency_ms: null, latency_sample_size: 0, latency_sample_limit: 500 } } });
    return route.fulfill({ status: 404, json: { error: 'notFound' } });
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('dialog', dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss());
  const workspace = page.locator('.soc-cases-workspace'), detail = page.locator('.soc-case-detail');
  const settle = () => page.waitForTimeout(250);
  const screenshot = async name => { const file = path.join(output, `${name}.png`); await page.screenshot({ path: file, fullPage: true }); report.screenshots.push(file); };
  const language = lang => page.locator('.topbar').getByRole('button', { name: lang === 'kk' ? 'ҚАЗ' : 'РУС', exact: true }).click();
  const selectCase = async id => { await workspace.locator(`.soc-case-row[data-case-id="${id}"]`).click(); await page.locator(`.soc-case-detail[data-case-id="${id}"]`).waitFor(); await page.locator('#case-action-kind').waitFor(); };
  const prepare = async (action, selector, value) => { await page.locator('#case-action-kind').selectOption(action); if (selector) { const field = page.locator(selector); if (await field.evaluate(node => node.tagName === 'SELECT')) await field.selectOption(value); else await field.fill(value); } await page.locator('.case-action-submit').click(); await page.locator('.case-action-confirm').waitFor(); };
  const confirm = async () => { const sent = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname.startsWith(base)); await page.locator('.case-action-confirm').click(); await sent; await page.waitForFunction(() => !document.querySelector('.case-action-confirm')); await settle(); };
  try {
    await page.goto(target, { waitUntil: 'domcontentloaded' }); await page.locator('#tab-soc').click();
    await page.getByTestId('soc-mode-cases').click(); await workspace.waitFor(); await workspace.locator('.soc-case-row').first().waitFor();
    check('queue_reads_backend_cases', await workspace.locator('.soc-case-row').count() === 2);
    check('queue_has_explicit_pagination', await workspace.locator('.case-load-more').isVisible());
    await workspace.locator('.case-load-more').click(); await settle();
    check('queue_cursor_appends_without_duplicates', await workspace.locator('.soc-case-row').count() === 3 && report.requests.some(item => item.path === base && item.search.includes('cursor=qa-next-page')));
    await page.locator('#soc-case-status').selectOption('NEW');
    check('status_filter_uses_loaded_case_state', await workspace.locator('.soc-case-row').count() === 1);
    await selectCase(caseA); await page.locator('.case-history').getByText('QA: OPENED сохранено', { exact: true }).waitFor();
    check('authoritative_case_detail_and_history', await detail.getAttribute('data-case-id') === caseA && (await page.locator('.case-history').innerText()).includes('OPENED'));
    await page.locator('.case-notes').getByText('QA синтетический ответ клиента', { exact: true }).waitFor();
    check('customer_reply_visible_in_notes', (await page.locator('.case-notes').innerText()).includes('QA синтетический ответ клиента'));
    await page.getByTestId('incident-timeline').getByText('QA: внешняя проверка недоступна', { exact: true }).waitFor();
    await page.locator('.gateway-results').waitFor();
    const healthText = await page.getByTestId('integration-health').innerText();
    check('health_distinguishes_unknown_from_healthy_and_test_from_delivery', healthText.includes('TEST') && healthText.includes('доступность не проверена') && healthText.includes('MOCK') && healthText.includes('неизвест') && await page.locator('.integration-queue').count() === 0, healthText);
    check('gateway_result_explicitly_unverified_and_advisory', (await page.locator('.integration-gateway').innerText()).includes('Результат устарел или не подтверждён'));
    await page.getByTestId('incident-more').click();
    await page.getByTestId('incident-timeline').getByText('QA: продолжение истории', { exact: true }).waitFor();
    check('timeline_cursor_appends_same_snapshot_without_duplicates', await page.locator('.incident-events li').count() === 2 && report.requests.some(item => item.search.includes('cursor=qa-timeline-cursor')));
    const insightRead = item => item.path.includes('/integrations/soc/transactions/') || item.path.endsWith('/health/details');
    const idleReadCount = report.requests.filter(insightRead).length;
    await page.waitForTimeout(1200);
    check('integration_cards_do_not_rapidly_poll_shared_capability', report.requests.filter(insightRead).length === idleReadCount);
    await page.evaluate(() => { window.__qaSocNoReload = true; }); await language('kk');
    check('kazakh_switch_preserves_case_without_reload', await detail.getAttribute('data-case-id') === caseA && await page.evaluate(() => window.__qaSocNoReload) === true && (await workspace.innerText()).includes('Істі қарау'));
    check('timeline_explanations_translate_live', (await page.getByTestId('incident-timeline').innerText()).includes('QA: сыртқы тексеріс қолжетімсіз'));
    await language('ru');
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('#case-action-kind').waitFor();
    check('reload_restores_soc_cases_and_selected_case', await page.locator('#tab-soc').getAttribute('aria-selected') === 'true' && await detail.getAttribute('data-case-id') === caseA && await page.locator('#soc-case-status').inputValue() === 'NEW');
    await page.locator('#soc-case-status').selectOption('all');
    const beforePreview = report.mutations.length;
    await prepare('assign', '#case-assignee', 'demo_analyst_a');
    check('preview_does_not_write_case', report.mutations.length === beforePreview);
    await confirm();
    check('assignment_is_versioned_and_idempotent', records.get(caseA).assignee === 'demo_analyst_a' && report.mutations.at(-1).body.expected_version === 1 && /^[0-9a-f-]{36}$/.test(report.mutations.at(-1).key));
    fixture.conflict = true;
    await prepare('transition', '#case-next-state', 'IN_REVIEW'); await confirm();
    await page.locator('.case-conflict').waitFor();
    const conflictRequest = report.mutations.at(-1), conflictCount = report.mutations.length;
    await settle();
    check('conflict_refresh_never_automatically_resubmits', report.mutations.length === conflictCount && records.get(caseA).state === 'NEW');
    await page.locator('.case-conflict-confirm').click(); await settle();
    if (await page.locator('.case-action-confirm').isVisible()) await confirm();
    check('conflict_requires_fresh_explicit_confirmation', records.get(caseA).state === 'IN_REVIEW' && report.mutations.at(-1).body.expected_version === records.get(caseA).version - 1 && report.mutations.at(-1).key !== conflictRequest.key);
    fixture.unknown = true;
    await prepare('note', '#case-note', sensitiveNote); await confirm(); await page.locator('.case-unknown-retry').waitFor();
    const unknownRequest = structuredClone(report.mutations.at(-1));
    check('unknown_result_blocks_new_action', await page.locator('#case-action-kind').isDisabled());
    fixture.throttle = true;
    await page.locator('.case-unknown-retry').click(); await page.locator('.case-rate-limit').waitFor();
    check('retry_rate_limit_preserves_original_unknown_intent', await page.locator('.case-unknown-retry').isDisabled() && await page.locator('#case-action-kind').isDisabled() && report.mutations.at(-1).key === unknownRequest.key && await page.evaluate(() => JSON.parse(sessionStorage.getItem('saq-bol-soc-cases-v1')).pending !== null));
    const readsAtThrottle = report.requests.filter(item => item.path.startsWith(base)).length;
    await page.waitForTimeout(350);
    check('rate_limit_stops_followup_reads', report.requests.filter(item => item.path.startsWith(base)).length === readsAtThrottle);
    await page.locator('.case-unknown-retry').click(); await settle();
    check('unknown_retry_reuses_exact_body_and_key', report.mutations.at(-1).key === unknownRequest.key && JSON.stringify(report.mutations.at(-1).body) === JSON.stringify(unknownRequest.body) && (notes.get(caseA) || []).filter(item => item.body === sensitiveNote).length === 1);
    await prepare('request_information', '#case-question', 'secrecy_pressure'); await confirm();
    check('question_creates_only_advisory_case_action', records.get(caseA).state === 'NEEDS_INFORMATION' && report.mutations.at(-1).body.question === 'secrecy_pressure' && report.mutations.every(item => item.path.startsWith(base)));
    await screenshot('soc-cases-ru');
    fixture.unknown = true;
    await prepare('note', '#case-note', 'QA ещё одна синтетическая заметка'); await confirm(); await page.locator('.case-unknown-retry').waitFor();
    const beforeReload = report.mutations.length;
    const storage = await page.evaluate(() => ({ session: { ...sessionStorage }, local: { ...localStorage } }));
    check('storage_has_only_recovery_metadata_no_case_text', !JSON.stringify(storage).includes(sensitiveNote) && !JSON.stringify(storage).includes('QA ещё одна') && JSON.parse(storage.session['saq-bol-soc-cases-v1']).pending?.key === report.mutations.at(-1).key);
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('.case-reload-ack').waitFor();
    check('unknown_reload_never_resubmits_or_reconstructs_private_body', report.mutations.length === beforeReload && await page.locator('#case-action-kind').isDisabled());
    await page.locator('.case-reload-ack').click(); await settle();
    check('manual_history_review_unlocks_new_intent', await page.locator('#case-action-kind').isEnabled() && report.mutations.length === beforeReload);
    await page.getByTestId('incident-more').click();
    await page.getByTestId('incident-timeline').getByText('QA: продолжение истории', { exact: true }).waitFor();
    await selectCase(caseB); await page.locator('#case-action-kind').selectOption('request_information');
    check('trusted_contact_case_cannot_send_owner_question', await page.locator('.case-action-submit').isDisabled());
    await settle();
    check('case_without_transfer_clears_previous_timeline_and_gateway', !(await page.getByTestId('incident-timeline').innerText()).includes(transactionId) && await page.locator('.integration-gateway').count() === 0);
    await selectCase(caseA);
    await page.getByTestId('incident-timeline').getByText('QA: внешняя проверка недоступна', { exact: true }).waitFor();
    check('returning_to_case_restarts_timeline_at_first_page', await page.locator('.incident-events li').count() === 1 && await page.getByTestId('incident-more').isVisible() && !report.requests.filter(item => item.path.endsWith('/timeline')).at(-1).search.includes('cursor='));
    fixture.expired.add(caseA);
    await page.locator('.case-refresh').click(); await settle();
    check('expired_case_removes_private_content_and_actions', !(await workspace.innerText()).includes(sensitiveNote) && await page.locator('#case-action-kind').count() === 0);
    fixture.expired.clear(); fixture.disabled = true;
    await page.reload({ waitUntil: 'domcontentloaded' }); await workspace.waitFor(); await settle();
    check('disabled_integration_is_explicit_not_demo_data', (await workspace.innerText()).includes('не подключена') && await workspace.locator('.soc-case-row').count() === 0 && await page.locator('#case-action-kind').count() === 0);
    await page.setViewportSize({ width: 390, height: 844 }); await settle();
    check('soc_small_viewport_has_no_document_overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    check('case_actions_have_no_transfer_or_telegram_mutations', report.mutations.length > 0 && report.mutations.every(item => item.intercepted && item.path.startsWith(base)));
    fixture.disabled = false;
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.preset').nth(2).click();
    await page.locator('.analysis-panel .badge.blocked').waitFor();
    check('hub_preset_explicitly_exits_cases_into_transfer_investigation', await page.getByTestId('soc-mode-transfers').getAttribute('aria-pressed') === 'true' && await workspace.count() === 0 && presetTransfers.size === 1);
    await page.getByTestId('soc-mode-cases').click(); await page.locator('#case-action-kind').waitFor();
    // Seed only this isolated browser's synthetic receipt. A mobile hold must not steal
    // focus from the operator's restored case; /mobile should still reopen that hold.
    await page.evaluate(id => {
      const selectedKey = Object.keys(localStorage).find(key => key.startsWith('saqbol.client.v1.') && key.endsWith('.selected'));
      if (!selectedKey) throw new Error('Expected the mobile client recovery scope after the hub preset');
      localStorage.setItem(selectedKey, id);
      const values = JSON.parse(localStorage.getItem('bcc-shield.recovery.v2') || '[]').filter(item => item.id !== id);
      localStorage.setItem('bcc-shield.recovery.v2', JSON.stringify([...values, { id, state: 'held', status: 'cooling_off', updatedAt: Date.now() }]));
    }, transactionId);
    const recoveredHold = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/transfers/${transactionId}`);
    await page.reload({ waitUntil: 'domcontentloaded' }); await recoveredHold; await page.locator('#case-action-kind').waitFor(); await settle();
    check('soc_reload_does_not_open_unrelated_mobile_hold_sheet', await workspace.isVisible() && await page.locator('dialog[open]').count() === 0);
    await page.goto(new URL('/mobile', target).href, { waitUntil: 'domcontentloaded' }); await page.locator('.phone-stage.is-bare').waitFor();
    await page.locator('.home-tools, .phone-form, .phone-receipt').first().waitFor();
    check('standalone_mobile_ignores_persisted_operator_tab', await page.locator('.soc-cases-workspace').count() === 0 && await page.locator('.phone-tabbar').isVisible());
    await page.locator('dialog[open]').waitFor();
    check('standalone_mobile_still_restores_held_questionnaire', await page.locator('.receipt-cooling_off').getAttribute('data-transaction-id') === transactionId);
    check('all_mutations_mocked_with_only_explicit_hub_evaluation', report.mutations.filter(item => item.path === '/api/v1/transfers/evaluate').length === 1 && report.mutations.every(item => item.intercepted && (item.path.startsWith(base) || item.path === '/api/v1/transfers/evaluate')));
    check('no_browser_runtime_errors', report.errors.length === 0, report.errors);
    report.success = true;
  } catch (error) {
    report.success = false; report.failure = String(error.stack || error); await screenshot('failure').catch(() => {}); throw error;
  } finally {
    report.finished_at = now(); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close(); console.log(JSON.stringify({ output, success: report.success, checks: report.checks.length, errors: report.errors }));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
