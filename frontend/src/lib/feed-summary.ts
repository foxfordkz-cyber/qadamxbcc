import type { FeedItem } from "./contracts";

// The feed's global blocked total includes questionnaire/scam blocks as well.
// Only distinct recipients with explicit hub evidence count as visible drop hubs.
export function countBlockedHubs(items: FeedItem[]): number {
  return new Set(items.filter(item => item.status === "blocked" && item.reasons.some(reason =>
    reason.code === "DROP_HUB_FAN_IN" || reason.code === "RECIPIENT_MANY_SENDERS",
  )).map(item => item.recipient.id)).size;
}
