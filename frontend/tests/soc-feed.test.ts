import assert from "node:assert/strict";
import { test } from "node:test";
import { ids } from "../src/lib/config";
import { feedQuerySchema, transferSchema, validateApiResponse } from "../src/lib/contracts";
import { cancelDemo, detailDemo, evaluateDemo, feedDemo, graphDemo } from "../src/lib/demo";
import { initialCaseSelection, socFeedPath } from "../src/lib/soc-feed";

const input = (id: string, recipient: string, activeCall = false) => transferSchema.parse({ request_id: id, sender_id: ids.sender, recipient_id: recipient, amount: "900000", context: { active_call: activeCall, from_deposit: activeCall } });

test("SOC search and pages cover history beyond the last 50 without changing global totals", () => {
  const stamp = Date.parse("2026-11-17T10:00:00Z");
  const created = Array.from({ length: 62 }, (_, index) => evaluateDemo(input(`10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, index % 2 ? ids.hub : ids.friend), stamp + index));
  const all = feedDemo({ limit: 200 });
  assert.equal(all.pagination.total_filtered, 62);
  const pages = [0, 25, 50].flatMap(offset => feedDemo({ offset, limit: 25 }).items.map(row => row.transaction_id));
  assert.equal(new Set(pages).size, 62);
  assert.equal(pages.at(-1), created[0].transaction_id);
  const blocked = feedDemo({ status: "blocked", limit: 25 });
  assert.equal(blocked.pagination.total_filtered, 31);
  assert.equal(blocked.stats.total, 62);
  assert.equal(blocked.stats.blocked_hubs, 1);
  assert.equal(blocked.stats.p95_latency_ms, all.stats.p95_latency_ms);
  assert.equal(blocked.stats.latency_sample_size, all.stats.latency_sample_size);
  assert.ok(blocked.items.every(row => row.status === "blocked"));
  assert.equal(feedDemo({ q: " дАнИяР " }).pagination.total_filtered, 31);
  assert.equal(feedDemo({ q: created[0].transaction_id.toUpperCase().replace(/-/g, "") }).items[0].transaction_id, created[0].transaction_id);
  assert.equal(feedDemo({ q: "%" }).items.length, 0);
  assert.equal(feedDemo({ q: "%" }).stats.p95_latency_ms, all.stats.p95_latency_ms);
  assert.equal(feedDemo({ q: "_" }).items.length, 0);
  const highRisk = feedDemo({ min_score: 75, limit: 200 });
  assert.equal(highRisk.pagination.total_filtered, 31);
  assert.ok(highRisk.items.every(row => row.risk_score >= 75));
  assert.equal(highRisk.stats.total, 62);
  assert.equal(feedDemo({ offset: 1000 }).pagination.has_more, false);
});

test("SOC updated incident ordering and since filter retain authoritative lifecycle timestamps", () => {
  const time = Date.parse("2026-11-18T10:00:00Z");
  const held = evaluateDemo(input("20000000-0000-4000-8000-000000000001", ids.stranger, true), time);
  evaluateDemo(input("20000000-0000-4000-8000-000000000002", ids.friend), time + 1);
  cancelDemo(held.transaction_id, time + 1000);
  assert.equal(feedDemo().items[0].transaction_id, held.transaction_id);
  const filtered = feedDemo({ since: new Date(time + 2).toISOString() });
  assert.equal(filtered.items.length, 1);
  assert.equal(filtered.items[0].status, "cancelled");
  assert.equal(detailDemo(held.transaction_id).created_at, new Date(time).toISOString());
  assert.equal(detailDemo(held.transaction_id).updated_at, new Date(time + 1000).toISOString());
});

test("SOC filters validate bounds and malformed pagination cannot masquerade as complete results", () => {
  for (const query of [{ limit: 0 }, { limit: 201 }, { offset: -1 }, { offset: 100001 }, { q: "x".repeat(129) }, { q: "Alice\u0000Bob" }, { min_score: -1 }, { min_score: 101 }, { min_score: 10.5 }, { status: "all" }, { since: "yesterday" }]) assert.equal(feedQuerySchema.safeParse(query).success, false);
  const response = feedDemo();
  assert.doesNotThrow(() => validateApiResponse("soc/feed?offset=0", response));
  const { p95_latency_ms, latency_sample_size, latency_sample_limit, ...legacyStats } = response.stats;
  assert.doesNotThrow(() => validateApiResponse("soc/feed", { ...response, stats: legacyStats }));
  assert.throws(() => validateApiResponse("soc/feed", { ...response, stats: { ...response.stats, p95_latency_ms: -1 } }));
  assert.throws(() => validateApiResponse("soc/feed", { ...response, pagination: { ...response.pagination, total_filtered: -1 } }));
  assert.throws(() => validateApiResponse("soc/feed", { ...response, pagination: undefined }));
  assert.equal(socFeedPath("blocked", " Аружан & Марат ", 25), "soc/feed?limit=25&offset=25&status=blocked&q=%D0%90%D1%80%D1%83%D0%B6%D0%B0%D0%BD+%26+%D0%9C%D0%B0%D1%80%D0%B0%D1%82");
});

test("a pinned case survives filtering and fresh rows, and nullable browser overrides remain unknown", () => {
  assert.equal(initialCaseSelection("selected", ["newer", "other"]), "selected");
  assert.equal(initialCaseSelection("selected", []), "selected");
  assert.equal(initialCaseSelection(null, ["first", "next"]), "first");
  assert.equal(initialCaseSelection(null, []), null);
  const detail = detailDemo("20000000-0000-4000-8000-000000000001");
  const parsed = validateApiResponse(`transfers/${detail.transaction_id}`, { ...detail, context: { is_new_device: null, is_new_recipient: null } }) as typeof detail;
  assert.equal(parsed.context?.is_new_device, undefined);
  assert.equal(parsed.context?.is_new_recipient, undefined);
  assert.throws(() => validateApiResponse(`transfers/${detail.transaction_id}`, { ...detail, resolved_at: "not-a-date" }));
  assert.throws(() => validateApiResponse(`transfers/${ids.friend}`, detail));
  assert.throws(() => validateApiResponse(`soc/graph/${ids.friend}`, graphDemo(ids.hub)));
});
