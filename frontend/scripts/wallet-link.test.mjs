import assert from "node:assert/strict";
import test from "node:test";
import { connectedWalletAvailable } from "./wallet-link.mjs";

test("Pages links to the signed-in wallet entry only when it serves the product HTML", async () => {
  const html = { headers: { "content-type": "text/html; charset=utf-8" } };
  assert.equal(await connectedWalletAvailable(async (url, options) => {
    assert.equal(url, "https://saq-bol-mobile.onrender.com/wallet/");
    assert.equal(options.redirect, "error");
    return new Response('<html lang="kk" data-web-wallet data-install>', html);
  }), true);
  for (const response of [
    new Response("{}", { headers: { "content-type": "application/json" } }),
    new Response('<html><body data-web-wallet></body></html>', html),
    new Response('<html data-web-wallet-offline>', html),
    new Response('<html data-web-wallet>', { ...html, status: 503 }),
  ]) {
    assert.equal(await connectedWalletAvailable(async () => response), false);
  }
  assert.equal(await connectedWalletAvailable(async () => { throw new Error("offline"); }), false);
});
