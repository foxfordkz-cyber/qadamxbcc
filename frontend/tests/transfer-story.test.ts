import assert from "node:assert/strict";
import test from "node:test";
import type { Evaluation } from "../src/lib/contracts";
import { proxySocIntegration, resolveSocProxyRoute } from "../src/lib/soc-integration-proxy";
import { validateSocIntegrationResponse } from "../src/lib/soc-integrations";
import { privateStorySchema, rehearsalStory, selectedStory } from "../src/lib/transfer-story";
import { storyLabel } from "../src/lib/transfer-story-copy";

const id = rehearsalStory.transaction_id;
const t0 = "2026-11-20T07:00:00Z";
const t1 = "2026-11-20T07:01:00Z";
const t2 = "2026-11-20T07:02:00Z";
const reason = (code: string, at?: string) => ({ code, layer: "questionnaire", score_delta: 0,
  reason_kk: "Тіркелді", reason_ru: "Сохранено", evidence: at ? { recorded_at: at } : {} });
const detail: Evaluation = { transaction_id: id, status: "cancelled", risk_score: 72, reasons_kk: [], reasons_ru: [],
  headline_kk: "", headline_ru: "", latency_ms: 1, layer_latency_ms: {}, is_new_recipient: true, is_new_device: false,
  recipient: { id, display_name: "Demo", iban_masked: "KZ••" },
  reasons: [reason("POST_CALL_ENDED", t1), reason("RETURN_REVIEW_CLEARED", t2), reason("UNKNOWN_FUTURE_EVENT")],
  created_at: t0, resolved_at: t2, updated_at: t2, cooling_off_until: null };
const internal = privateStorySchema.parse({ transaction_id: id, truncated: false,
  events: [{ role: "guardian", code: "NOTIFICATION_QUEUED", timestamp: t1 }] });

test("selected story separates customer-reported calls, authorization and provider state", () => {
  const open = selectedStory(detail, null);
  assert.deepEqual(open.map(item => item.code), ["EVALUATED", "HELD", "POST_CALL_ENDED", "CANCELLED"]);
  assert.equal(open[2].timestamp, t1);
  assert.deepEqual(selectedStory(detail, { ...internal, transaction_id: "other" }), open);
  const linked = selectedStory(detail, internal);
  assert.ok(linked.find(item => item.code === "RETURN_REVIEW_CLEARED" && item.role === "soc"));
  assert.deepEqual(linked.filter(item => item.role === "guardian"), internal.events);
  const old = selectedStory({ ...detail, reasons: [reason("POST_CALL_ENDED")] }, null);
  assert.equal(old.at(-1)?.timestamp, null);
  assert.equal(old.at(-1)?.code, "POST_CALL_ENDED");
});

test("private projection rejects crossed identities, leaking fields, unknown codes and unbounded collections", () => {
  const path = ["soc", "transactions", id, "story"];
  assert.equal("status" in resolveSocProxyRoute(path, "GET", new URLSearchParams()), false);
  assert.equal("status" in resolveSocProxyRoute(path, "POST", new URLSearchParams()), true);
  assert.equal("status" in resolveSocProxyRoute(path, "GET", new URLSearchParams("include=contacts")), true);
  const route = `integrations/${path.join("/")}`;
  assert.deepEqual(validateSocIntegrationResponse(route, internal), internal);
  assert.throws(() => validateSocIntegrationResponse(route, { ...internal, transaction_id: "eea75868-9b22-456d-9948-0558afc9cd25" }));
  const [item] = internal.events;
  for (const event of [{ ...item, chat_id: "private" }, { ...item, code: "DELIVERED" }, { ...item, role: "soc" }]) {
    assert.equal(privateStorySchema.safeParse({ ...internal, events: [event] }).success, false);
  }
  assert.equal(privateStorySchema.safeParse({ ...internal, events: Array(41).fill(item) }).success, false);
});

test("offline rehearsal separates the owner's report from the guardian response and SOC case opening", () => {
  assert.deepEqual(rehearsalStory.steps.map(step => step.code), ["EVALUATED", "HELD", "NOTIFICATION_QUEUED",
    "NOTIFICATION_SENT", "SUSPICION_REPORTED", "OWNER_REPORT_SUBMITTED", "CASE_OPENED"]);
  for (const step of rehearsalStory.steps) {
    assert.deepEqual(Object.keys(step).sort(), ["code", "role", "timestamp"]);
    assert.notEqual(storyLabel(step.code, "kk"), storyLabel(step.code, "ru"));
  }
});

test("in a public deployment the story route denies access before contacting the private API", async () => {
  const host = "https://demo.example.org";
  const path = ["soc", "transactions", id, "story"];
  const response = await proxySocIntegration(new Request(`${host}/api/v1/integrations/${path.join("/")}`), path, {
    env: { BCC_ENVIRONMENT: "demo", BCC_API_MODE: "live", BCC_API_URL: "https://api.example.org",
      BCC_DEMO_PUBLIC_ORIGIN: host, BCC_DEMO_UPSTREAM_API_KEY: "synthetic-demo-transfer-service-fixture",
      BCC_DEMO_UPSTREAM_SOC_KEY: "synthetic-demo-soc-operator-service-fixture" },
    fetch: () => { throw new Error("The public story must never request private data"); },
  });
  assert.equal(response.status, 403);
});

test("scam report precedes its cancellation at the same instant, sub-millisecond events keep their sequence", () => {
  const micro = (digits: string) => `2026-11-20T07:01:00.${digits}Z`;
  const steps = selectedStory({ ...detail, reasons: [
    reason("RETURN_APPEAL_REQUESTED", micro("000222")), reason("POST_CALL_ENDED", micro("000111")),
    reason("POST_CALL_SCAM_REPORTED", t2),
  ] }, null);
  assert.deepEqual(steps.slice(-4).map(e => e.code), ["POST_CALL_ENDED", "RETURN_APPEAL_REQUESTED", "POST_CALL_SCAM_REPORTED", "CANCELLED"]);
});
