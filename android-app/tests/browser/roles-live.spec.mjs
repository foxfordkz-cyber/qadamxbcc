import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test.use({ trace: "off", screenshot: "off", video: "off" });

function localOrigin() {
  const url = new URL(process.env.QADAM_GATEWAY ?? "http://127.0.0.1:18001");
  if (!["http:", "https:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost"].includes(url.hostname) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new Error("This acceptance test requires an isolated loopback gateway origin");
  }
  return url.origin;
}

const base = "/mobile/v1";
const guardian = "/api/integrations/guardian";

async function signIn(context, origin, login, password, role) {
  await context.route("**/*", route => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.goto(origin + "/wallet/");
  const form = page.locator("#personal-login");
  await expect(form).toBeVisible();
  await form.locator("[name=login]").fill(login);
  await form.locator("[name=password]").fill(password);
  const [reply] = await Promise.all([
    page.waitForResponse(r => r.url() === origin + base + "/auth/login" && r.request().method() === "POST"),
    form.locator("[type=submit]").click(),
  ]);
  expect(reply.status()).toBe(200);
  const session = await reply.json();
  expect(session.role).toBe(role);
  expect(session).not.toHaveProperty("token");
  await expect(page.locator('[data-nav="home"]')).toBeEnabled();
  return { page, subject: session.subject };
}

// Use the signed-in browser's HttpOnly cookie and the same subject header as the wallet.
async function api({ page, subject }, path, { body, status = 200 } = {}) {
  const response = await page.evaluate(async ({ subject, path, body, base }) => {
    const headers = { "X-Qadam-Web": "1", "X-Qadam-Subject": subject };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      headers["Idempotency-Key"] = crypto.randomUUID();
    }
    const res = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST", headers,
      credentials: "same-origin", redirect: "error", body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json() };
  }, { subject, path, body, base });
  expect(response.status, path).toBe(status);
  return response.data;
}

test("three personal accounts share a protected case and separate operational metrics", async ({ browser }) => {
  test.skip(process.env.QADAM_PASSWORD_E2E !== "1", "Requires a synthetic password-mode gateway");
  test.setTimeout(150_000);
  const origin = localOrigin();
  const passwords = JSON.parse(await readFile(process.env.QADAM_ACCESS_FILE, "utf8"));
  const contexts = await Promise.all(Array.from({ length: 3 }, () =>
    browser.newContext({ serviceWorkers: "block" })));
  try {
    const [client, officer, platform] = await Promise.all([
      signIn(contexts[0], origin, "client_demo", passwords.client, "client"),
      signIn(contexts[1], origin, "admin_demo", passwords.admin, "admin"),
      signIn(contexts[2], origin, "platform_demo", passwords.platform_admin, "platform_admin"),
    ]);
    expect(new Set([client.subject, officer.subject, platform.subject]).size).toBe(3);
    const initialMetrics = await api(platform, "/admin/metrics");
    const { request_id } = await api(client, "/requests", { body: {}, status: 201 });
    const transfer = await api(client, "/api/transfers/evaluate", { body: {
      request_id, currency: "KZT", recipient_phone: "+77010000003", amount: "900000",
      context: { active_call: true, from_deposit: true, is_new_recipient: true },
    } });
    expect(transfer.status).toBe("cooling_off");
    const report = await api(client, guardian + "/reports", { status: 201, body: {
      category: "impersonation", description: "Звонивший представился сотрудником банка и попросил перевести деньги.",
      confirmed_demo_submission: true, transaction_id: transfer.transaction_id,
    } });
    const caseFile = await api(officer, guardian + "/soc/cases", { status: 201, body: { report_id: report.id } });
    const caseCallback = "/cases/" + caseFile.id + "/callback";

    await test.step("Assigned officer invites the account owner from the case", async () => {
      await officer.page.bringToFront();
      await officer.page.locator('[data-nav="cases"]').click();
      await officer.page.locator(`[data-case="${caseFile.id}"]`).click();
      await officer.page.locator('[data-action="case-assign"]').click();
      await officer.page.locator('[data-action="officer-callback"]').click();
      await expect(officer.page.locator(".desk-callback h3")).toBeVisible();
    });
    const { callback } = await api(officer, caseCallback);
    expect(callback).toMatchObject({ status: "requested", transaction_id: transfer.transaction_id });

    await test.step("Owner consents and the assigned officer sees the receipt", async () => {
      await client.page.bringToFront();
      await client.page.locator('[data-nav="safety"]').click();
      await client.page.locator('[data-action="callbacks"]').click();
      const accept = client.page.locator(`[data-callback-id="${callback.id}"][data-answer="accepted"]`);
      const card = client.page.locator(".desk-callback").filter({ hasText: caseFile.id.slice(-8) });
      await expect(card.locator('a[href="tel:505"]')).toHaveCount(0);
      await accept.click();
      await expect(card.locator('a[href="tel:505"]')).toBeVisible();
      await officer.page.bringToFront();
      await expect(officer.page.locator(".desk-callback h3")).toHaveText(/келісім берді|согласился/i, { timeout: 20_000 });
      const receipt = (await api(officer, caseCallback)).callback;
      expect(receipt).toMatchObject({ id: callback.id, status: "accepted" });
      expect(receipt.answered_at).toBeTruthy();
      expect((await api(client, "/api/transfers/" + transfer.transaction_id)).status).toBe("cooling_off");
    });

    await test.step("Technical dashboard reflects the evaluation and enforces distinct permissions", async () => {
      await platform.page.bringToFront();
      await platform.page.locator('[data-nav="home"]').click();
      const metrics = await api(platform, "/admin/metrics");
      expect(metrics.scope).toBe("wallet_transfer_api");
      expect(metrics.requests).toBeGreaterThan(initialMetrics.requests);
      expect(metrics.buckets).toHaveLength(15);
      await expect(platform.page.locator(".desk-stats dd").first()).toHaveText(String(metrics.requests));
      await platform.page.locator('[data-nav="staff"]').click();
      await expect(platform.page.locator(`[data-staff="${officer.subject}"]`)).toBeVisible();
      await api(platform, guardian + "/soc/cases/" + caseFile.id, { status: 403 });
      await api(platform, "/account", { status: 403 });
      await api(officer, "/admin/staff", { status: 403 });
      await api(client, "/admin/metrics", { status: 403 });
      await api(client, caseCallback, { status: 403 });
    });
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});
