import assert from "node:assert/strict";
import test from "node:test";
import { Gateway } from "../www/gateway.mjs";

test("identical reads share a request only within one active session",async()=>{
  const requests=[];
  const g=new Gateway("http://127.0.0.1:18001",()=>new Promise(resolve=>requests.push(resolve)));
  g.role="client"; g.token="first";
  const first=g.request("/account");
  assert.equal(first,g.request("/account"));
  g.token="next";
  const next=g.request("/account");
  assert.notEqual(next,first);
  requests[0](new Response("{}",{status:401}));
  await assert.rejects(first,{status:401});
  assert.equal(g.token,"next");
  requests[1](Response.json({balance:"10.00"}));
  assert.deepEqual(await next,{balance:"10.00"});
  const another=g.request("/account");
  assert.equal(requests.length,3);
  requests[2](new Response("{}",{status:401}));
  await assert.rejects(another,{status:401});
  assert.equal(g.token,null);
});
