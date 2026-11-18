/** Record the real local API demo. Never targets a remote bank or mocks decisions. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const value = key => args[args.indexOf(key) + 1];
assert.ok(args.includes("--url") && args.includes("--allow-demo-writes"),
  "Usage: node scripts/record-demo.mjs --url http://127.0.0.1:3217 --allow-demo-writes [--output directory]");
const target = new URL(value("--url"));
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) && target.protocol === "http:",
  "Only an explicitly selected local synthetic-data rehearsal is supported.");
const output = path.resolve(args.includes("--output") ? value("--output") : "deliverables/demo");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright-core");
await mkdir(output, { recursive: true });
assert.ok((await fetch(target, { signal: AbortSignal.timeout(30000) })).ok, "Preview must be healthy before recording");
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1, locale: "ru-KZ", timezoneId: "Asia/Qyzylorda",
  recordVideo: { dir: path.join(output, "raw"), size: { width: 1920, height: 1080 } } });
const recordingBegan = performance.now();
const page = await context.newPage();
page.setDefaultTimeout(20000);
const video = page.video();
const errors = [];
const decisions = [];
const chapters = [];
let trafficSummary = null;
let graphCounts = null;
let started = performance.now();
let preroll = 0;
page.on("pageerror", error => errors.push(error.message));
page.on("response", response => {
  if (response.url().includes("/api/v1/") && response.status() >= 400)
    errors.push(`${response.status()} ${new URL(response.url()).pathname}`);
});
const elapsed = () => (performance.now() - started) / 1000;
async function until(seconds) { await page.waitForTimeout(Math.max(0, (seconds - elapsed()) * 1000)); }
function chapter(ru, kk) {
  chapters.push({ seconds: Number(elapsed().toFixed(2)), ru, kk });
  console.log(`[${elapsed().toFixed(1)}s] ${ru}`);
}
async function language(label, inModal = false) {
  await page.locator(inModal ? ".cooling-toolbar" : ".topbar").getByRole("button", { name: label, exact: true }).click();
}
async function focusInvestigation() {
  await page.locator("#soc-investigation").evaluate(element => window.scrollTo({
    top: window.scrollY + element.getBoundingClientRect().top - 145, behavior: "instant",
  }));
  await page.waitForTimeout(250);
}
async function preset(index, expected) {
  const responsePromise = page.waitForResponse(response => response.url().endsWith("/api/v1/transfers/evaluate") && response.request().method() === "POST");
  await page.locator(".preset-buttons button").nth(index).click();
  const response = await responsePromise;
  assert.ok(response.ok(), `Preset ${index}: HTTP ${response.status()}`);
  const result = await response.json();
  assert.equal(result.status, expected, `Preset ${index} decision`);
  decisions.push({ preset: ["normal", "scam", "hub"][index], transaction_id: result.transaction_id,
    status: result.status, risk_score: result.risk_score, ml_score: result.ml_score, latency_ms: result.latency_ms });
  return result;
}
try {
  await page.goto(target.href, { waitUntil: "networkidle" });
  await page.locator(".preset-buttons button").first().waitFor();
  await language("РУС");
  started = performance.now();
  preroll = (started - recordingBegan) / 1000;
  chapter("BCC Shield: синтетическое демо на живом API", "BCC Shield: нақты API-дегі синтетикалық демо");
  await until(5); await language("ҚАЗ");
  await until(10); await language("РУС");
  await page.locator("#transfer-amount").fill("");
  await page.locator("#transfer-amount").pressSequentially("5000", { delay: 180 });
  await page.locator("#transfer-amount").press("Backspace");
  await page.locator("#transfer-amount").press("0");
  await page.locator("#transfer-amount").blur();
  await until(14);
  chapter("Обычный перевод: решение и квитанция", "Қалыпты аударым: шешім және түбіртек");
  await preset(0, "approved");
  await page.locator(".phone-receipt").waitFor();
  await page.locator(".phone-receipt").scrollIntoViewIfNeeded();
  await until(28);
  await page.screenshot({ path: path.join(output, "01-normal.png") });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await until(34);
  chapter("Звонок и вывод депозита: предупреждение о «безопасном счёте»", "Қоңырау және депозиттен алу: «қауіпсіз шот» туралы ескерту");
  const held = await preset(1, "cooling_off");
  assert.ok(held.cooling_off_until, "The hold must have a real server deadline");
  await page.locator("dialog[data-step=intro]").waitFor();
  await until(43); await language("ҚАЗ", true);
  await until(50); await language("РУС", true);
  await page.screenshot({ path: path.join(output, "02-cooling.png") });
  await page.locator(".cooling-start").click();
  chapter("Пять явных ответов и проверка перед подтверждением", "Бес нақты жауап және растау алдындағы тексеру");
  for (const [index, answer] of [false, false, false, true, true].entries()) {
    await until(54 + index * 6);
    await page.locator(".cooling-choices input").nth(answer ? 0 : 1).check();
    await page.waitForTimeout(1500);
    await page.locator(".cooling-next").click();
  }
  await page.locator("dialog[data-step=review]").waitFor();
  await until(88);
  const savedResponse = page.waitForResponse(response => response.url().endsWith(`/transfers/${held.transaction_id}/resolve-cooling`) && response.request().method() === "POST");
  await page.locator(".cooling-submit").click();
  const savedHttp = await savedResponse;
  assert.ok(savedHttp.ok());
  const saved = await savedHttp.json();
  assert.equal(saved.status, "cooling_off", "Safe answers cannot bypass the 15-minute hold");
  assert.ok(saved.verification_answers, "Answers must be persisted");
  chapter("Ответы сохранены; 15-минутное удержание остаётся", "Жауаптар сақталды; 15 минуттық кідіріс жалғасады");
  await until(96);
  if (!(await page.locator("dialog[open]").count())) await page.locator(".receipt-review").click();
  const cancelledResponse = page.waitForResponse(response => response.url().endsWith(`/transfers/${held.transaction_id}/cancel`) && response.request().method() === "POST");
  await page.locator("dialog .danger-button").click();
  const cancelledHttp = await cancelledResponse;
  assert.ok(cancelledHttp.ok());
  assert.equal((await cancelledHttp.json()).status, "cancelled");
  chapter("Клиент отменяет перевод; средства не отправляются", "Клиент аударымнан бас тартады; қаражат жіберілмейді");
  await page.locator(".phone-receipt").scrollIntoViewIfNeeded();
  await until(104);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  const hub = await preset(2, "blocked");
  chapter("Дропперский хаб: блокировка по совокупности сигналов", "Дроппер торабы: сигналдар жиынтығы бойынша бұғаттау");
  await until(115);
  await page.locator("#tab-soc").click();
  await page.locator(`.case-panel[data-transaction-id="${hub.transaction_id}"] .ml-badge`).waitFor();
  await page.locator(".react-flow__node").first().waitFor();
  const directNodes = await page.locator(".react-flow__node").count();
  assert.equal(await page.locator(".graph-depth-controls button").first().getAttribute("aria-pressed"), "true");
  await page.locator(".soc-stage-toggle").click();
  chapter("SOC: измеренный p95, заблокированные хабы и граф связей", "SOC: өлшенген p95, бұғатталған тораптар және байланыс графы");
  await until(126);
  await page.screenshot({ path: path.join(output, "03-soc.png") });
  await page.locator(".investigation-tabs button").nth(1).click();
  await focusInvestigation();
  const contributorsBox = await page.locator(".case-panel .contributors").boundingBox();
  assert.ok(contributorsBox && contributorsBox.y >= 110 && contributorsBox.y + contributorsBox.height <= 1080, "ML contributors must be in the recorded viewport");
  chapter("ML и причины: вклад признаков, правила и граф", "ML және себептер: белгілердің үлесі, ережелер және граф");
  await until(141);
  await page.screenshot({ path: path.join(output, "04-ml.png") });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await language("ҚАЗ");
  await focusInvestigation();
  chapter("ҚАЗ / РУС: объяснения переводятся без перезагрузки", "ҚАЗ / РУС: түсіндірмелер бет жаңартылмай аударылады");
  await page.locator(".graph-depth-controls button").nth(1).click();
  await page.waitForFunction(count => document.querySelectorAll(".react-flow__node").length > count, directNodes);
  graphCounts = { direct: directNodes, expanded: await page.locator(".react-flow__node").count() };
  await focusInvestigation();
  await until(150);
  await page.locator(".graph-depth-controls button").nth(0).click();
  await page.waitForFunction(count => document.querySelectorAll(".react-flow__node").length === count, directNodes);
  await focusInvestigation();
  await until(155);
  await page.locator(".soc-stage-toggle").click();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await language("РУС");
  await page.locator(".soc-dashboard").scrollIntoViewIfNeeded();
  await page.locator(".traffic-button").click();
  chapter("Живой поток: сумма заблокированных переводов симуляции", "Тікелей ағын: симуляцияда бұғатталған аударымдар сомасы");
  await until(171);
  await page.locator(".traffic-button[aria-pressed=true]").click();
  const blockedAmount = await page.locator(".prevented-card strong").innerText();
  assert.ok(Number(blockedAmount.replace(/[^0-9]/g, "")) > 0, "Synthetic traffic must show a blocked amount");
  trafficSummary = { blocked_simulated_amount_label: blockedAmount, stopped: true };
  await page.screenshot({ path: path.join(output, "05-traffic.png") });
  chapter("Поток остановлен; следующий этап — контролируемый пилот", "Ағын тоқтатылды; келесі кезең — бақыланатын пилот");
  await until(174);
  assert.deepEqual(errors, [], "Browser/API errors during recording");
  const duration = elapsed();
  assert.ok(duration >= 150 && duration <= 180, `Recording duration ${duration}`);
  await context.close();
  const videoPath = path.join(output, "BCC-Shield-demo.webm");
  await video.saveAs(videoPath);
  await video.delete();
  const sha256 = createHash("sha256").update(await readFile(videoPath)).digest("hex");
  const stamp = seconds => {
    const ms = Math.round(seconds * 1000);
    return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
  };
  for (const lang of ["ru", "kk"]) await writeFile(path.join(output, `BCC-Shield-demo.${lang}.srt`),
    chapters.map((chapter, index) => `${index + 1}\n${stamp(chapter.seconds + preroll)} --> ${stamp((chapters[index + 1]?.seconds ?? duration) + preroll)}\n${chapter[lang]}\n`).join("\n"), "utf8");
  await writeFile(path.join(output, "manifest.json"), JSON.stringify({ recorded_at: new Date().toISOString(),
    source: target.origin, synthetic: true, api: "live, no request interception", width: 1920, height: 1080,
    duration_seconds: duration, approximate_preroll_seconds: preroll, audio: false, sha256, decisions, graph_nodes: graphCounts, traffic: trafficSummary, assertions: ["three preset decisions", "saved answers remain held", "explicit cancellation", "direct and expanded graph scopes", "live traffic started and stopped", "nonzero simulated blocked amount", "no browser/API errors"], chapters }, null, 2) + "\n");
  console.log(JSON.stringify({ videoPath, duration_seconds: duration, sha256, decisions }, null, 2));
} finally { await context.close().catch(() => {}); await browser.close(); }
