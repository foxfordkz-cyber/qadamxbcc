const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

/** Both browser sessions use the same disposable backend as the linked-transfer rehearsal. */
async function checkReturnAppeal(browser, baseURL, output, owner, payer) {
  const mobile = await browser.newContext({ baseURL, viewport: { width: 414, height: 860 } });
  const operator = await browser.newContext({ baseURL, viewport: { width: 1440, height: 960 } });
  const customer = await mobile.newPage();
  const soc = await operator.newPage();
  const errors = [];
  const button = (scope, name) => scope.getByRole('button', { name, exact: true });
  const responseFor = (page, pathname, method) =>
    page.waitForResponse(r => new URL(r.url()).pathname === pathname && r.request().method() === method);
  for (const page of [customer, soc]) page.on('pageerror', error => errors.push(error.message));
  try {
    const seed = await mobile.request.post('/api/v1/transfers/evaluate', {
      headers: { Origin: baseURL },
      data: { request_id: randomUUID(), sender_id: payer, recipient_id: owner, amount: '21905.73', context: {} },
    });
    assert.equal(seed.status(), 200);
    const incoming = await seed.json();
    assert.equal(incoming.status, 'approved');
    const id = incoming.transaction_id;
    const receiptPath = '/api/v1/returns/' + id;
    const reviewPath = '/api/v1/soc/returns/' + id + '/review';
    const clientPanel = customer.locator('.return-tool');
    const officerPanel = soc.locator('.investigation-card[data-transaction-id="' + id + '"] .return-review');

    async function confirm(scope, page, route, expectedState) {
      const posted = responseFor(page, route, 'POST');
      await button(scope, 'Подтвердить').click();
      const reply = await posted;
      assert.equal(reply.status(), 200);
      const receipt = await reply.json();
      assert.equal(receipt.original_id, id);
      assert.equal(receipt.review_state, expectedState);
      assert.equal(receipt.refund_transaction_id, null);
    }
    async function refreshCustomer(expectedState) {
      const read = responseFor(customer, receiptPath, 'GET');
      await button(clientPanel, 'Обновить').click();
      assert.equal((await (await read).json()).review_state, expectedState);
    }

    await customer.goto('/mobile');
    await button(customer.locator('.topbar'), 'РУС').click();
    const list = responseFor(customer, '/api/v1/returns/incoming', 'GET');
    await button(customer, 'Возврат поступления').click();
    const items = (await (await list).json()).items;
    const index = items.findIndex(row => row.original_id === id);
    assert.ok(index >= 0);
    const detail = responseFor(customer, receiptPath, 'GET');
    await clientPanel.locator('.return-list button').nth(index).click();
    assert.equal((await (await detail).json()).original_id, id);
    await button(clientPanel, 'Просят вернуть на другой счёт').click();
    await confirm(clientPanel, customer, receiptPath, 'reported');

    await soc.goto('/soc');
    await button(soc.locator('.topbar'), 'РУС').click();
    await soc.locator('#soc-search').fill(id);
    await soc.locator('tr[data-transaction-id="' + id + '"] .row-select').click();
    await button(officerPanel, 'Сохранить ограничение').click();
    await confirm(officerPanel, soc, reviewPath, 'upheld');
    await refreshCustomer('upheld');
    await clientPanel.getByText('Служба безопасности сохранила ограничение.', { exact: true }).waitFor();
    await button(clientPanel, 'Попросить пересмотр').click();
    await confirm(clientPanel, customer, receiptPath, 'appealed');

    // Keep this inspector open: polling must pick up the appeal while the officer stays on the case.
    await officerPanel.getByText('Обращение на повторной проверке. Возврат приостановлен.', { exact: true })
      .waitFor({ timeout: 15000 });
    await button(officerPanel, 'Разрешить возврат отправителю').click();
    // A delayed officer command for the original review cannot change the appeal stage.
    const stale = await operator.request.post(reviewPath, {
      headers: { Origin: baseURL }, data: { decision: 'uphold', stage: 'reported', confirmed: true },
    });
    assert.equal(stale.status(), 409);
    await confirm(officerPanel, soc, reviewPath, 'cleared');
    await refreshCustomer('cleared');
    await clientPanel.getByText('Служба безопасности разрешила возврат первоначальному отправителю.', { exact: true }).waitFor();
    await button(clientPanel, 'Вернуть отправителю').waitFor();
    await customer.screenshot({ path: path.join(output, 'return-appeal-cleared.png') });
    assert.deepEqual(errors, []);
    console.log('PASS: mobile redirect report, officer hold, appeal in open inspector, stale decision rejected, release requires consent');
  } catch (error) {
    await Promise.all([
      customer.screenshot({ path: path.join(output, 'appeal-customer-failure.png') }).catch(() => {}),
      soc.screenshot({ path: path.join(output, 'appeal-officer-failure.png') }).catch(() => {}),
    ]);
    throw error;
  } finally {
    await Promise.all([mobile.close(), operator.close()]);
  }
}
module.exports = { checkReturnAppeal };
