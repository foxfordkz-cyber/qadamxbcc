import test from "node:test";
import assert from "node:assert/strict";
import { walletUI } from "../www/wallet.mjs";

const ui = walletUI({
  T: (ru) => ru,
  E: (s) => String(s ?? "").replaceAll("<", "&lt;"),
  amount: (s) => s + " ₸",
  when: (s) => s,
  button: (k) => "<button data-action=" + k + "></button>",
  status: (s) => s,
});
test("mask hides only the displayed balance and opening Guardian preserves consent", () => {
  const account = {
    display_name: "Алия Демо",
    balance: "1234.50",
    card_last4: "6701",
    recipients: [],
    guardian_username: "example_bot",
    contact_limit: 3,
    telegram_mode: "fake",
  };
  assert.match(ui.home(account, { items: [] }, null, false, ""), /1234.50 ₸/);
  const masked = ui.home(account, { items: [] }, null, true, "");
  assert.doesNotMatch(masked, /1234.50/);
  assert.match(masked, /6701/);
  const circle = ui.telegram(account, {
    contacts: [
      { state: "CONTACT_VERIFIED" },
      { state: "CONTACT_PENDING_CONSENT" },
    ],
  });
  assert.match(circle, /1 \/ 3/);
  assert.match(circle, /тестовый адаптер/);
});
test("a selected chart day drills into the same day of the ledger", () => {
  const series = ["2026-11-18", "2026-11-19"].map((day, i) => ({
    day,
    incoming: 0,
    outgoing: i * 50,
    count: i,
  }));
  const html = ui.analytics(
    {
      days: 7,
      from: series[0].day,
      series,
      outgoing: 50,
      incoming: 0,
      count: 1,
      blocked: 0,
      paused: 0,
    },
    0,
  );
  assert.match(html, /data-drill-day="2026-11-18"/);
  assert.match(html, /data-chart-day="2026-11-18" aria-pressed="true"/);
  assert.match(html, /data-days="30"/);
});
