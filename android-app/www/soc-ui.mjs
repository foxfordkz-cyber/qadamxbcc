// SOC workspace views (role "admin"). Layout follows the Saq Bol SOC Figma frames.
// Every value shown comes from the gateway; nothing here invents figures.
import { layoutNetwork } from "./network-graph.mjs";

const RU_MONTHS = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
const KK_MONTHS = ["қаңтар","ақпан","наурыз","сәуір","мамыр","маусым","шілде","тамыз","қыркүйек","қазан","қараша","желтоқсан"];
const clock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
function parts(value) {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return null;
  return Object.fromEntries(clock.formatToParts(instant).map(p => [p.type, p.value]));
}

const glyph = {
  home: '<rect x="3.5" y="3.5" width="7" height="7" rx="2.2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2.2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2.2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2.2"/>',
  cases: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6l2 2.2h7.4A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  socAnalytics: '<path d="M5 20v-7M10 20V5M15 20v-9M20 20v-5"/>',
  system: '<rect x="3" y="4" width="18" height="12" rx="2.5"/><path d="M12 16v4M8 20h8"/>',
  settings: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21c.6-4.2 3.6-6.5 7.5-6.5s6.9 2.3 7.5 6.5"/>',
  shield: '<path d="M12 2.8 4.5 5.6v5.6c0 4.8 3.2 8.6 7.5 10 4.3-1.4 7.5-5.2 7.5-10V5.6z"/><path d="m8.6 11.8 2.4 2.4 4.6-4.8"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  out: '<path d="M7 17 17 7M9 7h8v8"/>',
  down: '<path d="M12 5v14m-6-6 6 6 6-6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  projector: '<rect x="3" y="4" width="18" height="12" rx="2.5"/><path d="m9 20 3-4 3 4"/>',
  load: '<path d="M3 13h4l2.5-6 4 11 2.5-5H21"/>',
  staff: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-3.6 3-5.6 6.5-5.6s6 2 6.5 5.6"/><path d="M15.5 4.8a3.3 3.3 0 0 1 0 6.4M18 14.6c2 .6 3.3 2.4 3.6 5.4"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4"/>',
};
export const socIcon = (k, cls = "si") =>
  '<svg class="' + cls + '" viewBox="0 0 24 24" aria-hidden="true">' + (glyph[k] || glyph.arrow) + "</svg>";

export function socUI(ctx) {
  const { T, E, amount, status, label, caseState } = ctx;
  const lang = () => ctx.lang();
  const month = m => T(RU_MONTHS[m - 1] || "", KK_MONTHS[m - 1] || "");
  const today = () => {
    const p = parts(Date.now());
    return p ? (lang() === "ru" ? Number(p.day) + " " + month(Number(p.month)) + " " + p.year
      : p.year + " ж. " + Number(p.day) + " " + month(Number(p.month))) : "";
  };
  const time = (v, seconds = true) => { const p = parts(v); return p ? p.hour + ":" + p.minute + (seconds ? ":" + p.second : "") : "—"; };
  const longDate = v => {
    const p = parts(v); if (!p) return "—";
    return lang() === "ru" ? Number(p.day) + " " + month(Number(p.month)) + " " + p.year + ", " + p.hour + ":" + p.minute + ":" + p.second
      : p.year + " ж. " + Number(p.day) + " " + month(Number(p.month)) + ", " + p.hour + ":" + p.minute + ":" + p.second;
  };
  const dayMonth = v => { const p = parts(v); return p ? Number(p.day) + " " + month(Number(p.month)) + " · " + p.hour + ":" + p.minute : "—"; };
  const num = n => Number.isFinite(Number(n)) ? String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, " ") : "—";
  // Russian plural; Kazakh nouns stay singular after numbers.
  const plural = (n, one, few, many, kk) => {
    if (lang() !== "ru") return kk;
    const a = Math.abs(n) % 100, b = a % 10;
    return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
  };
  const shortName = full => {
    const words = String(full || "").trim().split(/\s+/).filter(Boolean);
    if (words.length < 2) return words[0] || "—";
    return words[0] + " " + Array.from(words[1])[0] + ".";
  };
  const initials = full => {
    const words = String(full || "?").trim().split(/\s+/).filter(w => /\p{L}/u.test(w));
    if (words.length >= 2) return words.slice(0, 2).map(w => Array.from(w)[0]).join("").toUpperCase();
    return Array.from(words[0] || String(full || "?")).slice(0, 3).join("");
  };
  const shortId = id => {
    const s = String(id || "");
    return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(s) ? s.slice(0, 8).toUpperCase() : s;
  };
  const caseNo = id => "SOC-" + shortId(id);
  const band = score => { const n = Number(score); return !Number.isFinite(n) ? "muted" : n >= 70 ? "bad" : n >= 40 ? "warn" : "good"; };
  const bandName = score => ({ bad: T("Высокий", "Жоғары"), warn: T("Средний", "Орташа"), good: T("Низкий", "Төмен"), muted: "—" })[band(score)];
  const statusTone = s => ({ approved: "good", cooling_off: "warn", blocked: "bad", cancelled: "muted" })[s] || "muted";
  // CSP forbids inline styles, so bar lengths are SVG attributes.
  const track = (v, cls = "") => '<svg class="sx-track ' + cls + '" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect class="bg" width="100" height="8" rx="4"/><rect class="fg" width="' +
    Math.max(0, Math.min(100, Number(v) || 0)).toFixed(1) + '" height="8" rx="4"/></svg>';
  const pill = (text, tone = "muted", extra = "") => '<span class="sx-pill ' + tone + '" ' + extra + ">" + text + "</span>";
  const disabled = () => ctx.loading() ? "disabled" : "";
  const card = (cls, body) => '<section class="sx-card ' + cls + '">' + body + "</section>";
  const layerName = l => ({ network: T("Сеть", "Желі"), graph: T("Сеть", "Желі"), behavior: T("Поведение", "Мінез-құлық"), behaviour: T("Поведение", "Мінез-құлық"),
    device: T("Устройство", "Құрылғы"), session: T("Сессия", "Сессия"), rules: T("Правило", "Ереже"), rule: T("Правило", "Ереже"), ml: "ML",
    amount: T("Сумма", "Сома"), call: T("Звонок", "Қоңырау"), registry: T("Реестр", "Тізілім") })[String(l || "").toLowerCase()] || E(l || "—");

  /* ---------- shell ---------- */
  const titles = () => ({
    home: T("Обзор", "Шолу"), detail: T("Перевод", "Аударым"), cases: T("Дела SOC", "SOC істері"), case: T("Дело", "Іс"),
    graph: T("Граф связей", "Байланыстар графы"), socAnalytics: T("Аналитика", "Талдау"), system: T("Система", "Жүйе"),
    settings: T("Профиль", "Профиль"), timeline: T("Хронология", "Хронология"), enrichment: T("Проверки", "Тексерулер"),
    reports: T("Обращения", "Өтініштер"), reportDetail: T("Обращение", "Өтініш"), gateway: T("Получатель", "Алушы"),
    notifications: T("Уведомления", "Хабарламалар"), inbox: T("Сообщения", "Хабарламалар"),
  });
  function shell({ page, navPage, nav, body, banners, openCases, dark, back, platform }) {
    const pageTitle = platform ? ({ home: T("Нагрузка", "Жүктеме"), staff: T("Доступ", "Рұқсат"), settings: T("Профиль", "Профиль") })[page] || T("Администратор", "Әкімші") : titles()[page] || "SOC";
    const icon = key => platform && key === "home" ? "load" : key;
    const who = platform ? T("Администратор платформы", "Платформа әкімшісі") : T("Сотрудник SOC", "SOC қызметкері");
    const navButtons = nav.map(([key, , text]) =>
      '<button data-nav="' + key + '" aria-current="' + (navPage === key ? "page" : "false") + '" ' + disabled() + ">" +
      socIcon(icon(key)) + "<span>" + E(text) + "</span>" +
      (key === "cases" && openCases > 0 ? '<b class="sx-count">' + num(openCases) + "</b>" : "") + "</button>").join("");
    const crumb = page === "detail" ? '<span class="sx-crumb">' + T("Лента операций", "Операциялар тізімі") + "</span>" : "";
    return '<div class="sx-shell">' +
      '<aside class="sx-side"><div class="sx-brand">' + socIcon("shield", "si brand-mark") + "<b>Saq Bol</b></div>" +
      '<small class="sx-place">' + (platform ? T("Администрирование платформы", "Платформаны басқару") : T("Рабочее место SOC", "SOC жұмыс орны")) + "</small>" +
      '<nav class="sx-nav" aria-label="' + T("Навигация", "Навигация") + '">' + navButtons + "</nav>" +
      '<div class="sx-side-foot"><p class="sx-secure">' + socIcon("shield") + T("Защищённая сессия", "Қорғалған сессия") + "</p>" +
      '<button class="sx-me" data-action="settings" ' + disabled() + '><img src="soc/avatar.webp" alt=""><span><b>' + who + "</b><small>" +
      T("Учебный стенд", "Оқу стенді") + "</small></span></button><small class=\"sx-legal\">Saq Bol × " + T("Банк ЦентрКредит", "Банк ЦентрКредит") + "</small></div></aside>" +
      '<div class="sx-body"><header class="sx-top">' +
      '<button class="back" data-action="back" aria-label="' + T("Назад", "Артқа") + '">' + socIcon("back") + crumb + "</button>" +
      '<div class="sx-mobile-brand"><b>Saq Bol</b><i>/</i><b>' + (platform ? "Admin" : "SOC") + '</b></div>' +
      '<h1 class="sx-page-title" tabindex="-1">' + E(back && page === "detail" ? T("Перевод", "Аударым") : pageTitle) + "</h1>" +
      '<span class="sx-chip sx-synthetic"><span class="wide">' + T("Синтетические данные", "Синтетикалық деректер") + '</span><span class="narrow">' + T("Демо · BCC", "Демо · BCC") + "</span></span>" +
      '<span class="sx-spacer"></span><span class="sx-date">' + E(today()) + "</span>" +
      '<button class="sx-tool" data-action="theme" aria-label="' + T("Тема оформления", "Түс тақырыбы") + '" ' + disabled() + ">" + socIcon(dark ? "moon" : "sun") + "</button>" +
      '<button class="sx-tool sx-lang" data-action="language" ' + disabled() + ">" + (lang() === "ru" ? "ҚАЗ" : "РУС") + "</button>" +
      '<button class="sx-avatar" data-action="settings" aria-label="' + T("Профиль", "Профиль") + '" ' + disabled() + '><img src="soc/avatar.webp" alt=""></button>' +
      "</header><main class=\"sx-main\">" + banners + body + "</main></div></div>";
  }

  /* ---------- overview ---------- */
  const periods = n => '<div class="sx-seg" role="group" aria-label="' + T("Период", "Кезең") + '">' + [7, 30, 90].map(v =>
    '<button data-days="' + v + '" aria-pressed="' + (v === n) + '" ' + disabled() + ">" + v + " " + T("дн.", "күн") + "</button>").join("") + "</div>";
  function home({ summary, feed, filter, query, offset, projector }) {
    const st = summary?.states || {}, cs = summary?.case_states || {};
    const closed = (cs.RESOLVED || 0) + (cs.CLOSED || 0);
    const open = Object.values(cs).reduce((a, b) => a + b, 0) - closed;
    const blocked = st.blocked || { count: 0, amount: 0 }, held = st.cooling_off || { count: 0, amount: 0 };
    const people = new Map();
    for (const row of feed?.items || []) for (const p of [row.sender, row.recipient]) if (p?.id) people.set(p.id, p.full_name);
    const signals = people.size;
    const hero = '<section class="sx-hero"><div class="sx-hero-text"><h2>' + T("Центр безопасности", "Қауіпсіздік орталығы") + "</h2><p>" +
      T("Риски под контролем", "Тәуекелдер бақылауда") + '<span class="wide">' + T(". Важное — перед вами.", ". Маңыздысы — алдыңызда.") + "</span></p>" +
      '<div class="sx-hero-actions">' + periods(summary?.days ?? ctx.days()) +
      '<button class="sx-projector" data-action="projector" aria-pressed="' + projector + '" ' + disabled() + ">" + socIcon("projector") +
      "<span>" + (projector ? T("Обычный вид", "Қалыпты көрініс") : T("Режим проектора", "Проектор режимі")) + "</span></button></div></div>" +
      '<img class="sx-hero-art" src="soc/hero.webp" alt=""></section>';
    const kpis = !summary ? "" : '<div class="sx-kpis">' +
      '<section class="sx-kpi"><h3>' + T("Отклонённые переводы", "Қабылданбаған аударымдар") + '</h3><strong class="bad">' + amount(blocked.amount) + '</strong><i class="bar bad"></i><small>' +
      num(blocked.count) + " " + plural(blocked.count, "перевод", "перевода", "переводов", "аударым") + " · " + num(summary.blocked_recipients) + " " +
      plural(summary.blocked_recipients, "получатель", "получателя", "получателей", "алушы") + "</small></section>" +
      '<section class="sx-kpi"><h3>' + T("На проверке", "Тексерілуде") + " · " + num(held.count) + " " + plural(held.count, "перевод", "перевода", "переводов", "аударым") +
      '</h3><strong class="warn">' + amount(held.amount) + '</strong><i class="bar warn"></i><small>' + T("Средства ещё не списаны", "Ақша әлі есептен шыққан жоқ") + "</small></section>" +
      '<button class="sx-kpi" data-action="cases" ' + disabled() + "><h3>" + T("Открытые дела", "Ашық істер") + " · " + num(open) + '</h3><strong class="good">' + T("К делам", "Істерге") + " " + socIcon("arrow") +
      '</strong><i class="bar good"></i><small>' + (cs.NEW ? T("Новых", "Жаңа") + ": " + num(cs.NEW) + " · " + T("ждут рассмотрения", "қарауды күтуде") : T("Новых дел нет", "Жаңа іс жоқ")) + "</small></button>" +
      '<details class="sx-kpi sx-net"><summary><h3>' + T("Участники в ленте", "Тізімдегі қатысушылар") + '</h3><strong class="good">' + num(signals) + " " +
      plural(signals, "клиент", "клиента", "клиентов", "клиент") + '</strong><small>' + T("Открыть связи", "Байланыстарды ашу") + '</small><img class="sx-kpi-art light" src="soc/search.webp" alt=""><img class="sx-kpi-art dark" src="soc/search-dark.webp" alt=""></summary>' +
      '<div class="sx-net-list">' + ([...people].map(([id, name]) => '<button data-graph="' + E(id) + '" ' + disabled() + "><i>" + E(initials(name)) + "</i>" + E(name) + socIcon("out") + "</button>").join("") ||
        "<p>" + T("В ленте пока нет участников.", "Тізімде әзірге қатысушы жоқ.") + "</p>") + "</div></details></div>";
    const chips = ["", "approved", "cooling_off", "blocked", "cancelled"].map(k =>
      '<button data-filter="' + k + '" aria-pressed="' + (k === filter) + '" ' + disabled() + ">" + (k ? E(status(k)) : T("Все", "Барлығы")) + "</button>").join("");
    const items = feed?.items || [];
    const rows = items.map(item => {
      const risk = Number(item.risk_score), ml = item.ml_score == null ? null : Number(item.ml_score);
      const attention = item.status === "cooling_off" || item.status === "blocked";
      return '<button class="sx-row" data-detail="' + E(item.transaction_id) + '" ' + disabled() + ">" +
        (attention ? '<i class="sx-dot" aria-hidden="true"></i>' : "") +
        '<span class="c-amount"><b>' + amount(item.amount) + "</b><small>" + E(shortId(item.transaction_id)) + "</small></span>" +
        '<span class="c-time">' + E(time(item.created_at)) + "</span>" +
        '<span class="c-who">' + E(shortName(item.sender?.full_name)) + " → " + E(shortName(item.recipient?.full_name)) + "</span>" +
        '<span class="c-status">' + pill(E(status(item.status)), statusTone(item.status)) + "</span>" +
        '<span class="c-risk">' + pill(T("Риск", "Тәуекел") + " " + (Number.isFinite(risk) ? risk : "—") + "/100", band(risk)) + "</span>" +
        '<span class="c-ml"><em>ML </em>' + (ml == null || !Number.isFinite(ml) ? "—" : Math.round(ml) + '<em class="wide">/100</em>') + "</span>" +
        '<span class="c-go">' + socIcon("arrow") + "</span></button>";
    }).join("");
    const total = Number(feed?.pagination?.total ?? feed?.total);
    const shown = items.length ? T("Показано", "Көрсетілді") + " " + (offset + 1) + "–" + (offset + items.length) +
      (Number.isFinite(total) ? " " + T("из", "/") + " " + num(total) : "") + " " + plural(total || items.length, "операции", "операций", "операций", "операция") : "";
    const pager = (offset ? '<button class="sx-link" data-action="prev" ' + disabled() + ">" + socIcon("back") + T("Назад", "Артқа") + "</button>" : "") +
      (feed?.pagination?.has_more || feed?.has_more ? '<button class="sx-link" data-action="next" ' + disabled() + ">" + T("Следующие операции", "Келесі операциялар") + socIcon("arrow") + "</button>" : "");
    const feedCard = '<section class="sx-card sx-feed"><div class="sx-feed-head"><h2>' + T("Лента операций", "Операциялар тізімі") + '</h2><span class="sx-live"><i></i><span>' +
      T("В реальном времени", "Нақты уақытта") + '</span></span><span class="sx-spacer"></span><span class="sx-sort">' + T("Сначала новые", "Алдымен жаңалары") + socIcon("down") + "</span></div>" +
      '<div class="sx-feed-tools"><div class="sx-chips">' + chips + '</div><form id="search-form" class="sx-search" role="search">' + socIcon("search") +
      '<input name="q" maxlength="128" value="' + E(query) + '" aria-label="' + T("Имя или ID", "Аты немесе ID") + '" placeholder="' + T("Имя или ID", "Аты немесе ID") + '"></form></div>' +
      (items.length ? '<div class="sx-table-head" aria-hidden="true"><span>' + T("Сумма / ID", "Сома / ID") + "</span><span>" + T("Отправитель → Получатель", "Жіберуші → Алушы") + "</span><span>" +
        T("Время", "Уақыт") + "</span><span>" + T("Статус", "Күйі") + "</span><span>" + T("Риск", "Тәуекел") + "</span><span>ML</span><span></span></div>" + '<div class="sx-rows">' + rows + "</div>"
        : '<div class="sx-empty"><h3>' + T("Пока нет операций", "Әзірге операциялар жоқ") + "</h3><p>" + T("Здесь появятся операции учебного стенда.", "Оқу стендінің операциялары осында көрінеді.") + "</p></div>") +
      '<div class="sx-feed-foot"><small>' + shown + '</small><span class="sx-spacer"></span>' + pager + "</div></section>";
    return hero + kpis + feedCard + (summary?.from ? '<p class="sx-note">' + T("По дате создания с", "Жасалған күні бойынша") + " " + E(summary.from) + " · UTC+5</p>" : "");
  }

  /* ---------- transfer ---------- */
  function ring(score, tone) {
    const v = Math.max(0, Math.min(100, Number(score) || 0));
    return '<svg class="sx-ring ' + tone + '" viewBox="0 0 120 120" aria-hidden="true"><circle class="track" cx="60" cy="60" r="52" pathLength="100"/>' +
      '<circle class="value" cx="60" cy="60" r="52" pathLength="100" stroke-dasharray="' + v + ' 100" transform="rotate(-90 60 60)"/></svg>';
  }
  function detail(tx, { timer, callEvidence }) {
    if (!tx) return "";
    const reasons = tx.reasons ?? [], contributors = (tx.ml_contributors ?? []).filter(c => Number.isFinite(Number(c.contribution)));
    const risk = Number(tx.risk_score), ml = tx.ml_score == null ? null : Number(tx.ml_score);
    const sender = tx.sender?.full_name || tx.sender?.display_name;
    const recipient = tx.recipient?.full_name || tx.recipient?.display_name;
    const held = tx.status === "cooling_off";
    const art = held || tx.status === "blocked" ? "soc/warning.webp" : "img3d/shield.webp";
    const headline = tx[lang() === "ru" ? "headline_ru" : "headline_kk"];
    const meta = [longDate(tx.created_at), tx.recipient?.iban_masked, tx.currency || "KZT"].filter(Boolean).map(E).join('<i aria-hidden="true">·</i>');
    const top = '<section class="sx-card sx-tx-hero"><div class="sx-tx-main"><small class="sx-eyebrow">' + T("Перевод", "Аударым") + " · " + E(shortId(tx.transaction_id)) + "</small>" +
      '<strong class="sx-tx-amount">' + amount(tx.amount) + "</strong>" +
      '<p class="sx-tx-parties">' + (sender ? E(sender) + socIcon("arrow") : "") + E(recipient || "—") + "</p><p class=\"sx-tx-meta\">" + meta + "</p></div>" +
      '<div class="sx-tx-state">' + pill(E(status(tx.status)), statusTone(tx.status)) +
      "<h3>" + (held ? T("Автоматическая пауза", "Автоматты кідіріс") : E(status(tx.status))) + "</h3>" + (headline ? "<p>" + E(headline) + "</p>" : "") +
      (held ? '<p class="sx-timer">' + T("До повторной проверки", "Қайта тексеруге дейін") + ' <b id="countdown" role="timer">' + E(timer) + "</b></p>" : "") + "</div>" +
      '<div class="sx-tx-art"><img src="' + art + '" alt=""></div></section>';
    const score = '<section class="sx-card sx-score"><div class="sx-card-head"><h2>' + T("Оценка риска", "Тәуекел бағасы") + "</h2>" + pill(bandName(risk), band(risk)) + "</div>" +
      '<div class="sx-score-body"><div class="sx-ring-wrap">' + ring(risk, band(risk)) + "<span><b>" + (Number.isFinite(risk) ? risk : "—") + "</b><small>" + T("из 100", "100-ден") + "</small></span></div>" +
      '<div class="sx-ml"><small>ML</small><b>' + (ml == null || !Number.isFinite(ml) ? "—" : Math.round(ml)) + "/100</b><small>" + T("Модель", "Модель") + " " + E(tx.ml_model_version || "—") + "</small></div></div>" +
      track(Number.isFinite(risk) ? risk : 0, "sx-meter " + band(risk)) +
      '<p class="sx-foot">' + T("Оценка модели, не вероятность мошенничества", "Модель бағасы, алаяқтық ықтималдығы емес") + "</p></section>";
    const why = '<section class="sx-card sx-why"><h2>' + (held ? T("Почему перевод на проверке", "Аударым неге тексерілуде") : T("Почему такое решение", "Шешім себептері")) + "</h2>" +
      (reasons.length ? '<div class="sx-why-head" aria-hidden="true"><span>' + T("Слой", "Қабат") + "</span><span>" + T("Сигнал и код", "Белгі мен код") + "</span><span>" + T("Вклад", "Үлес") + "</span></div>" +
        reasons.map(r => {
          const d = Number(r.score_delta);
          return '<div class="sx-why-row"><span class="sx-layer">' + layerName(r.layer) + "</span><span><b>" + E(r[lang() === "ru" ? "reason_ru" : "reason_kk"] || r.code) + "</b><small>" + E(r.code) + "</small></span>" +
            pill((d >= 0 ? "+" : "") + (Number.isFinite(d) ? d : "—"), d > 0 ? "warn" : "good") + "</div>";
        }).join("") : "<p>" + T("Дополнительные правила не сработали.", "Қосымша ережелер іске қосылған жоқ.") + "</p>") + "</section>";
    const top8 = contributors.slice().sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 6);
    const max = Math.max(1, ...top8.map(c => Math.abs(Number(c.contribution))));
    const fmt = v => { const n = Number(v); const r = Math.abs(n) >= 10 ? Math.round(n) : Math.round(n * 10) / 10; return (n >= 0 ? "+" : "−") + String(Math.abs(r)).replace(".", ","); };
    const model = '<section class="sx-card sx-model"><h2>' + T("Что повлияло на оценку модели", "Модель бағасына не әсер етті") + "</h2><p class=\"sx-sub\">" +
      T("Вклад признаков, баллы", "Белгілердің үлесі, балл") + (tx.ml_explanation_method ? " · " + E(tx.ml_explanation_method) : "") + "</p>" +
      (top8.length ? top8.map((c, i) => '<div class="sx-bar-row' + (Number(c.contribution) < 0 ? " neg" : "") + '"><span>' + E(c[lang() === "ru" ? "label_ru" : "label_kk"]) + '</span>' + track(Math.abs(Number(c.contribution)) / max * 100, "s" + Math.min(i, 3)) + '<b>' + fmt(c.contribution) + "</b></div>").join("")
        : "<p>" + T("Модель не передала объяснение.", "Модель түсіндірме жібермеді.") + "</p>") + "</section>";
    const tools = '<section class="sx-card sx-tools"><h2>' + T("Инструменты проверки", "Тексеру құралдары") + "</h2>" +
      (tx.recipient?.id ? '<button class="sx-tool-row primary-row" data-graph="' + E(tx.recipient.id) + '" ' + disabled() + "><span><b>" + T("Связи получателя", "Алушының байланыстары") + "</b><small>" + T("Граф и дроп-сеть", "Граф және дроп-желі") + "</small></span>" + socIcon("out") + "</button>" : "") +
      '<button class="sx-tool-row" data-action="timeline" ' + disabled() + "><span><b>" + T("Хронология", "Хронология") + "</b><small>" + T("События операции", "Операция оқиғалары") + "</small></span>" + socIcon("out") + "</button>" +
      '<button class="sx-tool-row" data-action="enrichment" ' + disabled() + "><span><b>" + T("Проверки и уведомления", "Тексерулер мен хабарламалар") + "</b><small>" + T("Учебный реестр и Telegram", "Оқу тізілімі және Telegram") + "</small></span>" + socIcon("out") + "</button>" +
      '<button class="sx-tool-row" data-action="refresh-detail" ' + disabled() + "><span><b>" + T("Обновить статус", "Күйін жаңарту") + "</b><small>" + E(tx.transaction_id) + "</small></span>" + socIcon("refresh") + "</button></section>";
    return top + '<div class="sx-grid g-score">' + score + why + "</div>" + '<div class="sx-grid g-model">' + model + tools + "</div>" + (callEvidence || "");
  }
  function callEvidence(text, log) {
    return '<section class="sx-card sx-call"><h2>' + T("Ответ клиента об этом переводе", "Аударым туралы клиенттің жауабы") + "</h2><p>" + E(text) + "</p>" + (log ? "<p class=\"sx-sub\">" + E(log) + "</p>" : "") + "</section>";
  }

  /* ---------- cases ---------- */
  const caseTone = s => ({ NEW: "good", IN_REVIEW: "warn", NEEDS_INFORMATION: "warn", ESCALATED: "bad", RESOLVED: "muted", CLOSED: "muted" })[s] || "muted";
  function cases({ data, queue, filter, offset, states, updated }) {
    const by = queue?.by_state || {};
    const count = k => Number(by[k] || 0);
    const open = ["NEW", "IN_REVIEW", "NEEDS_INFORMATION", "ESCALATED"].reduce((a, k) => a + count(k), 0);
    const wait = queue?.oldest_current_status_seconds?.NEW;
    const items = data?.items || [];
    const head = '<div class="sx-section-head"><div><h2>' + T("Обращения клиентов", "Клиент өтініштері") + "</h2><p>" + (queue ? num(open) + " " + plural(open, "открытое дело", "открытых дела", "открытых дел", "ашық іс") + " · " + num(count("NEW")) + " " +
      plural(count("NEW"), "новое", "новых", "новых", "жаңа") : T("Очередь загружается", "Кезек жүктелуде")) + '</p></div><button class="sx-link" data-action="reports" ' + disabled() + ">" + T("Все обращения", "Барлық өтініштер") + socIcon("arrow") + "</button></div>";
    const kpis = '<div class="sx-kpis three">' +
      '<section class="sx-kpi"><h3>' + T("Открытые дела", "Ашық істер") + "</h3><strong>" + (queue ? num(open) : "—") + "</strong><small>" +
      (count("NEW") ? T("Новых", "Жаңа") + ": " + num(count("NEW")) + (Number.isFinite(wait) ? " · " + T("до", "") + " " + num(Math.ceil(wait / 60)) + " " + T("мин", "мин") : "") : T("Новых нет", "Жаңа іс жоқ")) + "</small></section>" +
      '<section class="sx-kpi"><h3>' + T("В работе", "Қарастырылуда") + "</h3><strong>" + (queue ? num(count("IN_REVIEW") + count("ESCALATED")) : "—") + "</strong><small>" + T("Ответственный назначен", "Жауапты тағайындалған") + "</small></section>" +
      '<section class="sx-kpi"><h3>' + T("Ждём клиента", "Клиентті күтуде") + "</h3><strong>" + (queue ? num(count("NEEDS_INFORMATION")) : "—") + "</strong><small>" + T("Нужно уточнение", "Нақтылау қажет") + "</small></section></div>";
    const chips = '<div class="sx-chips sx-case-chips">' + [""].concat(Object.keys(states)).map(k => {
      const n = k ? count(k) : null;
      return '<button data-case-state="' + k + '" aria-pressed="' + (filter === k) + '" ' + disabled() + ">" + (k ? caseState(k) : T("Все", "Барлығы")) + (k && queue ? " · " + num(n) : "") + "</button>";
    }).join("") + "</div>";
    const search = '<label class="sx-search wide-search">' + socIcon("search") + '<input type="search" data-case-search maxlength="64" placeholder="' + T("Поиск по ID дела или категории", "Іс ID немесе санаты бойынша іздеу") + '" aria-label="' + T("Поиск дел", "Істерді іздеу") + '"></label>';
    const grid = items.length ? '<div class="sx-case-grid">' + items.map(c => {
      const who = c.client_name || c.customer_name || c.reporter_name;
      const tx = c.transaction_id ? E(shortId(c.transaction_id)) + (c.amount != null ? " · " + amount(c.amount) : "") : "";
      const owner = c.assignee ? '<span class="sx-owner"><i>' + E(initials(String(c.assignee).replace(/[_-]+/g, " "))) + "</i>" + E(c.assignee_name || c.assignee) + "</span>" : '<span class="sx-owner none">' + T("Не назначено", "Тағайындалмаған") + "</span>";
      return '<button class="sx-case" data-case="' + E(c.id) + '" data-search="' + E((caseNo(c.id) + " " + (who || "") + " " + label(c.category) + " " + (c.transaction_id || "")).toLowerCase()) + '" ' + disabled() + ">" +
        '<span class="sx-case-top"><b class="sx-case-id">' + E(caseNo(c.id)) + "</b>" + pill(caseState(c.state), caseTone(c.state)) + "</span>" +
        "<strong>" + E(who || label(c.category)) + "</strong>" + (tx ? '<span class="sx-case-tx">' + tx + socIcon("out") + "</span>" : "") +
        (who ? '<span class="sx-tag">' + E(label(c.category)) + "</span>" : "") +
        '<span class="sx-case-foot"><small>' + T("Создано", "Құрылды") + " " + E(dayMonth(c.created_at)) + (c.version ? " · v" + Number(c.version) : "") + "</small>" + owner + "</span></button>";
    }).join("") + "</div>" : '<div class="sx-card sx-empty"><h3>' + T("По этому фильтру дел нет", "Бұл сүзгі бойынша іс жоқ") + "</h3></div>";
    const pager = '<div class="sx-feed-foot"><small>' + T("Показано", "Көрсетілді") + " " + num(items.length) + " " + plural(items.length, "дело", "дела", "дел", "іс") + (updated ? " · " + T("обновлено в", "жаңартылды") + " " + E(updated) : "") + '</small><span class="sx-spacer"></span>' +
      (offset ? '<button class="sx-link" data-action="case-prev" ' + disabled() + ">" + socIcon("back") + T("Назад", "Артқа") + "</button>" : "") +
      (data?.has_more ? '<button class="sx-link" data-action="case-next" ' + disabled() + ">" + T("Ещё", "Тағы") + socIcon("arrow") + "</button>" : "") + "</div>";
    return head + kpis + search + chips + grid + pager;
  }

  /* ---------- graph ---------- */
  function diagram(graph, compact) {
    const nodes = graph?.nodes ?? [], edges = graph?.edges ?? [], visible = nodes.slice(0, 30);
    const { points, box } = layoutNetwork(visible);
    const r = compact ? 13 : 15;
    const roleClass = n => ["mule", "hub"].includes(n.data.role) ? n.data.role : "normal";
    const lines = edges.filter(e => points.has(e.source) && points.has(e.target)).map(e => {
      const a = points.get(e.source), b = points.get(e.target);
      const count = Number(e.data?.tx_count);
      return '<line data-edge="' + E(e.id) + '" class="' + (e.data?.highlight ? "evidence-edge" : "") + (e.data?.edge_type === "transfer" ? "" : " device-edge") + '" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '"/>' +
        (!compact && Number.isFinite(count) ? '<text class="edge-label" x="' + ((a.x + b.x) / 2) + '" y="' + ((a.y + b.y) / 2 - 3) + '" text-anchor="middle">' +
          (e.data?.edge_type === "transfer" ? count + " " + T("перев.", "аудар.") : T("устр.", "құрыл.")) + "</text>" : "");
    }).join("");
    const circles = visible.map(n => {
      const p = points.get(n.id);
      return '<g class="' + roleClass(n) + '"><circle cx="' + p.x + '" cy="' + p.y + '" r="' + r + '"/><text class="node-in" x="' + p.x + '" y="' + (p.y + 3.5) + '" text-anchor="middle">' + E(initials(n.data.label)) + "</text>" +
        (compact ? "" : '<text class="node-name" x="' + p.x + '" y="' + (p.y + r + 10) + '" text-anchor="middle">' + E(n.data.label) + "</text>") + "</g>";
    }).join("");
    const pad = compact ? 4 : 14;
    const vb = [box[0] - pad, box[1] - pad, box[2] + pad * 2, box[3] + pad * 2];
    return '<svg class="graph sx-graph-svg" tabindex="0" viewBox="' + vb.join(" ") + '" role="img" aria-label="' + T("Граф связей", "Байланыстар графы") + '">' + lines + circles + "</svg>";
  }
  function graph(data) {
    const nodes = data?.nodes ?? [], edges = data?.edges ?? [];
    const transfers = edges.filter(e => e.data?.edge_type === "transfer").length;
    const role = n => ({ mule: T("Дроп-счёт", "Дроп-шот"), hub: T("Узел сети", "Желі түйіні"), client: T("Клиент", "Клиент"), sender: T("Отправитель", "Жіберуші"),
      recipient: T("Получатель", "Алушы") })[n.data.role] || T("Счёт", "Шот");
    const side = '<section class="sx-card sx-accounts"><h2>' + T("Связанные счета", "Байланысты шоттар") + '</h2><p class="sx-sub">' + num(nodes.length) + " " + plural(nodes.length, "узел", "узла", "узлов", "түйін") + " · " +
      num(transfers) + " " + plural(transfers, "связь-перевод", "связи-перевода", "связей-переводов", "аударым байланысы") + "</p>" +
      nodes.map((n, i) => '<button class="sx-account ' + (["mule", "hub"].includes(n.data.role) || n.data.suspected_mule ? "risky" : "") + '" data-node-index="' + i + '" ' + disabled() + "><b>" + (i < 30 ? "" : "") + E(n.data.label) + "</b><small>" + E(role(n)) +
        " · " + T("вход./исх.", "кіріс/шығыс") + " " + num(n.data.in_degree) + "/" + num(n.data.out_degree) + "</small><em>" + (n.data.suspected_mule ? T("Подозрение на транзит", "Транзит күдігі") : T("Без признаков транзита", "Транзит белгісі жоқ")) +
        (Number(n.data.shared_device_accounts) ? " · " + T("общие устройства", "ортақ құрылғылар") + ": " + num(n.data.shared_device_accounts) : "") + "</em></button>").join("") +
      '<p class="sx-sub" id="node-detail" aria-live="polite"></p></section>';
    const main = '<section class="sx-card sx-graph"><div class="sx-legend"><span class="normal">' + T("Клиент", "Клиент") + '</span><span class="mule">' + T("Подозрение на транзит", "Транзит күдігі") + '</span><span class="hub">' + T("Хаб", "Хаб") + "</span></div>" +
      '<div class="sx-graph-canvas">' + diagram(data, false) + "</div>" +
      '<div class="sx-graph-tools"><button data-action="graph-shrink" aria-label="' + T("Уменьшить", "Кішірейту") + '" ' + disabled() + ">−</button><output id=\"graph-zoom-level\">100 %</output>" +
      '<button data-action="graph-zoom" aria-label="' + T("Увеличить", "Үлкейту") + '" ' + disabled() + ">+</button><button data-action=\"graph-fit\" " + disabled() + ">" + T("По размеру", "Өлшеміне қарай") + "</button>" +
      '<button data-action="graph-full" ' + disabled() + ">" + T("На весь экран", "Толық экран") + "</button></div>" +
      '<p class="sx-foot">' + T("Признаки дроп-сети — основание для проверки, а не доказательство вины. Показано до 30 узлов.", "Дроп-желі белгілері — тексеруге негіз, кінәнің дәлелі емес. 30 түйінге дейін көрсетіледі.") + "</p>" +
      '<label class="sx-select">' + T("Связь", "Байланыс") + '<select id="edge-focus"><option value="">—</option>' + edges.filter(e => nodes.slice(0, 30).some(n => n.id === e.source) && nodes.slice(0, 30).some(n => n.id === e.target)).map(e =>
        '<option value="' + E(e.id) + '">' + E(nodes.find(n => n.id === e.source)?.data.label) + " → " + E(nodes.find(n => n.id === e.target)?.data.label) + "</option>").join("") + "</select></label>" +
      '<p class="sx-sub" id="edge-detail" aria-live="polite"></p><div id="graph-records" class="sx-records" aria-live="polite"></div></section>';
    return '<div class="sx-section-head"><div><h2>' + T("Связи получателя", "Алушының байланыстары") + "</h2></div><small>" + T("Учебный реестр · глубина 2", "Оқу тізілімі · тереңдік 2") + "</small></div>" +
      '<div class="sx-grid g-graph">' + main + side + "</div>";
  }

  /* ---------- case ---------- */
  const flow = ["NEW", "IN_REVIEW", "NEEDS_INFORMATION", "CLOSED"];
  function caseView({ data, events, tx, evidence, network, actions, closeForm, callback }) {
    if (!data) return "";
    const at = flow.indexOf(data.state === "RESOLVED" ? "CLOSED" : data.state === "ESCALATED" ? "IN_REVIEW" : data.state);
    const stepper = '<ol class="sx-steps">' + flow.map((k, i) => '<li class="' + (i < at ? "done" : i === at ? "now " + caseTone(k) : "") + '"><span>' + caseState(k) + "</span></li>").join("") + "</ol>";
    const head = '<section class="sx-card sx-case-head"><div><h2>' + E(caseNo(data.id)) + " · " + E(data.client_name || label(data.category)) + "</h2>" + stepper +
      '<p class="sx-sub">' + E(dayMonth(data.created_at)) + " · v" + Number(data.version) + " · " + E(data.assignee ?? T("Не назначено", "Тағайындалмаған")) +
      (data.state === "ESCALATED" ? " · " + caseState("ESCALATED") : "") + "</p></div>" +
      (data.state === "NEW" ? '<button class="sx-primary" data-action="case-review" ' + disabled() + ">" + T("Взять в рассмотрение", "Қарауға алу") + "</button>" : "") + "</section>";
    const statement = data.description ? card("sx-statement", "<h2>" + T("Заявление клиента", "Клиент өтініші") + "</h2><p>" + E(data.description) + "</p>" + (data.category ? '<span class="sx-flag">' + E(label(data.category)) + "</span>" : "")) : "";
    const linked = tx ? card("sx-linked", "<h2>" + T("Связанный перевод", "Байланысты аударым") + " " + socIcon("out") + "</h2>" +
      '<button class="sx-linked-row" data-detail="' + E(tx.transaction_id) + '" ' + disabled() + "><span>" + E(shortId(tx.transaction_id)) + "</span><span>" +
      E(shortName(tx.sender?.full_name || tx.sender?.display_name)) + (tx.sender ? " → " : "") + E(shortName(tx.recipient?.display_name)) + "</span><b>" + amount(tx.amount) + "</b>" + pill(bandName(tx.risk_score), band(tx.risk_score)) + "</button>" +
      '<p class="sx-sub">' + E(time(tx.created_at)) + " · " + E(status(tx.status)) + (tx.recipient?.iban_masked ? " · " + E(tx.recipient.iban_masked) : "") + "</p>" +
      '<p class="sx-sub">' + E(ctx.moneyOutcome(tx.status)) + "</p>") : "";
    const reasons = tx?.reasons ?? [];
    const fact = r => '<li><b>' + E(T(r.reason_ru, r.reason_kk) || r.code) + "</b><small>" + layerName(r.layer) + " · " + E(r.code) + " · " + (Number(r.score_delta) >= 0 ? "+" : "") + E(r.score_delta) +
      (r.evidence?.recorded_at ? " · " + E(time(r.evidence.recorded_at, false)) : "") + "</small></li>";
    const up = reasons.filter(r => r.score_delta > 0), down = reasons.filter(r => r.score_delta < 0);
    const ledger = evidence?.recipient_ledger;
    const proof = tx ? card("sx-proof", "<h2>" + T("Доказательства", "Дәлелдер") + "</h2>" +
      '<div class="sx-proof-box"><h3>' + T("Поддерживает подозрение", "Күдікті күшейтеді") + "</h3>" + (up.length ? "<ul>" + up.map(fact).join("") + "</ul>" : "<p>" + T("Усиливающих факторов в расчёте нет.", "Есепте күдікті күшейтетін белгі жоқ.") + "</p>") + "</div>" +
      '<div class="sx-proof-box"><h3>' + T("Ослабляет подозрение", "Күдікті әлсіретеді") + "</h3>" + (down.length ? "<ul>" + down.map(fact).join("") + "</ul>" : "<p>" + T("Снижающих риск факторов в расчёте нет.", "Есепте тәуекелді азайтатын белгі жоқ.") + "</p>") + "</div>" +
      '<div class="sx-proof-box"><h3>' + T("Ответ клиента о давлении", "Клиенттің қысым туралы жауабы") + "</h3><p>" + (!tx.context?.call_pressure_answer ? T("Не зарегистрирован.", "Тіркелмеген.") : T("Зарегистрирован со слов клиента.", "Клиенттің сөзімен тіркелген.")) + "</p></div>" +
      (ledger ? '<div class="sx-proof-box"><h3>' + T("Выписка получателя за 24 часа до перевода", "Аударымға дейінгі 24 сағаттағы алушы үзіндісі") + "</h3>" +
        (ledger.items?.length ? ledger.items.map(row => '<button class="sx-ledger-row" data-detail="' + E(row.transaction_id) + '" ' + disabled() + "><b>" + (row.direction === "incoming" ? T("Зачисление", "Түсім") : T("Списание", "Шығыс")) + " · " + amount(row.amount) +
          "</b><small>" + E(dayMonth(row.settled_at)) + " · " + E(String(row.transaction_id).slice(-8)) + "</small></button>").join("") + (ledger.has_more ? "<p>" + T("Показаны последние 8 операций.", "Соңғы 8 операция көрсетілді.") + "</p>" : "")
          : "<p>" + T("Исполненных переводов по счёту получателя нет.", "Алушы шоты бойынша орындалған аударым жоқ.") + "</p>") + "</div>" : "")) : "";
    const net = network ? card("sx-case-net", "<h2>" + T("Связи получателя", "Алушының байланыстары") + '</h2><div class="sx-graph-canvas small">' + diagram(network, true) + "</div>" +
      '<p class="sx-sub">' + T("Клиент → получатель → связанные счета", "Клиент → алушы → байланысты шоттар") + "</p>" +
      '<button class="sx-soft" data-graph="' + E(tx.recipient.id) + '" ' + disabled() + ">" + T("Открыть граф связей", "Байланыстар графын ашу") + " " + socIcon("out") + "</button>") : "";
    const timeline = card("sx-events", "<h2>" + T("Хронология событий", "Оқиғалар хронологиясы") + "</h2>" + (events.length ? '<ol class="sx-timeline">' + events.map(e =>
      "<li><time>" + E(time(e.timestamp, false)) + "</time><span><b>" + E(e[lang() === "ru" ? "description_ru" : "description_kk"]) + "</b>" + (e.outcome ? "<small>" + e.outcome + "</small>" : "") + "</span></li>").join("") + "</ol>"
      : "<p>" + T("Событий пока нет.", "Әзірге оқиға жоқ.") + "</p>"));
    const work = actions ? card("sx-actions", "<h2>" + T("Работа с делом", "Іспен жұмыс") + "</h2>" + actions) : "";
    const cb = callback ? '<section class="sx-card sx-callback">' + callback + "</section>" : "";
    return head + '<div class="sx-grid g-case"><div class="sx-col">' + statement + linked + proof + cb + closeForm + "</div><div class=\"sx-col\">" + net + timeline + work + "</div></div>" +
      '<p class="sx-note">' + T("Действия фиксируются в журнале. Это не решение банка.", "Әрекеттер журналда сақталады. Бұл банк шешімі емес.") + " · " + E(data.id) + "</p>";
  }

  /* ---------- analytics ---------- */
  function lineChart(series, days) {
    const width = days <= 7 ? 1 : days <= 30 ? 3 : 7;
    const groups = [];
    for (let i = 0; i < series.length; i += width) {
      const rows = series.slice(i, i + width);
      const sum = k => rows.reduce((a, r) => a + Number(r.states?.[k] || 0), 0);
      groups.push({ day: rows[0].day, held: sum("cooling_off"), blocked: sum("blocked") });
    }
    if (!groups.length) return '<p class="sx-empty">' + T("Нет данных за период", "Кезең бойынша дерек жоқ") + "</p>";
    const max = Math.max(4, ...groups.map(g => Math.max(g.held, g.blocked)));
    const step = Math.pow(10, Math.floor(Math.log10(max))) / (max / Math.pow(10, Math.floor(Math.log10(max))) > 5 ? 0.5 : max / Math.pow(10, Math.floor(Math.log10(max))) > 2 ? 1 : 2);
    const top = Math.ceil(max / step) * step;
    const W = 600, H = 220, L = 46, B = 24, R = 10, Tp = 10;
    const x = i => groups.length === 1 ? (L + W - R) / 2 : L + i * (W - L - R) / (groups.length - 1);
    const y = v => Tp + (H - Tp - B) * (1 - v / top);
    const grid = [];
    for (let v = 0; v <= top + 1e-9; v += step) grid.push('<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text x="' + (L - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + num(v) + "</text>");
    const path = k => groups.map((g, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(g[k]).toFixed(1)).join(" ");
    const dots = k => groups.map((g, i) => '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(g[k]).toFixed(1) + '" r="3"><title>' + E(g.day) + ": " + g[k] + "</title></circle>").join("");
    const every = Math.ceil(groups.length / 8);
    const labels = groups.map((g, i) => i % every === 0 || i === groups.length - 1 ? '<text x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="middle">' + Number(g.day.slice(8, 10)) + "</text>" : "").join("");
    return '<svg class="sx-chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + T("Динамика решений", "Шешімдер динамикасы") + '"><g class="grid">' + grid.join("") + "</g>" +
      '<path class="l1" d="' + path("held") + '"/><path class="l2" d="' + path("blocked") + '"/><g class="d1">' + dots("held") + '</g><g class="d2">' + dots("blocked") + '</g><g class="axis">' + labels + "</g></svg>";
  }
  function analytics(d) {
    if (!d) return "";
    const st = d.states || {};
    const total = Object.values(st).reduce((a, v) => a + Number(v?.count || 0), 0);
    const held = Number(st.cooling_off?.count || 0);
    const share = total ? (held / total * 100) : null;
    const pct = v => v == null ? "—" : String(Math.round(v * 100) / 100).replace(".", ",") + " %";
    const series = d.series || [];
    const first = series[0]?.day, last = series.at(-1)?.day;
    const range = first && last ? Number(first.slice(8, 10)) + (first.slice(5, 7) !== last.slice(5, 7) ? " " + month(Number(first.slice(5, 7))) : "") + "–" + Number(last.slice(8, 10)) + " " + month(Number(last.slice(5, 7))) + " " + last.slice(0, 4) : "";
    const review = d.policy_comparison;
    const cov = review?.label_coverage == null ? null : Math.max(0, Math.min(1, Number(review.label_coverage)));
    const cs = d.case_states || {};
    const closed = (cs.RESOLVED || 0) + (cs.CLOSED || 0);
    const head = '<div class="sx-section-head"><div><h2>' + T("Качество решений", "Шешімдер сапасы") + '</h2></div><div class="sx-head-side"><small class="sx-range">' + E(range) + (range ? " · " : "") + d.days + " " + T("дн.", "күн") + "</small>" + periods(d.days) + "</div></div>";
    const kpis = '<div class="sx-kpis three stack">' +
      '<section class="sx-kpi"><h3>' + T("Проверено переводов", "Тексерілген аударымдар") + "</h3><strong>" + num(total) + "</strong><small>" + T("Синтетическая выборка", "Синтетикалық іріктеме") + "</small></section>" +
      '<section class="sx-kpi"><h3>' + T("Доля пауз", "Кідірістер үлесі") + "</h3><strong>" + pct(share) + "</strong><small>" + num(held) + " " + plural(held, "перевод", "перевода", "переводов", "аударым") + " · " + d.days + " " + T("дн.", "күн") + "</small></section>" +
      '<section class="sx-kpi"><h3>' + T("Оценка движком · среднее", "Қозғалтқыш бағасы · орташа") + "</h3><strong>" + (d.mean_engine_ms == null ? "—" : String(Math.round(Number(d.mean_engine_ms) * 10) / 10).replace(".", ",") + " " + T("мс", "мс")) + "</strong><small>" +
      T("Завершённые дела", "Аяқталған істер") + " · " + num(closed) + "</small></section></div>";
    const chart = card("sx-trend", "<h2>" + T("Динамика решений", "Шешімдер динамикасы") + '</h2><div class="sx-legend line"><span class="l1">' + T("Пауза", "Кідіріс") + '</span><span class="l2">' + T("Отклонено", "Қабылданбады") + "</span></div>" +
      lineChart(series, d.days) + '<p class="sx-foot">' + T("Количество переводов по дате создания", "Жасалған күні бойынша аударымдар саны") + "</p>");
    const donut = card("sx-coverage", "<h2>" + T("Покрытие разметкой", "Белгіленген үлес") + "</h2>" + (cov == null ? "<p>" + T("Разметки пока нет.", "Әзірге белгі жоқ.") + "</p>" :
      '<div class="sx-ring-wrap big">' + ring(cov * 100, "good") + "<span><b>" + Math.round(cov * 100) + " %</b><small>" + T("размечено", "белгіленді") + "</small></span></div>" +
      '<p class="sx-legend-line"><i></i>' + Math.round(cov * 100) + " % " + T("размечено", "белгіленді") + " · " + (100 - Math.round(cov * 100)) + " % " + T("ожидает", "күтуде") + "</p>" +
      '<p class="sx-sub">' + T("Подтверждено мошеннических", "Алаяқтық расталды") + " · " + num(review.fraud_labelled) + " · " + T("законных", "заңды") + " · " + num(review.legitimate_labelled) + "</p>"));
    const policies = review?.policies?.length ? card("sx-policy", "<h2>" + T("Сравнение политик", "Саясаттарды салыстыру") + '</h2><p class="sx-sub">' + T("Сравнили исходные решения", "Бастапқы шешімдер салыстырылды") + " · " + num(review.evaluated) + " / " + num(review.sampled) + "</p>" +
      '<div class="sx-table-wrap"><table class="sx-table"><thead><tr><th>' + T("Порог", "Шек") + "</th><th>" + T("Доп. паузы", "Қосымша кідіріс") + "</th><th>" + T("Пропуск фрода", "Өткізілген алаяқтық") + "</th><th>" + T("Ложные паузы на 1 000", "1 000-ға қате кідіріс") + "</th></tr></thead><tbody>" +
      review.policies.map(r => '<tr class="' + (r.threshold === null ? "current" : "") + '"><th>' + (r.threshold === null ? T("Текущая", "Қазіргі") : "≥ " + E(r.threshold)) + "</th><td>" + (review.evaluated ? num(r.extra_holds) : "—") + "</td><td>" + num(r.missed_fraud) + "</td><td>" +
        (Number.isFinite(Number(r.false_per_1000_legitimate)) ? String(Math.round(r.false_per_1000_legitimate * 10) / 10).replace(".", ",") : "—") + "</td></tr>").join("") + "</tbody></table></div>" +
      '<p class="sx-foot">' + T("Пороги моделируют дополнительные паузы поверх действующих мер. «—» — данных нет.", "Шектер қолданыстағы шараларға қосымша кідірісті модельдейді. «—» — дерек жоқ.") + "</p>") : "";
    const p95 = card("sx-p95", "<h2>" + T("Задержка решения · p95", "Шешім кідірісі · p95") + "</h2><strong>" + (d.p95_engine_ms == null ? "—" : String(Math.round(Number(d.p95_engine_ms) * 10) / 10).replace(".", ",") + " " + T("мс", "мс")) + "</strong>" +
      (d.latency_sample_size != null ? track(Number(d.latency_sample_size) / Math.max(1, Number(d.latency_sample_limit) || 1) * 100, "sx-meter good") + '<p class="sx-sub">' +
        num(d.latency_sample_size) + " " + T("замеров за период", "өлшем") + " · " + T("лимит", "шегі") + " " + num(d.latency_sample_limit) + "</p>" : "") +
      '<p class="sx-sub">' + T("Время оценки движком, без сети", "Желісіз қозғалтқыш бағалау уақыты") + "</p>");
    const decisions = card("sx-decisions", "<h2>" + T("Решения по операциям", "Операциялар бойынша шешімдер") + "</h2>" + Object.entries(st).map(([k, v]) =>
      '<div class="sx-decision">' + pill(E(status(k)), statusTone(k)) + "<b>" + num(v.count) + "</b><span>" + amount(v.amount) + "</span></div>").join(""));
    const outcomes = d.hold_outcomes;
    const outcomePanel = outcomes ? card("sx-decisions", "<h2>" + T("Исходы удержанных переводов", "Кідіртілген аударымдардың нәтижесі") + "</h2><p>" +
      T("Дело SOC и отмена могут относиться к одному удержанию. Ложные паузы считаются по подтверждённым исходам.",
        "SOC ісі мен бас тарту бір аударымға қатысты болуы мүмкін. Адал төлемдер расталған нәтижелер бойынша саналады.") + "</p>" +
      outcomes.rows.map(row => '<div class="sx-decision"><span>' + E(T(row.ru, row.kk)) + "</span><b>" + (row.value == null ? "—" : Number(row.value).toLocaleString(T("ru-KZ","kk-KZ"), {maximumFractionDigits: 2})) + "</b></div>").join("") +
      '<a download="soc-' + Number(d.days) + '.csv" href="data:text/csv;charset=utf-8,' + E(encodeURIComponent("\uFEFF" + outcomes.csv)) + '">' + T("Скачать CSV", "CSV жүктеп алу") + "</a>") : "";
    return head + kpis + outcomePanel + '<div class="sx-grid g-analytics">' + chart + donut + "</div>" + '<div class="sx-grid g-analytics">' + (policies || decisions) + '<div class="sx-col">' + p95 + (policies ? decisions : "") + "</div></div>" +
      '<p class="sx-note">' + T("По дате создания с", "Жасалған күні бойынша") + " " + E(d.from || "—") + " · UTC+5</p>";
  }

  /* ---------- system ---------- */
  function system(d) {
    const keys = ["database", "redis", "worker", "telegram", "gateway"];
    const good = v => ["ok", "healthy", "up", "ready", "available", "connected"].includes(String(v || "").toLowerCase());
    const known = keys.filter(k => d?.[k] != null);
    const okCount = known.filter(k => good(d[k])).length;
    const allOk = known.length > 0 && okCount === known.length;
    const queued = Number(d?.queue?.notifications_queued ?? 0), failed = Number(d?.queue?.notifications_failed ?? 0);
    const head = '<div class="sx-section-head"><div><h2>' + (!d ? T("Получаем состояние…", "Күйі алынуда…") : allOk ? T("Все основные сервисы доступны", "Барлық негізгі қызметтер қолжетімді") :
      T("Есть сервисы с ограничениями", "Шектеулі қызметтер бар")) + '</h2></div><small class="sx-updated ' + (allOk ? "good" : "warn") + '"><i></i>' + T("Обновлено в", "Жаңартылды") + " " + E(d?.checked_at ? time(d.checked_at, false) : "—") + "</small></div>";
    const kpis = '<div class="sx-kpis three stack">' +
      '<section class="sx-kpi"><div class="sx-kpi-row"><h3>' + T("Очередь уведомлений", "Хабарламалар кезегі") + "</h3>" + pill(queued ? T("В очереди", "Кезекте") : T("Пусто", "Бос"), "good") + '</div><strong class="good">' + num(queued) + "</strong><small>" + T("Ожидают отправки", "Жіберуді күтуде") + "</small></section>" +
      '<section class="sx-kpi"><div class="sx-kpi-row"><h3>' + T("Ошибки доставки", "Жеткізу қателері") + "</h3>" + pill(failed ? T("Требуют внимания", "Назар қажет") : T("Нет", "Жоқ"), failed ? "warn" : "good") + '</div><strong class="' + (failed ? "warn" : "good") + '">' + num(failed) + "</strong><small>" + T("Учебный канал уведомлений", "Оқу хабарлама арнасы") + "</small></section>" +
      '<section class="sx-kpi"><div class="sx-kpi-row"><h3>' + T("Сервисы", "Қызметтер") + "</h3>" + pill(allOk ? T("Доступны", "Қолжетімді") : T("Есть сбои", "Ақау бар"), allOk ? "good" : "warn") + '</div><strong class="' + (allOk ? "good" : "warn") + '">' + num(okCount) + " / " + num(known.length) + "</strong><small>" +
      known.map(k => E(label(k))).join(", ") + "</small></section></div>";
    const list = card("sx-links", "<h2>" + T("Подключения", "Қосылымдар") + "</h2>" + keys.map(k => '<div class="sx-link-row ' + (d?.[k] == null ? "muted" : good(d[k]) ? "good" : "warn") + '"><b><i></i>' + E(label(k)) + "</b><small>" + E(d?.[k] == null ? "—" : label(d[k])) + "</small></div>").join("") +
      '<div class="sx-callout"><b>' + T("Настоящие провайдеры не опрашиваются", "Нақты провайдерлер сұралмайды") + "</b><small>" + T("Проверка", "Тексеру") + " · " + E(d?.checked_at ? dayMonth(d.checked_at) : "—") + "</small></div>" +
      '<button class="sx-soft" data-action="system" ' + disabled() + ">" + socIcon("refresh") + T("Обновить", "Жаңарту") + "</button>");
    return head + kpis + '<div class="sx-grid g-system">' + list + "</div>" + '<p class="sx-note">' + T("Синтетические данные · Диагностика не влияет на решения банка.", "Синтетикалық деректер · Диагностика банк шешімдеріне әсер етпейді.") + "</p>";
  }

  /* ---------- profile ---------- */
  function profile({ remember, dark, origin, platform, edition }) {
    const row = (act, title, value, extra = "") => '<button class="sx-set-row" data-action="' + act + '" ' + extra + " " + disabled() + "><span>" + title + "</span>" + value + "</button>";
    return '<section class="sx-card sx-profile"><img src="soc/avatar.webp" alt=""><div><h2>' + (platform ? T("Администратор платформы", "Платформа әкімшісі") : T("Сотрудник SOC", "SOC қызметкері")) + "</h2><p>" +
      T("Роль назначена сервером. Сессия действует 30 минут, затем нужен повторный вход.", "Рөлді сервер тағайындады. Сессия 30 минутқа жарамды, содан кейін қайта кіру қажет.") + '</p><small>Saq Bol × BCC ' + E(edition) + ' · ' + E(origin) + "</small></div></section>" +
      card("sx-settings", "<h2>" + T("Настройки", "Баптаулар") + "</h2>" +
        row("remember-settings", T("Сохранённый вход", "Сақталған кіру"), '<b class="sx-switch" aria-hidden="true"></b>', 'role="switch" aria-checked="' + !!remember + '"') +
        row("theme", T("Тёмная тема", "Қараңғы тақырып"), '<b class="sx-switch" aria-hidden="true"></b>', 'role="switch" aria-checked="' + !!dark + '"') +
        row("language", T("Язык", "Тіл"), "<em>" + T("Русский", "Қазақша") + "</em>")) +
      '<button class="sx-danger" data-action="logout" ' + disabled() + ">" + T("Выйти из аккаунта", "Аккаунттан шығу") + "</button>";
  }

  /* ---------- platform administrator ---------- */
  const unavailable = () => '<section class="sx-card sx-empty"><h3>' + T("Метрики пока недоступны", "Метрикалар әзірге қолжетімсіз") + "</h3><p>" +
    T("Сервер не вернул данные. Попробуйте ещё раз.", "Сервер дерек қайтармады. Қайталап көріңіз.") + '</p><button class="sx-soft" data-nav="home" ' + disabled() + ">" + socIcon("refresh") + T("Повторить", "Қайталау") + "</button></section>";
  function metrics(v) {
    const hero = '<section class="sx-hero"><div class="sx-hero-text"><h2>' + T("Нагрузка API", "API жүктемесі") + "</h2><p>" +
      T("Проверки переводов за 15 минут", "15 минуттағы аударым тексерулері") + '<span class="wide">' + T(", включая повторные запросы.", ", қайталанған сұраулармен қоса.") + "</span></p>" +
      '<div class="sx-hero-actions"><button class="sx-projector sx-refresh" data-nav="home" ' + disabled() + ">" + socIcon("refresh") + "<span>" + T("Обновить", "Жаңарту") + "</span></button>" +
      '<small class="sx-hero-note">' + T("Обновляется каждые 3 секунды", "Әр 3 секунд сайын жаңарады") + "</small></div></div>" +
      '<img class="sx-hero-art" src="soc/hero.webp" alt=""></section>';
    if (v?.scope !== "wallet_transfer_api" || !Array.isArray(v.buckets)) return hero + unavailable();
    const p95 = v.p95_overflow ? T("Более 30 с", "30 с артық") : Number.isFinite(Number(v.p95_upper_ms)) && v.p95_upper_ms !== null ? "≤ " + num(v.p95_upper_ms) + " " + T("мс", "мс") : "—";
    const errors = Number(v.server_errors) || 0, limited = Number(v.rate_limited) || 0;
    const kpi = (title, value, tone, note) => '<section class="sx-kpi"><h3>' + title + '</h3><strong class="' + tone + '">' + value + '</strong><i class="bar ' + tone + '"></i><small>' + note + "</small></section>";
    const kpis = '<div class="sx-kpis">' +
      kpi(T("Всего запросов", "Барлық сұраулар"), num(v.requests), "good", T("За последние 15 минут", "Соңғы 15 минутта")) +
      kpi(T("Лимит частоты · 429", "Жиілік шегі · 429"), num(limited), limited ? "warn" : "good", T("Отклонены из-за частоты", "Жиілікке байланысты қабылданбады")) +
      kpi(T("Ошибки сервера · 5xx", "Сервер қателері · 5xx"), num(errors), errors ? "bad" : "good", errors ? T("Требуют внимания", "Назар қажет") : T("Ошибок нет", "Қате жоқ")) +
      kpi(T("Ответ API · p95", "API жауабы · p95"), E(p95), v.p95_overflow ? "bad" : "good", T("95% запросов быстрее", "Сұраулардың 95%-ы жылдамырақ")) + "</div>";
    const b = v.buckets;
    const max = Math.max(1, ...b.map(x => Number(x.requests) || 0));
    const W = 600, H = 200, L = 40, B = 26, Tp = 8, slot = (W - L - 6) / Math.max(1, b.length), bw = Math.max(4, slot * 0.62);
    const y = val => Tp + (H - Tp - B) * (1 - val / max);
    const grid = [0, 0.5, 1].map(f => '<line x1="' + L + '" x2="' + W + '" y1="' + y(max * f) + '" y2="' + y(max * f) + '"/><text x="' + (L - 8) + '" y="' + (y(max * f) + 4) + '" text-anchor="end">' + num(max * f) + "</text>").join("");
    const bars = b.map((x, i) => {
      const r = Number(x.requests) || 0, e = Math.min(r, Number(x.server_errors) || 0), l = Math.min(r - e, Number(x.rate_limited) || 0);
      const xx = (L + 6 + i * slot + (slot - bw) / 2).toFixed(1);
      const seg = (from, val, cls) => val > 0 ? '<rect class="' + cls + '" x="' + xx + '" y="' + y(from + val).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (y(from) - y(from + val)).toFixed(1) + '" rx="3"/>' : "";
      return "<g><title>" + E(time(x.minute, false)) + ": " + r + " · 429: " + l + " · 5xx: " + e + "</title>" + seg(0, r - e - l, "ok") + seg(r - e - l, l, "lim") + seg(r - l - e + l, e, "err") + "</g>";
    }).join("");
    const every = Math.ceil(b.length / 6);
    const axis = b.map((x, i) => i % every === 0 || i === b.length - 1 ? '<text x="' + (L + 6 + i * slot + slot / 2).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + E(time(x.minute, false)) + "</text>" : "").join("");
    const chart = card("sx-load", "<h2>" + T("Запросов в минуту", "Минутына сұраулар") + '</h2><div class="sx-legend line"><span class="l1">' + T("Запросы", "Сұраулар") + '</span><span class="l2">429</span><span class="l3">5xx</span></div>' +
      '<svg class="sx-chart sx-bars" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + T("Запросов в минуту", "Минутына сұраулар") + '"><g class="grid">' + grid + "</g>" + bars + '<g class="axis">' + axis + "</g></svg>" +
      '<p class="sx-foot">' + T("Время · UTC+5. p95 — верхняя граница времени ответа для 95% запросов.", "Уақыт · UTC+5. p95 — сұраулардың 95%-ына жауап уақытының жоғарғы шегі.") + "</p>");
    const rows = b.map(x => '<tr class="' + (Number(x.server_errors) ? "err" : Number(x.rate_limited) ? "lim" : "") + '"><th>' + E(time(x.minute, false)) + "</th><td>" + num(x.requests) + "</td><td>" + num(x.rate_limited) + "</td><td>" + num(x.server_errors) + "</td></tr>").join("");
    const table = '<div class="sx-table-wrap"><table class="sx-table sx-minutes"><thead><tr><th>' + T("Время", "Уақыт") + "</th><th>" + T("Запросы", "Сұраулар") + "</th><th>429</th><th>5xx</th></tr></thead><tbody>" + rows + "</tbody></table></div>";
    const minutes = '<section class="sx-card sx-minutes-card"><h2 class="only-wide">' + T("Поминутные значения", "Әр минуттың мәндері") + '</h2><div class="only-wide">' + table + "</div>" +
      '<details class="only-narrow"><summary><h2>' + T("Поминутные значения", "Әр минуттың мәндері") + "</h2>" + socIcon("down") + "</summary>" + table + "</details></section>";
    return hero + kpis + '<div class="sx-grid g-analytics">' + chart + minutes + "</div>";
  }
  function staff(v) {
    if (!Array.isArray(v?.items)) return '<div class="sx-section-head"><div><h2>' + T("Доступ сотрудников", "Қызметкерлердің рұқсаты") + "</h2></div></div>" + unavailable().replace('data-nav="home"', 'data-nav="staff"');
    const open = v.items.filter(s => s.enabled).length;
    const state = on => on ? T("Доступ открыт", "Рұқсат берілген") : T("Доступ приостановлен", "Рұқсат тоқтатылған");
    const head = '<div class="sx-section-head"><div><h2>' + T("Доступ сотрудников", "Қызметкерлердің рұқсаты") + "</h2><p>" + num(v.items.length) + " " +
      plural(v.items.length, "сотрудник", "сотрудника", "сотрудников", "қызметкер") + " · " + num(open) + " " + T("с открытым доступом", "рұқсаты ашық") + "</p></div></div>";
    const cards = '<div class="sx-case-grid sx-staff-grid">' + v.items.map(s => '<section class="sx-case sx-staff ' + (s.enabled ? "on" : "off") + '">' +
      '<span class="sx-case-top"><small class="sx-eyebrow">' + T("Сотрудник SOC", "SOC қызметкері") + "</small>" + pill(state(s.enabled), s.enabled ? "good" : "bad") + "</span>" +
      '<span class="sx-staff-who"><i>' + E(initials(String(s.login).replace(/[_.-]+/g, " "))) + "</i><strong>" + E(s.login) + "</strong></span>" +
      '<small class="sx-sub">' + T("Версия", "Нұсқа") + " " + num(s.version) + "</small>" +
      '<button class="' + (s.enabled ? "sx-danger" : "sx-soft") + '" data-staff="' + E(s.subject) + '" ' + disabled() + ">" + (s.enabled ? T("Приостановить доступ", "Рұқсатты тоқтату") : T("Восстановить доступ", "Рұқсатты қалпына келтіру")) + "</button></section>").join("") + "</div>";
    const audit = card("sx-events", "<h2>" + T("Журнал доступа", "Рұқсат журналы") + "</h2>" + (v.audit?.length ? '<ol class="sx-timeline">' + v.audit.map(a =>
      "<li><time>" + E(dayMonth(a.at)).replace(" · ", "<br>") + "</time><span><b>" + state(a.enabled) + "</b><small>" + E(v.items.find(s => s.subject === a.subject)?.login ?? a.subject) + " · " +
      T("Администратор", "Әкімші") + " · …" + E(String(a.actor || "").slice(-8)) + "</small></span></li>").join("") + "</ol>"
      : '<p class="sx-sub">' + T("Изменений доступа пока не было.", "Рұқсат әлі өзгерген жоқ.") + "</p>"));
    return head + cards + audit + '<p class="sx-note">' + T("Действия фиксируются в журнале. Пароли здесь не меняются.", "Әрекеттер журналда сақталады. Мұнда құпиясөз өзгермейді.") + "</p>";
  }

  /* generic wrapper for secondary SOC screens rendered by the legacy views */
  const plain = html => '<div class="sx-plain">' + html + "</div>";

  return { shell, home, detail, callEvidence, cases, graph, caseView, analytics, system, profile, plain, time, metrics, staff };
}
