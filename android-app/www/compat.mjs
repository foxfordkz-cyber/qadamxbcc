// Wallet drafts contain only the JSON data that is also stored across restarts.
export function copyDraftData(value) {
  return JSON.parse(JSON.stringify(value));
}

export const hasOwn = (record, key) => Object.prototype.hasOwnProperty.call(record, key);
export const last = (items) => items[items.length - 1];

export function requestId(source = globalThis.crypto) {
  if (source.randomUUID) return source.randomUUID();
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}
