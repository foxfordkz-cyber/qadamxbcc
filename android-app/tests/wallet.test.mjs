import { ledgerInstant, ledgerTime } from "../www/wallet-date.mjs";
import { bucketDays, scaleMax } from "../www/spending-chart.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { formatTenge, walletUI } from "../www/wallet.mjs";

test("KZT amounts use the same thousands and tiyn separators on both wallet locales", () => {
  assert.equal(formatTenge("900000.00"), "900\u00a0000 ₸");
  assert.equal(formatTenge(-5000012.5), "-5\u00a0000\u00a0012,5 ₸");
  assert.equal(formatTenge("0.01"), "0,01 ₸");
  assert.equal(formatTenge(0), "0 ₸");
  assert.equal(formatTenge(null), "— ₸");
});

const ui = walletUI({
  T: (ru) => ru,
  E: (s) => String(s ?? "").replaceAll("<", "&lt;"),
  amount: (s) => s + " ₸",
  when: (s) => s,
  button: (k) => "<button data-action=" + k + "></button>",
  status: (s) => s,
});
test("privacy mask hides balance and account suffix and opening Guardian preserves consent", () => {
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
  assert.doesNotMatch(masked, /6701/);
  const circle = ui.telegram(account, {
    contacts: [
      { state: "CONTACT_VERIFIED" },
      { state: "CONTACT_PENDING_CONSENT" },
    ],
  });
  assert.match(circle, /1 \/ 3/);
  assert.match(circle, /тестовый адаптер/);
});
test("Guardian links to the team bot without a server override or consent transition", () => {
  for (const name of [null, "", "bad/../../path", "untrusted.example"]) {
    const panel = ui.telegram({ guardian_username: name, contact_limit: 3 }, { contacts: [] });
    assert.match(panel, /href="https:\/\/t\.me\/bekzat_bcc_shield_test_bot"/);
    assert.match(panel, /noopener noreferrer/);
    assert.match(panel, /0 \/ 3/);
  }
  assert.match(ui.telegram({ guardian_username: "example_bot" }, null), /href="https:\/\/t\.me\/example_bot"/);
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
  assert.match(html, /data-chart-step="-1" disabled/);
});

test("the chart distinguishes an empty ledger from zero settled money", () => {
  const d = {
    days: 7,
    series: [],
    count: 0,
    incoming: 0,
    outgoing: 0,
    blocked: 0,
    paused: 0,
  };
  assert.match(ui.analytics(d, null), /операций нет/);
  const one = { day: "2026-11-12", incoming: "0.00", outgoing: "0.00" };
  assert.match(
    ui.analytics({ ...d, count: 1, series: [one] }, 0),
    /Проведённых поступлений/,
  );
  const single = ui.analytics(
    { ...d, count: 1, series: [{ ...one, outgoing: "12345.67" }] },
    0,
  );
  assert.doesNotMatch(single, /NaN|Infinity/);
  assert.match(single, /data-chart-day="2026-11-12"/);
});
test("period bins preserve chronological ranges and exact posted amounts", () => {
  const days = Array.from({ length: 30 }, (_, i) => ({
    day: "2026-11-" + String(i + 1).padStart(2, "0"),
    incoming: "0.01",
    outgoing: "9999999.99",
  }));
  const groups = bucketDays(days.reverse(), 30);
  assert.equal(groups.length, 6);
  assert.deepEqual(groups[0], {
    from: "2026-11-01",
    to: "2026-11-05",
    incoming: "0.05",
    outgoing: "49999999.95",
  });
  assert.equal(groups.at(-1).to, "2026-11-30");
  assert.equal(scaleMax(groups), 50000000);
  assert.equal(scaleMax([]), 0);
  assert.throws(() =>
    bucketDays([{ day: "2026-11-01", incoming: "nan", outgoing: "0" }], 7),
  );
});

test("ledger dates agree across the Kazakhstan midnight boundary", () => {
  assert.equal(ledgerTime("2026-11-20T19:08:00Z"), "21.11 · 00:08");
  assert.equal(ledgerInstant("2026-11-20T18:59:00Z").day, "2026-11-20");
  assert.equal(ledgerTime("invalid"), "—");
});

test("officer analytics distinguishes an unlabelled cohort from zero false holds", () => {
  const review = {
    sampled: 5, evaluated: 4, label_coverage: 0.5, legitimate_labelled: 2, fraud_labelled: 0,
    policies: [
      {threshold: null, extra_holds: 0, missed_fraud: null, false_interventions: 0, false_per_1000_legitimate: 0},
      {threshold: 30, extra_holds: 2, missed_fraud: null, false_interventions: 1, false_per_1000_legitimate: 500},
    ],
  };
  const data = {days: 7, states: {}, case_states: {}, policy_comparison: review};
  const html = ui.soc(data, true);
  assert.match(html, /4 \/ 5/);
  assert.match(html, /50%/);
  assert.match(html, /<td>—<\/td><td>0 \(0\/2\)/);
  assert.match(html, /500 \(1\/2\)/);
  assert.doesNotMatch(ui.soc(data, false), /data-policy-comparison/);
});
