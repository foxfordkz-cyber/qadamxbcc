import assert from "node:assert/strict";
import test from "node:test";
import { GET as health } from "../src/app/health/route";
import { caseTimeline } from "../src/lib/case-timeline";
import { localGraph, newTour, nextTour, nextTourStep, prepareTour, readTour, saveTour, tourCall, tourCase, tourStep, tourStorageKey, warmupLimit } from "../src/lib/jury-tour";

function tab() {
  const entries = new Map<string, string>();
  return () => ({ getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); } });
}

test("one transfer visits six stops in order, and the report records the actual verdict", () => {
  let state = newTour();
  const id = state.id;
  const stops = new Map<number, string>();
  for (;;) {
    if (!stops.has(tourStep(state.view))) stops.set(tourStep(state.view), state.view);
    assert.equal(state.id, id);
    if (state.view === "verdict") assert.equal(tourCall(state)?.verified, false);
    if (state.view === "telegram") assert.equal(tourCase(state).status, "cooling_off");
    if (state.view === "saved") break;
    state = nextTour(state, state.view === "caller" ? true : state.view === "payee" ? false : undefined);
  }
  assert.deepEqual([...stops.values()], ["transfer", "caller", "call", "telegram", "feed", "report"]);
  const detail = tourCase(state);
  assert.equal(detail.amount, "450000");
  assert.equal(detail.status, "blocked");
  assert.equal(detail.recipient.id, localGraph().center);
  assert.ok(detail.ml_contributors?.length);
  assert.deepEqual(state.answers, { caller_claims_bank_or_police: true, knows_recipient_personally: false });
  assert.deepEqual(caseTimeline(detail).slice(-4).map(event => event.key), ["tlDecisionHeld", "tlBankLog", "tlContactSuspicion", "tlStopped"]);
  assert.equal(nextTour(state), state);
});

test("Next alone completes the six numbered steps without filling in answers on the visitor's behalf", () => {
  let state = newTour();
  for (const view of ["transfer", "caller", "call", "telegram", "feed", "report"]) {
    assert.equal(state.view, view);
    state = nextTourStep(state);
  }
  assert.equal(state.view, "saved");
  assert.ok(state.checked !== null && state.blocked !== null);
  assert.deepEqual(state.answers, {});
});

test("Skip clears this tab's tour and Replay starts a new case with empty answers", () => {
  const first = tab(), second = tab();
  const initial = readTour(first);
  const other = nextTour(readTour(second));
  saveTour(other, second);
  saveTour(nextTour(nextTour(initial), true), first);
  assert.equal(readTour(first).view, "payee");
  assert.equal(readTour(first).id, initial.id);
  saveTour(null, first);
  assert.equal(first().getItem(tourStorageKey), null);
  assert.equal(readTour(first).view, "transfer");
  assert.deepEqual(readTour(second), other);
  const replay = newTour();
  assert.notEqual(replay.id, initial.id);
  assert.deepEqual([replay.view, replay.answers, replay.checked, replay.blocked], ["transfer", {}, null, null]);
});

test("storage denial and damaged or incomplete sessions still allow the story to start", () => {
  const denied = () => { throw new Error("storage denied"); };
  assert.equal(nextTour(readTour(denied)).view, "caller");
  assert.doesNotThrow(() => saveTour(newTour(), denied));
  const storage = tab();
  for (const value of ["{", JSON.stringify({ ...newTour(), view: "saved" })]) {
    storage().setItem(tourStorageKey, value);
    assert.equal(readTour(storage).view, "transfer");
  }
});

test("ready API supplies the recipient graph and a failed health or graph read uses frontend data", async () => {
  const signal = new AbortController().signal;
  const graph = localGraph();
  const live = await prepareTour(signal, async () => "api", async () => graph);
  assert.equal(live.source, "api");
  assert.equal(live.graph, graph);
  const fail = async () => { throw new Error("offline"); };
  for (const result of [await prepareTour(signal, fail, fail), await prepareTour(signal, async () => "api", fail)]) {
    assert.equal(result.source, "local");
    assert.deepEqual(result.graph, graph);
  }
});

test("the 60 second limit aborts a sleeping API even when its promise never settles", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let probeSignal: AbortSignal | undefined;
  let settled = false;
  const result = prepareTour(new AbortController().signal, signal => {
    probeSignal = signal;
    return new Promise<never>(() => {});
  }).then(data => { settled = true; return data; });
  t.mock.timers.tick(59_999);
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(warmupLimit, 60_000);
  t.mock.timers.tick(1);
  assert.equal((await result).source, "local");
  assert.ok(probeSignal?.aborted);
});

test("a temporary cold-start response retries within the same deadline", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let attempts = 0;
  const ready = prepareTour(new AbortController().signal, async () => ++attempts === 1 ? "starting" : "api", async () => localGraph());
  await Promise.resolve();
  t.mock.timers.tick(2000);
  assert.equal((await ready).source, "api");
  assert.equal(attempts, 2);
});

test("tour probe wakes the configured backend health endpoint and ordinary liveness stays independent", async t => {
  const previous = process.env.BCC_API_URL;
  process.env.BCC_API_URL = "https://upstream.test";
  t.after(() => { if (previous === undefined) delete process.env.BCC_API_URL; else process.env.BCC_API_URL = previous; });
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: URL) => { urls.push(String(url)); return new Response(null, { status: 503 }); });
  assert.equal((await (await health(new Request("http://localhost/health"))).json()).status, "ok");
  assert.deepEqual(await (await health(new Request("http://localhost/health?tour=1"))).json(), { source: "starting" });
  assert.deepEqual(urls, ["https://upstream.test/health"]);
});
