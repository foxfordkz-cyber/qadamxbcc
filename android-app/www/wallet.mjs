import { last as lastItem } from "./compat.mjs";
import { ledgerInstant, shortDate } from "./wallet-date.mjs";
import { cashPlot } from "./spending-chart.mjs";

// WebViews can lack Kazakh ICU data and silently fall back to English punctuation.
export function formatTenge(value) {
  if (value == null || value === "" || !Number.isFinite(Number(value))) return "— ₸";
  const [whole, fraction] = Number(value).toFixed(2).split(".");
  const groups = whole.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
  const tiyn = fraction.replace(/0+$/, "");
  return `${groups}${tiyn ? "," + tiyn : ""} ₸`;
}

// Shared product views. Every amount passed here comes from the mobile gateway.
const paths = {
  transfer: "M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4",
  history: "M12 5v7l4 2 M21 12a9 9 0 1 1-3-6",
  safety: "M12 2 4 5v6c0 5 4 9 8 11 4-2 8-6 8-11V5z M8 11l3 3 5-6",
  guardian: "M3 10 21 3l-4 18-6-6-4 3v-5z M7 13 18 6",
  analytics: "M3 20h18 M6 16v-5m6 5V5m6 11V9",
  settings: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21c0-8 16-8 16 0",
  staff: "M15 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M8 21c0-8 14-8 14 0 M7 5a3 3 0 0 0 0 6 M2 19c0-3 2-5 5-5",
  home: "m3 10 9-7 9 7v11h-6v-7H9v7H3z",
  bell: "M5 17h14l-2-4V9a5 5 0 0 0-10 0v4z M10 20h4",
  eye: "M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12z M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  incoming: "M18 5 6 17m0-8v8h8",
  outgoing: "M6 18 18 6m-8 0h8v8",
  cases: "M3 7h18v13H3z M8 7V4h8v3",
  system: "M2 12h5l3-7 4 14 3-7h5",
  call: "m5 3 4 5-2 3c2 3 3 4 6 6l3-2 5 4c-1 5-6 3-10 0S2 10 2 6z",
  message: "M4 5h16v11H9l-5 4z M8 9h8 M8 12h5",
  family: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6 M16.5 4.5a3 3 0 0 1 0 6 M18 14c2.2.6 3.5 2.6 3.5 5",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M20.5 20.5 16 16",
  report: "M5 21V4h11l-1.5 4L16 12H5 M9 7.5v1",
};
export const icon = (k) =>
  '<svg aria-hidden="true" viewBox="0 0 24 24" class="wi"><path d="' +
  (paths[k] || paths.arrow) +
  '"/></svg>';
// Line pictograms for the home actions: 24px, stroke 2, round caps.
const glyphs = {
  transfer: '<path d="M7 7h11m-3-3 3 3-3 3M17 17H6m3-3-3 3 3 3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  shield: '<path d="M12 3 5 6v5.5c0 4.3 3 7.8 7 9.5 4-1.7 7-5.2 7-9.5V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  alert: '<path d="M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V5a1 1 0 0 1 1-1z"/><path d="M12 7.5v4M12 14.5h.01"/>',
  plane: '<path d="M21 3 10.5 13.5"/><path d="M21 3 14.5 21l-4-7.5L3 9.5z"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
};
const glyph = (k) =>
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  (glyphs[k] || glyphs.chevron) + "</svg>";
// The Saq Bol S-mark from mark.svg, drawn white for the card face.
const cardMark =
  '<svg class="bank-card-mark" viewBox="12 10 40 44" aria-hidden="true"><path fill="#fff" d="M50 12H29.6C20.5 12 14 16.9 14 24.2c0 5.2 2.9 8.5 8.8 10.7l2.7 1 7-7.6-5.9-2.1c-2-.7-2.9-1.4-2.9-2.6 0-1.8 1.9-3 5.3-3h13.2Z"/>' +
  '<path fill="#fff" fill-opacity=".78" d="M14 52h20.4C43.5 52 50 47.1 50 39.8c0-5.2-2.9-8.5-8.8-10.7l-2.7-1-7 7.6 5.9 2.1c2 .7 2.9 1.4 2.9 2.6 0 1.8-1.9 3-5.3 3H21.8Z"/></svg>';
const contactless =
  '<svg class="bank-card-nfc" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M6.5 9a4.3 4.3 0 0 1 0 6"/><path d="M10 6.5a8 8 0 0 1 0 11"/><path d="M13.5 4a11.6 11.6 0 0 1 0 16"/><path d="M17 1.8a15 15 0 0 1 0 20.4"/></svg>';
const initials = (name) =>
  String(name || "Q")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => Array.from(w)[0])
    .join("")
    .toUpperCase();
// The miniature represents the training account. Its number always comes from the gateway.
export const cardThumbnail = '<span class="card-thumbnail" aria-hidden="true"><img src="mark.svg" alt=""></span>';
export function walletUI({ T, E, amount, when, button, status }) {
  const heading = (name, extra = "") =>
    '<div class="w-heading"><h2>' + name + "</h2>" + extra + "</div>";
  const little = (act, title) =>
    '<button class="w-link" data-action="' +
    act +
    '">' +
    title +
    " " +
    icon("arrow") +
    "</button>";
  const badge = (s) => '<span class="wb ' + E(s) + '">' + E(status(s)) + "</span>";
  const RU_MONTHS = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
  const KK_MONTHS = ["қаңтар","ақпан","наурыз","сәуір","мамыр","маусым","шілде","тамыз","қыркүйек","қазан","қараша","желтоқсан"];
  const dayKey = (offsetDays = 0) => ledgerInstant(new Date(Date.now() - offsetDays * 86400000).toISOString())?.day;
  // "Сегодня" / "Вчера" for the two latest days, otherwise "24 ноября".
  function dayLabel(day, withDate) {
    const m = Number(day.slice(5, 7)) - 1, d = Number(day.slice(8, 10));
    const date = d + " " + T(RU_MONTHS[m] || "", KK_MONTHS[m] || "");
    const near = day === dayKey(0) ? T("Сегодня", "Бүгін") : day === dayKey(1) ? T("Вчера", "Кеше") : "";
    if (!near) return withDate ? date : shortDate(day);
    return withDate ? near + ", " + date : near;
  }
  const plain = (v) => amount(v).replace(/\s?₸$/, "");
  function row(r, group) {
    const local = ledgerInstant(r.created_at), incoming = r.direction === "incoming";
    const time = local ? local.time : "";
    const sub = group
      ? (incoming ? T("Поступление", "Түсім") : T("Перевод", "Аударым")) + " · " + time
      : local ? dayLabel(local.day, false) + ", " + time : when(r.created_at);
    return '<button class="ledger-row" ' + (incoming ? "data-incoming" : "data-detail") + '="' + E(r.transaction_id) + '">' +
      '<i class="flow ' + (incoming ? "credit" : "") + '" aria-hidden="true">' + E(initials(r.counterparty)) + "</i>" +
      "<span><strong>" + E(r.counterparty) + "</strong><small>" + E(sub) + "</small></span>" +
      '<span class="right"><strong>' + (r.status === "approved" ? (incoming ? "+" : "−") : "") + amount(r.amount) + "</strong>" + badge(r.status) + "</span></button>";
  }
  function rows(items, group = false) {
    if (!items?.length)
      return '<p class="empty">' + T("Операций по этим условиям нет.", "Бұл шарттарға сай операция жоқ.") + "</p>";
    if (!group) return '<div class="ledger">' + items.map((r) => row(r, false)).join("") + "</div>";
    // History: one card per day with the day's executed totals.
    const days = [];
    for (const r of items) {
      const day = ledgerInstant(r.created_at)?.day || "";
      if (!days.length || lastItem(days).day !== day) days.push({ day, items: [] });
      lastItem(days).items.push(r);
    }
    return '<div class="ledger">' + days.map(({ day, items: list }) => {
      const done = list.filter((r) => r.status === "approved");
      const out = done.filter((r) => r.direction !== "incoming").reduce((t, r) => t + Number(r.amount || 0), 0);
      const inc = done.filter((r) => r.direction === "incoming").reduce((t, r) => t + Number(r.amount || 0), 0);
      const totals = [out ? "−" + plain(out) : "", inc ? "+" + plain(inc) : ""].filter(Boolean).join(" / ");
      return '<section class="day-group"><header class="day-title"><h3>' + E(day ? dayLabel(day, true) : "—") + "</h3>" +
        (totals ? "<span>" + totals + " ₸</span>" : "") + '</header><div class="day-rows">' + list.map((r) => row(r, true)).join("") + "</div></section>";
    }).join("") + "</div>";
  }
  const checks = (n) => n + " " + T(n % 10 === 1 && n % 100 !== 11 ? "проверка" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "проверки" : "проверок", "тексеру");
  function protection(stats, a) {
    const measured = Number.isInteger(stats?.count) && stats.count >= 0;
    return {
      checks: measured ? checks(stats.count) + " " + T("за неделю", "соңғы аптада") : "",
      title: a?.active_pause ? T("Перевод на проверке", "Аударым тексерілуде")
        : a?.pending_call ? T("Проверка после звонка", "Қоңыраудан кейінгі тексеру")
        : T("Защита переводов", "Аударымдарды қорғау"),
    };
  }
  function protectionCard(stats, a) {
    const p = protection(stats, a);
    const held = a?.active_pause || a?.pending_call;
    return `<button class="protection-index${held ? " held" : ""}" data-action="safety"><i class="pi-icon" aria-hidden="true">${glyph("shield")}</i>` +
      `<span class="pi-text"><b>${E(p.title)}</b>${p.checks ? `<span>${E(p.checks)}</span>` : ""}<small>${T("Открыть защиту","Қорғанысты ашу")}</small></span>` +
      `<i class="pi-go" aria-hidden="true">${glyph("chevron")}</i></button>`;
  }
  // A card face in true ID-1 proportions. Number and expiry come from the account; nothing is invented.
  function bankCard(a, hidden) {
    const last4 = hidden ? "••••" : E(a.card_last4 || "••••");
    const expiry = !hidden && /^\d{2}\/\d{2}$/.test(String(a.card_expiry || "")) ? E(a.card_expiry) : "••/••";
    return `<div class="bank-card" role="img" aria-label="${T("Карта Saq Bol", "Saq Bol картасы")} · •••• ${last4}">` +
      `<span class="bank-card-brand">${cardMark}<b>Saq Bol</b></span>${contactless}<i class="bank-card-chip" aria-hidden="true"></i>` +
      `<span class="bank-card-number">•••• ${last4}</span><span class="bank-card-holder">${E(a.display_name || "")}</span>` +
      `<span class="bank-card-expiry">${expiry}</span></div>`;
  }
  function card(a, hidden) {
    return `<article class="q-card"><div class="account-heading"><h2>${T("Мои счета", "Менің шоттарым")}</h2><button class="balance-privacy" data-action="mask-balance">${icon("eye")}<span>${hidden ? T("Показать баланс", "Балансты көрсету") : T("Скрыть баланс", "Балансты жасыру")}</span></button></div>
      <div class="q-balance"><strong>${hidden ? "•••••• ₸" : amount(a.balance)}</strong><small>${T("Карта Saq Bol", "Saq Bol картасы")} · •••• ${hidden ? "••••" : E(a.card_last4 || "••••")}</small>${!hidden && Number(a.disputed_kzt)>0 ? "<small>"+T("Доступно", "Қолжетімді")+" "+amount(a.available_kzt)+"</small>" : ""}</div>${bankCard(a, hidden)}</article>`;
  }
  // Anti-fraud tips; each opens an existing protection screen.
  function stories() {
    const tips = [
      ["call", "phone", T("Звонят «из банка»?", "«Банктен» қоңырау ма?")],
      ["scan", "chat", T("Проверь сообщение", "Хабарламаны тексер")],
      ["family", "family", T("Семейный щит", "Отбасы қорғанысы")],
      ["gateway", "search", T("Проверь получателя", "Алушыны тексер")],
      ["report", "warning", T("Сообщить об обмане", "Алаяқтықты хабарлау")],
    ];
    return `<section class="wallet-tips"><h2>${T("Полезно знать", "Білген жөн")}</h2><nav class="tip-stories" aria-label="${T("Советы по безопасности", "Қауіпсіздік кеңестері")}">${tips
      .map(([act, art, text], i) => `<button class="story s${i}" data-action="${act}"><i class="art art-${art}" aria-hidden="true"></i><span>${text}</span></button>`)
      .join("")}</nav></section>`;
  }
  function home(a, ledger, stats, hidden, pending, offline=false) {
    if (!a) return button("retry-home", T("Счёт недоступен · Повторить","Шот қолжетімсіз · Қайталау"),"secondary") + (ledger ? rows(ledger.items) : "");
    const actions = [
      ["history", "clock", T("История", "Тарих")],
      ["safety", "shield", T("Защита", "Қорғаныс")],
      offline ? ["check", "alert", T("Проверка","Тексеру")] : ["open-guardian", "plane", "Telegram"],
    ];
    const greet = `<header class="wallet-greeting"><h1><button class="profile-entry" data-action="settings" aria-label="${T("Открыть профиль", "Профильді ашу")} · ${E(a.display_name)}"><span class="avatar" aria-hidden="true">${E(initials(a.display_name))}</span><span><small>${T("Добрый день", "Қайырлы күн")}</small><strong>${E(a.display_name)}</strong></span></button></h1><button class="locale-short" data-action="language" aria-label="${T("Сменить язык", "Тілді ауыстыру")}">${T("ҚАЗ", "РУС")}</button>${offline?"":`<button data-action="inbox" aria-label="${T("Уведомления", "Хабарламалар")}">${icon("bell")}</button>`}</header>`;
    const links = actions.map(([k, g, n]) => `<button data-action="${k}"><i class="dock-icon" aria-hidden="true">${glyph(g)}</i><span>${n}</span></button>`).join("");
    const pause = a.active_pause
      ? `<button class="wallet-check" data-detail="${E(a.active_pause)}">${icon("history")}<span>${T("Перевод на проверке", "Аударым тексерілуде")}</span>${icon("arrow")}</button>`
      : "";
    const call = a.pending_call
      ? `<button class="wallet-check" data-call-id="${E(a.pending_call)}">${icon("call")}<span>${T("Проверка после звонка", "Қоңыраудан кейінгі тексеру")}</span>${icon("arrow")}</button>`
      : "";
    const people = a.recipients
      .map((r, i) => `<button data-payee="${E(r.phone)}" aria-label="${E(r.name)}"><i class="person p${i % 4}" aria-hidden="true">${E(initials(r.name))}</i><span class="person-name" aria-hidden="true">${E(String(r.name || "").trim().split(/\s+/)[0])}</span></button>`)
      .join("");
    const dock = '<div class="action-dock"><button class="transfer-primary" data-action="transfer"><i class="dock-icon" aria-hidden="true">'+glyph("transfer")+'</i><span>'+T("Перевести","Аудару")+'</span></button><div class="wallet-quick">'+links+'</div></div>';
    return (
      `<section class="home-hero">${greet}${card(a, hidden)}</section>` +
      '<div class="wallet-dashboard"><div class="wallet-overview"><div class="wallet-account">' + dock +
      (pending
        ? button("recover", T("Проверить незавершённый запрос", "Аяқталмаған сұрауды тексеру")) +
          button("abandon", T("Закрыть запрос", "Сұрауды жабу"), "secondary")
        : "") +
      (pause || call ? '<div class="wallet-checks">' + pause + call + "</div>" : "") +
      '</div><aside class="wallet-companion">' + protectionCard(stats, a) + "</aside></div>" +
      '<div class="wallet-activity">' + (offline ? "" : stories()) +
      '<section class="wallet-section wallet-recent">' +
      heading(T("Последние операции","Соңғы операциялар"),little("history",T("Все","Барлығы"))) +
      (ledger ? rows(ledger.items.slice(0,3)) : button("retry-home",T("Обновить историю","Тарихты жаңарту"),"secondary")) +
      "</section>" +
      (stats
        ? `<button class="week-summary" data-action="analytics"><span>${T("Моя аналитика", "Менің талдауым")}</span><i class="art art-chart" aria-hidden="true"></i><strong>${hidden ? "•••••• ₸" : amount(stats.outgoing)}</strong></button>`
        : button("retry-summary",T("Сводка недоступна · Повторить","Жиынтық қолжетімсіз · Қайталау"),"secondary")) +
      `<p class="fine">${T("Все данные учебные", "Барлық дерек оқу үшін")}</p>` +
      '<section class="wallet-section wallet-recipients">' + heading(T("Кому перевести","Кімге аударамыз")) +
      (people ? '<div class="people">' + people + `<button class="people-add" data-action="new-recipient" aria-label="${T("Новый перевод", "Жаңа аударым")}"><i aria-hidden="true">+</i><span class="person-name" aria-hidden="true">${T("Новый", "Жаңа")}</span></button></div>` : '<p class="empty">'+T("Учебные получатели пока не добавлены.","Оқу алушылары әзірге қосылмаған.")+'</p>') +
      "</section></div></div>"
    );
  }
  const periods = (n) =>
    '<div class="segments">' +
    [7, 30, 90]
      .map(
        (v) =>
          '<button data-days="' +
          v +
          '" aria-pressed="' +
          (v === n) +
          '">' +
          v +
          " " +
          T("дн.", "күн") +
          "</button>",
      )
      .join("") +
    "</div>";
  function history(d, s) {
    const dir = (v, label) =>
      `<label class="segment"><input type="radio" name="direction" value="${v}" ${(s.direction || "") === v ? "checked" : ""}><span>${label}</span></label>`;
    const filters = [
      s.status ? `<button class="w-link chip-clear" data-action="clear-period">${E(status(s.status))} ×</button>` : "",
      s.day || s.days
        ? '<button class="w-link chip-clear" data-action="clear-period">' +
          E(s.day ? s.day + (s.through && s.through !== s.day ? " – " + s.through : "") : s.days + " " + T("дн.", "күн")) +
          " ×</button>"
        : "",
    ].join("");
    return (
      "<h1>" + T("Операции", "Операциялар") + "</h1>" +
      '<form id="ledger-filter" class="ledger-filter"><label class="search-field"><span class="sr-only">' +
      T("Поиск по имени или ID", "Аты немесе ID бойынша іздеу") + "</span>" + icon("search") +
      '<input name="q" type="search" maxlength="128" placeholder="' + T("Имя или ID операции", "Аты немесе операция ID") + '" value="' + E(s.q) + '"></label>' +
      '<input type="hidden" name="status" value="' + E(s.status || "") + '">' +
      '<div class="segments direction" role="radiogroup" aria-label="' + T("Направление", "Бағыт") + '">' +
      dir("", T("Все", "Барлығы")) + dir("outgoing", T("Исходящие", "Шығыс")) + dir("incoming", T("Входящие", "Кіріс")) +
      '</div><button class="sr-only" type="submit">' + T("Применить", "Қолдану") + "</button></form>" +
      (filters ? '<div class="active-filters">' + filters + "</div>" : "") +
      rows(d?.items, true) +
      (d?.offset ? button("prev", T("Предыдущие", "Алдыңғысы"), "secondary") : "") +
      (d?.has_more ? button("next", T("Дальше", "Келесі"), "secondary") : "") +
      '<p class="screen-foot">' + T("Показаны операции учебного счёта", "Оқу шотының операциялары көрсетілген") + "</p>"
    );
  }
  // Incoming vs outgoing share as a ring; segments are SVG attributes, so no inline styles are needed.
  function donut(inc, out) {
    const total = inc + out;
    const outPct = total ? Math.max(out ? 2 : 0, Math.min(out && inc ? 98 : 100, (out / total) * 100)) : 0;
    const inPct = total ? 100 - outPct : 0;
    const gap = outPct && inPct ? 1.2 : 0;
    const seg = (cls, len, start) => len > 0
      ? `<circle class="${cls}" cx="21" cy="21" r="15.915" pathLength="100" stroke-dasharray="${Math.max(0, len - gap).toFixed(2)} ${(100 - Math.max(0, len - gap)).toFixed(2)}" stroke-dashoffset="${(25 - start).toFixed(2)}"/>`
      : "";
    return `<svg class="donut" viewBox="0 0 42 42" aria-hidden="true"><circle class="track" cx="21" cy="21" r="15.915"/>${seg("out", outPct, 0)}${seg("in", inPct, outPct)}</svg>`;
  }
  function periodLabel(d) {
    const first = d.series?.[0]?.day, last = lastItem(d.series ?? [])?.day;
    if (!first || !last) return "";
    const [fy, fm, fd] = first.split("-").map(Number), [ly, lm, ld] = last.split("-").map(Number);
    const month = (m) => T(RU_MONTHS[m - 1] || "", KK_MONTHS[m - 1] || "");
    const range = fm === lm && fy === ly ? fd + "–" + ld + " " + month(lm) : fd + " " + month(fm) + " – " + ld + " " + month(lm);
    return T("За ", "") + range;
  }
  function analytics(d, index) {
    if (!d) return "";
    const inc = Math.max(0, Number(d.incoming) || 0), out = Math.max(0, Number(d.outgoing) || 0);
    const counts = [
      ["", d.count, T("Всего операций", "Барлық операциялар")],
      ["cooling_off", d.paused, T("На проверке", "Тексерілуде")],
      ["blocked", d.blocked, T("Отклонены", "Қабылданбады")],
    ];
    return (
      "<h1>" + T("Аналитика", "Аналитика") + "</h1>" + periods(d.days) +
      `<section class="money-summary"><div><small>${T("Поступления", "Кіріс")}</small><strong class="in">${amount(d.incoming)}</strong></div>` +
      `<div><small>${T("Расходы", "Шығыс")}</small><strong>${amount(d.outgoing)}</strong></div><small class="period">${E(periodLabel(d))}</small><i class="art art-coins" aria-hidden="true"></i></section>` +
      `<section class="donut-card"><h2>${T("Движение денег", "Ақша қозғалысы")}</h2><div class="donut-wrap">${donut(inc, out)}<p><strong>${amount(d.outgoing)}</strong><small>${T("Всего расходов", "Барлық шығыс")}</small></p></div>` +
      `<ul class="donut-legend"><li class="out"><span>${T("Расходы", "Шығыс")}</span><b>${amount(d.outgoing)}</b></li><li class="in"><span>${T("Поступления", "Кіріс")}</span><b>${amount(d.incoming)}</b></li></ul>` +
      `<p class="fine">${T("Перевод на проверке не включён в расходы", "Тексерудегі аударым шығысқа кірмейді")}</p></section>` +
      '<section class="wallet-insight"><h2>' + T("Расходы по дням", "Күндер бойынша шығыс") + "</h2>" +
      cashPlot(d, d.series[index]?.day, { T, E, amount, icon }) + "</section>" +
      heading(T("Операции за период", "Кезеңдегі операциялар")) +
      '<div class="count-list">' +
      counts.map(([k, v, n]) => `<button data-drill-status="${k}"><span>${n}</span><strong>${v}</strong>${icon("arrow")}</button>`).join("") +
      '</div><p class="hint">' +
      T("В суммы входят проведённые операции. Календарь по времени Казахстана.", "Сомаға орындалған операциялар кіреді. Күндер Қазақстан уақытымен.") +
      "</p>"
    );
  }
  function decisionTrend(d) {
    if (!d.series?.length) return '<p class="empty">'+T("Нет данных за период","Кезең бойынша дерек жоқ")+'</p>';
    const groups=[], width=d.days<=7?1:d.days<=30?5:10;
    for(let i=0;i<d.series.length;i+=width){
      const rows=d.series.slice(i,i+width);
      const total=rows.reduce((sum,r)=>sum+Object.values(r.states).reduce((a,b)=>a+b,0),0);
      groups.push({from:shortDate(rows[0].day),to:shortDate(lastItem(rows).day),total});
    }
    const max=Math.max(...groups.map(g=>g.total),1);
    return '<section class="paper"><h2>'+T("Динамика операций","Операциялар динамикасы")+'</h2><p class="fine">'+
      T("Количество по дате создания","Жасалған күні бойынша саны")+'</p>'+
      groups.map(g=>'<div class="trend-row"><span>'+g.from+(g.from===g.to?"":" – "+g.to)+'</span><meter max="'+max+'" value="'+g.total+'"></meter><b>'+g.total+'</b></div>').join("")+
      '<p class="fine">'+ (d.p95_engine_ms==null?T("p95 движка · данных нет","Қозғалтқыш p95 · дерек жоқ"):
      T("p95 движка","Қозғалтқыш p95")+" · "+Number(d.p95_engine_ms).toFixed(2)+" ms · "+d.latency_sample_size+" "+
      T("замеров за период","өлшем")+' ('+T("до","шегі")+' '+d.latency_sample_limit+')')+'</p></section>';
  }
  function policyComparison(review) {
    if (!review?.policies?.length) return "";
    const formatter = new Intl.NumberFormat(T("ru-KZ", "kk-KZ"), {maximumFractionDigits: 1});
    const value = n => Number.isFinite(n) ? formatter.format(n) : "—";
    const rowAmount = raw => typeof raw === "string" && /^\d+(?:\.\d{1,2})?$/.test(raw)
      ? "<small>" + amount(raw) + "</small>" : "";
    const label = T("Пороги риска", "Тәуекел шектері");
    const headings = [
      T("Порог", "Шек"), T("Доп. паузы", "Қосымша кідіріс"),
      T("Пропущено мошеннических", "Өткізіп алған алаяқтық"),
      T("Ложные паузы на 1 000 законных", "1 000 заңды аударымға шаққандағы қате кідіріс"),
    ];
    const rows = review.policies.map(row => {
      const name = row.threshold === null ? T("Текущая", "Қазіргі") : "≥ " + value(row.threshold);
      const support = Number.isFinite(row.false_interventions) ? " (" + value(row.false_interventions) + "/" + value(review.legitimate_labelled) + ")" : "";
      return `<tr><th scope="row">${name}</th><td>${review.evaluated ? value(row.extra_holds) : "—"}</td><td>${value(row.missed_fraud)}${rowAmount(row.missed_fraud_kzt)}</td><td>${value(row.false_per_1000_legitimate)}${support}${rowAmount(row.legitimate_held_kzt)}</td></tr>`;
    }).join("");
    const coverage = review.label_coverage == null ? "—" : value(review.label_coverage * 100) + "%";
    const dates = review.first_sample_at && review.last_sample_at ? E(when(review.first_sample_at)) + " – " + E(when(review.last_sample_at)) : "—";
    return `<section class="paper" data-policy-comparison><h2>${label}</h2>
      <p>${T("Сравнили исходные решения по переводам", "Аударымдардың бастапқы шешімдері салыстырылды")} · ${value(review.evaluated)} / ${value(review.sampled)}<br>${dates}</p>
      <p>${T("Доля известных исходов", "Нәтижесі белгілі аударымдардың үлесі")} · ${coverage}<br>
      ${T("Подтверждено мошеннических", "Алаяқтық расталды")} · ${value(review.fraud_labelled)} · ${T("Законных", "Заңды")} · ${value(review.legitimate_labelled)}</p>
      ${review.fraud_labelled + review.legitimate_labelled === 0 ? "<p>" + T("Чтобы появилась разметка, укажите исход расследования при закрытии дела по оценённому переводу.", "Нәтижелерді көрсету үшін бағаланған аударымға қатысты істі жабу кезінде тергеу нәтижесін белгілеңіз.") + "</p>" : ""}
      <p class="fine">${T("Пороги моделируют дополнительные паузы поверх действующих мер.", "Шектер қолданыстағы шараларға қосымша кідірісті модельдейді.")}</p>
      <div class="plot-viewport"><table class="desk-table policy-table" aria-label="${label}"><thead><tr>${headings.map(h => '<th scope="col">' + h + "</th>").join("")}</tr></thead><tbody>${rows}</tbody></table></div>
      <p class="fine">${T("Суммы в тенге показывают объём пропущенных мошеннических и задержанных честных переводов при каждом пороге.", "Теңгемен берілген сомалар әр шек бойынша өткен алаяқтық және кідіртілген заңды аударымдардың көлемін көрсетеді.")}</p>
      <p class="fine">${T("«—» означает, что данных нет. Оценка качества учитывает подтверждённые исходы закрытых дел. Для этой выборки p95 полного HTTP-запроса недоступен.", "«—» дерек жоқ екенін білдіреді. Сапа бағасына жабылған істердің расталған нәтижелері кіреді. Осы іріктеме үшін толық HTTP сұрауының p95 уақыты қолжетімсіз.")}</p></section>`;
  }
  function soc(d, full = false) {
    if (!d) return "";
    const states = d.states,
      cases = d.case_states;
    const closed = (cases.RESOLVED || 0) + (cases.CLOSED || 0);
    const open = Object.values(cases).reduce((a, b) => a + b, 0) - closed;
    const list = Object.entries(states)
      .map(
        ([k, v]) =>
          `<div class="soc-line">${badge(k)}<strong>${v.count} · ${amount(v.amount)}</strong></div>`,
      )
      .join("");
    return `<header class="soc-heading"><div><small>SOC</small><h1>${T(full ? "Аналитика безопасности" : "Центр безопасности", full ? "Қауіпсіздік аналитикасы" : "Қауіпсіздік орталығы")}</h1></div>${icon("safety")}</header>${periods(d.days)}
      <div class="soc-overview"><section class="soc-hero"><div>${icon("safety")}<small>${T("Отклонённые переводы", "Қабылданбаған аударымдар")}</small></div><strong>${amount(states.blocked?.amount || 0)}</strong>
      <div class="soc-footer"><span>${T("Количество", "Саны")} <b>${states.blocked?.count || 0}</b></span><span>${T("Получатели", "Алушылар")} <b>${d.blocked_recipients}</b></span></div></section>
      <div class="soc-work"><div><small>${T("На проверке", "Тексерілуде")}</small><b>${states.cooling_off?.count || 0}</b><span>${T("переводов", "аударым")}</span></div>
      <button data-action="cases"><small>${T("Открытые дела", "Ашық істер")}</small><b>${open}</b><span>${T("К делам", "Істерге өту")} →</span></button></div>
      </div>${full ? policyComparison(d.policy_comparison) + decisionTrend(d) + '<section class="paper"><h2>' + T("Решения по операциям", "Операциялар бойынша шешімдер") + "</h2>" + list + "<p>" + T("Завершённые дела", "Аяқталған істер") + " · " + closed + "</p><p>" + T("Среднее время оценки движком", "Қозғалтқыштың орташа бағалау уақыты") + " · " + (d.mean_engine_ms == null ? "—" : Number(d.mean_engine_ms).toFixed(1) + " ms") + "</p></section>" : ""}
      <p class="hint">${T("По дате создания с", "Жасалған күні бойынша")}&nbsp;${E(d.from)} · UTC+5</p>`;
  }
  function telegram(a, contacts) {
    const verified = (contacts?.contacts || []).filter(
      (c) => c.state === "CONTACT_VERIFIED",
    ).length;
    const channel =
      a?.telegram_mode === "test"
        ? T("Тестовый Telegram", "Тест Telegram")
        : T("Доставка через тестовый адаптер", "Жеткізу тест адаптері арқылы");
    return `<section class="telegram-panel"><div class="guardian-ident"><i>${icon("guardian")}</i><div><small>${T("Доверенный контакт", "Сенімді контакт")}</small><h2>${T("Защита в Telegram","Telegram арқылы қорғау")}</h2></div></div>
      <p>${T("Контакт может попросить вас перезвонить или сообщить о подозрении.", "Контакт сізден қайта қоңырау шалуды сұрай алады немесе күдікті хабарлай алады.")}</p>
      <div class="guardian-count"><span>${T("Согласие получено", "Келісім берілді")}</span><b>${contacts ? verified : "—"} / ${a?.contact_limit ?? "—"}</b></div>
      <div class="guardian-links">${a?.guardian_username ? button("open-guardian", T("Открыть Telegram", "Telegram ашу")) : ""}${button("contacts", T("Доверенный круг", "Сенімді адамдар"), "secondary")}</div><small>${a && !a.guardian_username ? T("Адрес бота на стенде не настроен.", "Стендте боттың мекенжайы бапталмаған.") : channel}</small></section>`;
  }
  return { home, history, analytics, soc, telegram, rows, badge, periods, protection, protectionCard };
}
