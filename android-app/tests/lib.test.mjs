import assert from "node:assert/strict";
import test from "node:test";
import { allowedHost, parseServer, rememberServer } from "../www/lib.mjs";

test("QR from the SOC header and typed addresses become the /mobile URL", () => {
  assert.deepEqual(parseServer("http://192.168.1.23:3105/mobile"), { origin: "http://192.168.1.23:3105", url: "http://192.168.1.23:3105/mobile", label: "192.168.1.23:3105" });
  assert.equal(parseServer(" 192.168.1.23:3105 ").url, "http://192.168.1.23:3105/mobile");
  assert.equal(parseServer("10.0.0.7").url, "http://10.0.0.7:3000/mobile");
  assert.equal(parseServer("http://172.20.1.2").url, "http://172.20.1.2/mobile");
  assert.equal(parseServer("10.0.2.2:3105").url, "http://10.0.2.2:3105/mobile");
});

test("only the laptop on the local network is opened inside the app", () => {
  assert.equal(parseServer("").error, "empty");
  assert.equal(parseServer("https://evil.example/mobile").error, "notLocal");
  assert.equal(parseServer("8.8.8.8:3000").error, "notLocal");
  assert.equal(parseServer("172.32.0.1").error, "notLocal");
  assert.equal(parseServer("javascript:alert(1)").error, "invalid");
  assert.equal(parseServer("http://user:pass@192.168.1.2/").error, "invalid");
  assert.equal(parseServer("192.168.1.300").error !== undefined, true);
  assert.equal(allowedHost("192.168.0.1"), true);
  assert.equal(allowedHost("192.168.0.1.evil.com"), false);
});

test("recent servers are unique, newest first and bounded", () => {
  let list = [];
  for (const label of ["a", "b", "a", "c", "d", "e", "f"]) list = rememberServer(list, label);
  assert.deepEqual(list, ["f", "e", "d", "c", "a"]);
  assert.deepEqual(rememberServer("garbage", "x"), ["x"]);
});
