import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { decideFx, FrameWatch, isWeakRenderer, readFxOverride, type FxSignals } from "../src/lib/fx-tier";

const strong: FxSignals = { override: null, reducedMotion: false, saveData: false, cores: 8, memory: 8, webgl: true, renderer: "ANGLE (Apple, Apple M2, OpenGL 4.1)" };

test("a capable device gets the 3D scenes", () => {
  assert.equal(decideFx(strong), "rich");
  // Safari and Firefox do not report memory: unknown is not a reason to drop 3D.
  assert.equal(decideFx({ ...strong, memory: 0 }), "rich");
});

test("weak or constrained devices get the drawn version", () => {
  assert.equal(decideFx({ ...strong, webgl: false }), "lite");
  assert.equal(decideFx({ ...strong, reducedMotion: true }), "lite");
  assert.equal(decideFx({ ...strong, saveData: true }), "lite");
  assert.equal(decideFx({ ...strong, cores: 2 }), "lite");
  assert.equal(decideFx({ ...strong, memory: 2 }), "lite");
  assert.equal(decideFx({ ...strong, renderer: "Google SwiftShader" }), "lite");
  assert.equal(decideFx({ ...strong, renderer: "Mali-G52 MC2" }), "lite");
  assert.equal(decideFx({ ...strong, renderer: "Adreno (TM) 506" }), "lite");
});

test("the presenter override wins, except that it cannot create WebGL", () => {
  assert.equal(decideFx({ ...strong, cores: 2, reducedMotion: true, override: "on" }), "rich");
  assert.equal(decideFx({ ...strong, override: "off" }), "lite");
  assert.equal(decideFx({ ...strong, webgl: false, override: "on" }), "lite");
});

test("the override is read from the URL first, then from the session", () => {
  assert.equal(readFxOverride("?fx=on", "off"), "on");
  assert.equal(readFxOverride("", "off"), "off");
  assert.equal(readFxOverride("?fx=maybe", null), null);
});

test("modern GPUs are not mistaken for weak ones", () => {
  for (const renderer of ["Adreno (TM) 740", "Mali-G715-Immortalis MC11", "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)", "Apple GPU", "Intel(R) Iris(R) Xe Graphics"]) {
    assert.equal(isWeakRenderer(renderer), false, renderer);
  }
});

test("a scene that keeps missing the frame budget asks to drop to lite", () => {
  const fast = new FrameWatch(22, 10);
  for (let i = 0; i < 20; i++) assert.equal(fast.push(16.7), false);
  const slow = new FrameWatch(22, 10);
  const results = Array.from({ length: 10 }, () => slow.push(40));
  assert.equal(results.at(-1), true);
  // A single long gap (tab switch) is ignored rather than counted.
  const gap = new FrameWatch(22, 10);
  for (let i = 0; i < 9; i++) gap.push(16.7);
  assert.equal(gap.push(2000), false);
});

test("the display and text fonts carry every Kazakh letter and the tenge sign", () => {
  // Unicode ranges are declared per subset; the woff2 glyph check lives in the font choice notes.
  // roboto-flex is the bcc.kz heading face used on the public homepage.
  for (const pkg of ["onest", "geologica", "roboto-flex"]) {
    const css = readFileSync(new URL(`../node_modules/@fontsource-variable/${pkg}/index.css`, import.meta.url), "utf8");
    assert.match(css, /cyrillic-ext/, pkg);
    const ranges = [...css.matchAll(/unicode-range:\s*([^;]+);/g)].flatMap(m => m[1].split(",").map(r => r.trim().replace("U+", "")));
    const covered = (cp: number) => ranges.some(r => { const [a, b = a] = r.split("-"); return cp >= parseInt(a, 16) && cp <= parseInt(b, 16); });
    for (const ch of "әғқңөұүһіӘҒҚҢӨҰҮҺІ₸") assert.ok(covered(ch.codePointAt(0)!), `${pkg} ${ch}`);
  }
});
