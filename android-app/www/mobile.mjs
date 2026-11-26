import {revealChartSelection,stepChart} from "./spending-chart.mjs";
import {walletUI,icon as walletIcon,formatTenge as money} from "./wallet.mjs";
import {offlineWallet,SAMPLE_OPERATIONS,sampleInstant} from "./offline-wallet.mjs";
import {ledgerTime,ledgerInstant} from "./wallet-date.mjs";
import { COPY } from "./copy.mjs";
import {
  STORAGE_KEY,
  PRESETS,
  restore,
  addTransfer,
  cancelTransfer,
  safetyResult,
} from "./demo.mjs";
import { PUBLIC_DEMO, openExternal, installBackHandler } from "./native.mjs";

let storageFailed = false;
let state;
try {
  state = restore(localStorage.getItem(STORAGE_KEY));
} catch {
  state = restore(null);
  storageFailed = true;
}
const offlineEntry =
  new URLSearchParams(location.search).get("offline") === "1";
try {
  const preference = localStorage.getItem("qadam.language");
  if (["kk", "ru"].includes(preference)) state.language = preference;
} catch { storageFailed = true; }
if (offlineEntry) state.welcomed = true;
else if (state.welcomed) location.replace("index.html");
let route = "home",
  preset = "everyday",
  currentId = null,
  draftId = null,
  answers = [],
  resetting = false;
const app = document.querySelector("#app");
const t = (key) => COPY[state.language][key] ?? key;
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const paths = {
  home: '<path d="m3 10 9-7 9 7v10H6V10m3 10v-7h6v7"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  shield:
    '<path d="m12 3 8 3v6c0 5-5 8-8 10-3-2-8-5-8-10V6Z"/><path d="m8 12 3 3 5-6"/>',
  settings:
    '<circle cx="12" cy="8" r="4"/><path d="M4 21v-3a8 8 0 0 1 16 0v3"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  back: '<path d="M19 12H5m6 6-6-6 6-6"/>',
  scan: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 12h10"/>',
  people:
    '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c6 6 6 12 0 18-6-6-6-12 0-18"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.shield}</svg>`;
const date = (timestamp) =>
  new Intl.DateTimeFormat(state.language === "kk" ? "kk-KZ" : "ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
const action = (key, label, kind = "primary", pictogram = "arrow") =>
  `<button class="${kind}" data-action="${key}"><span>${esc(label)}</span>${icon(pictogram)}</button>`;
const heading = (title, sub = "") =>
  `<div class="heading"><h1 tabindex="-1">${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ""}</div>`;
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    storageFailed = true;
    toast(t("storageError"));
  }
}
function toast(text) {
  const el = document.querySelector("#notice");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    el.hidden = true;
  }, 5000);
}
function navigate(next) {
  if (route === "check" && next !== "check") answers = [];
  route = next;
  resetting = false;
  render();
  window.scrollTo(0, 0);
  document.querySelector("h1")?.focus({ preventScroll: true });
}
function rows(transfers) {
  if (!transfers.length)
    return `<div class="empty">${icon("history")}<h3>${t("empty")}</h3><p>${t("emptyText")}</p></div>`;
  return `<div class="rows">${transfers.map((tx) => `<button class="transaction" data-detail="${esc(tx.id)}"><span class="tile ${tx.status}">${icon(tx.status === "approved" ? "arrow" : tx.status === "cooling_off" ? "pause" : "close")}</span><span class="row-text"><strong>${t(tx.preset)}</strong><small>${date(tx.createdAt)}</small><span class="status-text ${tx.status}">${t(tx.status)}</span></span><strong class="sum">${money(PRESETS[tx.preset].amount)}</strong></button>`).join("")}</div>`;
}
function welcome() {
  return `<section class="welcome"><div class="welcome-top"><div class="wordmark"><img src="mark.svg" alt=""><span>saq bol<span class="wordmark-light"> × BCC</span></span></div>${languageButtons()}</div><div class="orbit"><div class="orbit-inner"><img src="mark.svg" alt=""></div><span class="orb orb-one">${icon("check")}</span><span class="orb orb-two">${icon("people")}</span></div><span class="eyebrow">SAQ BOL × BCC</span><h1>${esc(t("welcome")).replace("\n", "<br>")}</h1><p class="lead">${t("welcomeText")}</p><div class="welcome-bottom">${action("start", t("start"))}${action("offline", state.language === "ru" ? "Попробовать без сервера" : "Серверсіз байқап көру", "secondary")}<p class="fine">${t("onboardingNote")}</p></div></section>`;
}
function languageButtons() {
  return `<div class="languages" role="group" aria-label="Тіл / Язык"><button data-lang="kk" aria-pressed="${state.language === "kk"}">ҚАЗ</button><button data-lang="ru" aria-pressed="${state.language === "ru"}">РУС</button></div>`;
}
const T=(ru,kk)=>state.language==="ru"?ru:kk;
const wallet=walletUI({T,E:esc,amount:money,when:ledgerTime,button:action,status:t});
let days=7,selection=null,hideBalance=false,historyFilter={q:"",status:"",direction:"",day:"",through:"",days:""};
function home() {
  const local=offlineWallet(state);
  return wallet.home(local.account,{items:local.items},local.analytics(7),hideBalance,"",true);
}
function practiceHistory(){
  let items=offlineWallet(state).items.filter(r=>{
    const day=ledgerInstant(r.created_at).day;
    return (!historyFilter.q||(r.counterparty+" "+r.transaction_id).toLowerCase().includes(historyFilter.q.toLowerCase())) &&
      (!historyFilter.status||r.status===historyFilter.status) && (!historyFilter.direction||r.direction===historyFilter.direction) &&
      (!historyFilter.day||(day>=historyFilter.day && day<=(historyFilter.through||historyFilter.day)));
  });
  return wallet.history({items,has_more:false},historyFilter);
}
function transfer() {
  return `${heading(t("scenario"), t("scenarioHint"))}<div class="presets">${Object.entries(
    PRESETS,
  )
    .map(
      ([key, value], index) =>
        `<button data-preset="${key}" class="preset ${preset === key ? "selected" : ""}" aria-pressed="${preset === key}"><span class="preset-number">0${index + 1}</span><span><strong>${t(key)}</strong><small>${money(value.amount)} · ${value.recipient}</small></span><span class="radio"></span></button>`,
    )
    .join(
      "",
    )}</div><div class="paper"><label>${t("recipient")}</label><h2>${PRESETS[preset].recipient}</h2><div class="divider"></div><label>${t("amount")}</label><div class="amount">${money(PRESETS[preset].amount)}</div></div>${action("review", t("continue"))}`;
}
function review() {
  return `${heading(t("review"))}<div class="paper"><span class="eyebrow">${t(preset)}</span><div class="amount">${money(PRESETS[preset].amount)}</div><dl><dt>${t("recipient")}</dt><dd>${PRESETS[preset].recipient}</dd></dl></div><p class="callout">${icon("shield")}<span>${t("reviewNote")}</span></p>${action("confirm", t("confirm"))}`;
}
function sampleReceipt(sample) {
  const held = sample.heldDuringCall === true;
  const steps = held
    ? [[t("sampleCreated"), sample.counterparty], [t("sampleHeld"), t("sampleHeldNote")], [t("sampleCancelled"), t("sampleKept")]]
    : [[t("sampleCreated"), sample.counterparty], [t("sampleSent"), t("sampleNoSignals")]];
  return `<div class="receipt"><span class="result-icon ${sample.status}">${icon(held ? "close" : "check")}</span>${heading(t(held ? "sampleHeldTitle" : "sampleSentTitle"), t(held ? "sampleHeldText" : "sampleSentText"))}<div class="amount">${money(sample.amount)}</div><p>${esc(sample.counterparty)} · ${date(Date.parse(sampleInstant(sample)))}</p></div><section class="paper"><h2>${t("timeline")}</h2><ol class="timeline">${steps.map(([step, note]) => `<li><strong>${esc(step)}</strong><small>${esc(note)}</small></li>`).join("")}</ol><p class="fine">${t("sampleNote")}</p></section>${action("home", t("done"))}`;
}
function receipt() {
  const tx = state.transfers.find((item) => item.id === currentId);
  const sample = SAMPLE_OPERATIONS.find((item) => item.id === currentId);
  if (!tx && sample) return sampleReceipt(sample);
  if (!tx) return heading(t("empty"));
  const statusIcon =
    tx.status === "approved"
      ? "check"
      : tx.status === "cooling_off"
        ? "pause"
        : "close";
  return `<div class="receipt"><span class="result-icon ${tx.status}">${icon(statusIcon)}</span>${heading(t(tx.status), t(`${tx.status}Text`))}<div class="amount">${money(PRESETS[tx.preset].amount)}</div><p>${PRESETS[tx.preset].recipient} · ${date(tx.createdAt)}</p></div><section class="paper"><h2>${t("timeline")}</h2><ol class="timeline"><li><strong>${t("evaluated")}</strong><small>${t(tx.preset)}</small></li><li><strong>${t("decision")}</strong><small>${t(tx.status)}</small></li><li><strong>${t("noMessage")}</strong><small>${t("saved")}</small></li></ol></section>${tx.status === "cooling_off" ? `${action("check", t("check"))}${action("cancel-transfer", t("cancelTransfer"), "secondary", "close")}` : action("home", t("done"))}`;
}
function safety() {
  return `${heading(t("safetyTitle"), t("safetyText"))}<button class="safety-feature" data-action="check"><span class="feature-icon">${icon("scan")}</span><h2>${t("questionnaire")}</h2><p>${t("questionnaireText")}</p><span class="round-arrow">${icon("arrow")}</span></button><section class="paper"><div class="section-title"><h2>${t("circle")}</h2>${icon("people")}</div><div class="avatars"><span>A</span><span>B</span><span>C</span><small>${T("Демо","Демо")}</small></div><p>${t("circleText")}</p><p class="fine">${t("circleNote")}</p>${action("connect", T("Войти в Saq Bol × BCC","Saq Bol × BCC жүйесіне кіру"), "secondary", "scan")}</section><section class="paper"><h2>${t("learn")}</h2><ul class="rules">${[1, 2, 3].map((n) => `<li><span>${n}</span>${t(`rule${n}`)}</li>`).join("")}</ul></section>`;
}
function check() {
  const result = safetyResult(answers);
  if (result)
    return `<div class="receipt"><span class="result-icon ${result === "pause" ? "cooling_off" : "approved"}">${icon(result === "pause" ? "pause" : "shield")}</span>${heading(t(result), t(`${result}Text`))}</div><p class="callout">${t("advisory")}</p>${action("check", t("again"))}${action("home", t("done"), "secondary")}`;
  return `${heading(t("questionnaire"), t("questionnaireText"))}<div class="progress" aria-label="${t("question")} ${answers.length + 1} / 3">${[0, 1, 2].map((i) => `<span class="${i <= answers.length ? "filled" : ""}"></span>`).join("")}</div><span class="eyebrow">${t("question")} ${answers.length + 1} / 3</span><div class="question-card"><h2>${t(`q${answers.length + 1}`)}</h2></div><div class="answer-grid">${action("yes", t("yes"), "primary", "check")}${action("no", t("no"), "secondary", "close")}</div><p class="fine">${t("advisory")}</p>`;
}
function settings() {
  return `${heading(t("profileTitle"), t("localProfile"))}<section class="paper"><div class="section-title"><h2>${t("language")}</h2>${languageButtons()}</div></section><section class="paper"><h2>${t("connection")}</h2><div class="connection"><span class="tile approved">${icon("check")}</span><div><strong>${t("offline")}</strong><small>${t("offlineNote")}</small></div></div><button class="connection" data-action="connect"><span class="tile">${icon("scan")}</span><span><strong>${T("Войти в Saq Bol × BCC","Saq Bol × BCC жүйесіне кіру")}</strong><small>${T("Учебный аккаунт клиента или сотрудника","Клиенттің немесе қызметкердің оқу аккаунты")}</small></span>${icon("arrow")}</button></section><section class="paper"><h2>${t("data")}</h2><p>${t("dataNote")}</p>${action("reset", t("reset"), "danger-button", "close")}</section><p class="fine">${t("version")}</p><p class="fine">${t("copyright")}</p>${resetting ? `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="reset-title"><h2 id="reset-title">${t("resetAsk")}</h2><p>${t("resetNote")}</p>${action("erase", t("erase"), "primary", "close")}${action("dismiss", t("cancel"), "secondary")}</section></div>` : ""}`;
}
function render() {
  document.documentElement.lang = state.language;
  if (!state.welcomed) {
    app.innerHTML = welcome();
    return;
  }
  const mainRoutes = ["home", "history", "safety", "analytics", "settings"];
  const isRoot = mainRoutes.includes(route);
  const selected = isRoot ? route : route === "check" ? "safety" : "home";
  const screens = {
    home,
    transfer,
    review,
    receipt,
    safety,
    check,
    settings,
    analytics:()=>wallet.analytics(offlineWallet(state).analytics(days),selection),
    history:practiceHistory,
  };
  app.dataset.screen=route;app.dataset.actor="client";
  app.innerHTML=`<div class="shell"><header class="topbar"><button class="back" data-action="back" aria-label="${t("back")}">←</button><div class="wordmark"><img src="mark.svg" alt=""><span>saq bol</span></div><button class="text-button" data-action="language">${T("ҚАЗ","РУС")}</button></header><main><div class="offline-source"><span>${T("Офлайн-режим","Офлайн режим")}</span><button data-action="connect">${T("Войти","Кіру")}</button></div>${storageFailed?'<p class="network-note">'+t("storageError")+'</p>':""}${(screens[route]??home)()}</main><nav class="bottom-nav connected-nav">${mainRoutes.map(key=>`<button data-route="${key}" aria-current="${selected===key?"page":"false"}"><b>${walletIcon(key)}</b><span>${key==="analytics"?T("Аналитика","Талдау"):t(key)}</span></button>`).join("")}</nav></div>`;
  if(route==="analytics")revealChartSelection(app);

}
function back() {
  if (resetting) {
    resetting = false;
    render();
    return true;
  }
  if (route === "home" || !state.welcomed) return false;
  navigate(
    route === "review" ? "transfer" : route === "check" ? "safety" : "home",
  );
  return true;
}
app.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (resetting && !button.closest(".modal")) return;
  if (button.dataset.lang) {
    state.language = button.dataset.lang === "ru" ? "ru" : "kk";
    try {
      localStorage.setItem("qadam.language", state.language);
    } catch {
      storageFailed = true;
    }
    save();
    render();
    return;
  }
  if(button.dataset.days){days=Number(button.dataset.days);selection=null;render();return;}
  if(button.dataset.chartStep){stepChart(app,Number(button.dataset.chartStep));return;}
  if(button.dataset.chartDay){selection=offlineWallet(state).analytics(days).series.findIndex(d=>d.day===button.dataset.chartDay);render();return;}
  if(button.dataset.drillDay||button.hasAttribute("data-drill-status")){
    const stats=offlineWallet(state).analytics(days);
    historyFilter={q:"",status:button.dataset.drillStatus||"",direction:"",days:"",day:button.dataset.drillDay||stats.from,through:button.dataset.through||stats.series.at(-1).day};
    navigate("history");return;
  }
  if(button.dataset.action==="clear-period"){historyFilter={q:"",status:"",direction:"",days:"",day:"",through:""};render();return;}
  if(button.dataset.action==="mask-balance"){hideBalance=!hideBalance;render();return;}
  if(button.dataset.action==="language"){state.language=T("kk","ru");try{localStorage.setItem("qadam.language",state.language);}catch{} save();render();return;}
  if(["settings","history","safety","analytics"].includes(button.dataset.action)){navigate(button.dataset.action);return;}
  if (button.dataset.route) {
    navigate(button.dataset.route);
    return;
  }
  // Saved recipients and "+" open the practice transfer; the offline ledger has no free-form payee.
  if (button.dataset.payee || button.dataset.action === "new-recipient") {
    preset = "everyday";
    draftId = null;
    navigate("transfer");
    return;
  }
  if (button.dataset.preset && Object.hasOwn(PRESETS, button.dataset.preset)) {
    preset = button.dataset.preset;
    render();
    return;
  }
  if (button.dataset.detail) {
    currentId = button.dataset.detail;
    navigate("receipt");
    return;
  }
  switch (button.dataset.action) {
    case "start":
      state.welcomed = true;
      save();
      location.assign("index.html");
      break;
    case "offline":
      state.welcomed = true;
      save();
      history.replaceState(null, "", "index.html?offline=1");
      navigate("home");
      break;
    case "transfer":
      preset = "everyday";
      draftId = null;
      navigate("transfer");
      break;
    case "review":
      draftId = crypto.randomUUID();
      navigate("review");
      break;
    case "confirm":
      if (route !== "review" || !draftId) break;
      state = addTransfer(state, preset, draftId);
      currentId = draftId;
      draftId = null;
      save();
      navigate("receipt");
      break;
    case "cancel-transfer":
      state = cancelTransfer(state, currentId);
      save();
      render();
      break;
    case "check":
      answers = [];
      navigate("check");
      break;
    case "yes":
    case "no":
      if (route === "check" && answers.length < 3) {
        answers.push(button.dataset.action === "yes");
        render();
      }
      break;
    case "home":
      navigate("home");
      break;
    case "back":
      back();
      break;
    case "connect":
      window.location.assign("index.html");
      break;
    case "website":
      try {
        await openExternal(PUBLIC_DEMO);
      } catch {
        toast(t("unavailable"));
      }
      break;
    case "reset":
      resetting = true;
      render();
      document.querySelector('[data-action="dismiss"]')?.focus();
      break;
    case "dismiss":
      resetting = false;
      render();
      document.querySelector('[data-action="reset"]')?.focus();
      break;
    case "erase":
      state.transfers = [];
      save();
      resetting = false;
      render();
      toast(t("cleared"));
      break;
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") back();
  if (resetting && event.key === "Tab") {
    const buttons = [...document.querySelectorAll(".modal button")];
    const i = buttons.indexOf(document.activeElement);
    event.preventDefault();
    buttons[
      (i + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length
    ].focus();
  }
});
window.addEventListener("offline", render);
window.addEventListener("online", render);
render();
installBackHandler(back).catch(() => {
  /* Browser preview has no native back button. */
});

app.addEventListener("submit",event=>{if(event.target.id!=="ledger-filter")return;event.preventDefault();Object.assign(historyFilter,Object.fromEntries(new FormData(event.target)));render();});
