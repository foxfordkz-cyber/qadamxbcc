// Exercise the isolated local jury wallet with Chromium's standard virtual authenticator.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const origin = "http://localhost:18003";
const browser = await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL});
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const device = await context.newCDPSession(page);
  await device.send("WebAuthn.enable");
  await device.send("WebAuthn.addVirtualAuthenticator", {options:{
    protocol:"ctap2", transport:"internal", hasResidentKey:true,
    hasUserVerification:true, isUserVerified:true, automaticPresenceSimulation:true,
  }});
  const problems = [];
  page.on("pageerror", error => problems.push(error.message));
  await page.addInitScript(() => localStorage.setItem("qadam.language", "ru"));
  await page.goto(origin + "/jury");
  await page.locator('form[action="/jury/start"] button').click();
  await page.locator("[name=login]").fill("client_demo");
  await page.locator("[name=password]").fill("SaqBol-Client-2026");
  await page.locator("#personal-login [type=submit]").click();
  await page.locator('[data-nav="safety"]').click();
  await page.locator('[data-action="enroll-transfer-key"]').click();
  await page.getByText("Подключён. Каждый перевод", {exact:false}).waitFor();
  await page.locator('[data-nav="home"]').click();
  await page.locator('[data-action="transfer"]').first().click();
  await page.locator("[name=recipient_phone]").selectOption("+77010000002");
  await page.locator("[name=amount]").fill("1250");
  await page.locator("#transfer-form button[type=submit], #transfer-form button:not([type])").last().click();
  const evaluate = page.waitForResponse(r => r.url().endsWith("/api/transfers/evaluate"));
  await page.locator('[data-action="submit-transfer"]').click();
  const response = await evaluate;
  assert.ok(response.ok(), "evaluation HTTP " + response.status());
  const payment = await response.json();
  assert.equal(Number(payment.amount), 1250);
  await page.getByText("Клиент подтвердил перевод ключом устройства").waitFor();
  await page.locator('[data-action="language"]').click();
  await page.getByText("Клиент аударымды құрылғы кілтімен растады").waitFor();
  assert.deepEqual(problems, []);
  console.log("PASS · WebAuthn registration, payment, signed receipt and language switch");
} finally {
  await browser.close();
}
