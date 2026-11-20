import assert from "node:assert/strict";
import test from "node:test";
import { pickCallbackNumbers } from "../src/lib/family-callback";

test("callback asks for one contact and only its dialable telephone numbers", async () => {
  const numbers = await pickCallbackNumbers({ async select(fields, options) {
    assert.deepEqual(fields, ["tel"]);
    assert.deepEqual(options, { multiple: false });
    return [{ tel: ["8 (701) 000-00-02", "+7 701 000 00 02", "+49 30 12345678",
      "*123#", "505", "tel:+77010000002", "+77010000002;123", "+77010000002,123"] }];
  } });
  assert.deepEqual(numbers, ["+77010000002", "+493012345678"]);
});

test("cancelling or selecting a contact without a phone offers no dial target", async () => {
  assert.deepEqual(await pickCallbackNumbers({ select: async () => [] }), []);
  assert.deepEqual(await pickCallbackNumbers({ select: async () => [{}] }), []);
});
