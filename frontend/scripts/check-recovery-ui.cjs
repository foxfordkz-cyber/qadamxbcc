const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');

const configuredUrl = new URL(process.env.BCC_RECOVERY_TEST_URL || 'http://127.0.0.1:33217');
if (!['http:', 'https:'].includes(configuredUrl.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(configuredUrl.hostname)
    || configuredUrl.username || configuredUrl.password || configuredUrl.pathname !== '/'
    || configuredUrl.search || configuredUrl.hash) {
  throw new Error('BCC_RECOVERY_TEST_URL must be a loopback HTTP(S) origin without credentials or a path.');
}
const base = configuredUrl.origin;
const channel = process.env.BCC_RECOVERY_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : 'chromium');
if (!['chromium', 'chrome', 'msedge'].includes(channel)) {
  throw new Error('BCC_RECOVERY_BROWSER_CHANNEL must be chromium, chrome, or msedge.');
}
const output = path.resolve(__dirname, '../../.local-checks/recovery-ui');
const checks = [];
const errors = [];
const routeErrors = [];
const releases = new Set();
let apiMutationsObserved = 0;
const browserOptions = { ...(channel === 'chromium' ? {} : { channel }), headless: true, timeout: 30_000 };

async function withTimeout(promise, duration, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), duration);
    })]);
  } finally { clearTimeout(timer); }
}

async function setup(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(15_000);
  context.setDefaultNavigationTimeout(60_000);
  let demoConfirmed = false;
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== base || (!demoConfirmed && !['GET', 'HEAD'].includes(request.method()))) {
      routeErrors.push('Blocked a request outside the verified local demo scope.');
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.url().startsWith(`${base}/api/`) && !['GET', 'HEAD'].includes(request.method())) apiMutationsObserved += 1;
  });
  await page.clock.install();
  const response = await page.goto(new URL('/soc?workspace=full', base).href, { waitUntil: 'networkidle' });
  assert.equal(response?.status(), 200, 'The demo page must be accessible without live/pilot credentials.');
  assert.equal(new URL(page.url()).origin, base, 'The demo page must stay on the selected loopback origin.');
  await page.getByRole('button', { name: 'РУС', exact: true }).click();
  // This label is rendered directly from AppConfig.mode. A live API or pilot
  // console must fail before the script permits any application mutation.
  await expect(page.locator('.mode')).toHaveAttribute('title', 'Учебный режим · синтетические данные');
  await expect(page.locator('.preset')).toHaveCount(3);
  for (const button of await page.locator('.preset').all()) await expect(button).toBeEnabled();
  demoConfirmed = true;
  return { context, page };
}

async function createHeld(page, first = false) {
  const response = page.waitForResponse(item => item.url().endsWith('/api/v1/transfers/evaluate') && item.request().method() === 'POST');
  if (first) await page.locator('.preset').nth(1).click();
  else await page.locator('.transfer-cta').click();
  const evaluation = await (await response).json();
  assert.equal(evaluation.status, 'cooling_off');
  await expect(page.locator('dialog[open]')).toBeVisible();
  await page.getByRole('button', { name: 'Оставить на удержании', exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  return evaluation;
}

async function delayOneRead(page, id) {
  let release;
  let began;
  const gate = new Promise(resolve => { release = resolve; });
  const waiting = new Promise(resolve => { began = resolve; });
  releases.add(release);
  const target = `**/api/v1/transfers/${id}`;
  const handler = async route => {
    let timer;
    let expired = false;
    try {
      const response = await route.fetch({ timeout: 12_000, maxRedirects: 0 });
      began();
      timer = setTimeout(() => { expired = true; release(); }, 10_000);
      await gate;
      if (expired) throw new Error('A delayed recovery response was not released within ten seconds.');
      await route.fulfill({ response });
    } catch (error) {
      routeErrors.push(error.message);
      await route.abort('failed').catch(() => {});
    } finally { clearTimeout(timer); releases.delete(release); }
  };
  await page.route(target, handler, { times: 1 });
  return { wait: () => withTimeout(waiting, 20_000, 'Expected recovery GET did not arrive.'), release };
}

async function loseOneEvaluateResponse(page, onAccepted) {
  await page.route('**/api/v1/transfers/evaluate', async route => {
    try {
      const response = await route.fetch({ timeout: 12_000, maxRedirects: 0 });
      onAccepted(await response.json());
      await route.abort('failed');
    } catch (error) {
      routeErrors.push(error.message);
      await route.abort('failed').catch(() => {});
    }
  }, { times: 1 });
}

async function runScenarios(browser) {
    const { context, page } = await setup(browser);
    const a = await createHeld(page, true);
    await page.locator('#transfer-amount').fill('910000');
    const b = await createHeld(page);
    assert.notEqual(a.transaction_id, b.transaction_id);

    const lateB = await delayOneRead(page, b.transaction_id);
    await page.clock.runFor(16000);
    await lateB.wait();
    const rowA = page.locator('.recovery-list li').filter({ hasText: a.transaction_id.slice(-8) });
    await rowA.getByRole('button', { name: 'Открыть перевод', exact: true }).click();
    await expect(page.locator('dialog[open]')).toBeVisible();
    await expect(page.locator('.result-amount')).toHaveText(/900\s*000/);
    lateB.release();
    await expect(page.locator('.recovery-toolbar button').first()).toBeEnabled();
    await expect(page.locator('.result-amount')).toHaveText(/900\s*000/);
    await page.screenshot({ path: path.join(output, 'selected-a-after-late-b.png'), fullPage: true });
    const cancellation = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/cancel'));
    await page.getByRole('button', { name: 'Отменить перевод', exact: true }).click();
    assert.ok((await cancellation).url().endsWith(`/transfers/${a.transaction_id}/cancel`));
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    checks.push('Review A remains selected after a delayed recovery response for last attempt B; cancellation targets A.');

    const afterEdit = await delayOneRead(page, b.transaction_id);
    await page.clock.runFor(16000);
    await afterEdit.wait();
    await page.locator('#transfer-amount').fill('123456');
    await expect(page.locator('.decision-top')).toHaveCount(0);
    afterEdit.release();
    await expect(page.locator('.recovery-toolbar button').first()).toBeEnabled();
    await expect(page.locator('.decision-top')).toHaveCount(0);
    await expect(page.locator('#transfer-amount')).toHaveValue('123456');
    await page.screenshot({ path: path.join(output, 'edited-form-after-late-b.png'), fullPage: true });
    checks.push('Editing the form while B recovery is in flight keeps an empty result and the edited amount.');
    await page.locator('.recovery-list li').filter({ hasText: b.transaction_id.slice(-8) }).getByRole('button', { name: 'Открыть перевод', exact: true }).click();
    await expect(page.locator('dialog[open]')).toBeVisible();
    await page.getByRole('button', { name: 'Оставить на удержании', exact: true }).click();
    await page.locator('.recovery-toolbar button').nth(1).click();
    await page.route(`**/api/v1/transfers/${a.transaction_id}`, route => route.fulfill({ status: 503, json: { error: 'apiError' } }), { times: 1 });
    await page.locator('.recovery-list li').filter({ hasText: a.transaction_id.slice(-8) }).getByRole('button', { name: 'Открыть перевод', exact: true }).click();
    await expect(page.locator('.phone-form [role="alert"]')).toBeVisible();
    await expect(page.locator('.decision-top')).toHaveCount(0);
    await page.clock.runFor(16000);
    await expect(page.locator('.result-amount')).toHaveText(/900\s*000/);
    await expect(page.locator('.phone-form [role="alert"]')).toHaveCount(0);
    checks.push('A failed review of A clears the previous B receipt, then later recovery restores only selected A.');
    await context.close();

    const recovery = await setup(browser);
    let acceptedId;
    await loseOneEvaluateResponse(recovery.page, evaluation => { acceptedId = evaluation.transaction_id; });
    await recovery.page.locator('.preset').nth(1).click();
    await expect(recovery.page.getByRole('button', { name: 'Проверить / повторить запрос', exact: true })).toBeVisible();
    await expect(recovery.page.locator('.decision-top')).toHaveCount(0);
    await recovery.page.clock.runFor(16000);
    await expect(recovery.page.locator('.decision-top')).toBeVisible();
    await expect(recovery.page.getByRole('button', { name: 'Проверить / повторить запрос', exact: true })).toHaveCount(0);
    await expect(recovery.page.locator('.recovery-list li').filter({ hasText: acceptedId.slice(-8) })).toContainText('Период охлаждения');
    checks.push('A lost evaluate response recovers the selected pending request, clears unknown state, and shows its receipt.');

    await recovery.page.locator('#transfer-amount').fill('920000');
    let secondAcceptedId;
    await loseOneEvaluateResponse(recovery.page, evaluation => { secondAcceptedId = evaluation.transaction_id; });
    await recovery.page.locator('.transfer-cta').click();
    await expect(recovery.page.getByRole('button', { name: 'Проверить / повторить запрос', exact: true })).toBeVisible();
    await recovery.page.locator('.recovery-list li').filter({ hasText: acceptedId.slice(-8) }).getByRole('button', { name: 'Открыть перевод', exact: true }).click();
    await expect(recovery.page.locator('dialog[open]')).toBeVisible();
    await recovery.page.clock.runFor(16000);
    await expect(recovery.page.locator('.recovery-list li').filter({ hasText: secondAcceptedId.slice(-8) })).toContainText('Период охлаждения');
    await expect(recovery.page.getByRole('button', { name: 'Проверить / повторить запрос', exact: true })).toHaveCount(0);
    await expect(recovery.page.locator('.result-amount')).toHaveText(/900\s*000/);
    await expect(recovery.page.locator('dialog[open]')).toBeVisible();
    checks.push('A pending unknown B settles while A is reviewed without replacing the A modal or leaving retry state behind.');
    await recovery.context.close();

    const presets = await setup(browser);
    const normalResponse = presets.page.waitForResponse(item => item.url().endsWith('/api/v1/transfers/evaluate') && item.request().method() === 'POST');
    await presets.page.locator('.preset').nth(0).click();
    assert.equal((await (await normalResponse).json()).status, 'approved');
    await expect(presets.page.locator('.decision-top')).toBeVisible();
    const scamResponse = presets.page.waitForResponse(item => item.url().endsWith('/api/v1/transfers/evaluate') && item.request().method() === 'POST');
    await presets.page.locator('.preset').nth(1).click();
    const held = await (await scamResponse).json();
    assert.equal(held.status, 'cooling_off');
    await expect(presets.page.locator('dialog[open]')).toBeVisible();
    const cancelled = presets.page.waitForResponse(item => item.request().method() === 'POST' && item.url().endsWith(`/transfers/${held.transaction_id}/cancel`));
    await presets.page.getByRole('button', { name: 'Отменить перевод', exact: true }).click();
    assert.equal((await (await cancelled).json()).status, 'cancelled');
    await expect(presets.page.locator('dialog[open]')).toHaveCount(0);
    await expect(presets.page.locator('.decision-heading .badge')).toHaveText('Отменено');
    checks.push('Switching from a completed normal preset to a different scam preset preserves selection and accepts modal cancellation.');
    await presets.context.close();
    assert.deepEqual(errors, []);
    assert.deepEqual(routeErrors, []);
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  let browser;
  try {
    browser = await chromium.launch(browserOptions);
    await withTimeout(runScenarios(browser), 180_000, 'Recovery UI regression exceeded its three-minute deadline.');
    const report = { status: 'PASS', browser: `${channel} headless`, base, checks, pageErrors: errors, apiMutationsObserved, scope: 'Actual Next.js React UI with a preflight-verified synthetic in-process demo API; selected GET responses delayed and POST responses dropped.' };
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ checks, pageErrors: errors, routeErrors, apiMutationsObserved, error: error.stack }, null, 2));
    throw error;
  } finally {
    for (const release of releases) release();
    if (browser) await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
