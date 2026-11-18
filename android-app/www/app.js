import { parseServer, rememberServer } from "./lib.mjs";

const TEXT = {
  kk: {
    title: "Демо-банкке қосылу", intro: "Ноутбуктағы SOC панеліндегі QR-кодты сканерлеңіз — аударымды осы телефоннан жасайсыз.",
    scan: "QR-кодты сканерлеу", or: "немесе мекенжайды енгізіңіз", addressLabel: "Ноутбук мекенжайы", connect: "Қосылу",
    recent: "Соңғы қосылымдар", openAnyway: "Бәрібір ашу", cancel: "Бас тарту",
    scanHint: "SOC панеліндегі QR-кодты рамкаға түсіріңіз",
    help1: "Телефон мен ноутбук бір Wi-Fi желісінде болуы керек.",
    help2: "Ноутбукта демо BCC_MOBILE_LAN=true және --hostname 0.0.0.0 арқылы іске қосылады.",
    help3: "SOC панелінде «Телефоннан ашу» батырмасын басыңыз — QR-код шығады.",
    fine: "Оқу прототипі. Нақты төлемдер орындалмайды.",
    checking: "Ноутбукты тексеріп жатырмыз…", opening: "Ашылуда…",
    empty: "Мекенжайды енгізіңіз.", invalid: "Мекенжай дұрыс емес. Мысалы: 192.168.1.23:3105",
    notLocal: "Тек жергілікті желідегі ноутбукқа қосылуға болады (192.168…, 10…, 172.16–31…).",
    unreachable: "Ноутбук жауап бермеді. Wi-Fi желісін және демо іске қосылғанын тексеріңіз.",
    camera: "Камераға рұқсат берілмеді. Мекенжайды қолмен енгізіңіз.", notQr: "Бұл QR-код BCC Shield демосына апармайды.",
  },
  ru: {
    title: "Подключение к демо-банку", intro: "Отсканируйте QR-код на панели SOC ноутбука — и делайте перевод с этого телефона.",
    scan: "Сканировать QR-код", or: "или введите адрес", addressLabel: "Адрес ноутбука", connect: "Подключить",
    recent: "Недавние подключения", openAnyway: "Всё равно открыть", cancel: "Отмена",
    scanHint: "Наведите рамку на QR-код в панели SOC",
    help1: "Телефон и ноутбук должны быть в одной Wi-Fi.",
    help2: "На ноутбуке демо запущено с BCC_MOBILE_LAN=true и --hostname 0.0.0.0.",
    help3: "В панели SOC нажмите «Открыть на телефоне» — появится QR-код.",
    fine: "Учебный прототип. Реальные платежи не выполняются.",
    checking: "Проверяем ноутбук…", opening: "Открываем…",
    empty: "Введите адрес.", invalid: "Неверный адрес. Например: 192.168.1.23:3105",
    notLocal: "Подключаться можно только к ноутбуку в локальной сети (192.168…, 10…, 172.16–31…).",
    unreachable: "Ноутбук не ответил. Проверьте Wi-Fi и что демо запущено.",
    camera: "Нет доступа к камере. Введите адрес вручную.", notQr: "Этот QR-код не ведёт на демо BCC Shield.",
  },
};
const store = { get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }, set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be disabled */ } } };
let lang = store.get("bcc-shield.app.lang", "kk") === "ru" ? "ru" : "kk";
let pending = null;
const $ = id => document.getElementById(id);
const t = key => TEXT[lang][key] ?? key;

function render() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-t]").forEach(el => { el.textContent = t(el.dataset.t); });
  document.querySelectorAll("[data-lang]").forEach(el => el.setAttribute("aria-pressed", String(el.dataset.lang === lang)));
  const recent = store.get("bcc-shield.app.recent", []);
  $("recent-wrap").hidden = !recent.length;
  $("recent").replaceChildren(...recent.map(label => { const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.textContent = label; b.onclick = () => connect(label); return b; }));
}
function status(key, tone = "") { const el = $("status"); el.textContent = key ? t(key) : ""; el.className = `status ${tone}`; }

async function reachable(origin) {
  // no-cors: an opaque response still proves the laptop answered on the Wi-Fi.
  try { await fetch(`${origin}/health`, { mode: "no-cors", cache: "no-store", signal: AbortSignal.timeout(4000) }); return true; } catch { return false; }
}
function open(target) {
  store.set("bcc-shield.app.recent", rememberServer(store.get("bcc-shield.app.recent", []), target.label));
  status("opening", "ok");
  window.location.href = target.url;
}
async function connect(input, fromQr = false) {
  const target = parseServer(input);
  $("force").hidden = true;
  if (target.error) { status(fromQr && target.error !== "notLocal" ? "notQr" : target.error, "error"); return; }
  status("checking");
  if (await reachable(target.origin)) return open(target);
  pending = target; status("unreachable", "error"); $("force").hidden = false;
}

let stream = null, timer = 0;
async function startScan() {
  status("");
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }); }
  catch { status("camera", "error"); return; }
  const video = $("video"); video.srcObject = stream; await video.play();
  $("scanner").hidden = false;
  const canvas = $("canvas"); const ctx = canvas.getContext("2d", { willReadFrequently: true });
  timer = setInterval(() => {
    if (video.readyState < 2) return;
    const w = Math.min(video.videoWidth, 720), h = Math.round(video.videoHeight * w / video.videoWidth);
    canvas.width = w; canvas.height = h; ctx.drawImage(video, 0, 0, w, h);
    const code = window.jsQR?.(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
    if (code?.data) { stopScan(); navigator.vibrate?.(40); void connect(code.data, true); }
  }, 180);
}
function stopScan() { clearInterval(timer); stream?.getTracks().forEach(track => track.stop()); stream = null; $("scanner").hidden = true; }

document.querySelectorAll("[data-lang]").forEach(el => el.addEventListener("click", () => { lang = el.dataset.lang; store.set("bcc-shield.app.lang", lang); render(); }));
$("scan").addEventListener("click", () => void startScan());
$("cancel").addEventListener("click", stopScan);
$("manual").addEventListener("submit", event => { event.preventDefault(); void connect($("address").value); });
$("force").addEventListener("click", () => { if (pending) open(pending); });
document.addEventListener("visibilitychange", () => { if (document.hidden && stream) stopScan(); });
render();
