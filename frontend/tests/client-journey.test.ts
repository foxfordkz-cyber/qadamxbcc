import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET, POST, DELETE } from "../src/app/api/v1/trusted-circle/members/route";
import { mobileRecovery } from "../src/lib/mobile-recovery";
import { messageSignals } from "../src/lib/message-check";

const id = "10000000-0000-4000-8000-000000000001";
test("a fresh client restores the selected receipt and only its boolean draft", () => {
  const values = new Map<string, string>();
  const storage = () => ({ getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } });
  let now = 1000;
  const open = (scope = "live.owner") => mobileRecovery(scope, storage, () => now);
  open().select(id);
  assert.ok(open().save(id, { caller_claims_bank_or_police: false }));
  assert.equal(open().selection(), id);
  assert.deepEqual(open().read(id), { caller_claims_bank_or_police: false });
  assert.equal(open("demo.owner").read(id), null);
  now += 86_400_001;
  assert.equal(open().read(id), null);
  open().select(null);
  assert.equal(open().selection(), null);
  assert.equal(open().save("invalid", {}), false);
});

test("message input yields bilingual educational categories, never original text", () => {
  assert.deepEqual(messageSignals("Переведите деньги на безопасный счёт. Назовите код 123456."), ["safeAccount", "codeRequest"]);
  assert.deepEqual(messageSignals("Қауіпсіз шотқа ақша аударыңыз"), ["safeAccount"]);
  assert.deepEqual(messageSignals("Никогда не сообщите код. Встреча в 15:00"), []);
  assert.deepEqual(messageSignals("Ертең кездесеміз"), []);
});

test("member routes use the configured demo owner and return whitelisted fields", async t => {
  const env = { BCC_API_MODE: "live", BCC_NORMAL_SENDER_ID: id, BCC_INTEGRATIONS_SIGNING_KEY: "test-only-owner-capability-signing-key" };
  const previous = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [k,v] of Object.entries(previous)) if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  const member = { id, alias: "QA", state: "CONTACT_PENDING_CONSENT", notifications_enabled: true, telegram_chat_id: "private" };
  const sent: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.match(new Headers(init.headers).get("Authorization") ?? "", new RegExp("^Bearer owner:" + id + ":"));
    sent.push(new URL(url).pathname);
    return Response.json(init.method === "POST" ? { contact: member, invitation_token: "x".repeat(43), expires_at: "2026-11-21T12:00:00Z" }
      : init.method === "DELETE" ? { ...member, state: "CONTACT_REVOKED" } : { contacts: [member] });
  });
  const req = (method: string, body?: unknown) => new NextRequest("http://localhost/api/v1/trusted-circle/members",
    { method, headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const listed = await GET(req("GET"));
  assert.equal(listed.status, 200);
  const publicVisitor = new NextRequest("https://public.example/api/v1/trusted-circle/members");
  assert.equal((await GET(publicVisitor)).status, 404);
  assert.doesNotMatch(await listed.text(), /private|telegram_chat_id|Bearer/);
  assert.equal((await POST(req("POST", { owner_consent: false, language: "kk" }))).status, 422);
  assert.equal((await POST(req("POST", { owner_consent: true, owner: id, language: "ru" }))).status, 422);
  const created = await POST(req("POST", { owner_consent: true, language: "kk" }));
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("Cache-Control"), "no-store");
  assert.equal((await (await DELETE(req("DELETE", { contact_id: id }))).json()).state, "CONTACT_REVOKED");
  assert.deepEqual(sent, ["/api/v1/trusted-contacts", "/api/v1/trusted-contacts", "/api/v1/trusted-contacts/" + id]);
});
