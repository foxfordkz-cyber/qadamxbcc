import test from "node:test";
import assert from "node:assert/strict";
import {checkProtocol,protocolCompatibility} from "../www/compatibility.mjs";
import {PollBackoff,pollInterval} from "../www/poll-backoff.mjs";

test("protocol discovery accepts additive fields but rejects a newer major or unsupported build",()=>{
  assert.equal(protocolCompatibility({api_major:1,minimum_android_build:22,new_field:true},24),"supported");
  assert.equal(protocolCompatibility({api_major:2,minimum_android_build:0},24),"update_required");
  assert.equal(protocolCompatibility({api_major:1,minimum_android_build:25},24),"update_required");
  assert.equal(protocolCompatibility({api_major:1,minimum_android_build:25}),"supported");
  assert.equal(protocolCompatibility({}),"invalid");
});
test("only a missing legacy discovery route is optional; network and auth errors survive",async()=>{
  for(const status of [404,405])assert.equal(await checkProtocol({request:async()=>{throw {status};}}),"legacy");
  for(const status of [0,401,403,503])await assert.rejects(()=>checkProtocol({request:async()=>{throw {status};}}),e=>e.status===status);
});
test("read reconnect uses bounded backoff and never overrides Retry-After",()=>{
  const b=new PollBackoff();b.failure(0,503);assert.equal(b.next,3000);
  b.failure(3000,503);assert.equal(b.next,9000);
  for(let n=0;n<10;n++)b.failure(0,0);assert.equal(b.next,60000);
  b.reconnect();assert.equal(b.next,0);
  b.failure(100,429,120);assert.equal(b.next,120100);b.reconnect();assert.equal(b.next,120100);
  assert.equal(b.ready(120099),false);b.success(120100,15000);assert.equal(b.next,135100);
  assert.equal(b.failures,0);assert.equal(pollInterval("case"),15000);assert.equal(pollInterval("timeline"),60000);
});
