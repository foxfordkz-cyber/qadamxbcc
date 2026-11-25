import test from "node:test";
import assert from "node:assert/strict";
import { canUseTransferKey, verifyWithDevice } from "../www/transfer-key.mjs";

test("cancelling the device prompt sends no authorization", async () => {
  class Credential {
    static parseCreationOptionsFromJSON(value) { return value; }
    static parseRequestOptionsFromJSON(value) { return value; }
    toJSON() { return {}; }
  }
  const paths = [];
  const gateway = { async request(path) { paths.push(path); return {ceremony:"test", publicKey:{}}; } };
  const browser = {isSecureContext:true, PublicKeyCredential:Credential, navigator:{credentials:{
    async get() { throw new DOMException("Cancelled", "NotAllowedError"); }
  }}};
  assert.equal(canUseTransferKey({...browser, isSecureContext:false}), false);
  await assert.rejects(verifyWithDevice(gateway, {amount:"20.00"}, browser), {status:428});
  assert.deepEqual(paths, ["/protection/transfer-key/payment/options"]);
});
