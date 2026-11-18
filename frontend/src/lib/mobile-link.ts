import { networkInterfaces } from "node:os";

type Environment = Record<string, string | undefined>;
const PRIVATE_IPV4 = /^(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}$/;

/** True for an RFC 1918 address, optionally with a port: the laptop on the demo Wi-Fi. */
export function isPrivateLanHost(host: string): boolean {
  const match = /^([\d.]+)(?::(\d{1,5}))?$/.exec(host);
  return !!match && PRIVATE_IPV4.test(match[1]) && match[1].split(".").every(part => Number(part) <= 255) && (!match[2] || Number(match[2]) <= 65535);
}

/** Opt-in for opening the local demo from a phone on the same Wi-Fi (`BCC_MOBILE_LAN=true`). */
export function lanDemoEnabled(env: Environment = process.env): boolean {
  return env.BCC_MOBILE_LAN === "true" && (env.BCC_ENVIRONMENT ?? "local") !== "pilot";
}

/** Private IPv4 addresses of this machine, Wi-Fi/Ethernet first. Empty unless the LAN demo is enabled. */
export function lanAddresses(env: Environment = process.env, interfaces = networkInterfaces()): string[] {
  if (!lanDemoEnabled(env)) return [];
  const found: { name: string; address: string }[] = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal && PRIVATE_IPV4.test(entry.address)) found.push({ name, address: entry.address });
    }
  }
  const rank = (name: string) => /^(?:en|eth|wl|wi-?fi|беспровод)/i.test(name) && !/(?:docker|vbox|vmnet|veth|br-|virtual|hyper-v|wsl)/i.test(name) ? 0 : 1;
  return found.sort((a, b) => rank(a.name) - rank(b.name)).map(entry => entry.address).filter((address, index, all) => all.indexOf(address) === index).slice(0, 4);
}
