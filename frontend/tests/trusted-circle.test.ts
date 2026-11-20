import assert from "node:assert/strict";
import test from "node:test";
import { ownerCapability, sanitizeContacts, sanitizeNotifications, signingKey, telegramInvitation, terminalNotification } from "../src/lib/trusted-circle";

test("only real test invitations open the configured Guardian bot", () => {
  const token = "abcdefghijklmnopqrstuvwxyz0123456789_-";
  assert.equal(telegramInvitation(token, "test"), `https://t.me/bekzat_bcc_shield_test_bot?start=${token}`);
  for (const mode of ["fake", "disabled", ""]) assert.equal(telegramInvitation(token, mode), null);
  assert.equal(telegramInvitation("bad&redirect=other", "test"), null);
});

const key = "demo-signing-key-0123456789-abcdefghij";
const owner = "00000000-0000-4000-8000-000000000001";

test("owner capability matches backend issue_token byte for byte", () => {
  // Vector computed with Python hmac exactly as app.integrations.security.issue_token does.
  assert.equal(ownerCapability(owner, key, 300, 1_800_000_000_000),
    "owner:00000000-0000-4000-8000-000000000001:1800000300:a22c0d5aaf1fab628da6b70631ef46e1d19fb0e16ba81ed488c0d7e27648c7fc");
  assert.throws(() => ownerCapability("not-a-uuid", key));
  assert.throws(() => ownerCapability(owner, "short"));
  assert.throws(() => ownerCapability(owner, key, 3601));
});

test("signing key is required and must be long enough", () => {
  assert.equal(signingKey({}), null);
  assert.equal(signingKey({ BCC_INTEGRATIONS_SIGNING_KEY: "short" }), null);
  assert.equal(signingKey({ BCC_INTEGRATIONS_SIGNING_KEY: key }), key);
});

test("only verified contacts with notifications enabled are offered, without extra fields", () => {
  const id = (n: number) => `10000000-0000-4000-8000-00000000000${n}`;
  const value = sanitizeContacts({ state: "CONTACT_VERIFIED", contacts: [
    { id: id(1), state: "CONTACT_VERIFIED", alias: "  Мама  ", notifications_enabled: true, language: "kk", created_at: "x", chat_id: 42 },
    { id: id(2), state: "CONTACT_PENDING_CONSENT", alias: "Brother", notifications_enabled: true },
    { id: id(3), state: "CONTACT_VERIFIED", alias: "Muted", notifications_enabled: false },
  ] });
  assert.deepEqual(value, { contact_state: "CONTACT_VERIFIED", contacts: [{ id: id(1), alias: "Мама" }] });
  assert.equal(sanitizeContacts({ state: "SOMETHING_NEW", contacts: [] }).contact_state, null);
});

test("notifications drop correlation and error details; terminal states stop polling", () => {
  const raw = { id: "20000000-0000-4000-8000-000000000001", contact_id: "10000000-0000-4000-8000-000000000001", transaction_id: "30000000-0000-4000-8000-000000000001", correlation_id: "40000000-0000-4000-8000-000000000001", state: "NOTIFICATION_SENT", expires_at: "2026-11-18T12:15:00Z", error_code: "telegram_rate_limited", attempts: 1, next_attempt_at: null, advisory_only: true };
  assert.deepEqual(sanitizeNotifications([raw]), [{ id: raw.id, contact_id: raw.contact_id, state: "NOTIFICATION_SENT", expires_at: raw.expires_at, attempts: 1 }]);
  assert.throws(() => sanitizeNotifications([{ ...raw, state: "RELEASED" }]));
  assert.equal(terminalNotification("NOTIFICATION_SENT"), false);
  assert.equal(terminalNotification("NOTIFICATION_QUEUED"), false);
  for (const state of ["CONTACT_ACKNOWLEDGED", "SUSPICION_REPORTED", "DELIVERY_FAILED", "CONTACT_REVOKED", "NOTIFICATION_EXPIRED"] as const) assert.equal(terminalNotification(state), true);
});
