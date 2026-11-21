// Run against a local Next demo. The only unmocked POST is a read-only check of a seed payee.
const assert = require("node:assert/strict");
const { chromium, expect } = require("@playwright/test");

const target = new URL(process.env.BCC_QA_URL || "http://127.0.0.1:3000");
if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || target.username || target.password) {
  throw new Error("Use a loopback demo origin for the browser checks.");
}
const labels = {
  ru: { lang: "РУС", known: "В журнале есть исходящий звонок", absent: "В журнале нет исходящего звонка", failure: "Проверка не выполнена", checked: "Время проверки", caution: "безопасный счёт", matched: "Имя совпадает" },
  kk: { lang: "ҚАЗ", known: "Журналда шығыс қоңырауы бар", absent: "Журналда шығыс қоңырауы жоқ", failure: "Тексеру орындалмады", checked: "Тексеру уақыты", caution: "қауіпсіз шотқа", matched: "Аты сәйкес келеді" },
};
function callRecord(verified, staff = "Асем Нурланова") {
  return {
    check_id: "00000000-0000-4000-8000-000000000095", verified, employee_name: verified ? staff : null,
    checked_at: "2026-11-21T09:03:00Z", started_at: verified ? "2026-11-21T09:00:00Z" : null,
    message_ru: "", message_kk: "", simulated_log: true,
  };
}
async function verify(browser, language) {
  const ctx = await browser.newContext({viewport: {width: 393, height: 870}});
  try {
    const t = labels[language];
    const page = await ctx.newPage();
    const errors = [];
    let rejectCall = false, verified = true, staleSender, release;
    const gate = new Promise(resolve => { release = resolve; });
    page.on("pageerror", e => errors.push(e.message));
    await ctx.route("**/*", async route => {
      const r = route.request(), url = new URL(r.url());
      if (url.origin !== target.origin) return route.abort();
      if (url.pathname === "/api/v1/call-check" && r.method() === "POST") {
        if (r.postDataJSON().customer_id === staleSender) {
          await gate;
          return route.fulfill({json: callRecord(true, "STALE RECORD")}).catch(() => {});
        }
        return route.fulfill(rejectCall ? {status: 503, json: {error: "apiError"}} : {json: callRecord(verified)});
      }
      if (r.method() === "POST" && url.pathname !== "/api/v1/payee-check") {
        errors.push("Unexpected POST " + url.pathname); return route.abort();
      }
      return route.continue();
    });
    await page.goto(target.origin + "/mobile");
    await page.locator(".topbar").getByRole("button", {name: t.lang}).click();
    await page.locator(".home-tools .primary").click();
    await page.locator(".contact").first().click();
    await page.locator("#transfer-amount").fill("25000");
    await page.locator(".demo-context summary").click();
    const active = page.locator(".toggle-row").first();
    await active.click();
    const log = page.locator(".call-log-summary");
    await expect(log).toContainText(t.known);
    await expect(log).toContainText("Асем Нурланова");
    await expect(log).toContainText(t.checked);
    await expect(log).toContainText(t.caution);
    await expect(log.locator("time")).toHaveCount(2);
    await expect(log.locator('a[href="tel:505"]')).toBeVisible();
    rejectCall = true;
    await page.locator(".call-check-cta").click();
    await expect(log).toContainText(t.failure);
    await expect(log.locator("time")).toHaveCount(0);
    const sender = page.locator(".sender-field input");
    staleSender = await sender.inputValue(); rejectCall = false;
    await Promise.all([
      page.waitForRequest(r => new URL(r.url()).pathname === "/api/v1/call-check" && r.postDataJSON()?.customer_id === staleSender),
      page.locator(".call-check-cta").click(),
    ]);
    verified = false;
    await sender.fill("00000000-0000-4000-8000-000000000002");
    await expect(log).toContainText(t.absent);
    release();
    await expect(log.locator("time")).toHaveCount(1);
    await expect(log).not.toContainText("STALE RECORD");
    await active.click();
    await expect(log).toHaveCount(0);

    await page.locator(".transfer-cta").click();
    const payee = page.locator(".payee-verification"), confirm = page.locator(".transfer-confirm");
    const verdict = payee.locator("[data-payee-status]");
    await expect(verdict).toHaveAttribute("data-payee-status", "identified");
    await expect(verdict).toContainText("Данияр А.");
    await expect(confirm).toBeEnabled();
    await payee.locator("summary").click();
    const name = payee.getByRole("textbox");
    await name.fill("Марат"); await expect(confirm).toBeDisabled();
    await payee.getByRole("button").click();
    await expect(verdict).toHaveAttribute("data-payee-status", "mismatch");
    await expect(confirm).toBeDisabled();
    await payee.locator("select").selectOption("other");
    await expect(verdict).toHaveAttribute("data-payee-status", "unavailable");
    await expect(verdict).not.toContainText("Данияр");
    await name.fill("Данияр"); await payee.locator("select").selectOption("bcc");
    await expect(verdict).toHaveAttribute("data-payee-status", "close");
    await name.fill("Данияр А."); await payee.getByRole("button").click();
    await expect(verdict).toContainText(t.matched);
    await expect(confirm).toBeEnabled();
    await page.locator(".transfer-edit").click(); await page.locator(".contact").nth(2).click();
    await page.locator(".transfer-cta").click();
    await expect(verdict).toContainText("Марат Т.");
    await expect(verdict).not.toContainText("Данияр");
    assert.deepEqual(errors, []);
    console.log(language + " · call record, journal failure, stale sender reply, beneficiary edits: OK");
  } finally { await ctx.close(); }
}
(async () => {
  const channel = process.env.PLAYWRIGHT_CHANNEL || (process.platform === "win32" ? "chrome" : "chromium");
  const browser = await chromium.launch({channel, headless: true});
  try { for (const language of ["ru", "kk"]) await verify(browser, language); }
  finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
