import { createHmac } from "node:crypto";
import { z } from "zod";

// Server-only helpers for the trusted-circle BFF route. The signing key and the
// capabilities minted here never reach the browser bundle, storage or logs.

export const notificationStates = ["NOTIFICATION_QUEUED", "NOTIFICATION_SENT", "CONTACT_ACKNOWLEDGED", "SUSPICION_REPORTED", "DELIVERY_FAILED", "CONTACT_REVOKED", "NOTIFICATION_EXPIRED"] as const;
export const contactStates = ["CONTACT_NOT_CONFIGURED", "CONTACT_PENDING_CONSENT", "CONTACT_VERIFIED", "CONTACT_REVOKED"] as const;
export type NotificationState = typeof notificationStates[number];
export type ContactState = typeof contactStates[number];

export interface TrustedContact { id: string; alias: string }
export interface TrustedNotification { id: string; contact_id: string; state: NotificationState; expires_at: string; attempts: number }
export interface TrustedCircle { contact_state: ContactState | null; contacts: TrustedContact[]; notifications: TrustedNotification[] }

type Environment = Record<string, string | undefined>;

/** The integration signing key, if this frontend server may act for the demo owner. */
export function signingKey(env: Environment = process.env): string | null {
  const key = env.BCC_INTEGRATIONS_SIGNING_KEY;
  return key && key.length >= 32 ? key : null;
}

/** Same format as backend app.integrations.security.issue_token: role:subject:expires:hmac_sha256. */
export function ownerCapability(owner: string, key: string, ttlSeconds = 300, now = Date.now()): string {
  if (!z.uuid().safeParse(owner).success) throw new Error("invalid owner");
  if (key.length < 32 || ttlSeconds < 1 || ttlSeconds > 3600) throw new Error("invalid capability configuration");
  const payload = `owner:${owner.toLowerCase()}:${Math.floor(now / 1000) + ttlSeconds}`;
  return `${payload}:${createHmac("sha256", key).update(payload).digest("hex")}`;
}

const contactSchema = z.object({ id: z.uuid(), state: z.string(), alias: z.string().optional().default(""), notifications_enabled: z.boolean().optional().default(true) });
const contactsSchema = z.object({ state: z.string(), contacts: z.array(contactSchema) });
const notificationSchema = z.object({ id: z.uuid(), contact_id: z.uuid(), state: z.enum(notificationStates), expires_at: z.string(), attempts: z.number().int().nonnegative().optional().default(0) });

/** Only verified contacts that accept notifications can be offered; aliases are trimmed and bounded. */
export function sanitizeContacts(value: unknown): Pick<TrustedCircle, "contact_state" | "contacts"> {
  const parsed = contactsSchema.parse(value);
  const state = (contactStates as readonly string[]).includes(parsed.state) ? parsed.state as ContactState : null;
  return { contact_state: state, contacts: parsed.contacts.filter(contact => contact.state === "CONTACT_VERIFIED" && contact.notifications_enabled).slice(0, 5).map(contact => ({ id: contact.id, alias: contact.alias.trim().slice(0, 40) })) };
}

/** Drops correlation IDs, error codes and anything else the phone does not need. */
export function sanitizeNotifications(value: unknown): TrustedNotification[] {
  return z.array(notificationSchema).parse(value).slice(-10).map(({ id, contact_id, state, expires_at, attempts }) => ({ id, contact_id, state, expires_at, attempts }));
}

export const terminalNotification = (state: NotificationState) => state !== "NOTIFICATION_QUEUED" && state !== "NOTIFICATION_SENT";

/** Safe 409 detail codes the phone can explain; anything else becomes a generic conflict. */
export const knownConflicts = ["contact_consent_required", "contact_notifications_disabled", "active_cooling_required"] as const;
