// Browser acceptance for a seeded synthetic stack. Use a disposable database.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");

async function exercise(browser, origin, language) {
  const context = await browser.newContext({ viewport: { width: language === "ru" ? 320 : 390, height: 820 } });
  const page = await context.newPage();
  const issues = [];
  page.on("pageerror", error => issues.push(error.message));
  try {
    await page.goto(new URL("/mobile", origin).href);
    await page.locator(".topbar").getByRole("button", { name: language === "ru" ? "РУС" : "ҚАЗ" }).click();
    await page.locator(".home-tools .primary").click();
    const submit = async () => {
      await page.locator(".transfer-cta").click();
      await page.locator(".transfer-confirm").click();
    };
    await page.locator(".contact").first().click();
    await submit();
    const normal = page.locator(".receipt-approved");
    await normal.waitFor();
    const normalId = await normal.getAttribute("data-transaction-id");
    await page.reload();
    await normal.waitFor();
    assert.equal(await normal.getAttribute("data-transaction-id"), normalId);

    await page.locator(".receipt-new").click();
    await page.locator(".contact").nth(1).click();
    await page.locator("#transfer-amount").fill("900000");
    await page.locator(".demo-context summary").click();
    await page.locator(".toggle-row").nth(0).click();
    await page.locator(".toggle-row").nth(1).click();
    await submit();
    const dialog = page.locator("dialog[open]");
    await dialog.locator(".cooling-start").click();
    await dialog.getByRole("radio").first().check();
    const heldId = await page.locator(".receipt-cooling_off").getAttribute("data-transaction-id");
    await page.reload();
    await dialog.locator('input[name="asked_to_move_to_safe_account"]').first().waitFor();
    assert.equal(await page.locator(".receipt-cooling_off").getAttribute("data-transaction-id"), heldId);
    await dialog.locator(".cooling-back").click();
    assert.ok(await dialog.getByRole("radio").first().isChecked());
    await dialog.locator(".danger-button").last().click();
    await page.locator(".receipt-cancelled").waitFor();

    await page.locator(".receipt-new").click();
    await page.locator(".contact").nth(2).click();
    await page.locator("#transfer-amount").fill("250000");
    const contextPanel = page.locator(".demo-context");
    if (!(await contextPanel.evaluate(element => element.open))) await contextPanel.locator("summary").click();
    for (const toggle of await contextPanel.getByRole("switch", { checked: true }).all()) await toggle.click();
    await submit();
    await page.locator(".receipt-blocked").waitFor();

    await page.locator(".phone-tabbar button").nth(3).click();
    const text = language === "ru" ? "Назовите код 123456" : "Қауіпсіз шотқа ақша аударыңыз";
    const leaked = [];
    page.on("request", request => { if ((request.postData() || "").includes(text) || request.url().includes(encodeURIComponent(text))) leaked.push(request.url()); });
    await page.locator("textarea").fill(text);
    await page.locator(".mobile-tool form button").click();
    await page.locator(".safety-result li").first().waitFor();
    assert.equal(await page.locator("textarea").inputValue(), "");
    assert.deepEqual(leaked, []);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await context.setOffline(true);
    await page.locator(".phone-alert.warning").waitFor();
    await context.setOffline(false);
    assert.deepEqual(issues, []);
    console.log(language + ": approved, receipt reload, hold, draft reload, cancel, blocked hub, message check, offline, mobile width");
  } finally { await context.close(); }
}

// The browser fixture isolates UI consent transitions from Telegram delivery.
async function exerciseCircleFixture(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 320, height: 820 } });
  const members = [];
  let creations = 0;
  try {
    await context.route("**/api/v1/trusted-circle/members", async route => {
      const req = route.request();
      if (req.method() === "GET") return route.fulfill({ json: { contacts: members } });
      if (req.method() === "DELETE") {
        const member = members.find(item => item.id === req.postDataJSON().contact_id);
        member.state = "CONTACT_REVOKED";
        return route.fulfill({ json: member });
      }
      assert.deepEqual(req.postDataJSON(), { owner_consent: true, language: "ru" });
      const member = { id: `10000000-0000-4000-8000-00000000000${++creations}`, state: "CONTACT_PENDING_CONSENT", alias: "" };
      members.push(member);
      return route.fulfill({ status: 201, json: { contact: member, invitation_token: "fixture_invitation_token_123", expires_at: new Date(Date.now() + 600000).toISOString() } });
    });
    const page = await context.newPage();
    await page.goto(new URL("/mobile", origin).href);
    await page.locator(".topbar").getByRole("button", { name: "РУС" }).click();
    const openCircle = () => page.locator(".phone-tabbar button").nth(2).click();
    await openCircle();
    await page.getByText("Доверенных контактов пока нет.").waitFor();
    const invite = page.getByRole("button", {name: "Создать приглашение"});
    assert.ok(await invite.isDisabled());
    for (let i = 0; i < 3; i++) {
      await page.getByRole("checkbox").check();
      await invite.click();
      await page.locator(".circle-list li").nth(i).waitFor();
    }
    assert.equal(await invite.count(), 0);
    assert.match(await page.locator(".safety-result code").innerText(), /^\/start /);
    await page.reload();
    await openCircle();
    await page.locator(".circle-list li").nth(2).waitFor();
    assert.equal(await page.locator(".safety-result code").count(), 0);
    members[0].state = "CONTACT_VERIFIED";
    await page.getByRole("button", {name:"Обновить"}).click();
    await page.getByText("Участие подтверждено").waitFor();
    await page.getByRole("button", {name:"Отозвать доступ"}).first().click();
    await page.getByRole("button", {name:"Подтвердить отзыв"}).click();
    await page.getByText("Согласие отозвано").waitFor();
    assert.ok(await invite.isDisabled());
    assert.equal(creations, 3);
    console.log("FAKE contact API: invitation consent, three-person limit, reload, recipient consent, revoke");
  } finally { await context.close(); }
}

module.exports = { exercise, exerciseCircleFixture };
if (require.main === module) (async () => {
  const origin = new URL(process.argv[2]);
  assert.ok(["localhost", "127.0.0.1"].includes(origin.hostname) && process.env.BCC_QA_SYNTHETIC === "1", "Use an explicit localhost synthetic stack and set BCC_QA_SYNTHETIC=1");
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  try {
    for (const lang of ["ru", "kk"]) await exercise(browser, origin, lang);
    await exerciseCircleFixture(browser, origin);
  }
  finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
