// Synthetic local/CI gateway only. Secrets are read in process, never logged/traced.
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test.use({ trace: "off", screenshot: "off" });
test("real PostgreSQL/Redis: client, ML cooling, SOC graph and report lifecycle", async ({
  page,
}) => {
  test.skip(
    process.env.QADAM_LIVE !== "1",
    "Explicit synthetic gateway required",
  );
  test.setTimeout(240000);
  const access = JSON.parse(
    await readFile(process.env.QADAM_ACCESS_FILE, "utf8"),
  );
  const origin = process.env.QADAM_GATEWAY ?? "http://127.0.0.1:18001";
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  async function login(role) {
    await page.goto("/connected.html");
    // Switch language before putting any credential into the password field.
    if ((await page.locator("html").getAttribute("lang")) === "kk")
      await page.locator('[data-action="language"]').click();
    await page.locator(`[data-role="${role}"]`).click();
    await page.locator('[name="origin"]').fill(origin);
    await page.locator('[name="code"]').fill(access[role]);
    await page.locator("#login-form button").click();
    await expect(page.locator(".role-tag")).toHaveText(
      role === "client" ? "CLIENT" : "SOC",
    );
    await expect(page.locator(".busy-banner")).toHaveCount(0);
  }
  async function submit(preset) {
    await page.locator('[data-nav="home"]').click();
    await page.locator('[data-action="transfer"]').click();
    await page.locator(`[data-preset="${preset}"]`).click();
    await page.locator('#transfer-form button[type="submit"]').click();
    await page.locator('[data-action="submit-transfer"]').click();
    await expect(page.locator('[data-action="refresh-detail"]')).toBeVisible();
  }
  await test.step("Client login and ordinary transfer", async () => {
    await login("client");
    await expect(page.locator('[data-nav="cases"]')).toHaveCount(0);
    await submit("normal");
    await expect(page.locator("h1")).toHaveText("Одобрено");
    await expect(
      page.getByText("Как объясняет модель", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/live-client-approved.png",
      fullPage: true,
    });
  });
  await test.step("Real 15-minute cooling and complete questionnaire", async () => {
    await submit("scam");
    await expect(page.locator("h1")).toHaveText("Пауза");
    await expect(page.locator("#countdown")).toHaveText(/1[34]:\d\d/);
    await page.screenshot({
      path: "test-results/live-client-cooling.png",
      fullPage: true,
    });
    await page.locator('[data-action="questionnaire"]').click();
    for (const answer of ["no", "no", "no", "yes", "yes"])
      await page.locator(`[data-action="answer-${answer}"]`).click();
    await page.locator('[data-action="submit-answers"]').click();
    await expect(page.locator("h1")).toHaveText("Пауза");
    await page.locator('[data-action="cancel-confirm"]').click();
    await page.locator('[data-action="cancel-transfer"]').click();
    await expect(page.locator("h1")).toHaveText("Отменено");
  });
  await test.step("Hub blocks through the existing graph engine", async () => {
    await submit("hub");
    await expect(page.locator("h1")).toHaveText("Отклонено");
  });
  await test.step("Private Scam Check, mock lookup and report", async () => {
    await page.locator('[data-nav="safety"]').click();
    await page.locator('[data-action="scan"]').click();
    await page
      .locator('[name="text"]')
      .fill(
        "Звонящий просит перевести деньги на безопасный счёт и никому не говорить.",
      );
    await page.locator("#scan-form button").click();
    await expect(
      page.getByRole("heading", { name: "Результат", exact: true }),
    ).toBeVisible();
    await page.locator('[data-nav="safety"]').click();
    await page.locator('[data-action="gateway"]').click();
    await page.locator('[name="identifier"]').selectOption("SYN-NETWORK-001");
    await page.locator("#gateway-form button").click();
    await expect(page.getByText("INDICATORS · MOCK")).toBeVisible();
    await page.locator('[data-nav="safety"]').click();
    await page.locator('[data-action="report"]').click();
    await page
      .locator('[name="description"]')
      .fill(
        "Тестовый звонящий представился банком и попросил срочно перевести деньги. " +
          Array.from(crypto.getRandomValues(new Uint8Array(8)), n => String.fromCharCode(97 + n % 26)).join(""),
      );
    await page.locator('[name="consent"]').check();
    await page.locator("#report-form button").click();
    await expect(
      page.getByText("Передано на рассмотрение", { exact: true }).first(),
    ).toBeVisible();
    await page.locator('[data-nav="settings"]').click();
    await page.locator('[data-action="logout"]').click();
    await expect(page.locator("#login-form")).toBeVisible();
  });
  await test.step("Admin has separate permissions and sees persisted client activity", async () => {
    await login("admin");
    await expect(page.locator('[data-action="transfer"]')).toHaveCount(0);
    await page.screenshot({
      path: "test-results/live-soc-feed.png",
      fullPage: true,
    });
    await page.locator('[data-filter="blocked"]').click();
    await page.locator("[data-detail]").first().click();
    await expect(page.locator('[data-action="cancel-confirm"]')).toHaveCount(0);
    await page.locator("[data-graph]").click();
    await expect(page.locator(".graph circle").first()).toBeVisible();
    await page.screenshot({
      path: "test-results/live-soc-graph.png",
      fullPage: true,
    });
    await page.locator('[data-nav="cases"]').click();
    await page.locator('[data-action="reports"]').click();
    await page.locator("[data-ack]").first().click();
    await expect(
      page.getByText("Отмечено оператором", { exact: true }).first(),
    ).toBeVisible();
    await page.locator("[data-open-case]").first().click();
    await page.locator('[data-action="case-review"]').click();
    await expect(page.getByText(/IN_REVIEW · v/)).toBeVisible();
    await page.screenshot({
      path: "test-results/live-soc-case.png",
      fullPage: true,
    });
    await page.locator('[data-nav="system"]').click();
    await expect(page.getByText("fake_enabled", { exact: true })).toBeVisible();
    await page.locator('[data-nav="settings"]').click();
    await page.locator('[data-action="logout"]').click();
  });
  expect(errors).toEqual([]);
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  expect(stored.includes(access.client) || stored.includes(access.admin)).toBe(
    false,
  );
});
