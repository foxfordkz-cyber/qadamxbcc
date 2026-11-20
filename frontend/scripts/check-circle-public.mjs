// Read-only smoke for the team's published Worker. Run after deployment.
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";

const origin = "https://saq-bol-bcc.zerdeliportald.workers.dev";
const botUrl = "https://t.me/bekzat_bcc_shield_test_bot";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
    : process.platform === "win32" ? { channel: "msedge" } : {}),
});
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const mutations = [];
  await context.route("**/*", route => {
    const request = route.request();
    if (!["GET", "HEAD"].includes(request.method())) {
      mutations.push(request.method());
      return route.abort();
    }
    return new URL(request.url()).origin === origin ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  await page.goto(origin + "/mobile", { waitUntil: "domcontentloaded" });
  const ru = page.getByRole("button", { name: "РУС", exact: true });
  await ru.click();
  const circle = page.locator(".home-tools").getByRole("button", { name: "Доверенный круг", exact: true });
  await circle.waitFor();
  const api = name => page.waitForResponse(r => r.url() === origin + "/api/v1/trusted-circle/" + name);
  const [members, initialStatus] = await Promise.all([
    api("members"), api("session"), circle.click(),
  ]);
  assert.equal(members.status(), 401);
  assert.deepEqual(await members.json(), { error: "circle_login_required" });
  const bot = page.getByRole("link", { name: "Открыть Telegram-бота" });
  assert.equal(await bot.getAttribute("href"), botUrl);
  let status = initialStatus;
  for (let n = 0; status.status() >= 500 && n < 5; n++) {
    await delay(10000);
    [status] = await Promise.all([api("session"), page.getByRole("button", { name: "Проверить связь" }).click()]);
  }
  assert.equal(status.status(), 200);
  assert.deepEqual(await status.json(), { available: true });
  await page.getByText("Вход по коду доступен", { exact: true }).waitFor();
  await page.getByRole("button", { name: "ҚАЗ", exact: true }).click();
  await page.getByText("Кодпен кіру қолжетімді", { exact: true }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Telegram-ботты ашу" }).getAttribute("href"), botUrl);
  assert.deepEqual(mutations, []);
  console.log("Public mobile smoke passed (kk/ru, guest privacy, Telegram link, live session readiness).");
} finally {
  await browser.close();
}
