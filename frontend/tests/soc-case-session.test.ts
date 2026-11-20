import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaseOut } from "../src/lib/soc-integrations";
import { actionAllowed, emptyCaseSession, filterCases, intentMarker, mergeCases, readCaseSession, rebaseCaseAction, serializeCaseSession, type CaseIntent } from "../src/lib/soc-case-session";
import { caseText, socCaseCopy } from "../src/lib/soc-case-copy";

const id = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const key = "00000000-0000-4000-8000-000000000003";
function record(overrides: Partial<CaseOut> = {}): CaseOut {
  return { id, report_id: otherId, source: "owner_demo", category: "safe_account", state: "IN_REVIEW", assignee: null,
    version: 2, created_at: "2026-11-19T19:00:00Z", status_since: "2026-11-20T00:00:00Z", expires_at: "2099-01-01T00:00:00Z", demonstration_only: true, ...overrides };
}
function noteIntent(): CaseIntent { return { caseId: id, key, body: { action: "note", expected_version: 2, body: "Синтетическое замечание оператора" }, createdAt: 100 }; }

test("SOC session restores IDs and filters while stripping sensitive text and capability fields", () => {
  const value = { ...emptyCaseSession, selectedId: id, status: "IN_REVIEW" as const, assignee: "demo_analyst_a" as const, since: "2026-11-20", pending: { ...intentMarker(noteIntent()), body: "PRIVATE_NOTE" }, note: "PRIVATE_NOTE", token: "PRIVATE_TOKEN" };
  const raw = serializeCaseSession(value);
  assert.ok(!raw.includes("PRIVATE_"));
  const restored = readCaseSession(raw);
  assert.equal(restored.selectedId, id); assert.equal(restored.status, "IN_REVIEW"); assert.equal(restored.assignee, "demo_analyst_a");
  assert.deepEqual(restored.pending, { caseId: id, key, action: "note" });
  assert.equal("body" in restored.pending!, false);
});

test("broken or stale session formats reset safely without inventing a selected case", () => {
  for (const value of [null, "{", "null", '{"selectedId":"malformed"}', '{"status":"FROZEN"}', '{"pending":{"body":"secret"}}']) {
    assert.deepEqual(readCaseSession(value), emptyCaseSession);
  }
});

test("local filters use loaded rows and Kazakhstan day boundaries without mutating the source", () => {
  const rows = [record(), record({ id: otherId, state: "NEW", assignee: "demo_analyst_a", created_at: "2026-11-19T18:59:59Z" })];
  assert.deepEqual(filterCases(rows, { status: "all", assignee: "all", since: "2026-11-20" }).map(item => item.id), [id]);
  assert.deepEqual(filterCases(rows, { status: "NEW", assignee: "demo_analyst_a", since: "" }).map(item => item.id), [otherId]);
  assert.deepEqual(filterCases(rows, { status: "all", assignee: "unassigned", since: "" }).map(item => item.id), [id]);
  assert.equal(rows.length, 2);
});

test("old replay receipts never downgrade an already displayed case version", () => {
  const current = record({ version: 7, state: "ESCALATED" });
  const values = mergeCases([current], [record({ version: 3 }), record({ id: otherId })]);
  assert.equal(values[0], current); assert.equal(values.length, 2);
  assert.equal(mergeCases(values, [record({ version: 8, state: "RESOLVED" })])[0].state, "RESOLVED");
});

test("a conflict rebases only a copy for explicit confirmation and preserves exact retry evidence", () => {
  const intent = noteIntent(); const originalBody = JSON.stringify(intent.body);
  const rebased = rebaseCaseAction(intent, record({ version: 8 }));
  assert.equal(rebased?.expected_version, 8);
  assert.equal(JSON.stringify(intent.body), originalBody); assert.equal(intent.key, key);
  assert.equal(rebaseCaseAction(intent, record({ id: otherId, version: 8 })), null);
  assert.equal(rebaseCaseAction(intent, record({ version: 8, state: "CLOSED" })), null);
});

test("transition eligibility prevents phantom closures, invalid reopenings and expired actions", () => {
  assert.equal(actionAllowed(record({ state: "NEW" }), { action: "transition", expected_version: 2, state: "RESOLVED", reason: "review_complete" }), false);
  assert.equal(actionAllowed(record({ state: "CLOSED" }), { action: "transition", expected_version: 2, state: "IN_REVIEW", reason: "review_started" }), false);
  assert.equal(actionAllowed(record({ state: "CLOSED" }), { action: "transition", expected_version: 2, state: "IN_REVIEW", reason: "reopened" }), true);
  assert.equal(rebaseCaseAction(noteIntent(), record({ expires_at: "2000-01-01T00:00:00Z" })), null);
  assert.equal(rebaseCaseAction(noteIntent(), record({ version: 500 })), null);
});

test("information requests are available only on the supported client channel and states", () => {
  const action = { action: "request_information", expected_version: 2, question: "caller_request" } as const;
  assert.equal(actionAllowed(record(), action), true);
  assert.equal(actionAllowed(record({ source: "trusted_contact" }), action), false);
  assert.equal(actionAllowed(record({ state: "NEW" }), action), false);
  assert.equal(actionAllowed(record({ state: "NEEDS_INFORMATION" }), action), false);
});

test("every SOC message is bilingual and completion is never phrased as returned funds", () => {
  for (const pair of Object.values(socCaseCopy)) { assert.equal(pair.length, 2); assert.ok(pair[0].length > 0); assert.ok(pair[1].length > 0); }
  assert.equal(caseText("ru", "RESOLVED"), "Рассмотрение завершено");
  assert.equal(caseText("kk", "RESOLVED"), "Қарау аяқталды");
  assert.match(caseText("ru", "advisory"), /не означает возврат/);
});
