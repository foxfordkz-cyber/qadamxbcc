import { ledgerInstant, shortDate } from "./wallet-date.mjs";
import { cashPlot } from "./spending-chart.mjs";
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
const ribbon = '<svg class="card-ribbon" viewBox="0 0 200 210" aria-hidden="true" preserveAspectRatio="xMaxYMid slice"><g fill="none" stroke="currentColor" stroke-width="1.7">'+
  Array.from({length:16},(_,i)=>'<ellipse cx="165" cy="146" rx="'+(47+i*7)+'" ry="'+(97+i*6)+'" transform="rotate(-32 165 146)"/>').join("")+'</g></svg>';
const chip =
  '<svg class="chip" viewBox="0 0 40 30" aria-hidden="true"><rect x="1" y="1" width="38" height="28" rx="6" fill="#e6d6aa"/><path d="M1 10h11l4 4v3l-5 5H1m38-12H28l-4 4v3l5 5h10M15 1v6l4 4h3l5-5V1M16 29v-5l3-4h4l4 5v4" fill="none" stroke="#927f56" stroke-width="1.1"/></svg>';
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
            E(when(r.created_at)) +
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
  function card(a, hidden) {
    return `<article class="q-card">${ribbon}<div class="card-brand"><img src="mark.svg" alt=""><b>Saq Bol × BCC</b></div>
      <div class="q-balance"><small>${T("Баланс учебной карты", "Оқу картасының балансы")}</small><div><strong>${hidden ? "•••••• ₸" : amount(a.balance)}</strong><button data-action="mask-balance" aria-pressed="${hidden}" aria-label="${T("Скрыть или показать баланс", "Балансты жасыру немесе көрсету")}">${icon("eye")}</button></div></div>
      <div class="card-foot"><div><span>•••• &nbsp;${hidden ? "••••" : E(a.card_last4)}</span><b>${E(a.display_name)}</b></div>${chip}</div></article>`;
  }
  function home(a, ledger, stats, hidden, pending, offline=false) {
    if (!a) return button("retry-home", T("Счёт недоступен · Повторить","Шот қолжетімсіз · Қайталау"),"secondary") + (ledger ? rows(ledger.items) : "");
    const actions = [
      ["history", T("История", "Тарих")],
      ["safety", T("Защита", "Қорғаныс")],
      offline ? ["check", T("Проверка","Тексеру")] : ["open-guardian", "Telegram"],
    ];
    const greet = `<header class="wallet-greeting"><span class="avatar">${E(initials(a.display_name))}</span><div><small>${T("Добрый день", "Қайырлы күн")}</small><h1>${E(a.display_name)}</h1></div><button class="locale-short" data-action="language" aria-label="${T("Сменить язык", "Тілді ауыстыру")}">${T("ҚАЗ", "РУС")}</button><button data-action="${offline?"settings":"inbox"}" aria-label="${offline?T("Профиль","Профиль"):T("Уведомления", "Хабарламалар")}">${icon(offline?"settings":"bell")}</button></header>`;
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
    return (
      greet +
      '<div class="wallet-dashboard"><div class="wallet-overview"><div class="wallet-account">'+card(a, hidden) +
      '<div class="action-dock"><button class="transfer-primary" data-action="transfer">'+icon("transfer")+'<span>'+T("Перевести","Аудару")+'</span></button><div class="wallet-quick">'+links+'</div></div>' +
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
      '</div><aside class="wallet-companion"><section class="wallet-protection">' +
      heading(T("Под вашим контролем", "Өз бақылауыңызда"), icon("safety")) +
      '<p>'+T("Если торопят с переводом — сделайте паузу. Проверьте сообщение или обратитесь к близкому.", "Аударымға асықтырса — кідіріңіз. Хабарламаны тексеріңіз немесе жақыныңызға хабарласыңыз.")+'</p>'+little("safety", T("Открыть защиту", "Қорғанысты ашу"))+'</section>'+
      (stats ? `<button class="week-summary" data-action="analytics"><span>${T("Расходы за неделю", "Апталық шығыс")}<strong>${hidden ? "•••••• ₸" : amount(stats.outgoing)}</strong></span>${icon("analytics")}${icon("arrow")}</button>`
        : button("retry-summary",T("Сводка недоступна · Повторить","Жиынтық қолжетімсіз · Қайталау"),"secondary"))+
      '</aside></div><div class="wallet-activity"><section class="wallet-section wallet-recent">' +
      heading(T("Последние операции","Соңғы операциялар"),little("history",T("Все","Барлығы"))) +
      (ledger ? rows(ledger.items.slice(0,3)) : button("retry-home",T("Обновить историю","Тарихты жаңарту"),"secondary")) +
      '</section><section class="wallet-section wallet-recipients">'+heading(T("Получатели","Алушылар")) +
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
      '</h1><form id="ledger-filter" class="ledger-filter"><label>' +
      T("Поиск по имени или ID", "Аты немесе ID бойынша іздеу") +
      '<input name="q" maxlength="128" value="' +
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
      </div>${full ? decisionTrend(d) + '<section class="paper"><h2>' + T("Решения по операциям", "Операциялар бойынша шешімдер") + "</h2>" + list + "<p>" + T("Завершённые дела", "Аяқталған істер") + " · " + closed + "</p><p>" + T("Среднее время оценки движком", "Қозғалтқыштың орташа бағалау уақыты") + " · " + (d.mean_engine_ms == null ? "—" : Number(d.mean_engine_ms).toFixed(1) + " ms") + "</p></section>" : ""}
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
