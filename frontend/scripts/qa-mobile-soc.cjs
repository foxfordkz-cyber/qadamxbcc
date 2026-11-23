/* Browser integration QA. Every /api/v1 request is intercepted; no real transfers are created. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const target = process.argv[2];
assert.ok(target && ['127.0.0.1', 'localhost'].includes(new URL(target).hostname), 'Pass an explicit localhost preview URL');
const output = path.resolve(process.env.QA_OUTPUT || path.join(__dirname, '../../.local-checks', `mobile-soc-${Date.now()}`));
const uuid = n => `20000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const questions = ['caller_claims_bank_or_police', 'asked_to_move_to_safe_account', 'asked_to_keep_secret_or_install_app', 'initiated_by_customer', 'knows_recipient_personally'];
const clean = [false, false, false, true, true];
const records = new Map();
const recipients = new Map();
const recipientFlags = new Map();
const flagReceipts = new Map();
const trustedMock = { enabled: false, notifications: [], posts: 0, polls: [] };
let expectedPreset = 'normal'; let nextId = 1; let resolveFailure = false; let detailFailure = false;
let flagConflictOnce = false; let flagLoseResponseOnce = false;
const report = { target, started_at: new Date().toISOString(), mocked_api: true, checks: [], errors: [], requests: [], mutations: [], screenshots: [] };
const check = (name, value, detail) => { report.checks.push({ name, passed: Boolean(value), ...(detail === undefined ? {} : { detail }) }); assert.ok(value, name); };
const timestamp = () => new Date().toISOString();
const party = (id, full_name) => ({ id, full_name, iban: `KZ11${'0'.repeat(12)}${id.slice(-4)}` });
function create(input) {
  const id = input.request_id || uuid(nextId++);
  if (records.has(id)) return records.get(id);
  const recipientKey = input.recipient_id || input.recipient_phone || input.recipient_iban;
  if (!recipients.has(recipientKey)) recipients.set(recipientKey, party(input.recipient_id || uuid(100 + nextId++), expectedPreset === 'hub' ? 'QA Drop Hub' : 'QA Получатель'));
  const recipient = recipients.get(recipientKey);
  const flagged = recipientFlags.get(recipient.id)?.flagged === true;
  const status = flagged || expectedPreset === 'hub' ? 'blocked' : input.context.active_call ? 'cooling_off' : 'approved';
  const reason = { code: flagged ? 'RECIPIENT_FLAGGED' : status === 'blocked' ? 'DROP_HUB_FAN_IN' : 'ACTIVE_CALL', layer: status === 'blocked' ? 'graph' : 'behavioral', score_delta: flagged ? 100 : 20, reason_kk: flagged ? 'QA: алушы белгіленген' : 'QA: тәуекел белгісі', reason_ru: flagged ? 'QA: получатель помечен' : 'QA: сигнал риска' };
  const item = {
    transaction_id: id, created_at: timestamp(), updated_at: timestamp(), status,
    risk_score: flagged ? 100 : status === 'blocked' ? 90 : status === 'cooling_off' ? 65 : 10,
    amount: input.amount, currency: 'KZT', latency_ms: 2.1,
    sender: party(input.sender_id, 'QA Жіберуші'), recipient,
    active_call: input.context.active_call, from_deposit: input.context.from_deposit,
    is_new_device: input.context.is_new_device, is_new_recipient: true,
    cooling_until: status === 'cooling_off' ? new Date(Date.now() + 900000).toISOString() : null,
    resolved_at: null, reasons: status === 'approved' ? [] : [reason], context: input.context,
    verification_answers: null, ml_score: 71, ml_base_score: 40,
    ml_model_version: 'qa-synthetic-v2', ml_explanation_method: 'tree_path_probability',
    ml_contributors: [{ feature: 'amount_ratio', value: 4, contribution: 31, label_kk: 'Сома қатынасы', label_ru: 'Отношение суммы' }],
    layer_latency_ms: { behavioral: 0.2, graph: 0.1, velocity: 0.2, ml: 0.2 },
  };
  records.set(id, item); return item;
}
const evaluation = item => ({ ...item, headline_kk: 'QA: бағалау нәтижесі', headline_ru: 'QA: результат оценки', reasons_kk: item.reasons.map(r => r.reason_kk), reasons_ru: item.reasons.map(r => r.reason_ru), cooling_off_until: item.cooling_until, recipient: { id: item.recipient.id, display_name: item.recipient.full_name, iban_masked: '•••• 4821' }, server_time: timestamp() });
function graphFor(center, depth) {
  const node = (id, role, x, y) => ({ id, type: 'account', position: { x, y }, data: { label: role === 'hub' ? 'QA Drop Hub' : role === 'mule' ? 'QA Shared Device' : 'QA Account', role, depth: role === 'hub' ? 0 : 1, device_id: 'qa-device', flagged: role === 'hub', suspected_mule: role === 'mule', in_degree: role === 'hub' ? 12 : 1, out_degree: 1, in_weight: 900000, out_weight: 850000, transit_ratio: 0.94, shared_device_accounts: role === 'mule' ? 2 : 0 } });
  const nodes = [node(center, 'hub', 300, 100), node(uuid(501), 'normal', 0, 0), node(uuid(502), 'normal', 0, 230), node(uuid(503), 'mule', 580, 100)];
  if (depth > 1) nodes.push(...[node(uuid(504), 'normal', -280, 0), node(uuid(505), 'normal', -280, 230)].map(n => ({ ...n, data: { ...n.data, depth: 2 } })));
  const edges = nodes.slice(1).map((n, i) => ({ id: `qa-edge-${i}`, source: n.id, target: i > 2 ? uuid(501 + i - 3) : center, type: 'default', animated: true, label: null, data: { edge_type: i === 2 ? 'shared_device' : 'transfer', weight: 300000, tx_count: 3, highlight: true } }));
  return { center, depth, nodes, edges };
}
async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ru-KZ', reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.addInitScript(() => { if (!localStorage.getItem('bcc-shield.locale')) localStorage.setItem('bcc-shield.locale', 'ru'); });
  // A second boundary blocks any future mutation outside the mocked API surface.
  await context.route('**/*', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.abort('blockedbyclient'));
  await context.route('**/api/v1/**', async route => {
    const request = route.request(); const url = new URL(request.url()); const method = request.method();
    report.requests.push({ method, path: url.pathname, search: url.search });
    if (method === 'POST' && url.pathname === '/api/v1/payee-check') {
      const { recipient, bank, expected_name } = request.postDataJSON();
      const directory = new Map([['normal', 'Данияр А.'], ['scam', 'Алексей К.'], ['hub', 'Марат Т.']]);
      if (!directory.has(recipient) || !['bcc', 'other'].includes(bank) || expected_name !== '') {
        return route.fulfill({ status: 422, json: { error: 'invalid' } });
      }
      // A directory read, even over POST, never creates or changes a transfer.
      return route.fulfill({ json: { recipient, bank, source: 'synthetic_directory',
        status: bank === 'bcc' ? 'identified' : 'unavailable', display_name: bank === 'bcc' ? directory.get(recipient) : null } });
    }
    if (method === 'POST') report.mutations.push({ path: url.pathname, intercepted: true });
    if (url.pathname.endsWith('/transfers/evaluate') && method === 'POST') return route.fulfill({ json: evaluation(create(request.postDataJSON())) });
    const action = url.pathname.match(/\/transfers\/([0-9a-f-]+)\/(resolve-cooling|cancel|post-call)$/i);
    if (action && method === 'POST') {
      if (resolveFailure) return route.fulfill({ status: 503, json: { error: 'apiError' } });
      const item = records.get(action[1]); if (!item) return route.fulfill({ status: 404, json: { error: 'notFound' } });
      if (item.status === 'cooling_off') {
        const record = code => item.reasons.unshift({ code, layer: 'questionnaire', score_delta: 0, reason_ru: code, reason_kk: code });
        if (action[2] === 'post-call') record(request.postDataJSON().action === 'ended' ? 'POST_CALL_ENDED' : 'POST_CALL_RECOGNIZED');
        else if (action[2] === 'cancel') {
          item.status = 'cancelled';
          if (request.postDataJSON().reason === 'post_call_scam') record('POST_CALL_SCAM_REPORTED');
        }
        else {
          const answers = request.postDataJSON().answers; item.verification_answers = answers;
          if (questions.some((key, i) => answers[key] !== clean[i])) item.status = 'blocked';
          else if (Date.now() >= Date.parse(item.cooling_until)) item.status = 'approved';
        }
        item.updated_at = timestamp();
        if (item.status !== 'cooling_off') { item.resolved_at = timestamp(); item.cooling_until = null; }
      }
      return route.fulfill({ json: evaluation(item) });
    }
    if (url.pathname.endsWith('/soc/feed') && method === 'GET') {
      const items = [...records.values()].reverse(); const filter = url.searchParams.get('status'); const query = (url.searchParams.get('q') || '').toLowerCase();
      const alertsOnly = url.searchParams.get('alerts_only') === 'true';
      const filtered = items.filter(item => (!filter || item.status === filter) && (!alertsOnly || ['cooling_off', 'blocked'].includes(item.status)) && (!query || `${item.sender.full_name} ${item.recipient.full_name} ${item.transaction_id}`.toLowerCase().includes(query)));
      const offset = Number(url.searchParams.get('offset') || 0); const limit = Number(url.searchParams.get('limit') || 25);
      const count = status => items.filter(item => item.status === status).length;
      return route.fulfill({ json: { server_time: timestamp(), items: filtered.slice(offset, offset + limit), pagination: { total_filtered: filtered.length, offset, limit, has_more: offset + limit < filtered.length }, stats: { total: items.length, approved: count('approved'), cooling_off: count('cooling_off'), blocked: count('blocked'), cancelled: count('cancelled'), blocked_hubs: count('blocked'), avg_latency_ms: 2.1, max_latency_ms: 2.1, p95_latency_ms: items.length ? 2.1 : null, latency_sample_size: items.length, latency_sample_limit: 500 } } });
    }
    const recipientFlag = url.pathname.match(/\/soc\/recipients\/([0-9a-f-]{36})\/flag$/i);
    if (recipientFlag) {
      const accountId = recipientFlag[1];
      const current = recipientFlags.get(accountId) || { account_id: accountId, flagged: false, version: 0, updated_at: null };
      if (method === 'GET') return route.fulfill({ json: current });
      if (method === 'POST') {
        const input = request.postDataJSON();
        if (typeof input.flagged !== 'boolean' || typeof input.note !== 'string' || !input.note.trim() || input.note.length > 200 || !/^[0-9a-f-]{36}$/i.test(input.request_id || '') || !Number.isInteger(input.expected_version)) return route.fulfill({ status: 422, json: { error: 'invalid' } });
        const identity = JSON.stringify({ accountId, ...input });
        const requestKey = `${accountId}:${input.request_id}`;
        const replay = flagReceipts.get(requestKey);
        if (replay) return route.fulfill(replay.identity === identity ? { json: replay.receipt } : { status: 409, json: { error: 'conflict' } });
        if (flagConflictOnce) {
          flagConflictOnce = false;
          recipientFlags.set(accountId, { ...current, version: current.version + 1, updated_at: timestamp() });
          return route.fulfill({ status: 409, json: { error: 'conflict' } });
        }
        if (input.expected_version !== current.version) return route.fulfill({ status: 409, json: { error: 'conflict' } });
        const state = { account_id: accountId, flagged: input.flagged, version: current.version + 1, updated_at: timestamp() };
        const receipt = { ...state, audit_id: uuid(2000 + nextId++), actor: 'qa-soc-service', note: input.note, previous_flagged: current.flagged };
        recipientFlags.set(accountId, state); flagReceipts.set(requestKey, { identity, receipt });
        if (flagLoseResponseOnce) { flagLoseResponseOnce = false; return route.abort('failed'); }
        return route.fulfill({ json: receipt });
      }
      return route.fulfill({ status: 405, json: { error: 'invalid' } });
    }
    if (url.pathname.includes('/soc/graph/') && method === 'GET') return route.fulfill({ json: graphFor(url.pathname.split('/').at(-1), Number(url.searchParams.get('depth') || 2)) });
    const detail = url.pathname.match(/\/transfers\/([0-9a-f-]+)$/i);
    if (detail && method === 'GET') {
      if (detailFailure) return route.fulfill({ status: 503, json: { error: 'apiError' } });
      const item = records.get(detail[1]); return route.fulfill(item ? { json: evaluation(item) } : { status: 404, json: { error: 'notFound' } });
    }
    const trusted = url.pathname.match(/\/trusted-circle\/([0-9a-f-]{36})$/i);
    if (trusted) {
      if (!trustedMock.enabled) return route.fulfill({ status: 404, json: { error: 'unavailable' } });
      if (method === 'POST') { trustedMock.posts += 1; trustedMock.notifications = [{ id: uuid(900), contact_id: uuid(800), state: 'NOTIFICATION_QUEUED', expires_at: new Date(Date.now() + 900000).toISOString(), attempts: 0 }]; }
      else if (url.searchParams.get('scope') === 'notifications') trustedMock.polls.push(Date.now());
      const contacts = url.searchParams.get('scope') === 'notifications' ? {} : { contact_state: 'CONTACT_VERIFIED', contacts: [{ id: uuid(800), alias: 'QA Мама' }] };
      return route.fulfill({ json: { ...contacts, notifications: trustedMock.notifications } });
    }
    return route.fulfill({ status: 404, json: { error: 'notFound' } });
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.errors.push(error.message));
  const dialog = page.locator('dialog.mobile-cooling');
  const language = async (lang, inModal = false) => (inModal ? dialog : page.locator('.topbar')).getByRole('button', { name: lang === 'kk' ? 'ҚАЗ' : 'РУС', exact: true }).click();
  const preset = async kind => { expectedPreset = kind; await page.locator('.preset').nth(['normal', 'scam', 'hub'].indexOf(kind)).click(); };
  const screenshot = async name => { const file = path.join(output, `${name}.png`); await page.screenshot({ path: file, fullPage: true }); report.screenshots.push(file); };
  const answer = async (index, value) => { await dialog.locator(`input[name="${questions[index]}"]`).nth(value ? 0 : 1).check(); await dialog.locator('.cooling-next').click(); };
  const close = () => dialog.locator('.sheet-close').click();
  // Held transfers are listed only after the summary line is expanded.
  const openFromRecovery = async id => {
    const summary = page.locator('.recovery-summary button');
    if (await summary.isVisible()) await summary.click();
    await page.locator('.recovery-list li').filter({ hasText: id.slice(-8) }).getByRole('button', { name: 'Открыть перевод' }).click();
  };
  const reopen = async () => { await page.locator('.telemetry-panel .review-button').click(); await dialog.waitFor(); };
  const settle = () => page.waitForTimeout(250);
  const enabled = selector => page.waitForFunction(value => { const button = document.querySelector(value); return button && !button.disabled; }, selector);
  const overflow = () => page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  const graphGeometry = (expectedCount = 4) => page.locator('.graph-canvas').evaluate((element, expected) => {
    const canvas = element.getBoundingClientRect(); const viewport = element.querySelector('.react-flow__viewport');
    const nodes = [...element.querySelectorAll('.react-flow__node')].map(node => { const box = node.getBoundingClientRect(); return { left: box.left - canvas.left, top: box.top - canvas.top, width: box.width, height: box.height }; });
    return { width: canvas.width, height: canvas.height, scale: new DOMMatrix(getComputedStyle(viewport).transform).a, fitted: nodes.length === expected && nodes.every(box => box.left >= -1 && box.left + box.width <= canvas.width + 1 && box.top >= -1 && box.top + box.height <= canvas.height + 1), nodes };
  }, expectedCount);
  try {
    await page.goto(new URL('/soc?workspace=full', target).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // SSR starts in Kazakh; the locale effect confirms hydration before clicking presets.
    await page.waitForFunction(() => document.documentElement.lang === 'ru');
    check('public_jury_entry_ru', await page.getByRole('link', { name: 'Вход для жюри', exact: true }).getAttribute('href') === 'https://saq-bol-jury.onrender.com/');
    await preset('normal'); await page.locator('.phone-receipt .badge.approved').waitFor();
    const normalId = await page.locator('.phone-receipt').getAttribute('data-transaction-id');
    check('normal_preset_approved_receipt_inside_phone', await page.locator('.phone-frame .phone-receipt').isVisible() && records.get(normalId)?.status === 'approved');
    await page.evaluate(() => { window.__qaNoReload = 'retained'; }); await language('kk');
    check('public_jury_entry_kk', await page.getByRole('link', { name: 'Қазылар кабинеті', exact: true }).getAttribute('href') === 'https://saq-bol-jury.onrender.com/');
    check('receipt_language_switch_keeps_transaction_without_reload', await page.locator('.phone-receipt').getAttribute('data-transaction-id') === normalId && await page.evaluate(() => window.__qaNoReload) === 'retained');
    check('receipt_kazakh_status', (await page.locator('.phone-receipt').innerText()).includes('Мақұлданды'));
    await language('ru');
    await page.locator('.receipt-new').click();
    await page.locator('#recipient').fill('');
    await page.locator('#recipient').evaluate(element => { const clipboard = new DataTransfer(); clipboard.setData('text/plain', 'QA_CLIPBOARD_CONTENT_NOT_FOR_API'); element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: clipboard })); });
    await page.locator('#recipient').fill('+77010000002');
    await page.locator('#recipient').pressSequentially('0', { delay: 80 });
    await page.waitForTimeout(1600); await page.locator('#recipient').press('Backspace');
    check('browser_paste_and_typing_sensor_live', await page.locator('.signal-list li.risk').filter({ hasText: 'Обнаружена вставка' }).count() === 1 && /\d[\d\s]* мс/.test(await page.locator('.signal-list').innerText()));
    await page.locator('#transfer-amount').fill('5000');
    const beforeConfirm = report.mutations.filter(item => item.path.endsWith('/evaluate')).length;
    await page.locator('.phone-form .transfer-cta').click();
    await page.locator('.phone-confirm').waitFor();
    const confirmText = await page.locator('.phone-confirm').innerText();
    check('confirm_step_shows_amount_and_recipient_before_sending', /5\s000\s₸/.test(confirmText) && /\+7 [•\d ]+00 02/.test(confirmText) && report.mutations.filter(item => item.path.endsWith('/evaluate')).length === beforeConfirm, confirmText.slice(0, 200));
    await page.locator('.phone-confirm .transfer-confirm').click();
    await page.locator('.phone-receipt').waitFor();
    const biometric = records.get(await page.locator('.phone-receipt').getAttribute('data-transaction-id')).context;
    check('browser_biometrics_reach_evaluation', biometric.pasted_recipient === true && biometric.typing_duration_ms >= 1500 && biometric.hesitation_count >= 2, biometric);
    check('clipboard_contents_not_sent_as_biometrics', !JSON.stringify(biometric).includes('QA_CLIPBOARD_CONTENT_NOT_FOR_API'));
    await preset('scam'); await dialog.waitFor();
    const heldId = [...records.keys()].at(-1);
    check('scam_starts_15_minute_hold_intro', await dialog.getAttribute('data-step') === 'intro' && /^1[45]:/.test(await dialog.locator('.cooling-clock strong').innerText()));
    check('safe_account_warning_matches_context_ru', (await dialog.locator('.ai-warning').innerText()).includes('безопасный счёт'));
    await language('kk', true);
    check('safe_account_warning_matches_context_kk', (await dialog.locator('.ai-warning').innerText()).includes('Қауіпсіз') || (await dialog.locator('.ai-warning').innerText()).includes('қауіпсіз'));
    await dialog.locator('.post-call-end').click(); await dialog.locator('.post-call-prompt').waitFor();
    check('post_call_names_held_recipient', (await dialog.locator('#cooling-description').innerText()).includes(records.get(heldId).recipient.full_name));
    await dialog.locator('.post-call-prompt .primary').click();
    await dialog.locator('.cooling-next').waitFor();
    check('recognized_call_opens_questionnaire_and_retains_hold', records.get(heldId).status === 'cooling_off');
    check('missing_answer_disables_next', await dialog.locator('.cooling-next').isDisabled());
    check('question_heading_receives_keyboard_focus', await page.evaluate(() => document.activeElement?.id) === 'cooling-title');
    await dialog.locator(`input[name="${questions[0]}"]`).nth(1).check(); await language('ru', true);
    check('language_keeps_answer_and_question', await dialog.locator(`input[name="${questions[0]}"]`).nth(1).isChecked() && await dialog.getAttribute('data-step') === 'question');
    await dialog.locator('.cooling-next').click(); await close();
    check('closing_modal_does_not_mutate_held_transfer', records.get(heldId).status === 'cooling_off' && !records.get(heldId).verification_answers);
    await reopen();
    check('reopening_keeps_in_memory_answer_progress', await dialog.locator(`input[name="${questions[1]}"]`).count() === 2);
    for (let i = 1; i < questions.length; i++) await answer(i, clean[i]);
    check('review_lists_all_five_answers', await dialog.locator('.cooling-review-list li').count() === 5);
    await dialog.locator('.cooling-edit').nth(2).click();
    check('edit_returns_to_chosen_question', await dialog.locator(`input[name="${questions[2]}"]`).nth(1).isChecked());
    await dialog.locator('.cooling-next').click();
    const mutationsBeforeSave = report.mutations.length;
    const savedResponse = page.waitForResponse(response => response.url().endsWith(`/transfers/${heldId}/resolve-cooling`) && response.request().method() === 'POST');
    await dialog.locator('.cooling-submit').click();
    await savedResponse;
    await page.waitForFunction(() => document.querySelector('.cooling-submit')?.disabled === true);
    check('clean_answers_saved_without_early_release', records.get(heldId).status === 'cooling_off' && questions.every((q, i) => records.get(heldId).verification_answers[q] === clean[i]) && report.mutations.length === mutationsBeforeSave + 1);
    await screenshot('cooling-review-ru');
    await page.reload({ waitUntil: 'domcontentloaded' });
    // Recovery may reopen the questionnaire by itself after the reload; wait for that first.
    await dialog.waitFor({ timeout: 5000 }).catch(() => {});
    if (!await dialog.isVisible()) await openFromRecovery(heldId);
    await dialog.waitFor();
    check('reload_restores_server_saved_answers', await dialog.getAttribute('data-step') === 'review' && await dialog.locator('.cooling-review-list li').count() === 5 && await dialog.locator('.cooling-submit').isDisabled());
    const beforeExpiry = report.mutations.length; records.get(heldId).cooling_until = new Date(Date.now() - 1000).toISOString();
    await close(); await reopen();
    await page.waitForFunction(() => document.querySelector('.cooling-clock strong')?.textContent === '00:00');
    check('expired_countdown_never_auto_releases', report.mutations.length === beforeExpiry && records.get(heldId).status === 'cooling_off');
    check('expired_hold_requires_explicit_confirmation', await dialog.locator('.cooling-submit').isEnabled() && (await dialog.locator('.cooling-submit').innerText()).includes('Подтвердить перевод'));
    await dialog.locator('.cooling-submit').click(); await dialog.waitFor({ state: 'hidden' });
    check('explicit_confirmation_after_mock_deadline_approves', records.get(heldId).status === 'approved');
    await preset('scam'); await dialog.waitFor(); const riskyId = [...records.keys()].at(-1);
    check('new_transfer_does_not_reuse_questionnaire_draft', await dialog.getAttribute('data-step') === 'intro');
    await dialog.locator('.cooling-start').click();
    for (let i = 0; i < questions.length; i++) await answer(i, i === 0 ? true : clean[i]);
    resolveFailure = true; detailFailure = true;
    await dialog.locator('.cooling-submit').click(); await dialog.locator('[role="alert"]').waitFor();
    check('failed_submission_keeps_answers_and_hold', records.get(riskyId).status === 'cooling_off' && await dialog.locator('.cooling-review-list li').count() === 5 && await dialog.locator('.cooling-submit').isEnabled());
    resolveFailure = false; detailFailure = false;
    await dialog.locator('.cooling-submit').click(); await dialog.waitFor({ state: 'hidden' });
    check('red_flag_blocks_after_retry', records.get(riskyId).status === 'blocked');
    await preset('scam'); await dialog.waitFor(); const cancelId = [...records.keys()].at(-1);
    await dialog.locator('.post-call-end').click(); await dialog.locator('.post-call-prompt').waitFor();
    await page.reload({ waitUntil: 'domcontentloaded' }); await dialog.locator('.post-call-prompt').waitFor();
    await dialog.locator('.post-call-report').click(); await dialog.waitFor({ state: 'hidden' });
    check('reported_scam_offers_official_bank_contact', await page.locator('.phone-receipt a[href="tel:505"]').isVisible());
    check('explicit_cancel_terminal_receipt', records.get(cancelId).status === 'cancelled' && await page.locator('.phone-receipt .badge.cancelled').isVisible());
    await preset('scam'); await dialog.waitFor(); const holdA = [...records.keys()].at(-1);
    await dialog.locator('.cooling-start').click();
    for (let i = 0; i < questions.length; i++) await answer(i, clean[i]);
    const savedA = page.waitForResponse(response => response.url().endsWith(`/transfers/${holdA}/resolve-cooling`));
    await dialog.locator('.cooling-submit').click(); await savedA;
    await page.waitForFunction(() => document.querySelector('.cooling-submit')?.disabled === true);
    await close(); await preset('scam'); await dialog.waitFor(); const holdB = [...records.keys()].at(-1); await close();
    await openFromRecovery(holdA); await dialog.waitFor();
    // Wait for the actual recovery interval, so the last attempt B is read while A is selected.
    await page.waitForResponse(response => response.url().endsWith(`/transfers/${holdB}`), { timeout: 20000 }); await settle();
    check('background_recovery_of_B_does_not_replace_open_A', await page.locator('.phone-receipt').getAttribute('data-transaction-id') === holdA && await dialog.isVisible());
    // Adversarial answer snapshots test UI provenance, not backend fraud policy.
    records.get(holdA).verification_answers = { ...records.get(holdA).verification_answers, [questions[0]]: true };
    await close(); await reopen();
    check('fresh_server_answers_replace_old_saved_snapshot', await dialog.locator('.cooling-review-list li strong').first().innerText() === 'Да');
    await dialog.locator('.cooling-edit').nth(1).click(); await answer(1, true);
    records.get(holdA).verification_answers = Object.fromEntries(questions.map((q, i) => [q, clean[i]]));
    await close(); await reopen();
    check('actual_unsent_edits_survive_server_refresh', await dialog.locator('.cooling-review-list li strong').nth(1).innerText() === 'Да');
    await dialog.locator('.danger-button').click(); await dialog.waitFor({ state: 'hidden' });

    // This verifies browser contract/state transitions; backend policy and SQL durability
    // are covered by the real-service tests, not by these deliberately intercepted calls.
    await preset('normal'); await page.locator('.phone-receipt .badge.approved').waitFor();
    const safeId = await page.locator('.phone-receipt').getAttribute('data-transaction-id');
    const safeRecipientId = records.get(safeId).recipient.id;
    await page.locator('#tab-soc').click();
    await page.locator(`.case-panel[data-transaction-id="${safeId}"]`).waitFor();
    const flagPath = `/soc/recipients/${safeRecipientId}/flag`;
    const beforeFlag = report.mutations.filter(item => item.path.endsWith(flagPath)).length;
    await page.locator('.recipient-flag-open').click();
    check('recipient_flag_requires_reason_and_explicit_confirmation', await page.locator('.recipient-flag-confirm').isDisabled() && report.mutations.filter(item => item.path.endsWith(flagPath)).length === beforeFlag);
    await page.locator('#recipient-flag-note').fill('QA synthetic network confirmed by SOC');
    const flagResponse = page.waitForResponse(response => response.url().endsWith(flagPath) && response.request().method() === 'POST');
    await page.locator('.recipient-flag-confirm').click();
    const flaggedResponse = await flagResponse;
    const flagBody = flaggedResponse.request().postDataJSON();
    await enabled('.recipient-unflag-open');
    check('recipient_flag_sends_versioned_idempotent_write', flaggedResponse.ok() && flagBody.flagged === true && flagBody.expected_version === 0 && /^[0-9a-f-]{36}$/i.test(flagBody.request_id) && recipientFlags.get(safeRecipientId)?.version === 1);
    await preset('normal'); await page.locator('.phone-receipt .badge.blocked').waitFor();
    const flaggedId = await page.locator('.phone-receipt').getAttribute('data-transaction-id');
    check('flagged_recipient_blocks_new_transfer_with_explicit_reason', flaggedId !== safeId && records.get(flaggedId).recipient.id === safeRecipientId && records.get(flaggedId).reasons.some(reason => reason.code === 'RECIPIENT_FLAGGED'));
    check('flag_does_not_rewrite_previous_decision', records.get(safeId).status === 'approved');
    await page.locator('#tab-soc').click();
    await page.locator(`.case-panel[data-transaction-id="${flaggedId}"]`).waitFor();
    await page.locator('.recipient-unflag-open').click();
    await page.locator('#recipient-flag-note').fill('QA investigation cleared this synthetic account');
    const unflagResponse = page.waitForResponse(response => response.url().endsWith(flagPath) && response.request().method() === 'POST');
    await page.locator('.recipient-flag-confirm').click();
    const unflaggedResponse = await unflagResponse;
    const unflagBody = unflaggedResponse.request().postDataJSON();
    await enabled('.recipient-flag-open');
    check('unflag_is_a_new_audited_versioned_action', unflaggedResponse.ok() && unflagBody.flagged === false && unflagBody.expected_version === 1 && unflagBody.request_id !== flagBody.request_id && recipientFlags.get(safeRecipientId)?.version === 2);
    await preset('normal'); await page.locator('.phone-receipt .badge.approved').waitFor();
    const clearedId = await page.locator('.phone-receipt').getAttribute('data-transaction-id');
    check('unflag_removes_only_future_recipient_flag_signal', records.get(clearedId).recipient.id === safeRecipientId && !records.get(clearedId).reasons.some(reason => reason.code === 'RECIPIENT_FLAGGED') && records.get(flaggedId).status === 'blocked');
    await page.locator('#tab-soc').click();

    // Another writer invalidates the version: no automatic overwrite or new ID.
    await enabled('.recipient-flag-open');
    await page.locator('.recipient-flag-open').click();
    await page.locator('#recipient-flag-note').fill('QA concurrent analyst review');
    const beforeConflict = report.mutations.filter(item => item.path.endsWith(flagPath)).length;
    flagConflictOnce = true;
    const conflictResponse = page.waitForResponse(response => response.url().endsWith(flagPath) && response.request().method() === 'POST');
    await page.locator('.recipient-flag-confirm').click();
    const conflictedResponse = await conflictResponse;
    const conflictedBody = conflictedResponse.request().postDataJSON();
    await enabled('.recipient-flag-confirm');
    check('flag_conflict_reads_new_version_without_auto_write', conflictedResponse.status() === 409 && recipientFlags.get(safeRecipientId).flagged === false && recipientFlags.get(safeRecipientId).version === conflictedBody.expected_version + 1 && report.mutations.filter(item => item.path.endsWith(flagPath)).length === beforeConflict + 1);
    const reconfirmResponse = page.waitForResponse(response => response.url().endsWith(flagPath) && response.request().method() === 'POST');
    await page.locator('.recipient-flag-confirm').click();
    const reconfirmed = await reconfirmResponse;
    const reconfirmedBody = reconfirmed.request().postDataJSON();
    await enabled('.recipient-unflag-open');
    check('flag_conflict_requires_new_explicit_confirmation_and_request_id', reconfirmed.ok() && reconfirmedBody.request_id !== conflictedBody.request_id && reconfirmedBody.expected_version === conflictedBody.expected_version + 1 && reconfirmedBody.note === conflictedBody.note && recipientFlags.get(safeRecipientId).flagged);

    // Commit succeeds but its response disappears: only an exact idempotent retry is safe.
    await page.locator('.recipient-unflag-open').click();
    await page.locator('#recipient-flag-note').fill('QA retry after lost committed response');
    const beforeLost = report.mutations.filter(item => item.path.endsWith(flagPath)).length;
    flagLoseResponseOnce = true;
    const lostRequest = page.waitForRequest(request => request.url().endsWith(flagPath) && request.method() === 'POST');
    await page.locator('.recipient-flag-confirm').click();
    const lostBody = (await lostRequest).postDataJSON();
    await enabled('.recipient-flag-retry');
    check('lost_flag_response_blocks_fresh_actions', await page.locator('.recipient-flag-open').isDisabled() && await page.locator('.recipient-unflag-open').isDisabled() && recipientFlags.get(safeRecipientId).flagged === false && report.mutations.filter(item => item.path.endsWith(flagPath)).length === beforeLost + 1);
    const retryResponse = page.waitForResponse(response => response.url().endsWith(flagPath) && response.request().method() === 'POST');
    await page.locator('.recipient-flag-retry').click();
    const retriedResponse = await retryResponse;
    await enabled('.recipient-flag-open');
    check('lost_flag_response_retry_preserves_entire_request_and_single_audit_version', retriedResponse.ok() && JSON.stringify(retriedResponse.request().postDataJSON()) === JSON.stringify(lostBody) && recipientFlags.get(safeRecipientId).version === lostBody.expected_version + 1 && report.mutations.filter(item => item.path.endsWith(flagPath)).length === beforeLost + 2);

    // A write without a recoverable pending marker must never leave the browser.
    await page.locator('.recipient-flag-open').click();
    await page.locator('#recipient-flag-note').fill('QA storage unavailable: do not send');
    const beforeStorage = report.mutations.filter(item => item.path.endsWith(flagPath)).length;
    await page.evaluate(() => {
      window.__qaFlagSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (String(key).startsWith('saqbol.recipient-flag.pending.')) throw new DOMException('QA storage disabled', 'QuotaExceededError');
        return window.__qaFlagSetItem.call(this, key, value);
      };
    });
    await page.locator('.recipient-flag-confirm').click();
    await page.locator('.recipient-flag-error[role="alert"]').waitFor();
    check('flag_storage_failure_prevents_first_mutation', report.mutations.filter(item => item.path.endsWith(flagPath)).length === beforeStorage && recipientFlags.get(safeRecipientId).flagged === false);
    await page.evaluate(() => { Storage.prototype.setItem = window.__qaFlagSetItem; delete window.__qaFlagSetItem; });
    await page.locator('.recipient-flag-confirmation button[type="button"]').click();

    const alertsResponse = page.waitForResponse(response => response.url().includes('/soc/feed?') && new URL(response.url()).searchParams.get('alerts_only') === 'true');
    await page.getByTestId('soc-alerts-only').click();
    const alertsFeed = await (await alertsResponse).json();
    await page.waitForFunction(() => document.querySelectorAll('.feed-panel tbody .badge.approved, .feed-panel tbody .badge.cancelled').length === 0);
    check('alerts_only_requests_server_filter_and_excludes_safe_rows', await page.getByTestId('soc-alerts-only').getAttribute('aria-pressed') === 'true' && alertsFeed.items.length > 0 && alertsFeed.items.every(item => ['cooling_off', 'blocked'].includes(item.status)));
    const allFeedResponse = page.waitForResponse(response => response.url().includes('/soc/feed?') && new URL(response.url()).searchParams.get('alerts_only') !== 'true');
    await page.getByTestId('soc-alerts-only').click(); await allFeedResponse;

    const hubResponse = page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname.endsWith('/transfers/evaluate'));
    await preset('hub');
    const hubId = (await (await hubResponse).json()).transaction_id;
    await page.locator('#tab-soc[aria-selected="true"]').waitFor();
    await page.locator(`.case-panel[data-transaction-id="${hubId}"] .investigation-id code`).waitFor();
    // The detail and graph requests settle independently. An old graph's first
    // node can still be visible when the new case detail has already arrived.
    const hubRecipientId = records.get(hubId).recipient.id;
    await page.locator(`.react-flow__node[data-id="${hubRecipientId}"] .account-node.is-center`).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 4);
    check('hub_preset_shows_blocked_case_and_graph', records.get(hubId).status === 'blocked' && await page.locator('.react-flow__node').count() === 4);
    check('graph_defaults_to_explicit_direct_neighbor_depth', report.requests.some(request => request.path.endsWith(`/soc/graph/${records.get(hubId).recipient.id}`) && new URLSearchParams(request.search).get('depth') === '1'));
    check('direct_graph_control_and_counts_visible', await page.locator('.graph-depth-controls button').first().getAttribute('aria-pressed') === 'true' && /4\s*\/\s*3/.test(await page.getByText('Показано счетов / связей', { exact: false }).innerText()));
    await page.locator('.soc-stage-toggle').click();
    check('stage_mode_enters_and_hides_feed', await page.locator('.soc-dashboard.is-stage').count() === 1 && !await page.locator('.feed-panel').isVisible());
    await settle(); const initialStageGraph = await graphGeometry();
    check('initial_stage_graph_fits_without_window_resize', initialStageGraph.fitted && initialStageGraph.scale > 0.4, initialStageGraph);
    await page.locator('.graph-controls button').first().click(); await settle();
    const draggable = page.locator(`.react-flow__node[data-id="${uuid(501)}"]`);
    await draggable.scrollIntoViewIfNeeded(); const beforeDrag = await draggable.evaluate(element => element.style.transform);
    const dragBox = await draggable.boundingBox();
    await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2); await page.mouse.down();
    await page.mouse.move(dragBox.x + dragBox.width / 2 + 35, dragBox.y + dragBox.height / 2 + 25, { steps: 6 }); await page.mouse.up(); await settle();
    const draggedStyle = await draggable.evaluate(element => element.style.transform);
    check('graph_node_is_draggable', draggedStyle !== beforeDrag);
    await page.locator('.graph-canvas').scrollIntoViewIfNeeded();
    const panBox = await page.locator('.graph-canvas').boundingBox();
    const beforePan = await page.locator('.react-flow__viewport').getAttribute('style');
    const panX = panBox.x + panBox.width - 45; const panY = panBox.y + panBox.height - 95;
    await page.mouse.move(panX, panY); await page.mouse.down();
    await page.mouse.move(panX - 35, panY + 20, { steps: 6 }); await page.mouse.up(); await settle();
    check('graph_canvas_is_pannable', await page.locator('.react-flow__viewport').getAttribute('style') !== beforePan);
    const centerId = records.get(hubId).recipient.id;
    await page.locator(`.react-flow__node[data-id="${centerId}"]`).click(); await settle();
    check('graph_center_selection_opens_node_details', await page.locator('.node-detail strong').innerText() === 'QA Drop Hub');
    const retainedViewport = await page.locator('.react-flow__viewport').getAttribute('style');
    const polledGraph = page.waitForResponse(response => response.url().includes('/soc/graph/'), { timeout: 10000 });
    await language('kk'); await polledGraph; await settle();
    check('graph_zoom_pan_and_drag_survive_language_and_poll', await draggable.evaluate(element => element.style.transform) === draggedStyle && await page.locator('.react-flow__viewport').getAttribute('style') === retainedViewport);
    check('graph_center_selection_survives_language_and_poll', await page.locator('.node-detail strong').innerText() === 'QA Drop Hub' && await page.locator(`.react-flow__node.selected[data-id="${centerId}"]`).count() === 1 && await page.locator(`.case-panel[data-transaction-id="${hubId}"]`).isVisible());
    await language('ru');
    const expandedResponse = page.waitForResponse(response => response.url().includes(`/soc/graph/${centerId}`) && new URL(response.url()).searchParams.get('depth') === '2');
    await page.locator('.graph-depth-controls button').nth(1).click(); await expandedResponse;
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 6); await settle();
    check('expanded_graph_requests_depth_two_and_preserves_case', await page.locator('.graph-depth-controls button').nth(1).getAttribute('aria-pressed') === 'true' && await page.locator(`.case-panel[data-transaction-id="${hubId}"]`).isVisible());
    check('expanded_graph_shows_all_returned_nodes_and_edges', await page.locator('.react-flow__edge').count() === 5 && /6\s*\/\s*5/.test(await page.getByText('Показано счетов / связей', { exact: false }).innerText()));
    const expandedGeometry = await graphGeometry(6);
    check('depth_change_purposefully_refits_graph', expandedGeometry.fitted, expandedGeometry);
    await language('kk');
    check('graph_depth_controls_translate_and_keep_depth', await page.locator('.graph-depth-controls button').nth(1).innerText() === 'Кеңейтілген желі' && await page.locator('.graph-depth-controls button').nth(1).getAttribute('aria-pressed') === 'true' && /6\s*\/\s*5/.test(await page.getByText('Көрсетілген шоттар / байланыстар', { exact: false }).innerText()));
    const directResponse = page.waitForResponse(response => response.url().includes(`/soc/graph/${centerId}`) && new URL(response.url()).searchParams.get('depth') === '1');
    await page.locator('.graph-depth-controls button').first().click(); await directResponse;
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 4); await settle();
    const directGeometry = await graphGeometry();
    check('collapse_returns_to_direct_neighbors_and_refits', directGeometry.fitted && await page.locator('.graph-depth-controls button').first().getAttribute('aria-pressed') === 'true' && await page.locator(`.case-panel[data-transaction-id="${hubId}"]`).isVisible(), directGeometry);
    await language('ru');
    check('stage_keeps_traffic_control_and_case', await page.locator('.traffic-button').isVisible() && await page.locator(`.case-panel[data-transaction-id="${hubId}"]`).isVisible());
    expectedPreset = 'normal';
    const streamed = page.waitForResponse(response => response.url().endsWith('/transfers/evaluate') && response.request().method() === 'POST');
    await page.locator('.traffic-button').click(); await streamed;
    check('stage_stream_starts_through_evaluation_API', await page.locator('.traffic-button').getAttribute('aria-pressed') === 'true');
    await page.locator('.traffic-button').click();
    const stoppedCount = report.mutations.filter(item => item.path.endsWith('/evaluate')).length;
    await page.waitForTimeout(2800);
    check('stage_stream_stop_prevents_new_dispatches', report.mutations.filter(item => item.path.endsWith('/evaluate')).length === stoppedCount && await page.locator('.traffic-button').getAttribute('aria-pressed') === 'false');
    check('p95_is_measurement_with_scope', /2[,.]10/.test(await page.locator('.stat.scorer-latency strong').innerText()) && (await page.locator('#soc-latency-scope').innerText()).includes('Без HTTP и SQL'));
    await language('kk');
    check('stage_and_selection_survive_language_change', await page.locator('.soc-dashboard.is-stage').count() === 1 && await page.locator(`.case-panel[data-transaction-id="${hubId}"]`).isVisible());
    await page.locator('.soc-stage-feed-toggle').click();
    check('stage_feed_toggle_accessible', await page.locator('.feed-panel').isVisible());
    await page.locator('#soc-search').focus(); await page.keyboard.press('Escape');
    check('escape_in_editable_does_not_exit_stage', await page.locator('.soc-dashboard.is-stage').count() === 1);
    await page.locator('.soc-stage-toggle').focus(); await page.keyboard.press('Escape');
    check('escape_outside_editable_exits_stage', await page.locator('.soc-dashboard.is-stage').count() === 0);
    await page.locator('.soc-stage-toggle').click(); await settle();
    const restoredStageGraph = await graphGeometry();
    check('stage_reentry_graph_fits_without_window_resize', restoredStageGraph.fitted && restoredStageGraph.scale > 0.4, restoredStageGraph);
    await screenshot('soc-stage-kk');
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 }); await settle();
      const sizes = await overflow(); check(`stage_no_document_overflow_${width}`, sizes.document <= width + 1 && sizes.body <= width + 1, sizes);
      check(`stage_graph_has_width_${width}`, (await page.locator('.graph-canvas').boundingBox()).width > 200);
      const fitted = await page.locator('.graph-canvas').evaluate(element => { const canvas = element.getBoundingClientRect(); return [...element.querySelectorAll('.react-flow__node')].every(node => { const box = node.getBoundingClientRect(); return box.left >= canvas.left - 1 && box.right <= canvas.right + 1 && box.top >= canvas.top - 1 && box.bottom <= canvas.bottom + 1; }); });
      check(`resize_observer_refits_graph_${width}`, fitted);
      if (width === 320) await screenshot('soc-stage-320-kk');
    }
    await screenshot('soc-stage-resized-desktop-kk');
    await page.locator('#tab-mobile').click(); await page.locator('.receipt-new').click();
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 }); await settle(); const sizes = await overflow();
      check(`mobile_no_document_overflow_${width}`, sizes.document <= width + 1 && sizes.body <= width + 1, sizes);
      check(`phone_form_visible_${width}`, await page.locator('.phone-frame #recipient').isVisible() && await page.locator('#transfer-amount').isVisible());
      if (width === 320) await screenshot('phone-form-320-kk');
    }
    await preset('scam'); await dialog.waitFor();
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 720 }); await settle();
      const box = await dialog.boundingBox(); check(`cooling_sheet_fits_${width}`, box.x >= -1 && box.x + box.width <= width + 1 && box.y >= -1 && box.height <= 721, box);
      if (width === 320) { const file = path.join(output, 'cooling-intro-320-kk.png'); await page.screenshot({ path: file }); report.screenshots.push(file); }
    }
    const missingDeadlineId = [...records.keys()].at(-1); records.get(missingDeadlineId).cooling_until = null;
    const beforeMissing = report.mutations.length; await close(); await reopen();
    check('missing_deadline_does_not_look_expired', (await dialog.locator('.cooling-clock strong').innerText()) === '—' && (await dialog.locator('.cooling-time-note').innerText()).includes('Кідіріс уақыты расталмады') && report.mutations.length === beforeMissing);
    check('reduced_motion_preference_active', await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches));
    check('reduced_motion_disables_sheet_animation', await dialog.locator('.cooling-step-content').evaluate(element => getComputedStyle(element).animationName) === 'none');
    // /mobile: the same client on a real smartphone (390 px): no bezel, no decision panel, no SOC tab.
    await close().catch(() => {});
    const phone = await context.newPage(); phone.setDefaultTimeout(15000);
    phone.on('pageerror', error => report.errors.push(`/mobile: ${error.message}`));
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.goto(new URL('/mobile', target).href, { waitUntil: 'domcontentloaded' });
    // Recovery may reopen the held transfer's questionnaire here too; leave it on hold first.
    const reopened = phone.locator('dialog.cooling-modal[open]');
    await reopened.waitFor({ timeout: 5000 }).catch(() => {});
    if (await reopened.isVisible()) await reopened.locator('.cooling-later .secondary').click();
    await phone.locator('.topbar').getByRole('button', { name: 'РУС', exact: true }).click();
    // Recovery may reopen this browser's last receipt (same origin storage); start a new transfer from it.
    await phone.locator('.phone-stage.is-bare').waitFor();
    if (await phone.locator('.home-tools').isVisible()) await phone.locator('.home-tools .primary').click();
    if (await phone.locator('.cooling-modal[open]').isVisible()) await phone.locator('.sheet-close').click();
    await phone.waitForTimeout(500);
    if (await phone.locator('.phone-receipt .receipt-new').isVisible()) await phone.locator('.phone-receipt .receipt-new').click();
    await phone.locator('.phone-stage.is-bare .phone-form').waitFor();
    check('mobile_route_phone_only_layout', await phone.locator('.telemetry-panel').count() === 0 && await phone.locator('#tab-soc').count() === 0 && await phone.locator('.demo-bar').count() === 0 && await phone.locator('.phone-status').count() === 0);
    const frame = await phone.locator('.phone-frame').evaluate(element => { const style = getComputedStyle(element); return { border: style.borderTopWidth, width: element.getBoundingClientRect().width }; });
    check('mobile_route_full_width_without_bezel_390', frame.border === '0px' && frame.width >= 389, frame);
    const phoneSizes = await phone.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    check('mobile_route_no_document_overflow_390', phoneSizes.document <= 391 && phoneSizes.body <= 391, phoneSizes);
    check('mobile_route_installable_manifest', await phone.locator('link[rel="manifest"]').count() === 1 && (await (await phone.request.get(new URL('/manifest.webmanifest', target).href)).json()).start_url === '/mobile');
    const ruTitle = await phone.locator('.phone-appbar h2').innerText();
    await phone.locator('.topbar').getByRole('button', { name: 'ҚАЗ', exact: true }).click();
    check('mobile_route_language_switch', (await phone.locator('.phone-appbar h2').innerText()) !== ruTitle);
    await phone.locator('.topbar').getByRole('button', { name: 'РУС', exact: true }).click();
    expectedPreset = 'normal';
    await phone.locator('.contact').first().click(); await phone.locator('.phone-form .transfer-cta').click();
    const familyWrites = report.mutations.length;
    const marketCheck = phone.locator('.market-check');
    const marketResult = marketCheck.locator('[data-order-result]');
    const compareOrder = async reference => {
      await marketCheck.getByRole('combobox').selectOption(reference);
      await marketCheck.getByRole('button', { name: 'Сверить', exact: true }).click();
    };
    await marketCheck.locator('summary').click();
    await compareOrder('SB-1042');
    check('matching_market_order', await marketResult.getAttribute('data-order-result') === 'match');
    await compareOrder('SB-2031');
    check('market_seller_transliteration_requires_review', await marketResult.getAttribute('data-order-result') === 'close');
    await phone.locator('.topbar').getByRole('button', { name: 'ҚАЗ', exact: true }).click();
    check('close_market_match_switches_language_in_place', (await marketResult.innerText()).includes('басқа әліпбимен'));
    await phone.locator('.topbar').getByRole('button', { name: 'РУС', exact: true }).click();
    await compareOrder('unknown');
    check('unknown_order_is_unavailable', await marketResult.getAttribute('data-order-result') === 'unavailable');
    await marketCheck.getByRole('button', { name: 'Вернуться к реквизитам' }).click();
    await phone.locator('.contact').nth(1).click(); await phone.locator('.phone-form .transfer-cta').click();
    await marketCheck.locator('summary').click();
    await compareOrder('SB-1042');
    check('changed_market_payee_warns_before_submission', await marketResult.getAttribute('data-order-result') === 'mismatch' && report.mutations.length === familyWrites);
    const mismatchShot = path.join(output, 'market-payee-mismatch-ru.png');
    await marketCheck.screenshot({ path: mismatchShot }); report.screenshots.push(mismatchShot);
    await marketCheck.getByRole('button', { name: 'Вернуться к реквизитам' }).click();
    await phone.locator('.contact').first().click(); await phone.locator('.phone-form .transfer-cta').click();
    await phone.evaluate(() => {
      window.qaFamilyPickerUses = 0;
      Object.defineProperty(navigator, 'contacts', { configurable: true, value: {
        select: async () => { window.qaFamilyPickerUses++; return [{ tel: ['+7 701 234 56 78'] }]; },
      } });
    });
    await phone.locator('.family-check-start').click();
    check('family_check_waits_for_explicit_contact_selection',
      await phone.evaluate(() => window.qaFamilyPickerUses === 0) && await phone.locator('.transfer-confirm').count() === 0);
    await phone.getByRole('button', { name: 'Выбрать контакт в телефоне' }).click();
    check('family_callback_uses_only_selected_address_book_number',
      await phone.locator('.family-dial').getAttribute('href') === 'tel:+77012345678');
    await phone.locator('.topbar').getByRole('button', { name: 'ҚАЗ', exact: true }).click();
    check('family_explanation_switches_to_kazakh', (await phone.locator('#callback-heading').innerText()).includes('қоңырау'));
    const familyShot = path.join(output, 'family-callback-kk.png');
    await phone.locator('.family-callback').screenshot({ path: familyShot }); report.screenshots.push(familyShot);
    await phone.locator('.family-return').click();
    check('returning_from_callback_does_not_send', await phone.locator('.transfer-confirm').isVisible() && report.mutations.length === familyWrites);
    await phone.locator('.family-check-start').click();
    await phone.locator('.family-discard').click();
    await phone.getByRole('heading', { name: 'Аударым жіберілген жоқ' }).last().waitFor();
    check('discarding_family_request_keeps_payment_unsent', report.mutations.length === familyWrites);
    await phone.locator('.family-callback .primary').click();
    check('discarded_family_request_clears_payment_and_callback_number',
      await phone.locator('#recipient').inputValue() === '' && await phone.locator('#transfer-amount').inputValue() === ''
      && await phone.evaluate(() => !JSON.stringify([localStorage, sessionStorage]).includes('77012345678')));
    await phone.locator('.topbar').getByRole('button', { name: 'РУС', exact: true }).click();
    await phone.locator('.contact').first().click(); await phone.locator('#transfer-amount').fill('25000');
    await phone.locator('.phone-form .transfer-cta').click();
    const confirm = phone.locator('.phone-confirm .transfer-confirm'); await confirm.scrollIntoViewIfNeeded();
    const confirmBox = await confirm.boundingBox();
    check('mobile_route_confirm_button_on_screen_390', confirmBox.y >= 0 && confirmBox.y + confirmBox.height <= 844 && confirmBox.x + confirmBox.width <= 391, confirmBox);
    await confirm.click(); await phone.locator('.phone-receipt .badge.approved').waitFor();
    const phoneId = await phone.locator('.phone-receipt').getAttribute('data-transaction-id');
    check('mobile_route_transfer_reaches_api_and_receipt', records.get(phoneId)?.status === 'approved');
    await phone.locator('.receipt-new').click();
    await phone.locator('.demo-context summary').click();
    await phone.locator('.toggle-row').first().click();
    await phone.locator('.phone-form .transfer-cta').click(); await phone.locator('.phone-confirm .transfer-confirm').click();
    const phoneDialog = phone.locator('dialog.mobile-cooling'); await phoneDialog.waitFor();
    const sheet = await phoneDialog.boundingBox();
    check('mobile_route_cooling_sheet_fits_390', sheet.x >= -1 && sheet.x + sheet.width <= 391 && sheet.height <= 845, sheet);
    await phoneDialog.locator('.trusted-circle .secondary').waitFor();
    check('trusted_circle_unavailable_has_retry', await phoneDialog.locator('.trusted-circle .secondary').isVisible());
    // A trusted contact's suspicion prevents release through the questionnaire.
    trustedMock.enabled = true; await phoneDialog.locator('.sheet-close').click();
    await phone.locator('.receipt-review').click(); await phoneDialog.waitFor();
    await phoneDialog.locator('.trusted-notify').waitFor();
    check('trusted_circle_offers_notify_button', (await phoneDialog.locator('.trusted-notify').innerText()).includes('Сообщить доверенному лицу') && (await phoneDialog.locator('.trusted-circle').innerText()).includes('не может одобрить'));
    await phoneDialog.locator('.trusted-notify').click();
    await phoneDialog.locator('.trusted-status[data-state="NOTIFICATION_QUEUED"]').waitFor();
    check('trusted_circle_notify_posts_once_and_hides_button', trustedMock.posts === 1 && await phoneDialog.locator('.trusted-notify').count() === 0);
    trustedMock.notifications[0].state = 'NOTIFICATION_SENT';
    await phoneDialog.locator('.trusted-status[data-state="NOTIFICATION_SENT"]').waitFor({ timeout: 10000 });
    trustedMock.notifications[0].state = 'SUSPICION_REPORTED';
    await phoneDialog.locator('.trusted-status[data-state="SUSPICION_REPORTED"]').waitFor({ timeout: 10000 });
    const suspicionAlert = phoneDialog.locator('.trusted-circle.has-suspicion').getByRole('alert');
    check('trusted_circle_shows_suspicion_warning', (await suspicionAlert.innerText()).includes('Подтверждение этого перевода через анкету заблокировано.'));
    await phoneDialog.getByRole('button', { name: 'ҚАЗ', exact: true }).click();
    check('trusted_circle_shows_suspicion_warning_kk', (await suspicionAlert.innerText()).includes('Бұл аударымды сауалнама арқылы растауға тыйым салынды.'));
    await phoneDialog.getByRole('button', { name: 'РУС', exact: true }).click();
    const pollsAtTerminal = trustedMock.polls.length; await phone.waitForTimeout(5000);
    const gaps = trustedMock.polls.slice(1).map((value, index) => value - trustedMock.polls[index]);
    check('trusted_circle_polls_no_faster_than_2100ms_and_stops', gaps.every(gap => gap >= 2100) && trustedMock.polls.length === pollsAtTerminal, { gaps, polls: trustedMock.polls.length });
    check('trusted_circle_no_capability_in_page', !/owner:[0-9a-f-]{36}:\d+:/.test(await phone.content()));
    await phoneDialog.locator('.trusted-circle').scrollIntoViewIfNeeded();
    await phone.screenshot({ path: path.join(output, 'mobile-route-cooling-390-ru.png') }); report.screenshots.push(path.join(output, 'mobile-route-cooling-390-ru.png'));
    await phone.close();
    // A jury phone opens http://<laptop Wi-Fi IP>/mobile: not a secure context, so no WebCrypto,
    // randomUUID or Web Locks. Emulate that origin over the same server and mocked API.
    const lanOrigin = 'http://192.168.77.1:3105';
    await context.route(`${lanOrigin}/**`, async route => {
      if (new URL(route.request().url()).pathname.startsWith('/api/v1/')) return route.fallback();
      const response = await route.fetch({ url: route.request().url().replace(lanOrigin, new URL(target).origin) });
      return route.fulfill({ response });
    });
    const lan = await context.newPage(); lan.setDefaultTimeout(15000);
    lan.on('pageerror', error => report.errors.push(`lan: ${error.message}`));
    await lan.setViewportSize({ width: 390, height: 844 });
    await lan.goto(`${lanOrigin}/mobile`, { waitUntil: 'domcontentloaded' });
    await lan.waitForFunction(() => document.documentElement.lang === 'ru');
    await lan.locator('.phone-stage.is-bare').waitFor();
    if (await lan.locator('.home-tools').isVisible()) await lan.locator('.home-tools .primary').click();
    await lan.locator('.phone-form, .phone-receipt').first().waitFor();
    if (await lan.locator('.phone-receipt .receipt-new').isVisible()) await lan.locator('.phone-receipt .receipt-new').click();
    const capabilities = await lan.evaluate(() => ({ secure: window.isSecureContext, subtle: !!crypto.subtle, locks: !!navigator.locks, uuid: typeof crypto.randomUUID }));
    expectedPreset = 'normal';
    await lan.locator('.contact').first().click(); await lan.locator('.phone-form .transfer-cta').click(); await lan.locator('.phone-confirm .transfer-confirm').click();
    await lan.locator('.phone-receipt .badge.approved').waitFor();
    const lanId = await lan.locator('.phone-receipt').getAttribute('data-transaction-id');
    check('mobile_route_transfer_works_in_insecure_lan_context', !capabilities.secure && !capabilities.subtle && !capabilities.locks && /^[0-9a-f-]{36}$/.test(lanId) && records.get(lanId)?.status === 'approved', capabilities);
    check('unreported_call_is_not_submitted_by_default', !records.get(lanId).context.payment_requested_after_call);
    await lan.locator('.receipt-new').click();
    await lan.locator('.contact').first().click();
    await lan.locator('.phone-form .transfer-cta').click();
    const callReport = lan.locator('.reported-call-request input');
    check('post_call_report_starts_unchecked', !await callReport.isChecked());
    await callReport.check();
    await lan.locator('.topbar').getByRole('button', { name: 'ҚАЗ', exact: true }).click();
    check('post_call_report_translates_without_losing_selection',
      await callReport.isChecked() && (await lan.locator('.reported-call-request').innerText()).includes('осы аударымды'));
    await lan.locator('.topbar').getByRole('button', { name: 'РУС', exact: true }).click();
    await lan.locator('.transfer-edit').click();
    await lan.locator('.contact').nth(1).click();
    await lan.locator('.phone-form .transfer-cta').click();
    check('changed_recipient_clears_previous_call_report',
      !await callReport.isChecked() && (await lan.locator('.reported-call-request').innerText()).includes('этот перевод'));
    await callReport.check();
    const submitted = lan.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/transfers/evaluate'));
    await lan.locator('.phone-confirm .transfer-confirm').click();
    const sentContext = (await submitted).postDataJSON().context;
    check('confirmed_call_report_reaches_evaluate_after_hangup', sentContext.payment_requested_after_call === true && sentContext.active_call === false);
    await lan.close();
    check('all_mutations_intercepted', report.mutations.length > 0 && report.mutations.every(m => m.intercepted));
    check('no_browser_runtime_errors', report.errors.length === 0, report.errors);
    report.success = true;
  } catch (error) {
    report.success = false; report.failure = String(error.stack || error); await screenshot('failure').catch(() => {}); throw error;
  } finally {
    report.finished_at = timestamp(); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close(); console.log(JSON.stringify({ output, success: report.success, checks: report.checks.length, errors: report.errors }));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
