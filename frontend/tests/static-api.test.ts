import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../src/lib/contracts";
import { ids } from "../src/lib/demo-ids";
import { staticApi } from "../src/lib/static-api";

const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

test("the static Pages build answers the demo routes in the browser", async () => {
  const held = await staticApi("transfers/evaluate", post({ sender_id: ids.sender, recipient_phone: "+77010000003", amount: "900000", currency: "KZT", context: { active_call: true, from_deposit: true, is_new_device: false } })) as { status: string; transaction_id: string };
  assert.equal(held.status, "cooling_off");
  const detail = await staticApi(`transfers/${held.transaction_id}`) as { status: string };
  assert.equal(detail.status, "cooling_off");
  const byCard = await staticApi("transfers/evaluate", post({ sender_id: ids.sender, recipient_card: "4400000000000004", amount: "250000", currency: "KZT", context: { active_call: false, from_deposit: false, is_new_device: false } })) as { status: string };
  assert.equal(byCard.status, "blocked");
  const feed = await staticApi("soc/feed?limit=5") as { items: unknown[] };
  assert.ok(feed.items.length >= 2);
  const check = await staticApi("call-check", post({ customer_id: ids.sender })) as { verified: boolean };
  assert.equal(check.verified, false);
});

test("the static build refuses what needs a server", async () => {
  await assert.rejects(staticApi("trusted-circle/" + ids.sender), (error: unknown) => error instanceof ApiError && error.status === 404);
  await assert.rejects(staticApi("transfers/evaluate", post({ sender_id: "not-a-uuid" })), (error: unknown) => error instanceof ApiError && error.status === 422);
  await assert.rejects(staticApi("transfers/evaluate", post({ sender_id: ids.sender, recipient_card: "4400000000009999", amount: "1", currency: "KZT", context: {} })), (error: unknown) => error instanceof ApiError && error.code === "cardUnsupported");
  await assert.rejects(staticApi("admin/secrets"), (error: unknown) => error instanceof ApiError && error.status === 404);
});
