import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test.use({ trace: "off", screenshot: "off", video: "off" });

const api = "/mobile/v1";
const guardian = "/api/integrations/guardian";

function loopback() {
  const url = new URL(process.env.QADAM_JURY_ORIGIN ?? "http://127.0.0.1:18002");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !["http:", "https:"].includes(url.protocol) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Jury room acceptance requires an isolated loopback server");
  }
  return url.origin;
}

async function startRoom(page, origin, route = "/jury/start") {
  await page.goto(origin);
  const reply = page.waitForResponse(r => r.url() === origin + route);
  await page.locator(`form[action="${route}"] [type=submit]`).click();
  expect((await reply).status()).toBe(303);
  await page.locator("#personal-login").waitFor();
  await page.goto(origin);
  const href = await page.locator("a[href^='/jury/join/']").getAttribute("href");
  const invitation = new URL(href, origin);
  expect(invitation.origin).toBe(origin);
  await page.goto(origin + "/wallet/");
  return invitation.href;
}

test("a juror can select a saved recipient and an officer can inspect the same prepared case", async ({browser}) => {
  test.skip(process.env.QADAM_JURY_E2E !== "1", "Requires an isolated jury-room gateway");
  test.setTimeout(90_000);
  const origin = loopback();
  const readme = await readFile(new URL("../../../README.md", import.meta.url), "utf8");
  const customerContext = await browser.newContext({serviceWorkers:"block"});
  const officerContext = await browser.newContext({serviceWorkers:"block"});
  try {
    const page = await customerContext.newPage();
    const invite = await startRoom(page, origin, "/jury/start/history");
    const client = await enter(page, "client_demo", "client", readme);
    const {recipients} = await request(client, "/account");
    expect(recipients).toHaveLength(7);
    const saved = recipients.find(contact => contact.payee_ref === "saved-1");
    expect(saved).toBeDefined();
    await page.locator(`[data-payee="${saved.phone}"]`).click();
    await page.locator('[name="amount"]').fill("4050.25");
    await page.locator("#transfer-form button").click();
    await expect(page.locator("[data-payee-status=identified]")).toBeVisible();

    const reports = await request(client, guardian + "/reports");
    expect(reports).toHaveLength(4);
    const officerPage = await officerContext.newPage();
    await officerPage.goto(invite);
    const officer = await enter(officerPage, "admin_demo", "admin", readme);
    const cases = (await request(officer, "/wallet/cases")).items;
    expect(cases).toHaveLength(10);
    const linked = cases.find(item => item.report_id === reports[0].id);
    expect(linked).toBeDefined();
    await officerPage.locator('[data-nav="cases"]').click();
    await officerPage.locator(`[data-case="${linked.id}"]`).click();
    const source = officerPage.locator(".reason-groups").locator(
      `[data-detail="${reports[0].transaction_id}"]`,
    );
    await expect(source).toBeVisible();
    await source.click();
    await expect(officerPage.locator('[data-screen="detail"]')).toBeVisible();
    expect(new URL(officerPage.url()).searchParams.get("operation")).toBe(reports[0].transaction_id);
    // In the prepared incoming-payment cases, the preceding settled outgoing
    // receipt is recorded a minute earlier, even if other seed rows vary.
    const incomingCase = cases.find(item => !reports.some(report => report.id === item.report_id));
    const path = guardian + "/soc/cases/" + incomingCase.id + "/evidence";
    await request(client, path, 403);
    const evidence = await request(officer, path);
    const first = evidence.recipient_ledger.items[0];
    expect(Date.parse(first.settled_at)).toBeLessThan(Date.parse(evidence.recipient_ledger.before_time));
    await officerPage.locator('[data-nav="cases"]').click();
    await officerPage.locator(`[data-case="${incomingCase.id}"]`).click();
    const receipt = officerPage.locator(`.case-ledger [data-detail="${first.transaction_id}"]`);
    await expect(receipt).toContainText(/₸/);
    await receipt.click();
    await expect(officerPage.locator('[data-screen="detail"]')).toBeVisible();
    expect(new URL(officerPage.url()).searchParams.get("operation")).toBe(first.transaction_id);
  } finally {
    await Promise.all([customerContext.close(), officerContext.close()]);
  }
});

test("a disputed incoming payment reserves its amount and its saved statement follows the officer's decision", async ({ browser }, testInfo) => {
  test.skip(process.env.QADAM_JURY_E2E !== "1", "Requires an isolated jury-room gateway");
  test.setTimeout(90_000);
  const origin = loopback();
  const readme = await readFile(new URL("../../../README.md", import.meta.url), "utf8");
  const customer = await browser.newContext({serviceWorkers: "block"});
  const officer = await browser.newContext({serviceWorkers: "block"});
  try {
    const page = await customer.newPage();
    const invite = await startRoom(page, origin, "/jury/start/history");
    await enter(page, "client_demo", "client", readme);
    await page.locator('[data-nav="history"]').click();
    const incoming = page.locator("[data-incoming]").first();
    await expect(incoming).toBeVisible();
    const id = await incoming.getAttribute("data-incoming");
    await incoming.click();
    await page.locator('[data-action="dispute-report"]').click();
    const save = page.waitForEvent("download");
    await page.locator('[data-action="dispute-certificate"]').click();
    const download = await save;
    const file = testInfo.outputPath("statement.json");
    await download.saveAs(file);
    const document = JSON.parse(await readFile(file, "utf8")).statement;
    expect(document.original_id).toBe(id);
    expect(document.restricted_amount).toBe(document.original_amount);
    await page.locator('[data-action="dispute-verify"]').click();
    await expect(page.getByText(/Подпись и статус подтверждены|Қолтаңба мен күй расталды/)).toBeVisible();

    const staff = await officer.newPage();
    await staff.goto(invite);
    await enter(staff, "admin_demo", "admin", readme);
    await staff.locator('[data-nav="cases"]').click();
    await staff.locator('button.graph-record[data-detail="' + id + '"]').click();
    await staff.locator('[data-action="dispute-clear"]').click();
    await expect(staff.getByText(/Сотрудник снял ограничение|Қызметкер шектеуді алып тастады/)).toBeVisible();
    await page.locator("[data-dispute-file]").setInputFiles(file);
    await expect(page.getByText(/Статус с тех пор изменился|Содан бері күй өзгерді/)).toBeVisible();
  } finally {
    await Promise.all([customer.close(), officer.close()]);
  }
});

async function enter(page, login, expectedRole, readme) {
  // Exercise exactly the fixtures a reviewer sees in the Markdown table.
  const row = readme.split("\n").find(line => line.includes("| `" + login + "` |"));
  if (!row) throw new Error("Missing published fixture for " + login);
  const password = row.split("|")[3]?.trim().match(/^`([^`]+)`$/)?.[1];
  if (!password) throw new Error("Missing published password for " + login);
  const form = page.locator("#personal-login");
  await form.locator("[name=login]").fill(login);
  await form.locator("[name=password]").fill(password);
  const replyPromise = page.waitForResponse(r => new URL(r.url()).pathname === api + "/auth/login");
  await form.locator("[type=submit]").click();
  const reply = await replyPromise;
  expect(reply.status()).toBe(200);
  const identity = await reply.json();
  expect(identity.role).toBe(expectedRole);
  expect(identity).not.toHaveProperty("token");
  await expect(page.locator('[data-nav="home"]')).toBeVisible();
  return { page, subject: identity.subject };
}

async function request({ page, subject }, route, status = 200, method = "GET", body) {
  const response = await page.evaluate(async ({ path, subject, method, body }) => {
    const headers = { "X-Qadam-Web": "1", "X-Qadam-Subject": subject };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      headers["Idempotency-Key"] = crypto.randomUUID();
    }
    const reply = await fetch(path, {
      method, headers, body: JSON.stringify(body), credentials: "same-origin", redirect: "error",
    });
    return { status: reply.status, payload: await reply.json() };
  }, { path: api + route, subject, method, body });
  expect(response.status, route).toBe(status);
  return response.payload;
}

test("jurors can invite colleagues without sharing transfers, metrics or employee permissions with another room", async ({ browser }) => {
  test.skip(process.env.QADAM_JURY_E2E !== "1", "Requires an isolated jury-room gateway");
  test.setTimeout(150_000);
  const origin = loopback();
  const readme = await readFile(new URL("../../../README.md", import.meta.url), "utf8");
  const contexts = [];
  async function tab() {
    const context = await browser.newContext({ serviceWorkers: "block" });
    contexts.push(context);
    await context.route("**/*", r => new URL(r.request().url()).origin === origin ? r.continue() : r.abort());
    return context.newPage();
  }
  try {
    const [ownerPage, secondOfficerPage] = await Promise.all([tab(), tab()]);
    const roomA = await startRoom(ownerPage, origin);
    const roomB = await startRoom(secondOfficerPage, origin);
    expect(roomA !== roomB).toBe(true);
    const [officerPage, adminPageA, adminPageB] = await Promise.all([tab(), tab(), tab()]);
    await Promise.all([officerPage.goto(roomA), adminPageA.goto(roomA), adminPageB.goto(roomB)]);
    const [owner, officerA, officerB, adminA, adminB] = await Promise.all([
      enter(ownerPage, "client_demo", "client", readme),
      enter(officerPage, "admin_demo", "admin", readme),
      enter(secondOfficerPage, "admin_demo", "admin", readme),
      enter(adminPageA, "platform_demo", "platform_admin", readme),
      enter(adminPageB, "platform_demo", "platform_admin", readme),
    ]);

    const { request_id } = await request(owner, "/requests", 201, "POST", {});
    const transfer = await request(owner, "/api/transfers/evaluate", 200, "POST", {
      request_id, amount: "900000", currency: "KZT", recipient_phone: "+77010000003",
      context: { active_call: true, from_deposit: true, is_new_recipient: true },
    });
    expect(transfer.status).toBe("cooling_off");
    const report = await request(owner, guardian + "/reports", 201, "POST", {
      category: "impersonation", transaction_id: transfer.transaction_id,
      description: "Учебное обращение о звонке от имени сотрудника банка.", confirmed_demo_submission: true,
    });
    const caseFile = await request(officerA, guardian + "/soc/cases", 201, "POST", { report_id: report.id });
    const cases = (await request(officerB, guardian + "/soc/cases")).items;
    expect(cases.some(c => c.id === caseFile.id)).toBe(false);
    await request(officerA, "/cases/" + caseFile.id + "/callback");
    await request(officerB, "/cases/" + caseFile.id + "/callback", 404);
    await test.step("A room's officer can send a finding only to its reporting customer", async () => {
      await officerA.page.bringToFront();
      await officerA.page.locator('[data-nav="cases"]').click();
      await officerA.page.locator(`[data-case="${caseFile.id}"]`).click();
      await officerA.page.locator('[data-action="case-review"]').click();
      const form = officerA.page.locator("#case-close");
      await form.locator("select").selectOption("confirmed_fraud");
      await form.locator("button").click();
      await expect(form).toHaveCount(0);
      await ownerPage.bringToFront();
      await ownerPage.goto(origin + "/wallet/?report=" + report.id);
      const result = ownerPage.locator(".desk-resolution");
      await expect(result).toContainText(caseFile.id);
      await expect(result).toContainText(/Алаяқтық расталды|Мошенничество подтверждено/);
      await result.locator("[data-detail]").click();
      await expect(ownerPage.locator("#countdown")).toBeVisible();
      const receipt = await request(owner, "/reports/" + report.id + "/callback");
      expect(receipt.resolution.operation).toMatchObject({transaction_id:transfer.transaction_id, status:"cooling_off", amount:"900000.00"});
      expect(receipt.resolution.balance).toBe((await request(owner, "/account")).balance);
    });
    expect((await request(adminA, "/admin/metrics")).requests).toBe(1);
    expect((await request(adminB, "/admin/metrics")).requests).toBe(0);

    const staffA = (await request(adminA, "/admin/staff")).items[0];
    const staffPath = "/admin/staff/" + staffA.subject;
    const disabled = await request(adminA, staffPath, 200, "PATCH", {
      expected_version: staffA.version, enabled: false,
    });
    try {
      await request(officerA, "/session", 401);
      await request(officerB, "/session");
      const other = await request(adminB, "/admin/staff");
      expect(other.items[0].enabled).toBe(true);
      expect(other.audit).toHaveLength(0);
    } finally {
      await request(adminA, staffPath, 200, "PATCH", { expected_version: disabled.version, enabled: true });
    }
    // Switching rooms in the same browser must also end the original wallet session.
    await secondOfficerPage.goto(roomA);
    await expect(secondOfficerPage.locator("#personal-login")).toBeVisible();
    await request(officerB, "/session", 401);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});
