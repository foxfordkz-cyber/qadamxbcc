import { test, expect } from "@playwright/test";

async function offline(page, language = "ru") {
  await page.goto("/index.html?offline=1");
  await page.locator('.bottom-nav [data-route="settings"]').click();
  await page.locator(`[data-lang="${language}"]`).click();
  await page.locator('.bottom-nav [data-route="home"]').click();
}
test("an older WebView can open the same team account in a browser", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(AbortSignal, "timeout", {value: undefined}));
  await page.goto("/");
  const help = page.locator(".native-start-help");
  await expect(help.locator('[lang="kk"]')).toContainText("Android System WebView");
  await expect(help.locator('[lang="ru"]')).toContainText("Android System WebView");
  await expect(help.locator("a")).toBeVisible();
  await expect(help.locator("a")).toHaveAttribute("href", "https://saq-bol-mobile.onrender.com/wallet/");
  await expect(page.locator("#personal-login")).toHaveCount(0);
});
test("welcome exposes personal sign-in and explains unavailable deployment", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".topbar .wordmark")).toContainText("Saq Bol × BCC");
  await expect(page.getByRole("heading", {level: 1})).toHaveText(/Кабинетке кіру|Вход в кабинет/);
  await page.locator('[name="login"]').fill("client_demo");
  await page.locator('[name="password"]').fill("example");
  await page.locator('[data-action="show-password"]').click();
  await expect(page.locator('[name=password]')).toHaveAttribute("type","text");
  await page.locator("#personal-login button[type=submit]").click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator('[name="origin"], [name="code"], [data-role="admin"]')).toHaveCount(0);
  await page.screenshot({ path: "test-results/welcome.png", fullPage: true });
});
for (const [preset, status] of [
  ["everyday", "Демо-перевод завершён"],
  ["pressure", "Время сделать паузу"],
  ["network", "Демо-перевод отклонён"],
]) {
  test(`offline ${preset} persists once, without network effects`, async ({
    page,
  }) => {
    const mutations = [];
    page.on("request", (r) => {
      if (r.method() !== "GET") mutations.push(r.url());
    });
    await offline(page);
    await page.locator('[data-action="transfer"]').click();
    await page.locator(`[data-preset="${preset}"]`).click();
    await page.locator('[data-action="review"]').click();
    await page.locator('[data-action="confirm"]').click();
    await expect(page.locator("h1")).toHaveText(status);
    if (preset === "pressure") {
      await page.screenshot({
        path: "test-results/offline-cooling.png",
        fullPage: true,
      });
      await page.locator('[data-action="cancel-transfer"]').click();
      await expect(page.locator("h1")).toHaveText("Демо-перевод отменён");
    }
    await page.reload();
    await page.locator('.bottom-nav [data-route="history"]').click();
    await expect(page.locator(".ledger-row")).toHaveCount(1);
    expect(mutations).toEqual([]);
  });
}
test("offline questionnaire clears answers and never claims safety", async ({
  page,
}) => {
  await offline(page);
  await page.locator('[data-action="check"]').click();
  for (let i = 0; i < 3; i++) await page.locator('[data-action="no"]').click();
  await expect(page.locator("h1")).toHaveText("Сохраняй осторожность");
  await expect(page.locator(".heading p")).toContainText("не гарантирует");
  expect(
    await page.evaluate(() =>
      Object.keys(JSON.parse(localStorage.getItem("qadam.android.demo.v1"))),
    ),
  ).not.toContain("answers");
  await page.locator('[data-action="check"]').click();
  await page.locator('[data-action="yes"]').click();
  await page.locator('[data-action="back"]').click();
  await page.locator('[data-action="check"]').click();
  await expect(page.locator(".eyebrow")).toContainText("1 / 3");
});
test("clear history requires confirmation and retains language", async ({
  page,
}) => {
  await offline(page, "kk");
  await page.locator('.bottom-nav [data-route="settings"]').click();
  await page.locator('[data-action="reset"]').click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator('[data-action="reset"]').click();
  await page.locator('[data-action="erase"]').click();
  await expect(page.locator("html")).toHaveAttribute("lang", "kk");
});
test("narrow and large-text layouts stay within the viewport", async ({
  page,
}) => {
  for (const width of [320, 393, 540]) {
    await page.setViewportSize({ width, height: 851 });
    await offline(page, "kk");
    await page.screenshot({
      path: `test-results/home-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.locator('.bottom-nav [data-route="safety"]').click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
test("blocked storage is announced without a blank screen", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("disabled");
      },
    });
  });
  await page.goto("/index.html?offline=1");
  await expect(page.locator(".network-note")).toBeVisible();
  await expect(page.locator(".q-card")).toBeVisible();
});
test("live role gate is server-derived and errors do not trigger demo fallback", async ({
  page,
}) => {
  let calls = 0;
  await page.route("http://127.0.0.1:18001/mobile/v1/**", async (route) => {
    calls++;
    if (route.request().url().endsWith("/sessions"))
      await route.fulfill({
        json: { token: "synthetic-session-token", role: "client" },
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    else if (route.request().url().includes("/transfers?"))
      await route.fulfill({
        json: { items: [], has_more: false },
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    else
      await route.fulfill({
        status: 503,
        json: { detail: "unavailable" },
        headers: { "Access-Control-Allow-Origin": "*" },
      });
  });
  await page.goto("/dev/connected.html");
  await page.locator('[name="origin"]').fill("http://127.0.0.1:18001");
  await page.locator('[name="code"]').fill("synthetic-test-access-code-12345");
  await page.locator("#login-form button").click();
  await expect(page.locator(".role-tag")).toHaveText("Клиент");
  await expect(page.locator('[data-nav="cases"]')).toHaveCount(0);
  await page.locator('[data-nav="safety"]').click();
  await page.locator('[data-action="contacts"]').click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(calls).toBe(3);
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  expect(stored).not.toContain("synthetic-session-token");
  expect(stored).not.toContain("synthetic-test-access-code");
});
