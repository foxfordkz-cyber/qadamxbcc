/* Explicit localhost-only integration rehearsal. Mutates synthetic demo cases through the real BFF. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright-core');

const target = process.argv[2];
assert.ok(target && ['localhost', '127.0.0.1'].includes(new URL(target).hostname), 'Pass the localhost -SocDemo rehearsal URL');
assert.equal(process.env.SOC_SYNTHETIC_REHEARSAL, '1', 'Set SOC_SYNTHETIC_REHEARSAL=1 only for the fresh -SocDemo database');
const output = path.resolve(process.env.QA_OUTPUT || path.join(__dirname, '../../.local-checks', `soc-live-${Date.now()}`));
const report = { target, mocked: false, providerDelivery: 'FAKE', checks: [], screenshots: [], errors: [] };
const check = (name, value) => { assert.ok(value, name); report.checks.push(name); };

(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ru-RU' });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  const requests = [];
  page.on('request', request => { if (request.url().includes('/api/v1/integrations/')) requests.push({ url: request.url(), method: request.method() }); });
  const screenshot = async name => { const file = path.join(output, `${name}.png`); await page.screenshot({ path: file, fullPage: true }); report.screenshots.push(file); };
  try {
    await page.goto(target, { waitUntil: 'domcontentloaded' });
    await page.locator('.topbar').getByRole('button', { name: 'РУС', exact: true }).click();
    await page.locator('#tab-soc').click();
    await page.getByTestId('soc-mode-cases').click();
    const row = page.locator('.soc-case-row').filter({ hasText: 'Безопасный счёт' });
    await row.waitFor();
    const caseId = await row.getAttribute('data-case-id');
    assert.match(caseId, /^[\da-f-]{36}$/i);
    report.caseId = caseId;
    await row.click();
    const metaVersion = page.locator('.soc-case-meta > div').filter({ has: page.locator('dt', { hasText: 'Версия' }) }).locator('dd');
    await metaVersion.waitFor();
    const version = Number(await metaVersion.innerText());
    const timeline = page.getByTestId('incident-timeline');
    await timeline.locator('.incident-events li').first().waitFor();
    await page.getByTestId('integration-health').getByText('FAKE · локальная доставка', { exact: true }).waitFor();
    const txId = (await page.locator('.soc-case-transfer code').innerText()).trim();
    report.transactionId = txId;
    check('case_and_timeline_reference_same_real_transaction', (await timeline.locator(':scope > .integration-id').innerText()).trim() === txId);
    check('fake_callback_present_in_persisted_timeline', (await timeline.innerText()).includes('SUSPICION'));
    check('notification_and_gateway_are_explicitly_advisory', (await page.locator('.integration-notifications').innerText()).includes('подозрении') && (await page.locator('.integration-gateway').innerText()).includes('MOCK'));
    check('local_health_has_no_real_provider_probe', (await page.getByTestId('integration-health').innerText()).includes('не опрашивался'));
    await page.locator('.analysis-panel .badge.cooling_off').waitFor();
    await page.locator('.graph-panel .account-node.is-center').waitFor();
    check('linked_transfer_risk_and_recipient_graph_are_visible', (await page.locator('.soc-center-recipient').innerText()).includes('Выбранный получатель') && await page.locator('.analysis-panel .analysis-score').count() === 1);
    check('linked_transfer_has_no_contract_error', await page.locator('.investigation-error').count() === 0 && (await page.locator('.investigation-id code').innerText()).trim() === txId);
    const pathPrefix = `/api/v1/integrations/guardian/soc/cases/${caseId}`;
    // Simulate another operator writing after the UI read its snapshot.
    const external = await page.request.post(new URL(`${pathPrefix}/actions`, target).href, {
      headers: { Origin: new URL(target).origin, 'Idempotency-Key': randomUUID() },
      data: { action: 'assign', expected_version: version, assignee: 'demo_analyst_b' },
    });
    assert.equal(external.status(), 200, await external.text());
    const receipt = await external.json();
    check('real_bff_write_preserves_demo_contract', receipt.demonstration_only === true && receipt.version === version + 1);
    await page.locator('#case-action-kind').selectOption('assign');
    await page.locator('#case-assignee').selectOption('demo_analyst_a');
    await page.locator('.case-action-submit').click();
    await page.locator('.case-action-confirm').click();
    await page.locator('.case-conflict-confirm').waitFor();
    await page.waitForFunction(expected => [...document.querySelectorAll('.soc-case-meta > div')].some(element => element.querySelector('dt')?.textContent === 'Версия' && Number(element.querySelector('dd')?.textContent) === expected), version + 1);
    check('real_409_requires_explicit_reconfirmation', Number(await metaVersion.innerText()) === version + 1);
    await page.locator('.case-conflict-confirm').click();
    await page.locator('.soc-case-success').waitFor();
    await page.waitForFunction(expected => [...document.querySelectorAll('.soc-case-meta > div')].some(element => element.querySelector('dt')?.textContent === 'Версия' && Number(element.querySelector('dd')?.textContent) === expected), version + 2);
    check('confirmed_action_saved_once', Number(await metaVersion.innerText()) === version + 2);
    await screenshot('real-soc-ru');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator(`.soc-case-detail[data-case-id="${caseId}"] #case-action-kind`).waitFor();
    await metaVersion.waitFor();
    check('reload_restores_selected_case_and_committed_version', Number(await metaVersion.innerText()) === version + 2 && await page.getByTestId('soc-mode-cases').getAttribute('aria-pressed') === 'true');
    await page.locator('.case-history li').nth(2).waitFor();
    check('server_history_contains_all_three_versions', await page.locator('.case-history li').count() === version + 2);
    await page.locator('.topbar').getByRole('button', { name: 'ҚАЗ', exact: true }).click();
    check('kazakh_case_labels_update_without_reload', (await page.locator('.soc-case-detail').innerText()).includes('Істі қарау'));
    await screenshot('real-soc-kk');
    const storage = await page.evaluate(() => JSON.stringify({ session: { ...sessionStorage }, local: { ...localStorage } }));
    check('browser_storage_contains_no_operator_capability', !/soc:[\da-f-]{36}:\d{10}:[\da-f]{64}/i.test(storage));
    check('real_timeline_endpoint_was_used', requests.some(item => item.url.includes(`/soc/transactions/${txId}/timeline`)));
    await page.getByTestId('soc-mode-transfers').click();
    await page.locator('.filter-row button').nth(4).click();
    await page.locator('.row-select').first().waitFor();
    await page.locator('.row-select').first().click();
    await page.locator('.graph-panel .account-node.danger.is-center').waitFor();
    check('real_blocked_hub_graph_highlights_recipient_and_connections', await page.locator('.graph-panel .react-flow__edge').count() >= 2);
    await screenshot('real-hub-graph-kk');
    check('no_browser_runtime_errors', report.errors.length === 0);
    report.status = 'PASS';
    console.log(JSON.stringify({ status: report.status, checks: report.checks.length, output }));
  } catch (error) {
    report.status = 'FAIL'; report.failure = String(error.stack || error);
    await screenshot('failure').catch(() => {});
    throw error;
  } finally {
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
