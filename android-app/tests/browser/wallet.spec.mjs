import { test, expect } from "@playwright/test";

test("wallet card and chart remain usable at phone widths", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#personal-login [type=submit]")).toBeEnabled();
  for (const width of [320, 360, 412]) {
    await page.setViewportSize({ width, height: 720 });
    await page.evaluate(async () => {
      const { walletUI } = await import("/wallet.mjs");
      const views = walletUI({
        T: (ru) => ru,
        E: String,
        amount: (v) => v + " ₸",
        when: String,
        status: String,
        button: () => "",
      });
      const account = {
        display_name: "Аружан Демо",
        balance: "4502614",
        card_last4: "0001",
        recipients: [],
      };
      const series = Array.from({ length: 7 }, (_, i) => ({
        day: "2026-11-" + (10 + i),
        incoming: 0,
        outgoing: i * 100,
        count: i,
      }));
      document.querySelector("main").innerHTML =
        views.home(account, { items: [] }, null, false, "") +
        views.analytics(
          {
            days: 7,
            series,
            from: series[0].day,
            incoming: 0,
            outgoing: 2100,
            count: 21,
            paused: 0,
            blocked: 0,
          },
          6,
        );
    });
    const card = await page.locator(".q-card").boundingBox();
    expect(card.y + card.height).toBeLessThan(525);
    const chart = await page.locator(".chart-scroll").boundingBox();
    expect(chart.width).toBeGreaterThan(width * 0.68);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }
});

test("sign-in can recover from a service outage without granting a role early", async ({
  page,
  baseURL,
}) => {
  let status = 503;
  let attempts = 0;
  await page.route("https://wallet.test/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (!path.startsWith("/mobile/v1/")) {
      const asset = await route.fetch({
        url: new URL(path + url.search, baseURL).href,
      });
      return route.fulfill({ response: asset });
    }
    if (path.endsWith("/auth/login")) {
      attempts += 1;
      return route.fulfill({
        status,
        json:
          status === 200
            ? {
                role: "client",
                subject: "synthetic-wallet",
                token: "synthetic-session",
              }
            : { detail: "unavailable" },
      });
    }
    if (path.endsWith("/account"))
      return route.fulfill({
        json: {
          display_name: "Демо",
          card_last4: "0001",
          balance: "5000000",
          recipients: [],
        },
      });
    if (path.endsWith("/operations"))
      return route.fulfill({ json: { items: [] } });
    if (path.endsWith("/analytics"))
      return route.fulfill({ json: { outgoing: "0" } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.addInitScript(() => localStorage.setItem("qadam.language", "ru"));
  await page.goto("https://wallet.test/");
  await expect(page.locator("#personal-login [type=submit]")).toBeEnabled();
  await page.locator("[name=login]").fill("sandbox_client");
  await page.locator('[data-action="language"]').first().click();
  await expect(page.locator("[name=login]")).toHaveValue("sandbox_client");
  await page.locator('[data-action="language"]').first().click();
  await expect(page.locator("[name=login]")).toHaveValue("sandbox_client");
  async function submit() {
    await page.locator("[name=login]").fill("sandbox_client");
    await page.locator("[name=password]").fill("synthetic fixture");
    await page.locator("#personal-login [type=submit]").click();
  }
  await submit();
  await expect(page.getByRole("alert")).toContainText("Сервис входа");
  await expect(page.locator("[data-nav]")).toHaveCount(0);
  status = 401;
  await submit();
  await expect(page.getByRole("alert")).toContainText(
    "Неверный логин или пароль",
  );
  status = 200;
  await submit();
  await expect(page.locator(".q-card")).toBeVisible();
  await expect(page.locator("[data-nav=cases]")).toHaveCount(0);
  expect(attempts).toBe(3);
});
