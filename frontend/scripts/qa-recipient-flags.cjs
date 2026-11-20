/* Real UI rehearsal: no API mocks. Use only an isolated synthetic localhost demo. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const target = process.argv[2];
assert.ok(target && ['127.0.0.1', 'localhost'].includes(new URL(target).hostname), 'Explicit localhost URL required');
assert.equal(process.env.SOC_SYNTHETIC_REHEARSAL, '1', 'Only run against a disposable synthetic demo');
const output = path.resolve(process.env.QA_OUTPUT || path.join(__dirname, '../../.local-checks', `recipient-flags-${Date.now()}`));
const report = { target, mocked_api: false, checks: [], errors: [], screenshots: [] };
const check = (name, value) => { assert.ok(value, name); report.checks.push(name); };

(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'ru-RU' });
  const serverApiRequests = [];
  page.on('request', request => { if (new URL(request.url()).pathname.includes('/api/')) serverApiRequests.push(request.url()); });
  page.on('pageerror', error => report.errors.push(error.message));
  const screenshot = async name => {
    const file = path.join(output, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true }); report.screenshots.push(file);
  };
  const normal = async status => {
    await page.locator('.preset').nth(0).click();
    await page.locator(`.phone-receipt .badge.${status}`).waitFor();
    return page.locator('.phone-receipt').getAttribute('data-transaction-id');
  };
  try {
    await page.goto(target, { waitUntil: 'networkidle', timeout: 60000 });
    await page.locator('.topbar').getByRole('button', { name: 'РУС', exact: true }).click();
    if (process.env.QA_EXPECT_STATIC === '1') check('static_export_uses_demo_configuration', (await page.locator('.mode-text').innerText()).trim() === 'Демо');
    const approvedId = await normal('approved');
    check('initial_normal_transfer_is_approved', Boolean(approvedId));
    await page.locator('#tab-soc').click();
    await page.locator('.recipient-flag-open').click();
    check('reason_required_before_flag', await page.locator('.recipient-flag-confirm').isDisabled());
    await page.locator('#recipient-flag-note').fill('Synthetic QA: SOC confirmed this demo account');
    await page.locator('.recipient-flag-confirm').click();
    await page.locator('.recipient-flag-success').waitFor();
    check('confirmed_flag_is_authoritative', await page.locator('.recipient-flag-state.flagged').isVisible());
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.recipient-flag-state.flagged').waitFor();
    check('reloaded_soc_reads_persisted_flag', await page.locator('.recipient-flag-state.flagged').isVisible());
    const blockedId = await normal('blocked');
    check('new_transfer_to_flagged_recipient_is_blocked', blockedId && blockedId !== approvedId);
    await page.locator('#tab-soc').click();
    await page.locator('.recipient-unflag-open').waitFor();
    check('inspector_explains_flagged_recipient', /помечен|отмечен|подтвержден|подтверждён/i.test(await page.locator('.analysis-panel').innerText()));
    await screenshot('flagged-recipient-ru');
    await page.locator('.recipient-lookback summary').click();
    const prior = page.getByRole('button', { name: `Открыть операцию ${approvedId}`, exact: true });
    await prior.waitFor();
    check('prior_receipts_exclude_blocked_attempt', await page.locator('.recipient-lookback').getByRole('button', { name: new RegExp(blockedId) }).count() === 0);
    await page.locator('.topbar').getByRole('button', { name: 'ҚАЗ', exact: true }).click();
    await page.getByRole('button', { name: `Операцияны ашу ${approvedId}`, exact: true }).click();
    await page.locator(`.case-panel[data-transaction-id="${approvedId}"] .investigation-summary`).waitFor();
    check('lookback_opens_original_receipt_in_kazakh', true);
    await page.locator('.topbar').getByRole('button', { name: 'РУС', exact: true }).click();
    await page.locator('.recipient-unflag-open').click();
    await page.locator('#recipient-flag-note').fill('Synthetic QA: investigation cleared this demo account');
    await page.locator('.recipient-flag-confirm').click();
    await page.locator('.recipient-flag-success').waitFor();
    await page.locator('.recipient-flag-state.clear').waitFor();
    const clearedId = await normal('approved');
    check('unflag_removes_only_confirmed_recipient_block', clearedId && clearedId !== blockedId);
    await page.locator('#tab-soc').click();
    await page.getByTestId('soc-alerts-only').click();
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll('.soc-table-scroll tbody tr')];
      return rows.length > 0 && rows.every(row => row.querySelector('.badge.blocked,.badge.cooling_off'));
    });
    check('alerts_filter_contains_only_blocked_or_cooling_transfers', await page.locator('.soc-table-scroll tbody .badge.approved,.soc-table-scroll tbody .badge.cancelled').count() === 0);
    await page.locator('.topbar').getByRole('button', { name: 'ҚАЗ', exact: true }).click();
    check('kazakh_alert_filter_updates_live', (await page.getByTestId('soc-alerts-only').innerText()).trim() !== 'Только тревоги');
    await screenshot('alerts-only-kk');
    const storage = await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }));
    check('no_service_credentials_in_browser_storage', !/soc:[\da-f-]{36}:\d{10}:[\da-f]{64}/i.test(storage));
    check('no_browser_runtime_errors', report.errors.length === 0);
    if (process.env.QA_EXPECT_STATIC === '1') check('static_export_makes_no_server_api_requests', serverApiRequests.length === 0);
    report.status = 'PASS';
    console.log(JSON.stringify({ status: report.status, checks: report.checks.length, output }));
  } catch (error) {
    report.status = 'FAIL'; report.failure = String(error.stack || error);
    await screenshot('failure').catch(() => {}); throw error;
  } finally {
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
