import assert from "node:assert/strict";
import test from "node:test";
import type { Evaluation, Feed } from "../src/lib/contracts";
import { ApiError, validateApiResponse } from "../src/lib/contracts";
import { ids } from "../src/lib/demo-ids";
import { staticApi } from "../src/lib/static-api";

const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });
const answers = { caller_claims_bank_or_police: false, asked_to_move_to_safe_account: false, asked_to_keep_secret_or_install_app: false, initiated_by_customer: true, knows_recipient_personally: true };
const conflict = (e: unknown) => e instanceof ApiError && e.status === 409;
async function held() {
  const value = await staticApi("transfers/evaluate", post({ sender_id: ids.sender, recipient_id: ids.stranger, amount: "900000", currency: "KZT", context: { active_call: true, from_deposit: true } })) as Evaluation;
  assert.equal(value.status, "cooling_off");
  return `transfers/${value.transaction_id}`;
}

test("post-call recognition keeps the original hold and opens verification", async () => {
  const path = await held();
  await assert.rejects(staticApi(path + "/post-call", post({ action: "recognized" })), conflict);
  const start = await staticApi(path + "/post-call", post({ action: "ended" })) as Evaluation;
  await assert.rejects(staticApi(path + "/resolve-cooling", post({ answers })), conflict);
  for (let i = 0; i < 2; i++) {
    const current = await staticApi(path + "/post-call", post({ action: "recognized" })) as Evaluation;
    assert.equal(current.reasons.filter(r => r.code === "POST_CALL_RECOGNIZED").length, 1);
    assert.equal(current.cooling_off_until, start.cooling_off_until);
    assert.equal(current.context?.active_call, true);
  }
  const saved = await staticApi(path + "/resolve-cooling", post({ answers })) as Evaluation;
  assert.equal(saved.status, "cooling_off");
});

test("post-call scam report is terminal, repeatable and present in SOC alerts", async () => {
  const path = await held();
  const cancel = post({ reason: "post_call_scam" });
  await assert.rejects(staticApi(path + "/cancel", cancel), conflict);
  await staticApi(path + "/post-call", post({ action: "ended" }));
  for (let i = 0; i < 2; i++) {
    const result = await staticApi(path + "/cancel", cancel) as Evaluation;
    assert.equal(result.status, "cancelled");
    assert.equal(result.reasons.filter(r => r.code === "POST_CALL_SCAM_REPORTED").length, 1);
    assert.throws(() => validateApiResponse(`transfers/${crypto.randomUUID()}/cancel`, result, "POST"), /invalidResponse/);
  }
  const feed = await staticApi("soc/feed?alerts_only=true") as Feed;
  assert.ok(feed.items.some(row => path.endsWith(row.transaction_id)));
});
