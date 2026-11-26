import assert from "node:assert/strict";
import test from "node:test";
import { probeWallet, walletDestination, walletEntry } from "../src/lib/wallet-warmup";
import wallets from "../src/lib/connected-wallet.json";

test("wake probes only configured origins and never forwards a session", async () => {
  assert.equal(walletDestination("__proto__"), null);
  assert.equal(await probeWallet("https://elsewhere.example", () => { throw Error("unexpected network call"); }), false);
  assert.equal(await probeWallet("soc", async (url, options) => {
    assert.equal(String(url), new URL("/ready", wallets.socUrl).href);
    assert.equal(options?.method, "GET");
    assert.equal(options?.credentials, "omit");
    return Response.json({status:"ready"});
  }), true);
  assert.equal(await probeWallet("jury", async url => {
    assert.equal(String(url), new URL("/health", wallets.juryUrl).href);
    return Response.json({status:"ok", mode:"synthetic-jury"});
  }), true);
  for (const response of [new Response("warming", {status:503}), new Response("<html>waiting</html>"), Response.json({status:"unavailable"})]) {
    assert.equal(await probeWallet("jury", async () => response), false);
  }
});

test("static Pages links open the configured wallet without a server-side readiness route", () => {
  const expected = { wallet: wallets.url, soc: wallets.socUrl, jury: wallets.juryUrl, trial: new URL("jury/trial", wallets.juryUrl).href };
  for (const stand of ["wallet", "soc", "jury", "trial"] as const) {
    assert.equal(walletDestination(stand), expected[stand]);
    assert.equal(walletEntry(stand, true), walletDestination(stand));
    assert.equal(walletEntry(stand, false), "/connect?stand=" + stand);
  }
});
