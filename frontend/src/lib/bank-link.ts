/** Inspect the written address only. Never visit it or retain its path, query or credentials. */
export function inspectBankLink(input: string): BankLinkResult {
  const value = input.trim();
  if (!value || value.length > 2048 || /[\s\\\p{Cc}\p{Cf}]/u.test(value)) return { kind: "invalid" };

  const hasProtocol = /^https?:\/\//i.test(value);
  const authority = (hasProtocol ? value.slice(value.indexOf("//") + 2) : value).split(/[/?#]/, 1)[0];
  if (!authority || (!hasProtocol && (!authority.includes(".") || authority.includes("@")))) {
    return { kind: "invalid" };
  }
  try {
    const url = new URL(hasProtocol ? value : `https://${value}`);
    const host = url.hostname.replace(/\.$/, "");
    if (!host || host.startsWith(".") || host.includes("..")) return { kind: "invalid" };
    // URL normalizes escaped and Unicode characters. Do not endorse a disguised authority.
    if (url.protocol !== "https:" || url.port || /[@%]|[^\x21-\x7e]/.test(authority)) {
      return { kind: "unusual", host };
    }
    const matches = host === "bcc.kz" || host.endsWith(".bcc.kz");
    return { kind: matches ? "matches" : "external", host };
  } catch {
    return { kind: "invalid" };
  }
}

export type BankLinkResult = { kind: "invalid" } | { kind: "matches" | "external" | "unusual"; host: string };
