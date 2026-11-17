import assert from "node:assert/strict";
import test from "node:test";
import { apiAdmission, RequestQuota } from "../src/lib/request-quota";

test("a burst is bounded, quota refills, and backwards time grants no requests", () => {
  const quota = new RequestQuota(2, 1000);
  assert.equal(quota.take(1000), 0);
  assert.equal(quota.take(1000), 0);
  assert.equal(quota.take(1000), 30);
  assert.equal(quota.take(0), 30);
  assert.equal(quota.take(31_000), 0);
  assert.equal(quota.take(31_000), 30);
});

test("invalid admission configuration fails closed", () => {
  for (const value of ["0", "-1", "NaN", "Infinity", "10001", ""]) {
    assert.equal(apiAdmission({ BCC_REQUEST_RATE_LIMIT_PER_MINUTE: value }).status, 503);
  }
});
