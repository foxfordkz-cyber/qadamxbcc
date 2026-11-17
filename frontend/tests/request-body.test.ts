import assert from "node:assert/strict";
import test from "node:test";
import { readBoundedJson, RequestBodyError } from "../src/lib/request-body";

const status = (expected: number) => (error: unknown) => error instanceof RequestBodyError && error.status === expected;
function request(chunks: Uint8Array[], headers?: HeadersInit) {
  return new Request("http://localhost/api/v1/transfers/evaluate", {
    method: "POST", headers, duplex: "half",
    body: new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } }),
  } as RequestInit);
}
const bytes = (text: string) => new TextEncoder().encode(text);

test("JSON limit counts encoded bytes across chunks, including absent and false lengths", async () => {
  assert.deepEqual(await readBoundedJson(request([bytes('{"x":'), bytes('"қ"}')]), 10), { x: "қ" });
  await assert.rejects(readBoundedJson(request([bytes('{"x":'), bytes('"қ"}')]), 9), status(413));
  await assert.rejects(readBoundedJson(request([bytes("{}")] , { "content-length": "1000" }), 10), status(413));
  await assert.rejects(readBoundedJson(request([bytes("{}")] , { "content-length": "1" }), 10), status(400));
});

test("malformed JSON and invalid UTF-8 are rejected as client input", async () => {
  await assert.rejects(readBoundedJson(request([bytes("{")])), status(422));
  await assert.rejects(readBoundedJson(request([new Uint8Array([0xff])])), status(422));
});

test("a stalled request times out and cancels its body", async () => {
  let cancelled = false;
  const input = new Request("http://localhost/api/v1/transfers/evaluate", {
    method: "POST", duplex: "half", body: new ReadableStream({ cancel() { cancelled = true; } }),
  } as RequestInit);
  await assert.rejects(readBoundedJson(input, 100, 10), status(408));
  assert.equal(cancelled, true);
});
