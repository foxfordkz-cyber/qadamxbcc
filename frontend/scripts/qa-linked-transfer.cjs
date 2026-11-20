/* Drive the customer and officer UIs through one linked refund on a local synthetic ledger. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const { checkReturnAppeal } = require('./qa-return-appeal.cjs');

const target = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname));
assert.equal(process.env.SOC_SYNTHETIC_REHEARSAL, '1');
const output = path.resolve(process.env.QA_OUTPUT || '.local-checks/linked-transfer-ui');
const owner = '00000000-0000-4000-8000-000000000001';
const payer = '00000000-0000-4000-8000-000000000002';

async function run() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
  const context = await browser.newContext({ baseURL: target.origin, viewport: { width: 414, height: 860 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const lang = name => page.locator('.topbar').getByRole('button', { name, exact: true }).click();
  try {
    // Create this run's receipt through the same evaluation endpoint used by the mobile form.
    const response = await context.request.post('/api/v1/transfers/evaluate', { headers: { Origin: target.origin },
      data: { request_id: randomUUID(), sender_id: payer, recipient_id: owner, amount: '17405.25', context: {} } });
    assert.equal(response.status(), 200);
    const source = await response.json();
    assert.equal(source.status, 'approved');
    await page.goto('/mobile');
    await lang('РУС');
    const listLoaded = page.waitForResponse(r => r.url().endsWith('/returns/incoming'));
    await page.getByRole('button', { name: 'Возврат поступления', exact: true }).click();
    const receipts = (await (await listLoaded).json()).items;
    const row = receipts.findIndex(item => item.original_id === source.transaction_id);
    assert.ok(row >= 0);
    const detailsLoaded = page.waitForResponse(r => r.url().endsWith('/returns/' + source.transaction_id) && r.request().method() === 'GET');
    await page.locator('.return-list button').nth(row).click();
    assert.equal((await (await detailsLoaded).json()).original_id, source.transaction_id);
    await page.locator('.return-tool[aria-busy="false"] .return-receipt').waitFor();
    await page.getByRole('button', { name: 'Вернуть отправителю', exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'linked-return-ru.png') });
    await lang('ҚАЗ');
    await page.getByRole('button', { name: 'Жіберушіге қайтару', exact: true }).click();
    const confirmation = page.waitForResponse(r => r.url().endsWith('/returns/' + source.transaction_id) && r.request().method() === 'POST');
    await page.locator('.return-confirm').getByRole('button', { name: 'Растау', exact: true }).click();
    const refund = await (await confirmation).json();
    assert.equal(refund.original_id, source.transaction_id);
    assert.equal(refund.refund_status, 'approved');
    await page.locator('.return-completion .approved').waitFor();
    const repeat = await context.request.post('/api/v1/returns/' + source.transaction_id, {
      headers: { Origin: target.origin }, data: { action: 'return_to_sender', confirmed: true },
    });
    assert.equal(repeat.status(), 200);
    assert.equal((await repeat.json()).refund_transaction_id, refund.refund_transaction_id);
    await page.reload();
    const refreshedList = page.waitForResponse(r => r.url().endsWith('/returns/incoming'));
    await page.getByRole('button', { name: 'Түскен ақшаны қайтару', exact: true }).click();
    const refreshedRows = (await (await refreshedList).json()).items;
    const refreshedIndex = refreshedRows.findIndex(item => item.original_id === source.transaction_id);
    assert.ok(refreshedIndex >= 0);
    const refreshedReceipt = page.waitForResponse(r =>
      r.url().endsWith('/returns/' + source.transaction_id) && r.request().method() === 'GET');
    await page.locator('.return-list button').nth(refreshedIndex).click();
    assert.equal((await (await refreshedReceipt).json()).refund_transaction_id, refund.refund_transaction_id);
    await page.locator('.return-completion .approved').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Жіберушіге қайтару', exact: true }).count(), 0);

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/soc');
    await lang('РУС');
    const feedResult = page.waitForResponse(r => r.url().includes('soc/feed?') && new URL(r.url()).searchParams.get('q') === source.transaction_id);
    await page.locator('#soc-search').fill(source.transaction_id);
    assert.equal((await (await feedResult).json()).items[0].transaction_id, source.transaction_id);
    await page.locator(`tr[data-transaction-id="${source.transaction_id}"] .row-select`).click();
    await page.locator('.investigation-card[data-transaction-id="' + source.transaction_id + '"] .investigation-id code').waitFor();
    await page.getByText('Поступления на этот счёт', { exact: true }).click();
    const picker = page.locator('details[open]').filter({ has: page.getByText('Поступления на этот счёт', { exact: true }) });
    await picker.locator(`button[data-transaction-id="${source.transaction_id}"]`).click();
    const trace = page.getByTestId('funds-trace');
    await trace.getByText('Возможное движение средств', { exact: true }).waitFor();
    const report = await (await context.request.get('/api/v1/soc/transfers/' + source.transaction_id + '/funds-trace')).json();
    assert.ok(report.links.some(link => link.transaction_id === refund.refund_transaction_id));
    assert.ok(Number(report.first_hop_amount) <= Number(source.amount));
    await trace.screenshot({ path: path.join(output, 'funds-trace-ru.png') });
    const story = page.getByTestId('transfer-story');
    await lang('ҚАЗ');
    await story.getByRole('button', { name: 'Дайындық жазбасы', exact: true }).click();
    await story.locator('li').getByText('Сенімді адам күдік туралы хабарлады', { exact: true }).waitFor();
    await story.locator('li').getByText('Клиент аударым бойынша өтініш берді', { exact: true }).waitFor();
    await story.locator('li').getByText('SOC-та іс тіркелді', { exact: true }).waitFor();
    await story.screenshot({ path: path.join(output, 'case-story-kk.png') });
    assert.deepEqual(errors, []);
    console.log('PASS: confirmed linked refund, retry, receipt picker, chronological trace, bilingual role history');
    await context.close();
    await checkReturnAppeal(browser, target.origin, output, owner, payer);
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
