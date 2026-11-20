/** Marketplace orders and the receiving-account directory are independent synthetic fixtures. */
export const marketOrders = [
  { reference: "SB-1042", seller: "Данияр А.", destination: "+77010000002" },
  { reference: "SB-2031", seller: "Daniyar A.", destination: "+77010000002" },
] as const;

const beneficiaries: Readonly<Record<string, { name: string; aliases: readonly string[] }>> = {
  "+77010000002": { name: "Данияр А.", aliases: ["Daniyar A."] },
};

export type OrderMatch = "match" | "close" | "mismatch" | "unavailable";

export function matchMarketOrder(reference: string, phone: string): OrderMatch {
  const order = marketOrders.find(item => item.reference === reference.trim().toUpperCase());
  const normalized = phone.replace(/[\s()-]/g, "");
  if (!order || !/^\+7\d{10}$/.test(normalized)) return "unavailable";
  if (order.destination !== normalized) return "mismatch";
  const account = beneficiaries[normalized];
  if (!account) return "unavailable";
  if (order.seller === account.name) return "match";
  // Only an alias supplied by the directory can yield a close match.
  return account.aliases.includes(order.seller) ? "close" : "mismatch";
}

export function demoOrderPayee(phone: string) {
  return beneficiaries[phone]?.name;
}
