const { chromium } = require('/tmp/pw/node_modules/playwright-core');
const { execSync } = require('node:child_process');
const lang = process.argv[2]; const out = `/tmp/cap/${lang}`; execSync(`mkdir -p ${out}`);
const BASE = 'http://127.0.0.1:3105';
const log = (...a) => console.log(lang, ...a);
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  const init = l => () => localStorage.setItem('bcc-shield.locale', l);
  // ---------- desktop: phone frames, SOC, graph, QR ----------
  const d = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  await d.addInitScript(l => localStorage.setItem('bcc-shield.locale', l), lang);
  await d.route('**/mobile/link', r => r.fulfill({ json: { hosts: ['192.168.1.23'] } }));
  const p = await d.newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.goto(BASE); await p.waitForTimeout(1500);
  const preset = async i => { await p.locator('.preset').nth(i).click(); };
  const phone = async name => { await p.waitForTimeout(600); await p.locator('.phone-frame').screenshot({ path: `${out}/${name}.png` }); log('shot', name); };
  // form & confirm (normal preset values)
  await preset(0); await p.locator('.phone-receipt .badge').waitFor({ timeout: 20000 });
  log('normal ->', await p.locator('.phone-receipt').getAttribute('class'));
  await phone('phone-approved');
  await p.locator('.receipt-new').click(); await p.locator('.phone-form').waitFor(); await phone('phone-form');
  await p.locator('.phone-form .transfer-cta').click(); await p.locator('.phone-confirm').waitFor(); await phone('phone-confirm');
  await p.locator('.transfer-edit').click();
  // decision panel next to phone (client view, whole)
  await p.locator('.transfer-grid').screenshot({ path: `${out}/client-view.png` }); log('shot client-view');
  // hub -> SOC
  await preset(2); await p.locator('#tab-soc[aria-selected="true"]').waitFor({ timeout: 20000 });
  await p.locator('.react-flow__node').first().waitFor({ timeout: 20000 }); await p.waitForTimeout(2500);
  await p.locator('.soc-dashboard').evaluate(e => e.scrollIntoView()); await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}/soc-top.png` }); log('shot soc-top');
  const casePanel = p.locator('.case-panel').first(); if (await casePanel.count()) { await casePanel.scrollIntoViewIfNeeded(); await casePanel.screenshot({ path: `${out}/soc-case.png` }); log('shot soc-case'); }
  const ml = p.locator('.ml-panel, .analysis-panel').first(); if (await ml.count()) { await ml.scrollIntoViewIfNeeded(); await ml.screenshot({ path: `${out}/soc-analysis.png` }); log('shot soc-analysis'); }
  const graph = p.locator('.graph-panel, .panel:has(.graph-canvas)').first(); await graph.scrollIntoViewIfNeeded(); await p.waitForTimeout(800); await graph.screenshot({ path: `${out}/soc-graph.png` }); log('shot soc-graph');
  await p.locator('.soc-stage-toggle').click(); await p.waitForTimeout(2500); await p.screenshot({ path: `${out}/soc-stage.png` }); log('shot soc-stage');
  await p.locator('.mobile-qr summary').click(); await p.locator('.mobile-qr-code svg').waitFor(); await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/soc-stage-qr.png` }); log('shot soc-stage-qr');
  await p.locator('.mobile-qr summary').click(); await p.locator('.soc-stage-toggle').click(); await p.waitForTimeout(800);
  await p.locator('#tab-mobile').click(); await p.locator('.phone-receipt').waitFor(); log('hub ->', await p.locator('.phone-receipt').getAttribute('class')); await phone('phone-blocked');
  // ---------- real phone (/mobile): cooling sheet + trusted contact ----------
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await m.addInitScript(l => localStorage.setItem('bcc-shield.locale', l), lang);
  const q = await m.newPage(); q.on('pageerror', e => errors.push(e.message));
  await q.goto(`${BASE}/mobile`); await q.waitForTimeout(1500);
  if (await q.locator('.receipt-new').isVisible()) await q.locator('.receipt-new').click();
  await q.screenshot({ path: `${out}/mobile-form.png` }); log('shot mobile-form');
  await q.locator('.contact').nth(1).click(); await q.locator('#transfer-amount').fill('900000');
  await q.locator('.demo-context summary').click(); for (const i of [0, 1]) await q.locator('.toggle-row').nth(i).click();
  await q.locator('.demo-context summary').click();
  await q.locator('.phone-form .transfer-cta').click(); await q.locator('.transfer-confirm').waitFor();
  await q.screenshot({ path: `${out}/mobile-confirm.png` }); log('shot mobile-confirm');
  await q.locator('.transfer-confirm').click();
  const dlg = q.locator('dialog.mobile-cooling'); await dlg.waitFor({ timeout: 20000 }); await q.waitForTimeout(800);
  await q.screenshot({ path: `${out}/mobile-cooling-intro.png` }); log('shot mobile-cooling-intro');
  // trusted contact
  await dlg.locator('.trusted-notify').waitFor({ timeout: 10000 }); await dlg.locator('.trusted-circle').evaluate(e => e.scrollIntoView({ block: 'end' })); await q.waitForTimeout(300);
  await q.screenshot({ path: `${out}/mobile-trusted-offer.png` }); await dlg.locator('.trusted-circle').screenshot({ path: `${out}/card-trusted-offer.png` }); log('shot mobile-trusted-offer');
  await dlg.locator('.trusted-notify').click(); await dlg.locator('.trusted-status').waitFor();
  const txid = await q.evaluate(() => document.querySelector('dialog .trusted-circle') && document.querySelector('[data-transaction-id]')?.getAttribute('data-transaction-id'));
  const nid = await q.evaluate(async () => { const id = location && [...performance.getEntriesByType('resource')].map(e => e.name).find(n => n.includes('/trusted-circle/'))?.split('/trusted-circle/')[1].split('?')[0]; return (await (await fetch(`/api/v1/trusted-circle/${id}?scope=notifications`)).json()).notifications[0].id; });
  execSync(`cd /tmp/bek/backend && BCC_INTEGRATIONS_ENABLED=true BCC_INTEGRATIONS_TELEGRAM_MODE=fake BCC_INTEGRATIONS_SIGNING_KEY=demo-signing-key-0123456789-abcdefghij timeout 8 uv run python /tmp/bek/backend/deliver_once.py /tmp/bek/.local-checks/local-demo.db >/dev/null 2>&1 || true`);
  await dlg.locator('.trusted-status[data-state="NOTIFICATION_SENT"]').waitFor({ timeout: 15000 }); await dlg.locator('.trusted-circle').evaluate(e => e.scrollIntoView({ block: 'end' })); await q.waitForTimeout(300);
  await q.screenshot({ path: `${out}/mobile-trusted-sent.png` }); await dlg.locator('.trusted-circle').screenshot({ path: `${out}/card-trusted-sent.png` }); log('shot mobile-trusted-sent');
  const mid = String(BigInt('0x' + nid.replace(/-/g, '')) % 2000000000n);
  execSync(`curl -s -o /dev/null -X POST http://127.0.0.1:8011/api/v1/trusted-contacts/simulator/update -H "Authorization: Bearer $(cat /tmp/simtoken)" -H "Content-Type: application/json" -d '{"kind":"suspect","chat_id":123,"reference":"${nid}","message_id":"${mid}"}'`);
  await dlg.locator('.trusted-status[data-state="SUSPICION_REPORTED"]').waitFor({ timeout: 15000 }); await dlg.locator('.trusted-circle').evaluate(e => e.scrollIntoView({ block: 'end' })); await q.waitForTimeout(300);
  await q.screenshot({ path: `${out}/mobile-trusted-suspicion.png` }); await dlg.locator('.trusted-circle').screenshot({ path: `${out}/card-trusted-suspicion.png` }); log('shot mobile-trusted-suspicion');
  // questionnaire
  await dlg.evaluate(e => e.scrollTo({ top: 0 })); await dlg.locator('.cooling-start').click(); await q.waitForTimeout(400);
  const qs = ['caller_claims_bank_or_police', 'asked_to_move_to_safe_account', 'asked_to_keep_secret_or_install_app', 'initiated_by_customer', 'knows_recipient_personally'];
  await dlg.locator(`input[name="${qs[0]}"]`).nth(0).check(); await q.waitForTimeout(300);
  await q.screenshot({ path: `${out}/mobile-cooling-question.png` }); log('shot mobile-cooling-question');
  const ans = [true, true, false, true, false];
  for (let i = 0; i < 5; i++) { await dlg.locator(`input[name="${qs[i]}"]`).nth(ans[i] ? 0 : 1).check(); await dlg.locator('.cooling-next').click(); await q.waitForTimeout(250); }
  await q.waitForTimeout(500); await q.screenshot({ path: `${out}/mobile-cooling-review.png` }); log('shot mobile-cooling-review');
  await dlg.locator('.sheet-close').click(); await q.locator('.phone-receipt').waitFor(); await q.waitForTimeout(500);
  await q.screenshot({ path: `${out}/mobile-held.png` }); log('shot mobile-held');
  // SOC feed after phone transfer (desktop)
  await p.locator('#tab-soc').click(); await p.waitForTimeout(3500); await p.locator('.soc-dashboard').evaluate(e => e.scrollIntoView());
  await p.screenshot({ path: `${out}/soc-after-phone.png` }); log('shot soc-after-phone');
  const feed = p.locator('.feed-panel').first(); if (await feed.count()) { await feed.scrollIntoViewIfNeeded(); await feed.screenshot({ path: `${out}/soc-feed.png` }); log('shot soc-feed'); }
  log('errors', errors);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
