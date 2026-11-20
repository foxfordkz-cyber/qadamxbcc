import { test, expect } from "@playwright/test";

test("wallet card and chart remain usable at phone widths", async ({
  page,
}) => {
  await page.goto("/");
  for (const width of [320, 393]) {
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
