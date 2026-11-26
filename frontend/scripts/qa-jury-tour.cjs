/* Run against a local production preview. Only the health probe and read-only SOC graph are stubbed. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
require('tsx/cjs');
const { feedDemo, graphDemo } = require('../src/lib/demo.ts');
const { ids } = require('../src/lib/demo-ids.ts');

const origin = process.argv[2];
assert.ok(origin && ['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'Pass a localhost preview URL');
const tourUrl = new URL('/mobile?tour=1', origin).href;
const graphPath = '/api/v1/soc/graph/' + ids.hub;

async function walk(browser, viewport, lang, cold) {
  const context = await browser.newContext({ viewport, hasTouch: viewport.width === 360 });
  const errors = [], requests = [];
  const page = await context.newPage();
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', req => { if (new URL(req.url()).pathname.startsWith('/api/')) requests.push([req.method(), new URL(req.url()).pathname]); });
  await context.addInitScript(locale => { if (window === window.top) localStorage.setItem('bcc-shield.locale', locale); }, lang);
  let probes = 0, graphs = 0;
  let release;
  const sleeping = new Promise(resolve => { release = resolve; });
  await context.route('**/health?tour=1', async route => {
    probes++;
    if (cold && probes === 1) await sleeping;
    await route.fulfill({ json: { source: cold ? 'local' : 'api' } });
  });
  await context.route('**' + graphPath + '?depth=1', async route => {
    graphs++; await route.fulfill({ json: graphDemo(ids.hub, 1) });
  });
  if (cold) await page.clock.install();
  const read = name => page.locator(`[data-tour-view="${name}"]`);
  async function view(name, step) {
    await read(name).waitFor();
    const label = lang === 'ru' ? `Шаг ${step} из 6` : `${step}-қадам (барлығы 6)`;
    await page.getByText(label, { exact: true }).waitFor();
    const metrics = await page.evaluate(() => {
      const hint = document.querySelector('.tour-hint');
      const screen = document.querySelector('.tour-screen');
      const next = document.querySelector('.tour-guide > button:last-child').getBoundingClientRect();
      return { width: document.documentElement.scrollWidth, viewport: innerWidth,
        overflow: screen.scrollWidth - screen.clientWidth, accessible: next.bottom <= innerHeight && next.height >= 44,
        lines: hint ? hint.getBoundingClientRect().height / parseFloat(getComputedStyle(hint).lineHeight) : 0 };
    });
    assert.ok(metrics.width <= metrics.viewport && metrics.overflow <= 1, name + ' horizontal overflow ' + JSON.stringify(metrics));
    assert.ok(metrics.lines <= 2.05 && metrics.accessible, name + ' coach layout ' + JSON.stringify(metrics));
    assert.doesNotMatch(await page.locator('main').innerText(), /хакатон|прототип|демо/i, name);
    if (process.env.QA_OUTPUT) {
      await fs.mkdir(process.env.QA_OUTPUT, { recursive: true });
      await page.screenshot({ path: path.join(process.env.QA_OUTPUT, `${viewport.width}-${lang}-${name}.png`) });
    }
  }
  const next = () => page.locator('.tour-next').click();
  try {
    const probe = page.waitForRequest('**/health?tour=1');
    if (cold) {
      await page.goto(tourUrl);
    } else {
      await page.goto(origin);
      assert.equal(await page.locator('#tab-soc, .demo-bar, #personal-login').count(), 0);
      assert.equal(await page.locator('.public-signin').getAttribute('href'), 'https://saq-bol-jury.onrender.com/');
      if (viewport.width === 360) {
        const menu = page.locator('.public-menu-toggle');
        await menu.click();
        await page.locator('#public-nav a[href="#results"]').waitFor({state:'visible'});
        await menu.click();
        assert.equal(await menu.getAttribute('aria-expanded'), 'false');
      }
      const entry = page.locator('.land-hero').getByRole('link', { name: lang === 'ru' ? 'Смотреть демо' : 'Демоны көру' });
      await entry.waitFor();
      await page.evaluate(() => document.fonts.ready);
      const box = await entry.boundingBox();
      assert.ok(box && box.y >= 0 && box.y + box.height <= viewport.height && box.height >= 44, 'The entire jury entry must be visible before scrolling');
      for (const [group, stopped] of [['fraud', 57], ['ordinary', 4]]) {
        const card = page.locator('.proof-card[data-group="' + group + '"]');
        assert.equal(await card.locator('.proof-marks i').count(), 60);
        assert.equal(await card.locator('.proof-marks .counted').count(), stopped);
        assert.equal((await card.locator('.proof-result strong').innerText()).trim(), stopped + ' / 60');
      }
      await entry.click();
    }
    await probe;
    if (cold) {
      await page.getByText(lang === 'ru' ? 'Подготавливаем стенд…' : 'Стендті дайындап жатырмыз…').waitFor();
      await page.clock.fastForward(60_001);
      await read('transfer').waitFor();
      release();
    }
    await view('transfer', 1);
    await read('transfer').locator('.fx-wallet[data-state="idle"]').waitFor();
    const initialId = await page.locator('.tour-phone').getAttribute('data-case-id');
    assert.equal(await read('transfer').getAttribute('data-source'), cold ? 'local' : 'api');
    assert.equal(graphs, cold ? 0 : 1);
    await page.locator('.transfer-confirm').click();
    await view('caller', 2);
    await read('caller').locator('.fx-wallet[data-state="frozen"]').waitFor();
    await page.locator('.cooling-choices label').first().click();
    await view('payee', 2);
    await page.locator('.cooling-choices label').last().click();
    await view('call', 3);
    await page.locator('.call-check-cta').click();
    await view('verdict', 3);
    await page.locator('.call-log-summary').waitFor();
    await page.reload();
    await view('verdict', 3);
    assert.equal(await page.locator('.tour-phone').getAttribute('data-case-id'), initialId);

    // A second visitor in the same browser profile starts their own transfer.
    const second = await context.newPage();
    await second.goto(tourUrl);
    await second.locator('[data-tour-view="transfer"]').waitFor();
    assert.notEqual(await second.locator('.tour-phone').getAttribute('data-case-id'), initialId);
    await second.getByRole('button', { name: lang === 'ru' ? 'ҚАЗ' : 'РУС' }).click();
    assert.equal(await page.locator('html').getAttribute('lang'), lang);
    await second.close();

    await next(); await view('telegram', 4);
    await page.getByRole('button', { name: lang === 'ru' ? 'Это мошенники' : 'Бұл алаяқтар' }).click();
    await view('blocked', 4);
    await next(); await view('feed', 5);
    await page.locator('.row-select').click();
    await view('graph', 5);
    await page.locator('.react-flow__node .account-node.is-center').waitFor();
    assert.ok(await page.locator('.react-flow__node').count() > 2);
    await page.getByRole('button', { name: 'ML-инспектор' }).click(); await view('model', 5);
    assert.ok(await page.locator('.ml-inspector .contributors li').count() > 0);
    await next(); await view('report', 6);
    await page.locator('.police-report').click();
    await view('document', 6);
    const doc = page.frameLocator('.tour-document');
    await doc.getByText(initialId, { exact: true }).waitFor();
    assert.equal(await doc.locator('a[href*="adilet.zan.kz"]').count(), 3);
    assert.doesNotMatch(await doc.locator('body').innerText(), /хакатон|прототип|демо/i);
    assert.ok(await doc.locator('html').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    await next(); await view('saved', 6);
    assert.match(await page.locator('.tour-saved h2').innerText(), lang === 'ru' ? /Сохранено 450\s000 ₸/ : /450\s000 ₸ сақталды/);
    await page.getByRole('button', { name: lang === 'ru' ? 'Пройти ещё раз' : 'Қайта өту' }).click();
    await view('transfer', 1);
    assert.notEqual(await page.locator('.tour-phone').getAttribute('data-case-id'), initialId);
    assert.ok(requests.every(([method, path]) => method === 'GET' && path === graphPath), JSON.stringify(requests));
    await next(); await page.locator('.tour-guide .tour-skip').click();
    await page.waitForURL(url => url.pathname === '/mobile' && !url.search);
    await page.locator('.wallet-home-account').waitFor();
    assert.equal(await page.evaluate(() => sessionStorage.getItem('saqbol.jury-tour.v1')), null);
    assert.deepEqual(errors, []);
    console.log(`${viewport.width}×${viewport.height} ${lang.toUpperCase()}: six stops, ${cold ? '60 s fallback' : 'warm API'}, isolation, replay and skip passed; zero console errors or horizontal overflow`);
  } finally { release(); await context.close(); }
}

async function checkQr(browser) {
  const page = await browser.newPage();
  try {
    await page.route('**/mobile/link', route => route.fulfill({ json: { origins: [new URL(origin).origin] } }));
    await page.route('**/api/v1/soc/feed?*', route => route.fulfill({ json: feedDemo() }));
    await page.goto(origin);
    await page.locator('.mobile-qr summary').click();
    await page.locator(`.mobile-qr-url[href="${tourUrl}"]`).waitFor();
    const svg = await require('qrcode').toString(tourUrl, { type: 'svg', margin: 4, errorCorrectionLevel: 'M' });
    assert.equal(await page.locator('.mobile-qr-code path[stroke]').getAttribute('d'), svg.match(/<path stroke="[^"]*" d="([^"]+)"/)[1]);
    await page.locator('.mobile-qr-card .segmented button').last().click();
    await page.locator(`.mobile-qr-url[href="${new URL('/mobile', origin).href}"]`).waitFor();
    console.log('SOC QR encodes the tour URL and the ordinary mobile link is available');
  } finally { await page.close(); }
}

async function checkWithoutStorage(browser) {
  const page = await browser.newPage({ viewport: { width: 360, height: 780 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      for (const key of ['sessionStorage', 'localStorage']) {
        Object.defineProperty(window, key, { get() { throw new DOMException('Unavailable', 'SecurityError'); } });
      }
    });
    await page.route('**/health?tour=1', route => route.fulfill({ json: { source: 'local' } }));
    await page.goto(tourUrl);
    for (const name of ['transfer', 'caller', 'call', 'telegram', 'feed', 'report']) {
      await page.locator(`[data-tour-view="${name}"] .tour-next`).click();
    }
    await page.locator('[data-tour-view="saved"]').waitFor();
    assert.deepEqual(errors, []);
    console.log('Six guide presses finish the tour with browser storage disabled');
  } finally { await page.close(); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true });
  try {
    await walk(browser, { width: 360, height: 780 }, 'ru', true);
    await walk(browser, { width: 360, height: 780 }, 'kk', false);
    await walk(browser, { width: 1920, height: 1080 }, 'kk', false);
    await walk(browser, { width: 1920, height: 1080 }, 'ru', false);
    await checkQr(browser);
    await checkWithoutStorage(browser);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
