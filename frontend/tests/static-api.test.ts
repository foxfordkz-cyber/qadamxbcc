import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, type Evaluation } from "../src/lib/contracts";
import { ids } from "../src/lib/demo-ids";
import { resetStaticDemo, staticApi } from "../src/lib/static-api";
import { staticCircle, staticGuide } from "../src/lib/static-circle";
import { readFileSync } from "node:fs";

const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

test("only the notified contact in the static rehearsal can signal suspicion for its held payment", async t => {
  const storage = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "localStorage", previous); else Reflect.deleteProperty(globalThis, "localStorage"); });
  const held = await staticApi("transfers/evaluate", post({ sender_id: ids.sender, recipient_phone: "+77010000003",
    amount: "900000", currency: "KZT", context: { active_call: true, from_deposit: true, is_new_device: false } })) as Evaluation;
  const route = `trusted-circle/${held.transaction_id}`;
  const panel = await staticApi(route) as { contacts: { id: string }[] };
  const sent = await staticApi(route, post({ contact_id: panel.contacts[0].id })) as { notifications: { id: string }[] };
  const reply = `${route}/simulate-suspicion`;
  const clock = Date.now() + 3000;
  assert.throws(() => staticCircle("POST", reply, { notification_id: crypto.randomUUID() }, clock));
  staticCircle("POST", reply, { notification_id: sent.notifications[0].id }, clock);
  const answers = { caller_claims_bank_or_police: false, asked_to_move_to_safe_account: false,
    asked_to_keep_secret_or_install_app: false, initiated_by_customer: true, knows_recipient_personally: true };
  const resolve = `transfers/${held.transaction_id}/resolve-cooling`;
  const blocked = await staticApi(resolve, post({ answers })) as Evaluation;
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.reasons[0].code, "TRUSTED_CONTACT_SUSPICION");
  const replay = await staticApi(resolve, post({ answers })) as Evaluation;
  assert.deepEqual(replay.reasons, blocked.reasons);
});

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
  await assert.rejects(staticApi("integrations/guardian/soc/cases"), (error: unknown) => error instanceof ApiError && error.status === 503 && error.code === "integrationsUnavailable");
  await assert.rejects(staticApi("trusted-circle/" + ids.sender), (error: unknown) => error instanceof ApiError && error.status === 404);
  await assert.rejects(staticApi("trusted-circle/other"), (error: unknown) => error instanceof ApiError && error.status === 404);
  await assert.rejects(staticApi("transfers/evaluate", post({ sender_id: "not-a-uuid" })), (error: unknown) => error instanceof ApiError && error.status === 422);
  await assert.rejects(staticApi("transfers/evaluate", post({ sender_id: ids.sender, recipient_card: "4400000000009999", amount: "1", currency: "KZT", context: {} })), (error: unknown) => error instanceof ApiError && error.code === "cardUnsupported");
  await assert.rejects(staticApi("admin/secrets"), (error: unknown) => error instanceof ApiError && error.status === 404);
});

test("the static build simulates the trusted circle without Telegram", async () => {
  const held = await staticApi("transfers/evaluate", post({ sender_id: ids.sender, recipient_phone: "+77010000003", amount: "900000", currency: "KZT", context: { active_call: true, from_deposit: true, is_new_device: false } })) as { transaction_id: string };
  const circle = await staticApi(`trusted-circle/${held.transaction_id}`) as { contacts: { id: string }[]; notifications: unknown[] };
  assert.equal(circle.contacts.length, 1);
  const sent = await staticApi(`trusted-circle/${held.transaction_id}`, post({ contact_id: circle.contacts[0].id })) as { notifications: { state: string }[] };
  assert.equal(sent.notifications.length, 1);
  // Advance only the local rehearsal clock to observe simulated consent.
  const later = staticCircle("GET", "trusted-circle/members", undefined, Date.now() + 60_000) as { contacts: { state: string }[] };
  assert.ok(later.contacts.every(contact => contact.state === "CONTACT_VERIFIED"));
  const approved = await staticApi("transfers/evaluate", post({ sender_id: ids.sender, recipient_phone: "+77010000002", amount: "5000", currency: "KZT", context: { active_call: false, from_deposit: false, is_new_device: false } })) as { transaction_id: string; status: string };
  assert.equal(approved.status, "approved");
  await assert.rejects(staticApi(`trusted-circle/${approved.transaction_id}`, post({ contact_id: circle.contacts[0].id })), (error: unknown) => error instanceof ApiError && error.code === "active_cooling_required");
});

test("the static message-check guide matches the backend text", () => {
  const source = readFileSync(new URL("../../backend/app/integrations/guardian_education.py", import.meta.url), "utf8").replace(/"\s*\n\s*"/g, "");
  assert.equal(staticGuide.questions.length, 5);
  for (const question of staticGuide.questions) for (const text of [question.field, question.ru, question.kk]) assert.ok(source.includes(text), text);
});

test("explicit static demo reset clears restored SOC navigation but preserves language and unrelated storage", t => {
  const createStore = () => {
    const store: Record<string, unknown> = { "saq-bol.active-tab.v1": "soc", "saq-bol.soc-workspace.v1": "{}", "saq-bol-soc-cases-v1": "{}", "bcc-shield.locale": "kk", unrelated: "keep" };
    Object.defineProperty(store, "removeItem", { value: (key: string) => { delete store[key]; } });
    return store;
  };
  const local = createStore(), session = createStore();
  for (const [key, value] of [["localStorage", local], ["sessionStorage", session]] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else Reflect.deleteProperty(globalThis, key); });
  }
  resetStaticDemo();
  for (const store of [local, session]) assert.deepEqual(Object.keys(store).sort(), ["bcc-shield.locale", "unrelated"]);
});
