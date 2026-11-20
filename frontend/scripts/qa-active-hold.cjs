/* Real browser interactions against a disposable local demo; no API interception. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const target = process.argv[2];
assert.ok(target && ['127.0.0.1', 'localhost'].includes(new URL(target).hostname));
assert.equal(process.env.SOC_SYNTHETIC_REHEARSAL, '1');
const output = path.resolve(process.env.QA_OUTPUT || path.join(__dirname, '../../.local-checks', `active-hold-${Date.now()}`));
const report = { target, mocked_api: false, checks: [], errors: [] };
const check = (name, value) => { assert.ok(value, name); report.checks.push(name); };
const seconds = value => { const [m, s] = value.trim().split(':').map(Number); return m * 60 + s; };
(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => report.errors.push(error.message));
  try {
    await page.goto(target, { waitUntil: 'networkidle' });
    await page.locator('.topbar').getByRole('button', { name: 'РУС', exact: true }).click();
    await page.locator('.preset').nth(1).click();
    await page.locator('dialog[open] .cooling-clock strong').waitFor();
    const initialTime = seconds(await page.locator('.cooling-clock strong').innerText());
    check('initial_scam_is_held_for_full_window', initialTime >= 890 && initialTime <= 900);
    await page.waitForFunction(initial => {
      const [minutes, seconds] = document.querySelector('.cooling-clock strong').textContent.split(':').map(Number);
      return minutes * 60 + seconds < initial;
    }, initialTime);
    await page.locator('.sheet-close').click();
    const originalId = await page.locator('.phone-receipt').getAttribute('data-transaction-id');
    await page.locator('.receipt-new').click();
    await page.locator('#transfer-amount').fill('1000');
    await page.locator('.demo-context summary').click();
    // Iterate stable row positions. Filtering by checked state would shift every
    // subsequent locator after a click and leave a pressure signal enabled.
    for (const toggle of await page.locator('.demo-context .toggle-row').all()) {
      if (await toggle.getAttribute('aria-checked') === 'true') await toggle.click();
    }
    await page.locator('.transfer-cta').click();
    await page.locator('.transfer-confirm').click();
    await page.locator('dialog[open] .ai-warning').waitFor();
    check('cleared_context_retry_remains_held', (await page.locator('.ai-warning').innerText()).includes('Повторная отправка'));
    check('retry_explains_original_deadline', (await page.locator('#cooling-description').innerText()).includes('остаток исходной паузы'));
    const retryTime = seconds(await page.locator('.cooling-clock strong').innerText());
    // A previous synthetic rehearsal can already have a shorter original window.
    // Every active root counts down; a new 15-minute window would exceed this value.
    check('countdown_does_not_restart', retryTime < initialTime && retryTime > 0);
    await page.locator('dialog').getByRole('button', { name: 'ҚАЗ', exact: true }).click();
    check('kazakh_context_warning_updates_without_reload', (await page.locator('.ai-warning').innerText()).includes('Қайта жіберу'));
    await page.screenshot({ path: path.join(output, 'continuing-pause-kk.png'), fullPage: true });
    await page.locator('.sheet-close').click();
    check('retry_uses_a_new_intent', await page.locator('.phone-receipt').getAttribute('data-transaction-id') !== originalId);
    await page.locator('.preset').nth(0).click();
    await page.locator('.phone-receipt .badge.approved').waitFor();
    check('known_other_recipient_remains_approved', true);
    await page.setViewportSize({ width: 320, height: 760 });
    const mobile = new URL(target); mobile.pathname = mobile.pathname.replace(/\/?$/, '/') + 'mobile/';
    await page.goto(mobile.href, { waitUntil: 'networkidle' });
    check('mobile_brand_and_layout_fit_320px', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    check('full_identity_visible_on_phone', (await page.locator('.brand').innerText()).includes('BCC'));
    await page.screenshot({ path: path.join(output, 'mobile-320.png'), fullPage: true });
    check('no_browser_runtime_errors', report.errors.length === 0);
    report.status = 'PASS'; console.log(JSON.stringify({ status: report.status, checks: report.checks.length, output }));
  } catch (error) {
    report.status = 'FAIL'; report.failure = String(error.stack || error);
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
