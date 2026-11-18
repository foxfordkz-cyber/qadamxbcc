import assert from "node:assert/strict";
import test from "node:test";
import type { NetworkInterfaceInfo } from "node:os";
import { isPrivateLanHost, lanAddresses, lanDemoEnabled } from "../src/lib/mobile-link";

const v4 = (address: string, internal = false) => ({ address, family: "IPv4", internal, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: null }) as NetworkInterfaceInfo;

test("only RFC 1918 hosts count as the demo Wi-Fi", () => {
  for (const host of ["192.168.0.10", "10.1.2.3:3105", "172.16.5.4", "172.31.255.1:80"]) assert.equal(isPrivateLanHost(host), true, host);
  for (const host of ["8.8.8.8", "172.32.0.1", "127.0.0.1", "192.168.1.300", "192.168.1.5:99999", "localhost:3105", "evil.192.168.1.5"]) assert.equal(isPrivateLanHost(host), false, host);
});

test("LAN addresses are opt-in, never in the pilot, and prefer Wi-Fi over virtual adapters", () => {
  const interfaces = { lo: [v4("127.0.0.1", true)], "docker0": [v4("172.17.0.1")], "en0": [v4("192.168.1.23")], "utun": [v4("100.64.0.2")] };
  assert.deepEqual(lanAddresses({}, interfaces), []);
  assert.equal(lanDemoEnabled({ BCC_MOBILE_LAN: "true", BCC_ENVIRONMENT: "pilot" }), false);
  assert.deepEqual(lanAddresses({ BCC_MOBILE_LAN: "true" }, interfaces), ["192.168.1.23", "172.17.0.1"]);
});
