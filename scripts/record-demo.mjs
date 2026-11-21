/** Record the real P2P and SOC workflows on an explicitly selected synthetic loopback stand. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { verifyDemoFilm } from "./verify-demo-film.mjs";

const args = process.argv.slice(2);
const value = key => args[args.indexOf(key) + 1];
assert.ok(args.includes("--url") && args.includes("--allow-demo-writes"), "Pass --url and --allow-demo-writes for a disposable local demo.");
const local = (url) => {
  const u = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) && u.protocol === "http:" && !u.username && !u.password);
  return u.origin;
};
const target = local(value("--url"));
const simulator = process.env.RECORD_SIMULATOR_CAPABILITY;
const fakeApi = simulator ? local(process.env.RECORD_FAKE_API) : null;
const quick = args.includes("--quick-check");
const output = path.resolve(args.includes("--output") ? value("--output") : "deliverables/demo");
await mkdir(output, { recursive: true });
const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
  locale: "ru-KZ", timezoneId: "Asia/Qyzylorda",
  ...(quick ? {} : { recordVideo: { dir: path.join(output, "raw"), size: { width: 1920, height: 1080 } } }) });
const start = performance.now();
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.setDefaultNavigationTimeout(30000);
const video = page.video();
const elapsed = () => (performance.now() - start) / 1000;
const until = async seconds => { if (!quick) await page.waitForTimeout(Math.max(0, (seconds - elapsed()) * 1000)); };
const captions = [];
const decisions = [];
const errors = [];
const screenshots = [];
const checks = [];
const check = (condition, label) => { assert.ok(condition, label); checks.push(label); };
const chapter = (ru, kk) => {
  captions.push({ seconds: Number(elapsed().toFixed(2)), ru, kk });
  console.log("[" + elapsed().toFixed(1) + "s] " + ru);
};
const snapshot = async name => {
  if (quick) return;
  await page.screenshot({ path: path.join(output, name) });
  screenshots.push(name);
};
const center = async locator => {
  await locator.waitFor();
  await locator.evaluate(el => el.scrollIntoView({ behavior: "instant", block: "center" }));
};
const evaluate = async click => {
  const [response] = await Promise.all([page.waitForResponse(r => r.url().endsWith("/transfers/evaluate") && r.request().method() === "POST"), click()]);
  assert.ok(response.ok(), "evaluate HTTP " + response.status());
  return response.json();
};
const preset = async (index, expected) => {
  const result = await evaluate(() => page.locator(".preset-buttons button").nth(index).click());
  check(result.status === expected, ["normal", "scam", "hub"][index] + " → " + expected);
  decisions.push({ preset: ["normal", "scam", "hub"][index], transaction_id: result.transaction_id,
    status: result.status, ml_score: result.ml_score, latency_ms: result.latency_ms });
  return result;
};
const choose = label => page.locator(".topbar").getByRole("button", { name: label, exact: true }).click();
const responseFor = (ending, click) => Promise.all([
  page.waitForResponse(r => r.url().endsWith(ending) && r.request().method() === "POST"), click()
]).then(async ([r]) => { assert.ok(r.ok(), "HTTP " + r.status() + " " + ending); return r.json(); });
page.on("pageerror", error => errors.push(error.message));
page.on("response", res => { if (res.url().includes("/api/v1/") && res.status() >= 400) errors.push(res.status() + " " + new URL(res.url()).pathname); });
try {
  await page.goto(target, { waitUntil: "networkidle" });
  await page.locator(".preset-buttons button").first().waitFor();
  await choose("ҚАЗ");
  chapter("Saq Bol × BCC. Перевод проходит через антифрод до отправки денег.", "Saq Bol × BCC. Ақша жіберілгенге дейін аударым тексеріледі.");
  await until(6);
  await choose("РУС");
  await preset(0, "approved");
  await center(page.locator(".phone-receipt"));
  chapter("Перевод знакомому получателю одобрен. Клиент видит сумму и квитанцию.", "Таныс алушыға аударым мақұлданды. Клиент сома мен түбіртекті көреді.");
  await until(16);
  await snapshot("01-normal.png");

  const held = await preset(1, "cooling_off");
  const dialog = page.locator("dialog[open]");
  await dialog.waitFor();
  check(Date.parse(held.cooling_off_until) > Date.now(), "server cooling deadline in future");
  chapter("Звонок и перевод с депозита. Включилась 15-минутная пауза.", "Қоңырау кезінде депозиттен аударым жасалды. 15 минуттық кідіріс басталды.");
  await until(29);
  await snapshot("02-cooling.png");
  await dialog.locator(".post-call-end").click();
  await dialog.locator(".post-call-prompt").waitFor();
  chapter("После звонка клиент видит сумму и получателя в вопросе «Это вы?».", "Қоңыраудан кейін клиентке аударымның сомасы мен алушысы көрсетіліп, «Бұл сіз бе?» деп сұралады.");
  await until(39);
  await dialog.locator(".post-call-prompt .primary").click();
  const notify = dialog.locator(".trusted-notify").first();
  await center(notify);
  await notify.click();
  const statusUrl = target + "/api/v1/trusted-circle/" + held.transaction_id;
  let notice;
  for (let i = 0; i < 25; i++) {
    const r = await context.request.get(statusUrl + "?scope=notifications");
    assert.ok(r.ok(), "Cannot read the test contact's delivery status");
    notice = (await r.json()).notifications.find(n => n.state === "NOTIFICATION_SENT");
    if (notice) break;
    await page.waitForTimeout(350);
  }
  check(Boolean(notice), "worker delivered message through local adapter");
  chapter("Доверенный контакт получил запрос через локальный имитатор Telegram.", "Сенімді адамға жергілікті Telegram симуляторы арқылы сұрау жеткізілді.");
  await until(52);
  if (simulator) {
    const reply = await fetch(fakeApi + "/api/v1/trusted-contacts/simulator/update", { method: "POST",
      headers: { Authorization: "Bearer " + simulator, "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "suspect", chat_id: 123, reference: notice.id,
        message_id: String(BigInt("0x" + notice.id.replaceAll("-", "")) % 2000000000n) }) });
    assert.ok(reply.ok && (await reply.json()).state === "SUSPICION_REPORTED", "Local contact response was accepted");
    await dialog.locator(".trusted-circle button.secondary").last().click();
    await center(dialog.locator(".trusted-suspicion"));
    chapter("Тестовый контакт сообщил о подозрении. Предупреждение появилось у клиента.", "Сынақтағы сенімді адам күдігін хабарлады. Клиентке ескерту көрсетілді.");
    await snapshot("06-guardian.png");
  }
  await until(64);
  if (await dialog.locator(".cooling-start").isVisible()) await dialog.locator(".cooling-start").click();
  for (const [index, answer] of [false, false, false, true, true].entries()) {
    await dialog.locator(".cooling-choices input").nth(answer ? 0 : 1).check();
    await until(66 + index * 2);
    await dialog.locator(".cooling-next").click();
  }
  const resolution = await responseFor("/resolve-cooling", () => dialog.locator(".cooling-submit").click());
  if (simulator) {
    check(resolution.status === "blocked" && resolution.reasons.some(r => r.code === "TRUSTED_CONTACT_SUSPICION"), "contact signal prevents release after clean answers");
    chapter("Чистая анкета получена. Сигнал доверенного лица блокирует отправку.", "Сауалнама жауаптары қауіпсіз болғанымен, сенімді адамның сигналы аударымды бұғаттады.");
  } else {
    check(resolution.status === "cooling_off", "early clean answers preserve hold");
    await responseFor("/cancel", () => dialog.locator(".danger-button").click());
    chapter("Ответы сохранены. Клиент отменяет удерживаемый перевод.", "Жауаптар сақталды. Клиент кідіртілген аударымды тоқтатты.");
  }
  await center(page.locator(".phone-receipt"));
  await until(88);

  await page.locator(".receipt-new").click();
  await page.locator(".transfer-cta").click();
  const confirm = page.locator(".transfer-confirm");
  await center(confirm);
  const silent = await evaluate(async () => {
    const box = await confirm.boundingBox();
    assert.ok(box);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1750);
    await page.mouse.up();
  });
  check(silent.status === "blocked" && silent.reasons.some(r => r.code === "DURESS_SIGNAL"), "long press produces server duress block");
  await center(page.locator(".receipt-processing"));
  chapter("Тихий код. Клиент видит «В обработке», сервер блокирует перевод под давлением.", "Жасырын белгі. Клиент «Өңделуде» күйін көреді, сервер қысыммен жасалған аударымды бұғаттады.");
  await snapshot("07-duress.png");
  await until(105);
  const hub = await preset(2, "blocked");
  await page.locator("#tab-soc").click();
  const inspector = page.locator('.case-panel[data-transaction-id="' + hub.transaction_id + '"]');
  await inspector.locator(".ml-badge").waitFor();
  await page.locator(".react-flow__node").first().waitFor();
  const nodes = await page.locator(".react-flow__node").count();
  check(nodes > 0, "dropper network graph loaded");
  await center(page.locator(".react-flow").first());
  chapter("Дроп-счёт заблокирован. Сотрудник видит входящие связи получателя на графе.", "Дроп-шот бұғатталды. Қызметкер графтан алушының кіріс байланыстарын көреді.");
  await snapshot("03-soc.png");
  await until(120);
  const contributors = page.locator(".analysis-panel .contributors");
  await center(contributors);
  check((await contributors.locator("li").count()) > 0, "model exposes feature contributions");
  await snapshot("04-ml.png");
  chapter("В одной операции видны оценка модели и причины решения.", "Бір операцияда модель бағасы мен шешімнің себептері көрсетілген.");
  await until(132);
  await choose("ҚАЗ");
  await center(page.locator(".traffic-button"));
  await page.locator(".traffic-button").click();
  await page.waitForSelector(".traffic-button[aria-pressed=true]");
  await until(142);
  if (quick) await page.waitForTimeout(2000);
  await page.locator(".traffic-button[aria-pressed=true]").click();
  await snapshot("05-traffic.png");
  await choose("РУС");
  await center(inspector.locator(".police-report"));
  chapter("Из карточки дела сотрудник открывает справку с хронологией и доказательствами.", "Іс карточкасынан қызметкер оқиғалар реті мен дәлелдер көрсетілген анықтаманы ашады.");
  const [report] = await Promise.all([context.waitForEvent("page"), inspector.locator(".police-report").click()]);
  await report.waitForURL(url => url.href.startsWith("blob:" + target + "/"), { waitUntil: "domcontentloaded" });
  await report.getByText(hub.transaction_id, { exact: true }).waitFor();
  const reportUrl = report.url();
  check(reportUrl.startsWith("blob:" + target + "/") && (await report.locator("body").innerText()).includes(hub.transaction_id), "generated police statement matches transfer");
  // Playwright records each tab separately. Display the actual generated document in the filmed tab.
  await page.goto(reportUrl);
  await report.close();
  await page.locator("h1").waitFor();
  await snapshot("08-report.png");
  await until(165);
  check(errors.length === 0, "no browser or API errors: " + errors.join(", "));
  const duration = elapsed();
  const metadata = { recorded_at: new Date().toISOString(), synthetic: true, browser: browser.version(),
    executable: path.basename(process.env.CHROMIUM_EXECUTABLE || "chromium"), decisions,
    contact_signal: resolution.reasons.some(r => r.code === "TRUSTED_CONTACT_SUSPICION"),
    silent_transaction_id: silent.transaction_id, graph_nodes: nodes, printed_transaction_id: hub.transaction_id,
    api: "Live FastAPI, synthetic SQLite, fakeredis, local Telegram delivery double", assertions: checks, errors };
  if (quick) {
    await writeFile(path.join(output, "browser-qa.json"), JSON.stringify(metadata, null, 2) + "\n");
  } else {
    check(duration >= 150 && duration <= 180, "film duration fits the 2.5–3 minute target");
    await context.close();
    const videoPath = path.join(output, "Saq-Bol-demo.webm");
    await video.saveAs(videoPath);
    await video.delete();
    const sha256 = createHash("sha256").update(await readFile(videoPath)).digest("hex");
    await writeFile(path.join(output, "manifest.json"), JSON.stringify({ ...metadata, width: 1920,
      height: 1080, duration_seconds: duration, audio: false, sha256, screenshots, chapters: captions }, null, 2) + "\n");
    await verifyDemoFilm(output);
  }
} catch (error) {
  console.error("Screen:", await page.locator("body").innerText({timeout: 1500}).then(s=>s.slice(-600)).catch(()=>"unavailable"));
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
// A short-lived popup can leave Playwright's second FFmpeg pipe open on Windows.
// The primary film, subtitles and checks have all been awaited before this point.
process.exit(process.exitCode ?? 0);
