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
  const mark = (s) =>
    ({ approved: "✓", cooling_off: "◷", blocked: "⊘", cancelled: "×" })[s] ||
    "·";
  const badge = (s) =>
    '<span class="wb ' + E(s) + '">' + mark(s) + " " + E(status(s)) + "</span>";
  function rows(items, group = false) {
    if (!items?.length)
      return (
        '<p class="empty">' +
        T("Операций по этим условиям нет.", "Бұл шарттарға сай операция жоқ.") +
        "</p>"
      );
    let last = "";
    return (
      '<div class="ledger">' +
      items
        .map((r) => {
          const day = ledgerInstant(r.created_at)?.day || "",
            incoming = r.direction === "incoming";
          const h =
            group && day !== last
              ? '<h3 class="day-title">' + shortDate(day) + "</h3>"
              : "";
          last = day;
          return (
            h +
            '<button class="ledger-row" ' +
            (incoming ? "data-incoming" : "data-detail") +
            '="' +
            E(r.transaction_id) +
            '"><i class="flow ' +
            (incoming ? "credit" : "") +
            '">' +
            icon(r.direction) +
            "</i><span><strong>" +
            E(r.counterparty) +
            "</strong><small>" +
            // Grouped rows already sit under a date heading, so they show only the time.
            E(group && day ? ledgerInstant(r.created_at).time : when(r.created_at)) +
            '</small></span><span class="right"><strong>' +
            (r.status === "approved" ? (incoming ? "+" : "−") : "") +
            amount(r.amount) +
            "</strong>" +
            badge(r.status) +
            "</span></button>"
          );
        })
        .join("") +
      "</div>"
    );
  }
  function card(a, hidden, dock = "") {
    return `<article class="q-card"><div class="account-heading"><h2>${T("Мои счета", "Менің шоттарым")}</h2><button class="balance-privacy" data-action="mask-balance">${hidden ? T("Показать баланс", "Балансты көрсету") : T("Скрыть баланс", "Балансты жасыру")}</button></div>
      <div class="card-row">${cardThumbnail}<div class="q-balance"><strong>${hidden ? "•••••• ₸" : amount(a.balance)}</strong><small>${T("Карта Saq Bol", "Saq Bol картасы")} · •••• ${hidden ? "••••" : E(a.card_last4 || "••••")}</small></div></div>${dock}</article>`;
  }
  // Anti-fraud tips shown as stories; each opens an existing protection screen.
  function stories() {
    const tips = [
      ["call", "call", T("Звонят «из банка»?", "«Банктен» қоңырау ма?")],
      ["scan", "message", T("Проверь сообщение", "Хабарламаны тексер")],
      ["family", "family", T("Семейный щит", "Отбасы қорғанысы")],
      ["gateway", "search", T("Проверь получателя", "Алушыны тексер")],
      ["report", "report", T("Сообщить об обмане", "Алаяқтықты хабарлау")],
    ];
    return `<nav class="tip-stories" aria-label="${T("Советы по безопасности", "Қауіпсіздік кеңестері")}">${tips
      .map(([act, ic, text], i) => `<button class="story s${i}" data-action="${act}"><span>${text}</span><i aria-hidden="true">${icon(ic)}</i></button>`)
      .join("")}</nav>`;
  }
  // Decorative split of the week's money flow; widths are SVG attributes, so no inline styles are needed.
  function flowBar(stats, hidden) {
    const inc = Math.max(0, Number(stats.incoming) || 0), out = Math.max(0, Number(stats.outgoing) || 0);
    const total = inc + out;
    const solid = (cls) => `<svg class="flow-bar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect width="100" height="8" rx="4" class="${cls}"/></svg>`;
    if (hidden || !total) return solid("empty");
    if (!inc || !out) return solid(inc ? "in" : "out");
    const a = Math.max(6, Math.min(94, (inc / total) * 100));
    return `<svg class="flow-bar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect width="${(a - 1.5).toFixed(1)}" height="8" rx="4" class="in"/><rect x="${(a + 1.5).toFixed(1)}" width="${(100 - a - 1.5).toFixed(1)}" height="8" rx="4" class="out"/></svg>`;
  }
  function home(a, ledger, stats, hidden, pending, offline=false) {
    if (!a) return button("retry-home", T("Счёт недоступен · Повторить","Шот қолжетімсіз · Қайталау"),"secondary") + (ledger ? rows(ledger.items) : "");
    const actions = [
      ["history", T("История", "Тарих")],
      ["safety", T("Защита", "Қорғаныс")],
      offline ? ["check", T("Проверка","Тексеру")] : ["open-guardian", "Telegram"],
    ];
    const greet = `<header class="wallet-greeting"><h1><button class="profile-entry" data-action="settings" aria-label="${T("Открыть профиль", "Профильді ашу")} · ${E(a.display_name)}"><span class="avatar" aria-hidden="true">${E(initials(a.display_name))}</span><span><strong>${E(a.display_name)}</strong><small><b>saq bol</b>${T("Учебный счёт", "Оқу шоты")}</small></span></button></h1><button class="locale-short" data-action="language" aria-label="${T("Сменить язык", "Тілді ауыстыру")}">${T("ҚАЗ", "РУС")}</button>${offline?"":`<button data-action="inbox" aria-label="${T("Уведомления", "Хабарламалар")}">${icon("bell")}</button>`}</header>`;
    const links = actions
      .map(
        ([k, n]) =>
          `<button data-action="${k}"><i>${icon(k === "open-guardian" ? "guardian" : k)}</i><span>${n}</span></button>`,
      )
      .join("");
    const pause = a.active_pause
      ? `<button class="wallet-check" data-detail="${E(a.active_pause)}">${icon("history")}<span>${T("Перевод на проверке", "Аударым тексерілуде")}</span>${icon("arrow")}</button>`
      : "";
    const call = a.pending_call
      ? `<button class="wallet-check" data-call-id="${E(a.pending_call)}">${icon("call")}<span>${T("Проверка после звонка", "Қоңыраудан кейінгі тексеру")}</span>${icon("arrow")}</button>`
      : "";
    const people = a.recipients
      .map(
        (r, i) =>
          `<button data-payee="${E(r.phone)}"><i class="person p${i}">${E(initials(r.name))}</i><span>${E(r.name)}</span></button>`,
      )
      .join("");
    const dock = '<div class="action-dock"><button class="transfer-primary" data-action="transfer">'+icon("transfer")+'<span>'+T("Перевести","Аудару")+'</span></button><div class="wallet-quick">'+links+'</div></div>';
    return (
      greet + (offline ? "" : stories()) +
      '<div class="wallet-dashboard"><div class="wallet-overview"><div class="wallet-account">'+card(a, hidden, dock) +
      (pending
        ? button(
            "recover",
            T("Проверить незавершённый запрос", "Аяқталмаған сұрауды тексеру"),
          ) +
          button("abandon", T("Закрыть запрос", "Сұрауды жабу"), "secondary")
        : "") +
      (pause || call
        ? '<div class="wallet-checks">' + pause + call + "</div>"
        : "") +
      '</div><aside class="wallet-companion">' +
      (stats ? `<button class="week-summary" data-action="analytics"><b>${T("Моя аналитика", "Менің талдауым")}</b><small>${T("Расходы за неделю", "Апталық шығыс")}</small><strong>${hidden ? "•••••• ₸" : amount(stats.outgoing)}</strong>${flowBar(stats, hidden)}</button>`
        : button("retry-summary",T("Сводка недоступна · Повторить","Жиынтық қолжетімсіз · Қайталау"),"secondary"))+
      `<button class="wallet-protection" data-action="safety"><b>${T("Под защитой", "Қорғауда")}</b><small>${T("Пауза при звонке и проверка получателя", "Қоңырау кезіндегі кідіріс пен алушыны тексеру")}</small><span class="guard-dots" aria-hidden="true">${icon("safety")}${icon("call")}${icon("family")}</span></button>` +
      '</aside></div><div class="wallet-activity"><section class="wallet-section wallet-recent">' +
      heading(T("Последние операции","Соңғы операциялар"),little("history",T("Все","Барлығы"))) +
      (ledger ? rows(ledger.items.slice(0,3)) : button("retry-home",T("Обновить историю","Тарихты жаңарту"),"secondary")) +
      '</section><section class="wallet-section wallet-recipients">'+heading(T("Кому перевести","Кімге аударамыз")) +
      (people ? '<div class="people">'+people+'</div>' : '<p class="empty">'+T("Учебные получатели пока не добавлены.","Оқу алушылары әзірге қосылмаған.")+'</p>') +
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
  const options = (values, current) =>
    values
      .map(
        ([v, label]) =>
          '<option value="' +
          E(v) +
          '" ' +
          (v === current ? "selected" : "") +
          ">" +
          E(label) +
          "</option>",
      )
      .join("");
  function history(d, s) {
    return (
      "<h1>" +
      T("Операции", "Операциялар") +
      '</h1><form id="ledger-filter" class="ledger-filter"><label class="search-field"><span class="sr-only">' +
      T("Поиск по имени или ID", "Аты немесе ID бойынша іздеу") +
      "</span>" + icon("search") +
      '<input name="q" maxlength="128" placeholder="' +
      T("Поиск по имени или ID", "Аты немесе ID бойынша іздеу") +
      '" value="' +
      E(s.q) +
      '"></label><div><select name="status" aria-label="' +
      T("Статус", "Күй") +
      '">' +
      options(
        [
          ["", T("Все статусы", "Барлық күй")],
          ...["approved", "cooling_off", "blocked", "cancelled"].map((k) => [
            k,
            status(k),
          ]),
        ],
        s.status,
      ) +
      '</select><select name="direction" aria-label="' +
      T("Направление", "Бағыт") +
      '">' +
      options(
        [
          ["", T("Оба направления", "Екі бағыт")],
          ["outgoing", T("Исходящие", "Шығыс")],
          ["incoming", T("Входящие", "Кіріс")],
        ],
        s.direction,
      ) +
      '</select></div><button class="secondary">' +
      T("Применить", "Қолдану") +
      "</button></form>" +
      (s.day || s.days
        ? '<button class="w-link" data-action="clear-period">' +
          E(
            s.day
              ? s.day +
                  (s.through && s.through !== s.day ? " – " + s.through : "")
              : s.days + " " + T("дн.", "күн"),
          ) +
          " ×</button>"
        : "") +
      rows(d?.items, true) +
      (d?.offset
        ? button("prev", T("Предыдущие", "Алдыңғысы"), "secondary")
        : "") +
      (d?.has_more ? button("next", T("Дальше", "Келесі"), "secondary") : "")
    );
  }
  function analytics(d, index) {
    if (!d) return "";
    const metrics = [
      ["incoming", T("Поступления", "Кіріс"), d.incoming],
      ["outgoing", T("Расходы", "Шығыс"), d.outgoing],
    ];
    const cards = metrics
      .map(
        ([k, n, v]) =>
          `<div class="metric-cash ${k}"><div>${icon(k)}<small>${n}</small></div><strong>${amount(v)}</strong></div>`,
      )
      .join("");
    const counts = [
      ["", d.count, T("Всего операций", "Барлық операциялар")],
      ["cooling_off", d.paused, T("На проверке", "Тексерілуде")],
      ["blocked", d.blocked, T("Отклонены", "Қабылданбады")],
    ];
    return (
      "<h1>" +
      T("Аналитика", "Аналитика") +
      "</h1>" +
      periods(d.days) +
      '<div class="analytics-layout"><div class="cash-metrics">' +
      cards +
      '</div><section class="wallet-insight"><h2>' +
      T("Движение денег", "Ақша қозғалысы") +
      "</h2>" +
      cashPlot(d, d.series[index]?.day, { T, E, amount, icon }) +
      "</section></div>" +
      heading(T("Операции за период", "Кезеңдегі операциялар")) +
      '<div class="count-list">' +
      counts
        .map(
          ([k, v, n]) =>
            `<button data-drill-status="${k}"><span>${n}</span><strong>${v}</strong>${icon("arrow")}</button>`,
        )
        .join("") +
      '</div><p class="hint">' +
      T(
        "В суммы входят проведённые операции. Календарь по времени Казахстана.",
        "Сомаға орындалған операциялар кіреді. Күндер Қазақстан уақытымен.",
      ) +
      "</p>"
    );
  }
  function decisionTrend(d) {
    if (!d.series?.length) return '<p class="empty">'+T("Нет данных за период","Кезең бойынша дерек жоқ")+'</p>';
    const groups=[], width=d.days<=7?1:d.days<=30?5:10;
    for(let i=0;i<d.series.length;i+=width){
      const rows=d.series.slice(i,i+width);
      const total=rows.reduce((sum,r)=>sum+Object.values(r.states).reduce((a,b)=>a+b,0),0);
      groups.push({from:shortDate(rows[0].day),to:shortDate(rows.at(-1).day),total});
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
    const label = T("Пороги риска", "Тәуекел шектері");
    const headings = [
      T("Порог", "Шек"), T("Доп. паузы", "Қосымша кідіріс"),
      T("Пропущено мошеннических", "Өткізіп алған алаяқтық"),
      T("Ложные паузы на 1 000 законных", "1 000 заңды аударымға шаққандағы қате кідіріс"),
    ];
    const rows = review.policies.map(row => {
      const name = row.threshold === null ? T("Текущая", "Қазіргі") : "≥ " + value(row.threshold);
      const support = Number.isFinite(row.false_interventions) ? " (" + value(row.false_interventions) + "/" + value(review.legitimate_labelled) + ")" : "";
      return `<tr><th scope="row">${name}</th><td>${review.evaluated ? value(row.extra_holds) : "—"}</td><td>${value(row.missed_fraud)}</td><td>${value(row.false_per_1000_legitimate)}${support}</td></tr>`;
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
  return { home, history, analytics, soc, telegram, rows, badge, periods };
}
