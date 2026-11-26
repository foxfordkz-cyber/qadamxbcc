import assert from "node:assert/strict";
import test from "node:test";
import { probeWallet, shouldOpenWallet, walletDestination, walletEntry } from "../src/lib/wallet-warmup";
import wallets from "../src/lib/connected-wallet.json";

test("wake probes only configured origins and never forwards a session", async () => {
  assert.equal(walletDestination("__proto__"), null);
  assert.equal(await probeWallet("https://elsewhere.example", () => { throw Error("unexpected network call"); }), "pending");
  assert.equal(await probeWallet("soc", async (url, options) => {
    assert.equal(String(url), new URL("/ready", wallets.socUrl).href);
    assert.equal(options?.method, "GET");
    assert.equal(options?.credentials, "omit");
    assert.equal(options?.redirect, "manual");
    return Response.json({status:"ready"});
  }), "ready");
  assert.equal(await probeWallet("jury", async url => {
    assert.equal(String(url), new URL("/health", wallets.juryUrl).href);
    return Response.json({status:"ok", mode:"synthetic-jury"});
  }), "ready");
  for (const response of [Response.redirect("https://elsewhere.example/"), new Response("warming", {status:503}), new Response("<html>waiting</html>"), Response.json({status:"unavailable"}), Response.json({status:"ok", mode:"team"})]) {
    assert.equal(await probeWallet("jury", async () => response), "pending");
  }
});

test("the browser opens its chosen stand on a confirmed ready, starting or hibernation reply", async () => {
  const headers = { "x-render-routing": "hibernate-rate-limited" };
  const probe = (status: number, responseHeaders?: HeadersInit) =>
    probeWallet("wallet", async () => new Response(null, { status, headers: responseHeaders }));
  assert.equal(await probe(429, headers), "open_in_browser");
  assert.equal(await probe(429), "pending");
  assert.equal(await probe(503, headers), "pending");
  assert.equal(await shouldOpenWallet(Response.json({ ready: true })), true);
  assert.equal(await shouldOpenWallet(Response.json({ ready: false, open_directly: true }, { status: 429 })), true);
  assert.equal(await shouldOpenWallet(Response.json({ ready: true }, { status: 429 })), false);
  assert.equal(await shouldOpenWallet(Response.json({ ready: false }, { status: 503 })), true);
  assert.equal(await shouldOpenWallet(new Response("upstream failure", { status: 503 })), false);
  assert.equal(await shouldOpenWallet(Response.json({ ready: false }, { status: 400 })), false);
  assert.equal(await shouldOpenWallet(Response.json({ open_directly: true }, { status: 503 })), false);
  assert.equal(await shouldOpenWallet(Response.json({ open_directly: true })), false);
});

test("static Pages links open the configured wallet without a server-side readiness route", () => {
  const expected = { wallet: wallets.url, soc: wallets.socUrl, jury: wallets.juryUrl, trial: new URL("jury/trial", wallets.juryUrl).href };
  for (const stand of ["wallet", "soc", "jury", "trial"] as const) {
    assert.equal(walletDestination(stand), expected[stand]);
    assert.equal(walletEntry(stand, true), walletDestination(stand));
    assert.equal(walletEntry(stand, false), "/connect?stand=" + stand);
  }
});
