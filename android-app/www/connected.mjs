import {revealChartSelection,stepChart} from "./spending-chart.mjs";
import { layoutNetwork, graphCamera } from "./network-graph.mjs";
let camera, caseTransaction=null, caseNetwork=null;
import { ledgerTime } from "./wallet-date.mjs";
import { walletUI, icon } from "./wallet.mjs";
import { shortcuts, familyView, checkView, packetContent } from "./guardian.mjs";
import { packetView } from "./packet.mjs";
import { readScreenshot } from "./screenshot.mjs";
import * as identity from "./identity.mjs";
const product = document.documentElement.hasAttribute("data-product");
let initializingAccount = product;
let ownerScope = "", account = null, reportDraft = null, invitation = null, caseEvents = [];
const defaultLedger=()=>({q:"",status:"",direction:"",day:"",through:"",days:""});
let ledgerFilter=defaultLedger(),summary=null,circle=null,reportHistory=[],requests=[],caseEvidence=null;
let walletDays=7,socDays=7,selectedDay=null,caseFilter="",caseOffset=0,backStack=[];
let lastRead=null;
let viewRevision=0, loginName="", projector=false;
let polling=false, nextPoll=0;
const webWallet=document.documentElement.hasAttribute("data-web-wallet");
let guardRefreshed = "", guardReceived = 0;
let scanText = "", reportChoice = false;
let drafts = {byOperation:{}, last:null};
const reportKey = id => id || "general";
function readDrafts(value) {
  if (value?.version === 2) return value;
  if (!value) return {version:2, byOperation:{}, last:null};
  const key = reportKey(value.transaction_id);
  return {version:2, byOperation:{[key]:value}, last:key};
}
function persistDrafts() {
  const slot = "report." + ownerScope;
  const snapshot = structuredClone(drafts);
  const write = savingDraft.catch(() => {}).then(() => identity.write(slot, snapshot));
  savingDraft = write;
  return write;
}
function selectReport(id) {
  reportTx = id || null;
  reportDraft = drafts.byOperation[reportKey(reportTx)] || null;
  reportChoice = false;
}
function reportContext(id) {
  return id ? T("Связанная операция","Байланысты операция") + " · " + E(id) :
    T("Без привязки к переводу","Аударымға байланыстырылмаған");
}
let savingDraft = Promise.resolve(), reportTx = null;
let presetMode = false, mutationOutcome = false, expiryChecked = null;
const accountLabel = () => T("Учебный счёт · виртуальные средства", "Оқу шоты · виртуалды қаражат");
const pendingKey = () => "qadam.mobile.pending." + ownerScope;
async function savePending(id) {
  if (product) await identity.write("pending." + ownerScope, {id});
  const saved = putLocal(pendingKey(), id);
  if (!saved && !product) throw new Error("storage unavailable");
  pending = id;
}
async function loadOwner(g, subject) {
  loginName="";
  gateway = g;
  ownerScope = await identity.scopeKey(g.origin, subject);
  const durable = product ? await identity.read("pending." + ownerScope) : null;
  pending = durable?.id ?? getLocal(pendingKey(), "");
  const old = getLocal("qadam.mobile.pending", "");
  if (!pending && old && getLocal("qadam.gateway", "") === g.origin && g.role === "client") {
    try {
      await g.api("transfers/" + old);
      await savePending(old); putLocal("qadam.mobile.pending", "");
    } catch { /* Preserve an unproven legacy request in quarantine. */ }
  }
  if (product) {
    await savingDraft.catch(() => {});
    drafts = readDrafts(await identity.read("report." + ownerScope));
    invitation = await identity.read("invite." + ownerScope);
  }
  offset = 0;
  let target=null;
  if(webWallet){
    const url=new URL(location.href);
    const id=url.searchParams.get("operation"),report=url.searchParams.get("report");
    const valid=value=>/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value||"");
    if(valid(id))target=["detail",id];else if(valid(report))target=["reportDetail",report];
    history.replaceState({wallet:true,page:"home",scope:ownerScope,depth:0},"",location.pathname);
  }
  await open("home");
  if(target)await open(...target);
}
function clearVisible() {
  viewRevision++;nextPoll=0;projector=false;loginName="";
  if(webWallet)history.replaceState({wallet:true},"",location.pathname);
  scanText=""; reportChoice=false; drafts=readDrafts(null);
  lastRead=null;
  account = reportDraft = invitation = evaluation = data = draft = selectedId = scanResult = null;
  summary=circle=caseEvidence=null;ledgerFilter=defaultLedger();reportHistory=[];requests=[];walletDays=socDays=7;caseFilter="";caseOffset=0;selectedDay=null;backStack=[];
  gateway = null; step = offset = 0; pending = ownerScope = query = filter = "";
  answers = {}; caseNetwork = caseTransaction = null; caseEvents = []; casePageCursor = null; reportTx = null; expiryChecked = null; page = "login"; presetMode = false;
}
import { SAMPLE } from "./soc-sample.mjs";
import { Gateway, gatewayOrigin, remainingSeconds } from "./gateway.mjs";
import { installBackHandler } from "./native.mjs";

const root = document.querySelector("#app");
const E = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const getLocal = (key, fallback) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const putLocal = (key, value) => {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};
let lang = getLocal("qadam.language", "kk") === "ru" ? "ru" : "kk";
const T = (ru, kk) => (lang === "ru" ? ru : kk);
let gateway = null,
  chosenRole = "client",
  page = "login",
  loading = false,
  error = "",
  data = null;
let evaluation = null,
  receivedAt = 0,
  selectedId = null,
  filter = "",
  offset = 0,
  query = "";
let pending = "",
  draft = null,
  step = 0,
  answers = {},
  scanResult = null;
let sampleId = null;
let loginOrigin = getLocal("qadam.gateway", "10.0.2.2:18001"),
  casePageCursor = null;
const statuses = {
  approved: ["Одобрено", "Мақұлданды"],
  cooling_off: ["Пауза", "Үзіліс"],
  blocked: ["Отклонено", "Қабылданбады"],
  cancelled: ["Отменено", "Тоқтатылды"],
};
const productStatuses={approved:["Выполнен","Орындалды"],cooling_off:["На проверке","Тексерілуде"],blocked:["Отклонён","Қабылданбады"],cancelled:["Отменён","Тоқтатылды"]};
const status = (value) => product && productStatuses[value] ? T(...productStatuses[value]) : (statuses[value] ? T(...statuses[value]) : value);
const amount = (value) =>
  `${new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "kk-KZ").format(Number(value) || 0)} ₸`;
const when = ledgerTime;
const button = (action, label, style = "primary", attributes = "") =>
  `<button class="${style}" data-action="${action}" ${attributes} ${loading ? "disabled" : ""}>${E(label)}<span aria-hidden="true">→</span></button>`;
const title = (heading, intro = "") =>
  `<div class="heading"><h1 tabindex="-1">${E(heading)}</h1>${intro ? `<p>${E(intro)}</p>` : ""}</div>`;
const input = (name, label, value = "", type = "text", extra = "") =>
  `<label>${E(label)}<input name="${name}" type="${type}" value="${E(value)}" ${extra}></label>`;
const api = (...args) => gateway.api(...args);
const errText = (code) =>
  ({
    0: T(
      "Сервер не ответил. Результат отправки неизвестен: проверь историю, не отправляй перевод повторно.",
      "Сервер жауап бермеді. Нәтиже белгісіз: тарихты тексер, аударымды қайта жіберме.",
    ),
    401: T(
      "Сессия истекла. Войди снова.",
      "Сессия аяқталды. Қайта кір.",
    ),
    403: T(
      "У этой роли нет доступа к действию.",
      "Бұл рөлге әрекет қолжетімсіз.",
    ),
    404: T(
      "Запись не найдена или недоступна этому пользователю.",
      "Жазба табылмады немесе осы пайдаланушыға қолжетімсіз.",
    ),
    409: T(
      "Состояние уже изменилось. Обнови данные перед следующим действием.",
      "Күй өзгерген. Келесі әрекетке дейін деректерді жаңарт.",
    ),
    422: T(
      "Проверь поля. Не вводи настоящие банковские данные или секреты.",
      "Өрістерді тексер. Нақты банк деректері мен құпияларды енгізбе.",
    ),
    429: T(
      "Достигнут лимит запросов. Попробуйте позже.",
      "Сұрау шегіне жеттіңіз. Кейінірек қайталап көріңіз.",
    ),
    503: T(
      "Сервис временно недоступен. Попробуйте ещё раз.",
      "Қызмет уақытша қолжетімсіз. Қайта көріңіз.",
    ),
  })[code] ?? T("Не удалось выполнить действие.", "Әрекет орындалмады.");
let failureState = null;
function failureText({status,login,offline,mutation,report}) {
  return offline ? T("Нет интернета. Подключись и попробуй снова.", "Интернет жоқ. Қосылып, қайта көр.")
      : login && status === 401 ? T("Неверный логин или пароль.","Логин немесе құпиясөз қате.")
      : report && status === 429 ? T("Обращение не отправлено. Попробуйте позже. За 24 часа можно отправить до пяти обращений.", "Өтініш жіберілмеді. Кейінірек қайталап көріңіз. 24 сағат ішінде бес өтінішке дейін жіберуге болады.")
      : status === 499 ? T("Вход отменён. Можно выбрать другой способ.", "Кіру тоқтатылды. Басқа тәсілді таңда.")
      : login && (status === 0 || status >= 500) ? T("Сервис входа пока недоступен. Попробуй позже или открой демонстрацию.", "Кіру қызметі әзірге қолжетімсіз. Кейін қайтала немесе демоны аш.")
      : status === 0 && !mutation ? T("Сервис не ответил. Попробуй обновить данные.", "Қызмет жауап бермеді. Деректерді жаңартып көр.")
      : errText(status);
}
async function perform(task) {
  if (loading) return;
  ++viewRevision;
  loading = true;
  error = ""; failureState=null;
  render();
  try {
    await task();
  } catch (failure) {
    if (failure.status === 409 && page === "case" && data?.id) {
      try {
        const id = data.id;
        data = await api("integrations/guardian/soc/cases/" + id);
        caseEvents = (await api("integrations/guardian/soc/cases/" + id + "/history")).items;
      } catch { data = null; }
    }
    failureState = {status:failure.status,login:page==="login",report:page==="report",offline:!navigator.onLine,mutation:mutationOutcome};
    error = failureText(failureState);
    if (failure.status === 401 && page !== "login") {
      if (product) await identity.write("session", null);
      clearVisible();
    }
  } finally {
    loading = false; mutationOutcome = false;
    render();
  }
}
if (pending && !/^[0-9a-f-]{36}$/i.test(pending)) pending = "";
function accept(value) {
  evaluation = value;
  selectedId = value.transaction_id;
  receivedAt = Date.now();
}
async function open(next, id, remember=true) {
  if (loading) return;
  if (!gateway?.token && next !== "login") return;
  if(product && remember && page!==next && page!=="login") {
    if(["home","history","analytics","settings","cases","safety","socAnalytics"].includes(next))backStack=[];
    else backStack.push({page,id:page==="case"||page==="reportDetail"?data?.id:selectedId});
  }
  if (webWallet && remember && page!=="login" && next!==page) {
    const key = next==="detail" ? "operation" : next==="reportDetail" ? "report" : null;
    const url=new URL(location.pathname,location.origin);
    if(key && id)url.searchParams.set(key,id);
    history.pushState({wallet:true,page:next,id:id||null,scope:ownerScope,depth:(history.state?.depth||0)+1}, "", url);
  }
  lastRead={page:next,id};
  page = next;
  data = null;
  error = "";
  scanResult = null;
  if (id && !["graph","case","reportDetail","incoming"].includes(next)) selectedId = id;
  if (next !== "questionnaire") {
    answers = {};
    step = 0;
  }
  await perform(async () => {
    if (next === "home" || next === "history") {
      if(product && gateway.role==="client") {
        if(next==="home"){
          const results=await Promise.allSettled([gateway.request("/account"),gateway.request("/wallet/operations?limit=3"),gateway.request("/wallet/analytics?days=7")]);
          const authFailure=results.find(r=>r.status==="rejected" && r.reason?.status===401);
          if(authFailure)throw authFailure.reason;
          [account,data,summary]=results.map(r=>r.status==="fulfilled"?r.value:null);
        }else{
          const params=new URLSearchParams({offset:String(offset),limit:"20"});
          for(const [k,v] of Object.entries(ledgerFilter))if(v)params.set(k,v);
          data=await gateway.request("/wallet/operations?"+params);
        }
      }else if (gateway.role === "admin") {
        if(product)summary=await gateway.request("/wallet/soc?days="+socDays);
        data = await api(
          `soc/feed?limit=20&offset=${offset}${filter ? `&status=${filter}` : ""}${query ? `&q=${encodeURIComponent(query)}` : ""}`,
        );
      } else {
        data = await gateway.request(`/transfers?limit=20&offset=${offset}`);
        if (product && next === "home") account = await gateway.request("/account");
      }
    } else if(next==="analytics") data=await gateway.request("/wallet/analytics?days="+walletDays);
    else if(next==="socAnalytics")data=await gateway.request("/wallet/soc?days="+socDays);
    else if(next==="incoming")data=await gateway.request("/wallet/incoming/"+id);
    else if(product && next==="safety") [account,circle]=await Promise.all([gateway.request("/account"),api("trusted-contacts")]);
    else if (next === "family") data = await gateway.request("/protection/family");
    else if (next === "guard" || next === "packet") {
      data = await gateway.request("/protection/"+selectedId+(next === "guard"?"/check":"/packet"));
      guardReceived=Date.now();
    } else if (product && next === "transfer") {
      account = await gateway.request("/account");
    } else if (next === "detail") {
      accept(await api(`transfers/${selectedId}`));
      if(product && gateway.role==="client" && evaluation.status==="cooling_off") data=await gateway.request("/protection/"+selectedId+"/check");
    } else if (next === "graph") data = await api(`soc/graph/${id}?depth=2`);
    else if (next === "timeline")
      data = await api(
        `integrations/soc/transactions/${selectedId}/timeline?limit=50`,
      );
    else if (next === "enrichment")
      data = await api(`integrations/soc/transactions/${selectedId}`);
    else if (next === "system") data = await api("integrations/health/details");
    else if (next === "contacts") data = await api("trusted-contacts");
    else if (next === "inbox") data = await gateway.request("/inbox");
    else if (next === "reportDetail") {
      [data,reportHistory,requests]=await readReport(gateway,id);
    }
    else if (next === "reports")
      data = await api("integrations/guardian/reports");
    else if(product && next==="cases") data=await gateway.request("/wallet/cases?offset="+caseOffset+(caseFilter?"&state="+caseFilter:""));
    else if (next === "cases")
      data = await api(
        `integrations/guardian/soc/cases?limit=20${casePageCursor ? `&cursor=${encodeURIComponent(casePageCursor)}` : ""}`,
      );
    else if (next === "case") {
      caseEvidence=null;caseEvents=[];caseTransaction=null;caseNetwork=null;
      data = await api(`integrations/guardian/soc/cases/${id}`);
      caseEvents = (await api(`integrations/guardian/soc/cases/${id}/history`)).items;
      if(product){
        caseEvidence=await api(`integrations/guardian/soc/cases/${id}/evidence`);
        if(caseEvidence?.transaction_id){
          try{
            caseTransaction=await api("transfers/"+caseEvidence.transaction_id);
            caseNetwork=await api("soc/graph/"+caseTransaction.recipient.id+"?depth=1");
          }catch(e){if(e.status===401)throw e;}
        }
      }
    }
    else if (next === "notifications")
      data = await api(
        `trusted-contacts/transactions/${selectedId}/notifications`,
      );
  });
  window.scrollTo(0, 0);
}
async function readReport(session,id) {
  const path="integrations/guardian/reports/"+id;
  const questions=product && session.role==="client"
    ? session.api(path+"/information-requests").catch(e=>{if(e.status!==404)throw e;return [];})
    : [];
  return Promise.all([session.api(path),session.api(path+"/history"),questions]);
}
function loginView() {
  if (product) return `<section class="entry sign-in"><div class="sign-heading"><img src="mark.svg" alt=""><h1>Qadam Shield</h1><p>${T("Переводы под защитой","Қорғалған аударымдар")}</p></div><p class="sign-intro">${T("Войдите в свой учебный аккаунт.","Оқу аккаунтыңызға кіріңіз.")}</p>
    <form id="personal-login" class="form-stack">
    ${input("login",T("Логин","Логин"),loginName, "text",'autocomplete="username" required maxlength="64" autocapitalize="none" spellcheck="false"')}
    <label>${T("Пароль","Құпиясөз")}<span class="password-field"><input type="password" name="password" required minlength="1" maxlength="128" autocomplete="current-password">
    <button type="button" data-action="show-password" aria-pressed="false">${T("Показать","Көрсету")}</button></span></label>
    <button class="primary" type="submit" ${loading ? "disabled" : ""}>${T("Войти","Кіру")}</button></form>
    ${webWallet && document.documentElement.hasAttribute("data-install")?'<a class="install-link" href="install/">'+T("Установить на Android","Android жүйесіне орнату")+'</a>':""}<div class="sign-footer"><small>${T("Демонстрационная версия","Демо нұсқа")}</small>${button("offline",T("Офлайн-обзор","Офлайн шолу"),"text-button")}</div></section>`;
  return `${title(T("Всё начинается с тебя", "Бәрі сенен басталады"), T("Выбери свою роль и войди на тестовый стенд.", "Рөліңді таңдап, тест стендіне кір."))}<div class="role-choice"><button data-role="client" aria-pressed="${chosenRole === "client"}">${T("Клиент", "Клиент")}<small>${T("Свои переводы и защита", "Өз аударымдарың мен қорғаныс")}</small></button><button data-role="admin" aria-pressed="${chosenRole === "admin"}">SOC / ${T("Администратор", "Әкімші")}<small>${T("Мониторинг и расследования", "Мониторинг пен тексеру")}</small></button></div><section class="paper login-card"><form id="login-form" class="form-stack" autocomplete="off">${input("origin", T("Адрес тестового сервера", "Тест серверінің мекенжайы"), loginOrigin, "text", 'required inputmode="url" placeholder="127.0.0.1:18001"')}${input("code", T("Код доступа твоей роли", "Өз рөліңнің кіру коды"), "", "password", 'required minlength="24" maxlength="128" autocomplete="off" spellcheck="false"')}<button class="primary" type="submit" ${loading ? "disabled" : ""}>${T("Войти", "Кіру")} →</button></form><p class="fine">${T("Код выдаёт владелец тестового стенда. Роль проверяет сервер. Это отдельный тестовый код, не пароль банка.", "Кодты тест стендінің иесі береді. Рөлді сервер тексереді. Бұл банк құпиясөзі емес, бөлек тест коды.")}</p></section>${button("offline", T("Попробовать без сервера", "Серверсіз байқап көру"), "secondary")}`;
}
function transactionRows(items, soc = false) {
  if (!items?.length)
    return `<div class="empty"><h3>${T("Пока нет операций", "Әзірге әрекеттер жоқ")}</h3><p>${T("Здесь появятся сохранённые сервером транзакции.", "Серверде сақталған транзакциялар осында көрінеді.")}</p></div>`;
  return items
    .map(
      (item) =>
        `<button class="live-row" data-detail="${E(item.transaction_id)}"><div><strong>${amount(item.amount)}</strong><span class="status-pill ${E(item.status)}">${E(status(item.status))}</span></div>${soc ? `<p>${E(item.sender?.full_name)} → ${E(item.recipient?.full_name)}</p>` : ""}<div><small>${when(item.created_at)}</small><span class="score">${T("Риск", "Тәуекел")} ${Number(item.risk_score)}/100</span></div></button>`,
    )
    .join("");
}
function historyView() {
  if(product && gateway.role==="client")return page==="history"?wallet.history(data,ledgerFilter):wallet.home(account,data,summary,getLocal("qadam.mask."+ownerScope,"0")==="1",pending);
  if(product && gateway.role==="admin")return wallet.soc(summary)+title(T("Лента операций","Операциялар тізімі"))+
    '<div class="filter-row">'+["","approved","cooling_off","blocked","cancelled"].map(k=>'<button data-filter="'+k+'" aria-pressed="'+(k===filter)+'">'+(k?E(status(k)):T("Все","Барлығы"))+'</button>').join("")+'</div><form id="search-form"><input name="q" maxlength="128" value="'+E(query)+'" aria-label="'+T("Имя или ID","Аты немесе ID")+'" placeholder="'+T("Имя или ID","Аты немесе ID")+'"></form>'+transactionRows(data?.items,true)+(offset?button("prev",T("Назад","Артқа"),"secondary"):"")+(data?.pagination?.has_more?button("next",T("Ещё","Тағы"),"secondary"):"");
  const admin = gateway.role === "admin",
    stats = data?.stats;
  return `${title(admin ? T("Пульс безопасности", "Қауіпсіздік көрінісі") : page === "home" ? T("Твой следующий шаг", "Келесі қадамың") : T("Мои транзакции", "Менің транзакцияларым"), admin ? T("Общая лента из PostgreSQL. Обновление по запросу.", "PostgreSQL-дегі жалпы тізім. Сұрау бойынша жаңартылады.") : T("Только твои операции. Решения принимает существующий antifraud.", "Тек өз әрекеттерің. Шешімді қолданыстағы antifraud қабылдайды."))}${
    admin && stats
      ? `<div class="metrics">${[
          [stats.total, T("Все транзакции", "Барлық транзакция")],
          [stats.cooling_off, T("На паузе", "Үзілісте")],
          [stats.blocked, T("Отклонено", "Қабылданбады")],
          [stats.blocked_hubs, T("Сигналы сети", "Желі белгілері")],
        ]
          .map(
            ([v, k]) =>
              `<div class="metric"><b>${Number(v)}</b><small>${k}</small></div>`,
          )
          .join("")}</div>`
      : ""
  }${!admin ? `<section class="balance-card"><span class="small-label">QADAM · TEST</span><h2>${T("Безопасный перевод начинается с проверки", "Қауіпсіз аударым тексеруден басталады")}</h2><p>${T("Синтетический стенд · реальные деньги не используются", "Жасанды деректер стенді · нақты ақша қолданылмайды")}</p></section><div class="inline-actions">${button("transfer", T("Новый перевод", "Жаңа аударым"), "secondary")}${button("safety", T("Моя защита", "Менің қорғанысым"), "secondary")}</div>${pending ? `<p class="error-banner">${T("Есть запрос с неизвестным результатом. Новая отправка отключена до проверки.", "Нәтижесі белгісіз сұрау бар. Тексерілгенше жаңа аударым өшірулі.")}</p>${button("recover", T("Проверить сохранённый запрос", "Сақталған сұрауды тексеру"), "secondary")}${button("abandon", T("Безопасно закрыть запрос", "Сұрауды қауіпсіз жабу"), "secondary")}` : ""}` : `<div class="filter-row">${["", "approved", "cooling_off", "blocked", "cancelled"].map((s) => `<button data-filter="${s}" aria-pressed="${filter === s}">${s ? E(status(s)) : T("Все", "Барлығы")}</button>`).join("")}</div><form id="search-form"><input class="filter-input" name="q" value="${E(query)}" maxlength="128" placeholder="${T("Имя или ID транзакции", "Аты немесе транзакция ID")}" aria-label="${T("Поиск транзакций", "Транзакция іздеу")}"></form>`}<div class="section-title"><h2>${T("Транзакции", "Транзакциялар")}</h2><button class="text-button" data-action="refresh">${T("Обновить", "Жаңарту")}</button></div>${transactionRows(data?.items, admin)}<div class="list-footer">${offset > 0 ? button("prev", T("Назад", "Артқа"), "secondary") : ""}${data?.has_more || data?.pagination?.has_more ? button("next", T("Ещё", "Тағы"), "secondary") : ""}</div>`;
}
const presetValues = {
  normal: {
    recipient_phone: "+77010000002",
    amount: "25000",
    context: {
      active_call: false,
      from_deposit: false,
      is_new_recipient: false,
    },
  },
  scam: {
    recipient_phone: "+77010000003",
    amount: "900000",
    context: { active_call: true, from_deposit: true, is_new_recipient: true },
  },
  hub: {
    recipient_phone: "+77010000004",
    amount: "250000",
    context: {
      active_call: false,
      from_deposit: false,
      is_new_recipient: true,
    },
  },
};
function transferView() {
  if (pending)
    return `${title(T("Сначала проверь предыдущий запрос", "Алдыңғы сұрауды тексер"))}${button("recover", T("Проверить статус", "Күйін тексеру"))}${button("abandon", T("Безопасно закрыть запрос", "Сұрауды қауіпсіз жабу"), "secondary")}`;
  if (product && !presetMode) return title(T("Новый перевод","Жаңа аударым")) + `<div class="from-account">${icon("outgoing")}<span><small>${T("Со счёта","Шоттан")}</small><strong>Qadam Shield · •••• ${E(account?.card_last4)}</strong></span></div><section class="paper transfer-sheet"><form id="transfer-form" class="form-stack">
    <label>${T("Учебный получатель","Оқу аударымын алушы")}<select required name="recipient_phone"><option value="">${T("Выбери получателя","Алушыны таңда")}</option>
    ${(account?.recipients ?? []).map(r => `<option value="${E(r.phone)}" ${draft?.recipient_phone === r.phone ? "selected" : ""}>${E(r.name)}</option>`).join("")}</select></label>
    ${input("amount",T("Сумма, ₸","Сома, ₸"), draft?.amount ?? "", "number", 'required min="0.01" max="999999999" step="0.01" inputmode="decimal"')}
    <label class="tick-field"><input type="checkbox" name="active_call" ${draft?.context?.active_call ? "checked" : ""}>${T("Меня просят перевести во время звонка","Қоңырау кезінде аударуды сұрады")}</label>
    <button class="primary">${T("Проверить реквизиты","Деректемелерді тексеру")}</button></form></section>${button("presets",T("Демонстрационные сценарии","Демонстрациялық сценарийлер"),"secondary")}`;
  const value = draft ?? presetValues.normal;
  return `${title(T("Новый тестовый перевод", "Жаңа тест аударымы"), T("Сумму и признаки анализирует сервер: ML, частота операций и связи получателя.", "Сома мен белгілерді сервер талдайды: ML, әрекет жиілігі және алушы байланыстары."))}<div class="filter-row">${Object.keys(
    presetValues,
  )
    .map(
      (p, i) =>
        `<button data-preset="${p}">${[T("Обычный", "Қалыпты"), T("Социнженерия", "Әлеуметтік инженерия"), T("Дроп-сеть", "Дроп-желі")][i]}</button>`,
    )
    .join(
      "",
    )}</div><section class="paper"><form id="transfer-form" class="form-stack"><label>${T("Тестовый получатель", "Тест алушысы")}<select name="recipient_phone">${Object.values(
    presetValues,
  )
    .map(
      (v, i) =>
        `<option value="${v.recipient_phone}" ${value.recipient_phone === v.recipient_phone ? "selected" : ""}>${["A. Demo", "B. Demo", "C. Demo"][i]} · ${v.recipient_phone}</option>`,
    )
    .join(
      "",
    )}</select></label>${input("amount", T("Сумма, ₸", "Сома, ₸"), value.amount, "number", 'min="0.01" max="1000000000" step="0.01" required inputmode="decimal"')}${[
    [
      "active_call",
      T("Идёт подозрительный звонок", "Күдікті қоңырау жүріп жатыр"),
    ],
    ["from_deposit", T("Деньги сняты с депозита", "Ақша депозиттен алынған")],
    ["is_new_recipient", T("Новый получатель", "Жаңа алушы")],
  ]
    .map(
      ([key, label]) =>
        `<label class="tick-field"><input type="checkbox" name="${key}" ${value.context[key] ? "checked" : ""}>${label}</label>`,
    )
    .join(
      "",
    )}<button type="submit" class="primary">${T("Проверить детали", "Мәліметті тексеру")} →</button></form></section>`;
}
async function back() {
  if(webWallet && history.state?.scope===ownerScope && history.state.depth>0){history.back();return;}
  const previous = backStack.pop();
  await open(previous?.page || "home", previous?.id, false);
}
function reviewView() {
  return `${title(T("Подтверди тестовый перевод", "Тест аударымын раста"))}<section class="paper"><p>${T("Тестовый получатель", "Тест алушысы")}</p><h2>${E(account?.recipients?.find(r => r.phone === draft.recipient_phone)?.name ?? draft.recipient_phone)}</h2><small>${E(draft.recipient_phone)}</small><div class="amount">${amount(draft.amount)}</div><p>${T("Запрос уйдёт в тестовый antifraud и сохранится в его истории. Это не настоящий банковский перевод.", "Сұрау тест antifraud-қа жіберіліп, тарихта сақталады. Бұл нақты банк аударымы емес.")}</p></section>${button("edit-transfer",T("Изменить данные","Деректерді өзгерту"),"secondary")}${button("submit-transfer", T("Подтвердить перевод", "Аударымды растау"))}`;
}
const questions = [
  [
    "caller_claims_bank_or_police",
    "Звонящий представился банком или полицией?",
    "Қоңырау шалушы өзін банк не полиция қызметкері деп таныстырды ма?",
  ],
  [
    "asked_to_move_to_safe_account",
    "Просят перевести на «безопасный счёт»?",
    "«Қауіпсіз шотқа» аударуды сұрай ма?",
  ],
  [
    "asked_to_keep_secret_or_install_app",
    "Просят хранить секрет или установить приложение?",
    "Құпия ұстауды не қолданба орнатуды сұрай ма?",
  ],
  [
    "initiated_by_customer",
    "Ты самостоятельно решил сделать перевод?",
    "Аударымды өзің жасауды шештің бе?",
  ],
  [
    "knows_recipient_personally",
    "Ты лично знаешь получателя?",
    "Алушыны жеке танисың ба?",
  ],
];
function questionnaireView() {
  if (step === questions.length)
    return `${title(T("Проверь ответы", "Жауаптарды тексер"))}<section class="paper">${questions.map(([key, ru, kk]) => `<div class="reason"><h3>${T(ru, kk)}</h3><p>${answers[key] ? T("Да", "Иә") : T("Нет", "Жоқ")}</p></div>`).join("")}</section><p class="callout">${T("Сервер сохранит ответы. До окончания Cooling-Off операция не будет разрешена даже при чистых ответах.", "Сервер жауаптарды сақтайды. Қауіпті жауаптар болмаса да, Cooling-Off аяқталмай аударымға рұқсат берілмейді.")}</p>${button("submit-answers", T("Подтвердить ответы", "Жауаптарды растау"))}`;
  return `${title(T("Проверка во время паузы", "Үзіліс кезіндегі тексеру"))}<div class="progress">${questions.map((_, i) => `<span class="${i <= step ? "filled" : ""}"></span>`).join("")}</div><span class="eyebrow">${step + 1} / 5</span><div class="question-card"><h2>${T(questions[step][1], questions[step][2])}</h2></div><div class="answer-grid">${button("answer-yes", T("Да", "Иә"))}${button("answer-no", T("Нет", "Жоқ"), "secondary")}</div>`;
}
function moneyOutcome(state) {
  const wording={
    approved:["Сумма списана со счёта отправителя и зачислена получателю.","Сома жіберушінің шотынан алынып, алушыға түсті."],
    cooling_off:["Деньги остаются на счёте. Получателю ещё ничего не зачислено.","Ақша шотта. Алушыға әлі түскен жоқ."],
    cancelled:["Перевод отменён. Списания со счёта нет.","Аударым тоқтатылды. Шоттан ақша алынған жоқ."],
    blocked:["Перевод остановлен. Деньги остались на счёте.","Аударым тоқтатылды. Ақша шотта қалды."]
  };
  return wording[state]?T(...wording[state]):"";
}
function detailView() {
  if (!evaluation) return "";
  const tx = evaluation,
    admin = gateway.role === "admin";
  const reasons = tx.reasons ?? [],
    contributors = tx.ml_contributors ?? [];
  if(product && !admin) {
    const held=tx.status==="cooling_off";
    const hold=held?'<section class="paper hold-card"><h2>'+T("Защитная пауза","Қорғаныс кідірісі")+'</h2><div class="timer" id="countdown">'+timerText()+'</div><p>'+T("По окончании паузы решение обновит сервер.","Кідіріс аяқталған соң шешімді сервер жаңартады.")+'</p><div class="inline-actions">'+button("questionnaire",T("Пройти опрос","Сауалнамадан өту"))+button("cancel-confirm",T("Отменить перевод","Аударымды тоқтату"),"secondary")+'</div></section>':"";
    const contact=held?'<section class="paper"><h2>Telegram Guardian</h2><p>'+(!data||data.transaction_id!==tx.transaction_id?T("Обновите статус для проверки доставки.","Жеткізу күйін жаңартыңыз."):data.contact_state?E(label(data.contact_state)):T("Уведомление для этой операции пока не зарегистрировано.","Бұл операцияның хабарламасы әлі тіркелмеген."))+'</p>'+button("notifications",T("История уведомлений","Хабарлама тарихы"),"secondary")+'</section>':"";
    return title(status(tx.status),tx[lang==="ru"?"headline_ru":"headline_kk"])+
      '<section class="paper receipt"><div class="amount">'+amount(tx.amount)+'</div><strong>'+E(tx.recipient?.display_name)+'</strong><p>'+E(tx.recipient?.iban_masked)+'</p>'+wallet.badge(tx.status)+'<p class="funds-outcome">'+E(moneyOutcome(tx.status))+'</p></section>'+hold+
      (reasons.length?'<section class="paper"><h2>'+T("Что учла проверка","Тексеруде ескерілген белгілер")+'</h2>'+reasons.map(r=>'<p>'+E(r[lang==="ru"?"reason_ru":"reason_kk"])+'</p>').join("")+'</section>':"")+contact+
      '<p class="break-id">'+E(tx.transaction_id)+'</p>'+button("refresh-detail",T("Обновить статус","Күйін жаңарту"),"secondary");
  }
  return `${title(status(tx.status), tx[lang === "ru" ? "headline_ru" : "headline_kk"])}<section class="paper"><div class="amount">${amount(tx.amount)}</div><p>${E(tx.recipient?.display_name)} · ${E(tx.recipient?.iban_masked)}</p><div class="risk-meter"><progress max="100" value="${Number(tx.risk_score)}" aria-label="${T("Оценка риска", "Тәуекел бағасы")}"></progress></div><div class="analysis-grid"><dl><dt>${T("Риск", "Тәуекел")}</dt><dd>${Number(tx.risk_score)} / 100</dd></dl><dl><dt>ML</dt><dd>${tx.ml_score == null ? "—" : Number(tx.ml_score).toFixed(1)} / 100</dd></dl></div><p class="fine">${T("Это оценки модели, не вероятность доказанного мошенничества.", "Бұл модель бағасы, дәлелденген алаяқтық ықтималдығы емес.")}</p></section>${tx.status === "cooling_off" ? `<section class="paper hold-card"><h2>${T("Cooling-Off · пауза", "Cooling-Off · үзіліс")}</h2><div class="timer" id="countdown">${timerText()}</div><p>${T("Время берётся с сервера. Истечение таймера само по себе не отправляет перевод.", "Уақыт серверден алынады. Таймердің бітуі аударымды автоматты жібермейді.")}</p>${!admin ? `<div class="inline-actions">${button("questionnaire", T("Пройти опрос", "Сауалнамадан өту"), "secondary")}${button("cancel-confirm", T("Отменить", "Тоқтату"), "secondary")}</div>` : ""}</section>` : ""}<section class="paper"><h2>${T("Почему такое решение", "Шешім себептері")}</h2>${reasons.length ? reasons.map((r) => `<div class="reason"><h3>${E(r[lang === "ru" ? "reason_ru" : "reason_kk"])}</h3><p>${E(r.layer)} · ${E(r.code)} · ${Number(r.score_delta) >= 0 ? "+" : ""}${Number(r.score_delta)}</p></div>`).join("") : `<p>${T("Дополнительные правила не сработали.", "Қосымша ережелер іске қосылған жоқ.")}</p>`}</section><section class="paper"><h2>${T("Как объясняет модель", "Модель түсіндірмесі")}</h2><p class="fine">${E(tx.ml_model_version)} · ${E(tx.ml_explanation_method)}</p>${contributors
    .slice(0, 8)
    .map(
      (c) =>
        `<div class="reason"><h3>${E(c[lang === "ru" ? "label_ru" : "label_kk"])}</h3><p>${T("Значение", "Мәні")}: ${Number(c.value).toFixed(2)} · ${T("Вклад", "Үлес")}: ${Number(c.contribution).toFixed(2)}</p></div>`,
    )
    .join(
      "",
    )}</section>${admin ? `<div class="action-list"><button data-graph="${E(tx.recipient.id)}">${T("Связи получателя и дроп-сеть", "Алушының байланыстары және дроп-желі")}</button><button data-action="timeline">Incident Timeline</button><button data-action="enrichment">${T("Gateway и уведомления", "Gateway және хабарламалар")}</button></div>` : button("notifications", T("Уведомления контакту", "Сенімді адамға хабарламалар"), "secondary")}<p class="break-id">${E(tx.transaction_id)}</p>${button("refresh-detail", T("Обновить статус", "Күйін жаңарту"), "secondary")}`;
}
function timerText() {
  const s = remainingSeconds(evaluation, receivedAt);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
function safetyView() {
  const cards = [
    [
      "scan",
      T("Проверить сообщение", "Хабарламаны тексеру"),
      T(
        "Узнать признаки обмана в тексте или на скриншоте",
        "Мәтін мен скриншоттағы алаяқтық белгілері",
      ),
    ],
    [
      "call",
      T("Банк мне звонит?", "Банк маған қоңырау шалып жатыр ма?"),
      T(
        "Проверить журнал тестовых звонков",
        "Тест қоңыраулары журналын тексеру",
      ),
    ],
    [
      "contacts",
      T("Круг доверия", "Сенім шеңбері"),
      T("Согласие, статусы и отзыв", "Келісім, күйлер және қайтарып алу"),
    ],
    [
      "report",
      T("Сообщить о подозрении", "Күдік туралы хабарлау"),
      T(
        "Передать ситуацию сотруднику безопасности",
        "Жағдайды қауіпсіздік қызметіне хабарлау",
      ),
    ],
    [
      "reports",
      T("Мои обращения", "Менің өтініштерім"),
      T("История и отметка оператора", "Тарих пен оператор белгісі"),
    ],
    [
      "gateway",
      T("Проверить получателя", "Алушыны тексеру"),
      T(
        "Только синтетические идентификаторы; не НБК",
        "Тек жасанды идентификаторлар; ҰБ емес",
      ),
    ],
  ];
  if(product){
    const symbols={scan:"safety",call:"call",report:"cases",reports:"history",gateway:"system"};
    const actions=cards.filter(([k])=>k!=="contacts").map(([k,n,sub])=>`<button data-action="${k}"><i>${icon(symbols[k])}</i><span><strong>${E(n)}</strong><small>${E(sub)}</small></span>${icon("arrow")}</button>`).join("");
    return title(T("Защита","Қорғаныс"))+'<section class="safety-list">'+actions+'</section>';
  }
  return `${title(T("Защита", "Қорғаныс"))}<div class="action-list">${cards.map(([key, label, sub]) => `<button data-action="${key}">${label}<small>${sub}</small></button>`).join("")}</div>`;
}
function scanView() {
  return `${title("Scam Check", T("Вставьте учебное сообщение или выберите скриншот. Уберите коды и реквизиты.", "Оқу хабарламасын енгізіңіз немесе скриншотты таңдаңыз. Кодтар мен деректемелерді алып тастаңыз."))}<section class="paper"><form id="scan-form" class="form-stack"><label>${T("Текст сообщения", "Хабарлама мәтіні")}<textarea name="text" minlength="1" maxlength="2000" required autocomplete="off">${E(scanText)}</textarea></label><button class="primary" type="submit">${T("Проверить", "Тексеру")} →</button></form></section>${button("clear-scan",T("Очистить текст","Мәтінді тазарту"),"text-button")}${scanResult ? `<section class="paper"><h2>${T("Результат", "Нәтиже")}</h2><p>${E(scanResult.guidance)}</p>${(scanResult.signals ?? []).map((s) => `<div class="reason"><p>${E(s.explanation)}</p></div>`).join("")}<p class="fine">${E(scanResult.limitation)}</p></section>` : ""}`;
}
function reportView() {
  if (reportChoice) return title(T("Выберите черновик","Нобайды таңдаңыз")) +
    '<section class="paper"><p>'+reportContext(drafts.byOperation[drafts.last]?.transaction_id)+'</p>'+
    button("report-previous",T("Продолжить прежний черновик","Алдыңғы нобайды жалғастыру"),"secondary")+
    '<p>'+reportContext(reportTx)+'</p>'+button("report-current",T("Открыть форму для этой операции","Осы операцияның нысанын ашу"))+'</section>';
  return `${title(T("Сообщить о подозрении", "Күдік туралы хабарлау"))}<section class="paper"><p class="report-context">${reportContext(reportTx)}</p><form id="report-form" class="form-stack"><label>${T("Категория", "Санат")}<select name="category"><option value="impersonation">${T("Представился банком", "Банк атынан танысты")}</option><option value="safe_account">${T("«Безопасный счёт»", "«Қауіпсіз шот»")}</option><option value="remote_access">${T("Удалённый доступ", "Қашықтан кіру")}</option><option value="other">${T("Другое", "Басқа")}</option></select></label><label>${T("Что произошло", "Не болды")}<textarea name="description" minlength="10" maxlength="500" required autocomplete="off"></textarea></label><label class="tick-field"><input type="checkbox" name="consent" required>${T("Подтверждаю отправку в демо-SOC. В тексте нет настоящих личных данных.", "Демо-SOC-қа жіберуді растаймын. Мәтінде нақты жеке деректер жоқ.")}</label><button class="primary" type="submit">${T("Отправить в демо-SOC", "Демо-SOC-қа жіберу")} →</button></form></section>`;
}
function reportsView() {
  return `${title(T("Обращения", "Өтініштер"))}${!data?.length ? `<p class="empty">${T("Обращений нет", "Өтініштер жоқ")}</p>` : data.map((r) => `<section class="paper"><span class="status-pill">${E(label(r.state))}</span><p>${E(r.description)}</p><p class="fine">${E(label(r.category))} · ${when(r.created_at)}</p><small>${E(r.id)}</small><button class="text-button" data-object="report" data-object-id="${E(r.id)}">${T("Открыть квитанцию","Түбіртекті ашу")}</button>${gateway.role === "admin" ? `<div class="inline-actions"><button data-ack="${E(r.id)}">${T("Отметить", "Белгілеу")}</button><button data-open-case="${E(r.id)}">${T("Открыть дело", "Іс ашу")}</button></div>` : ""}</section>`).join("")}${button("reports", T("Обновить", "Жаңарту"), "secondary")}`;
}
const labels = {
  GUARDIAN_REPORT_SUBMITTED:["Обращение принято","Өтініш қабылданды"],GUARDIAN_REPORT_DEMO_ACKNOWLEDGED:["Оператор отметил обращение","Оператор өтінішті белгіледі"],
  CONTACT_VERIFIED:["Согласие получено","Келісім берілді"],CONTACT_PENDING_CONSENT:["Ожидаем согласия","Келісім күтілуде"],
  CONTACT_REVOKED:["Согласие отозвано","Келісім қайтарылды"],NOTIFICATION_QUEUED:["В очереди","Кезекте"],
  NOTIFICATION_SENT:["Принято адаптером","Адаптер қабылдады"],CONTACT_ACKNOWLEDGED:["Контакт подтвердил получение","Сенімді адам қабылдағанын растады"],
  SUSPICION_REPORTED:["Сообщено о подозрении","Күдік туралы хабарланды"],DELIVERY_FAILED:["Ошибка доставки","Жеткізу қатесі"],
  NOTIFICATION_EXPIRED:["Срок истёк","Мерзімі өтті"],SUBMITTED:["Передано на рассмотрение","Қарауға берілді"],
  DEMO_ACKNOWLEDGED:["Отмечено оператором","Оператор белгіледі"],impersonation:["Выдача себя за другого","Басқа адам болып танысу"],
  safe_account:["Безопасный счёт","Қауіпсіз шот"],remote_access:["Удалённый доступ","Қашықтан кіру"],other:["Другое","Басқа"]
};
const label = key => labels[key] ? T(...labels[key]) : T("Статус уточняется","Күйі нақтылануда");
function contactsView() {
  return `${title(T("Круг доверия", "Сенім шеңбері"), T("Контакт может сообщить о подозрении, но не одобрить перевод. Приглашение не означает согласие.", "Сенімді адам күдік туралы хабарлай алады, бірақ аударымды мақұлдай алмайды. Шақыру келісім болып саналмайды."))}<section class="paper">${(data?.contacts ?? []).map((c) => `<div class="contact"><strong>${E(c.alias || T("Контакт", "Контакт"))}</strong><p>${E(label(c.state))}</p><small>${E(c.language)}</small>${c.state !== "CONTACT_REVOKED" ? `<button class="text-button" data-revoke="${E(c.id)}">${T("Отозвать согласие", "Келісімді қайтарып алу")}</button>` : ""}</div>`).join("") || `<p>${T("Контакты не подключены.", "Контактілер қосылмаған.")}</p>`}</section><p class="callout">${T("Этот стенд работает с Fake Telegram. Реальные сообщения из приложения выключены. Подключение живого бота — отдельная согласованная проверка.", "Бұл стенд Fake Telegram-мен жұмыс істейді. Қолданбадан нақты хабарлама жіберу өшірулі. Нақты ботты қосу — бөлек келісілген тексеру.")}</p>${button("invite-confirm", T("Пригласить близкого", "Жақын адамды шақыру"), "secondary")}`;
}
function graphView(graph=data, compact=false) {
  const nodes = graph?.nodes ?? [],
    edges = graph?.edges ?? [],
    visible = nodes.slice(0, 30);
  const {points:coords,box}=layoutNetwork(visible);
  const diagram=`<svg class="graph" tabindex="0" viewBox="${box.join(" ")}" role="img" aria-label="${T("Граф связей", "Байланыстар графы")}">${edges
    .filter((e) => coords.has(e.source) && coords.has(e.target))
    .map(
      (e) =>
        `<line data-edge="${E(e.id)}" class="${e.data?.highlight ? "evidence-edge" : ""}" x1="${coords.get(e.source).x}" y1="${coords.get(e.source).y}" x2="${coords.get(e.target).x}" y2="${coords.get(e.target).y}"/>`,
    )
    .join(
      "",
    )}${visible.map((n, i) => `<g class="${["mule", "hub"].includes(n.data.role) ? n.data.role : "normal"}"><circle cx="${coords.get(n.id).x}" cy="${coords.get(n.id).y}" r="15"/><text x="${coords.get(n.id).x}" y="${coords.get(n.id).y + 4}" text-anchor="middle">${i + 1}</text></g>`).join("")}</svg>`;
  if(compact)return diagram;
  return `${title(T("Связи получателя", "Алушының байланыстары"), T("Признаки дроп-сети — основание для проверки, а не доказательство вины.", "Дроп-желі белгілері — тексеруге негіз, кінәнің дәлелі емес."))}${diagram}<p class="fine">${T("Схема показывает до 30 узлов; полный ответ ограничен сервером.", "Сызба 30 түйінге дейін көрсетеді; толық жауапты сервер шектейді.")}</p><div class="node-list">${nodes.map((n, i) => `<div><strong>${i + 1}. ${E(n.data.label)}</strong><small>${E(n.data.role)} · ${T("входящие / исходящие", "кіріс / шығыс")}: ${Number(n.data.in_degree)} / ${Number(n.data.out_degree)}</small><small>${T("Подозрение на транзит", "Транзит күдігі")}: ${n.data.suspected_mule ? T("да", "иә") : T("нет", "жоқ")} · ${T("общие устройства", "ортақ құрылғылар")}: ${Number(n.data.shared_device_accounts)}</small></div>`).join("")}</div>`;
}
function timelineView() {
  return `${title("Incident Timeline")}<section class="paper"><ol class="timeline">${(data?.events ?? []).map((e) => `<li><strong>${E(e[lang === "ru" ? "description_ru" : "description_kk"])}</strong><small>${when(e.timestamp)} · ${E(e.category)}</small></li>`).join("")}</ol></section>${data?.next_cursor ? button("timeline-more", T("Следующие события", "Келесі оқиғалар"), "secondary") : ""}`;
}
function systemView() {
  return `${title(T("Состояние интеграций", "Интеграциялар күйі"))}<section class="paper">${["database", "redis", "worker", "telegram", "gateway"].map((k) => `<div class="connection"><strong>${E(k)}</strong><small>${E(data?.[k] ?? "—")}</small></div>`).join("")}<p>${T("В очереди", "Кезекте")}: ${Number(data?.queue?.notifications_queued ?? 0)}</p><p>${T("Ошибок доставки", "Жеткізу қатесі")}: ${Number(data?.queue?.notifications_failed ?? 0)}</p><p class="fine">${when(data?.checked_at)} · ${T("Настоящие провайдеры не опрашиваются", "Нақты провайдерлер сұралмайды")}</p></section>${button("system", T("Обновить", "Жаңарту"), "secondary")}`;
}
const caseStates={NEW:["Новое","Жаңа"],IN_REVIEW:["В работе","Қарастырылуда"],NEEDS_INFORMATION:["Ждём уточнения","Жауап күтілуде"],ESCALATED:["Передано старшему","Аға маманға берілді"],RESOLVED:["Разбор завершён","Талдау аяқталды"],CLOSED:["Закрыто","Жабылды"]};
const caseState=k=>caseStates[k]?T(...caseStates[k]):E(k);
function casesView() {
  if(product)return title(T("Дела SOC","SOC істері"))+button("reports",T("Обращения клиентов","Клиент өтініштері"),"secondary")+
    '<form id="case-filter" class="ledger-filter"><label>'+T("Статус дела","Істің күйі")+'<select name="state"><option value="">'+T("Все дела","Барлық істер")+'</option>'+Object.keys(caseStates).map(k=>'<option value="'+k+'" '+(caseFilter===k?'selected':'')+'>'+caseState(k)+'</option>').join("")+'</select></label><button class="secondary">'+T("Применить","Қолдану")+'</button></form>'+
    ((data?.items||[]).map(c=>'<button class="live-row" data-case="'+E(c.id)+'"><div><strong>'+E(label(c.category))+'</strong><span class="status-pill">'+caseState(c.state)+'</span></div><small>'+when(c.created_at)+'</small></button>').join("")||'<p class="empty">'+T("По этому фильтру дел нет.","Бұл сүзгі бойынша іс жоқ.")+'</p>')+
    (caseOffset?button("case-prev",T("Назад","Артқа"),"secondary"):"")+(data?.has_more?button("case-next",T("Ещё","Тағы"),"secondary"):"");
  return `${title(T("Дела SOC", "SOC істері"))}<div class="inline-actions">${button("reports", T("Обращения", "Өтініштер"), "secondary")}</div>${(data?.items ?? []).map((c) => `<button class="live-row" data-case="${E(c.id)}"><div><strong>${E(c.category)}</strong><span class="status-pill">${E(c.state)}</span></div><small>${when(c.created_at)} · v${Number(c.version)}</small></button>`).join("") || `<p class="empty">${T("Дел пока нет", "Істер әзірге жоқ")}</p>`}${data?.next_cursor ? button("cases-more", T("Ещё", "Тағы"), "secondary") : ""}`;
}
function caseView() {
  return data
    ? `${title(T("Работа с делом", "Іспен жұмыс"))}<section class="paper case-summary"><small>SOC · ${when(data.created_at)}</small><h2>${E(product?label(data.category):data.category)}</h2><p>${product?caseState(data.state):E(data.state)} · v${Number(data.version)}</p><p class="fine">${E(data.assignee ?? T("Не назначено", "Тағайындалмаған"))}</p><p class="break-id">${E(data.id)}</p></section>${data.state === "NEW" ? button("case-review", T("Взять в рассмотрение", "Қарауға алу")) : ""}${data.state === "IN_REVIEW" ? button("case-resolve", T("Завершить демо-разбор", "Демо-тексеруді аяқтау")) : ""}<p class="fine">${T("Действия фиксируются в журнале. Это не решение банка.", "Әрекеттер журналда сақталады. Бұл банк шешімі емес.")}</p>`
    : "";
}
function enrichmentView() {
  return `${title(T("Доказательства интеграций", "Интеграция деректері"))}<section class="paper"><h2>Mock Gateway</h2>${(data?.external_checks ?? []).map((c) => `<p>${E(c[lang === "ru" ? "description_ru" : "description_kk"] ?? c.result?.status)}</p>`).join("") || `<p>${T("Проверок нет", "Тексерулер жоқ")}</p>`}<h2>${T("Уведомления", "Хабарламалар")}</h2>${(data?.notifications ?? []).map((n) => `<p>${E(n.state)}</p>`).join("") || `<p>${T("Отправок нет", "Жіберілімдер жоқ")}</p>`}</section>`;
}
function gatewayView() {
  return `${title(T("Проверить получателя","Алушыны тексеру"), T("Проверка по учебному справочнику.", "Оқу анықтамалығы бойынша тексеру."))}<section class="paper"><form id="gateway-form" class="form-stack"><label>${T("Синтетический идентификатор", "Жасанды идентификатор")}<select name="identifier"><option>SYN-CLEAR-001</option><option>SYN-REVIEW-001</option><option>SYN-NETWORK-001</option></select></label><button type="submit" class="primary">${T("Проверить", "Тексеру")} →</button></form>${data ? `<p>${E(data[lang === "ru" ? "description_ru" : "description_kk"])}</p><p class="fine">${E(data.result?.status)} · MOCK</p>` : ""}</section>`;
}
function settingsView() {
  if (product) return title(T("Профиль","Профиль")) + `<section class="profile-sheet"><i>${icon("settings")}</i><div><h2>${gateway.role === "admin" ? T("Сотрудник безопасности","Қауіпсіздік қызметкері") : E(account?.display_name||"Qadam")}</h2><p>${accountLabel()}</p><small>Qadam Shield 2.4 · ${T("Учебный стенд","Оқу стенді")}</small></div></section>` +
    button("language",T("Язык · Русский","Тіл · Қазақша"),"secondary") +
    (gateway.role === "client" ? button("contacts",T("Мои согласия","Келісімдерім"),"secondary")+button("open-guardian","Telegram Guardian","secondary") : "") + button("logout",T("Выйти","Шығу"));
  return `${title(T("Профиль доступа", "Кіру профилі"))}<section class="paper"><h2>${gateway.role === "admin" ? "SOC / Admin" : T("Клиент", "Клиент")}</h2><p>${T("Роль назначена сервером. Сессия действует 30 минут, затем нужен повторный вход.", "Рөлді сервер тағайындады. Сессия 30 минутқа жарамды, содан кейін қайта кіру қажет.")}</p><p class="fine">${E(gateway.origin)}</p></section>${button("logout", T("Выйти из аккаунта", "Аккаунттан шығу"), "secondary")}`;
}
function sampleView() {
  const item = SAMPLE.items.find((row) => row.id === sampleId);
  const intro = T(
    "Снимок тестового стенда. Доступен офлайн, только для просмотра.",
    "Тест стендінің сақталған деректері. Офлайн көруге болады.",
  );
  if (!item)
    return (
      title(T("Примеры работы SOC", "SOC жұмыс мысалдары"), intro) +
      SAMPLE.items
        .map(
          (row) =>
            `<button class="live-row" data-sample="${E(row.id)}"><div><strong>${amount(row.amount)}</strong><span>${E(status(row.status))}</span></div><p>ML ${E(row.ml ?? "—")} / 100</p></button>`,
        )
        .join("")
    );
  return (
    title(status(item.status), intro) +
    `<section class="paper"><h2>${amount(item.amount)}</h2><p>ML ${E(item.ml ?? "—")} / 100 · ${E(item.model)}</p>${item.reasons.map((reason) => `<p>${E(reason[lang === "ru" ? "reason_ru" : "reason_kk"])}</p>`).join("")}</section><section class="paper"><h2>${T("Граф получателя", "Алушы графы")}</h2><p>${T("Узлы", "Түйіндер")} ${item.nodes} · ${T("Связи", "Байланыстар")} ${item.edges}</p><p>${T("Узлы для проверки", "Тексерілетін түйіндер")} ${item.suspects}</p></section>`
  );
}
const wallet=walletUI({T,E,amount,when,button,status});
const screens = {
  analytics:()=>wallet.analytics(data,selectedDay),
  socAnalytics:()=>wallet.soc(data,true),
  incoming:()=>data?'<h1>'+T("Входящий перевод","Кіріс аударым")+'</h1><section class="paper"><h2>+'+amount(data.amount)+'</h2><p>'+E(data.counterparty)+'</p>'+wallet.badge(data.status)+'<p>'+when(data.created_at)+'</p><small>'+E(data.transaction_id)+'</small></section>':"",
  family: () => familyView(data,T,button,when),
  guard: () => checkView(data,T,button,when,label),
  packet: () => data ? packetView(packetContent(data,T,when,status),E)+button("print-packet",T("Сохранить PDF","PDF сақтау")) : "",
  sample: sampleView,
  login: loginView,
  home: historyView,
  inbox: () => title(T("Сообщения безопасности","Қауіпсіздік хабарламалары")) +
    ((data?.items ?? []).map(e => `<button class="live-row" data-object="${E(e.kind)}" data-object-id="${E(e.object_id)}"><strong>${E(e.state === "cooling_off" ? status(e.state) : label(e.state))}</strong><small>${when(e.time)}</small></button>`).join("") || T("Пока нет сообщений","Әзірге хабарлама жоқ")),
  reportDetail: () => title(T("Квитанция обращения","Өтініш түбіртегі")) + (data ? `<section class="paper"><strong>${E(label(data.state))}</strong><p>${E(data.description)}</p><small>${E(data.id)} · ${when(data.created_at)}</small></section>` : ""),
  history: historyView,
  transfer: transferView,
  review: reviewView,
  detail: detailView,
  questionnaire: questionnaireView,
  safety: safetyView,
  scan: scanView,
  report: reportView,
  reports: reportsView,
  contacts: contactsView,
  graph: graphView,
  timeline: timelineView,
  system: systemView,
  cases: casesView,
  case: caseView,
  enrichment: enrichmentView,
  gateway: gatewayView,
  settings: settingsView,
  call: () =>
    `${title(T("Банк мне звонит?", "Банк маған қоңырау шалып жатыр ма?"))}<p class="callout">${T("Ответ только из тестового журнала нашего стенда. Это не проверка настоящего звонка банка.", "Жауап тек стендтің тест журналынан алынады. Бұл банктің нақты қоңырауын тексеру емес.")}</p>${button("check-call", T("Проверить тестовый журнал", "Тест журналын тексеру"))}${data ? `<section class="paper"><p>${E(data[lang === "ru" ? "message_ru" : "message_kk"])}</p></section>` : ""}`,
  notifications: () =>
    `${title(T("Уведомления", "Хабарламалар"))}<section class="paper">${data?.length ? data.map((n) => `<p>${E(label(n.state))} · ${when(n.expires_at)}</p>`).join("") : T("Уведомлений нет. Реальные сообщения в этой сессии выключены.", "Хабарламалар жоқ. Осы сессияда нақты хабарламалар өшірулі.")}</section>`,
  confirmCancel: () =>
    `${title(T("Отменить перевод?", "Аударым тоқтатылсын ба?"))}<p class="callout">${T("Отмена тестовой операции необратима. Администратор не может отправить её за тебя.", "Тест әрекетін тоқтату қайтарылмайды. Әкімші оны сенің атыңнан жібере алмайды.")}</p>${button("cancel-transfer", T("Да, отменить", "Иә, тоқтату"))}${button("refresh-detail", T("Вернуться", "Қайту"), "secondary")}`,
  invite: () =>
    `${title(T("Тестовое приглашение", "Тест шақыруы"))}<p class="callout">${T("Создайте приглашение для близкого. Уведомления доступны только после его личного согласия.", "Жақын адамыңызға шақыру жасаңыз. Хабарламалар оның жеке келісімінен кейін ғана қолжетімді.")}</p>${button("create-invite", T("Подтверждаю", "Растаймын"))}`,
};
function render() {
  document.documentElement.lang = lang;
  root.classList.toggle("projector",projector && gateway?.role==="admin");
  root.dataset.screen=page;root.dataset.actor=gateway?.role||"guest";
  const nav =
    gateway?.role === "admin"
      ? [
          ["home", "◫", T("Лента", "Тізім")],
          ["cases", "▤", T("Дела", "Істер")],
          ["system", "◎", T("Система", "Жүйе")],
          ["settings", "◉", T("Профиль", "Профиль")],
        ]
      : [
          ["home", "⌂", T("Главная", "Басты")],
          ["history", "◷", T("История", "Тарих")],
          ["safety", "◇", T("Защита", "Қорғаныс")],
          ["settings", "◉", T("Профиль", "Профиль")],
        ];
  if(product && gateway?.role==="admin")nav.splice(0,nav.length,["home","",T("Обзор","Шолу")],["cases","",T("Дела","Істер")],["socAnalytics","",T("Аналитика","Талдау")],["system","",T("Система","Жүйе")],["settings","",T("Профиль","Профиль")]);
  if (product && gateway?.role === "client") nav.splice(0, nav.length,
    ["home","",T("Главная","Басты")],["history","",T("Операции","Амалдар")],["safety","",T("Защита","Қорғаныс")],["analytics","",T("Аналитика","Талдау")],["settings","",T("Профиль","Профиль")]);
  const navPage=nav.some(([key])=>key===page)?page:
    (gateway?.role==="admin"?({case:"cases",reports:"cases",reportDetail:"cases",gateway:"system"}[page]||"home"):
    ({detail:"history",incoming:"history",contacts:"safety",scan:"safety",call:"safety",family:"safety",guard:"safety",report:"safety",reports:"safety",reportDetail:"safety",invite:"safety",questionnaire:"history",confirmCancel:"history"}[page]||"home"));
  root.innerHTML = `<div class="shell"><header class="topbar"><button class="back" data-action="back" aria-label="${T("Назад", "Артқа")}">←</button><div class="wordmark"><img src="mark.svg" alt=""><span>qadam</span></div><span class="role-tag">${gateway?.role === "admin" ? "SOC" : gateway?.role === "client" ? "CLIENT" : "ANDROID"}</span><button class="text-button" data-action="language">${lang === "ru" ? "ҚАЗ" : "РУС"}</button></header><div class="demo-strip ${gateway?.token ? "connected-strip" : ""}">${gateway?.token ? T("ТЕСТОВЫЙ BACKEND · СИНТЕТИЧЕСКИЕ ДАННЫЕ", "ТЕСТ BACKEND · ЖАСАНДЫ ДЕРЕКТЕР") : "QADAM SHIELD · CLIENT / SOC"}</div><main>${error ? `<div class="error-banner" role="alert">${E(error)}</div>` : ""}${loading ? `<div class="busy-banner" role="status"><span class="spinner"></span>${T("Получаем данные…", "Деректер алынуда…")}</div>` : ""}${(screens[page] ?? loginView)()}</main>${gateway?.token ? `<nav class="bottom-nav connected-nav" aria-label="${T("Навигация", "Навигация")}">${nav.map(([key, mark, label]) => `<button data-nav="${key}" aria-current="${(product?navPage:page) === key ? "page" : "false"}" ${loading ? "disabled" : ""}><b aria-hidden="true">${product ? icon(key==="socAnalytics"?"analytics":key) : mark}</b><span>${label}</span></button>`).join("")}</nav>` : ""}</div>`;
  if (product) {
    if(error && lastRead?.page===page && gateway?.token && !loading)root.querySelector(".error-banner")?.insertAdjacentHTML("beforeend",button("reload-screen",T("Обновить экран","Экранды жаңарту"),"secondary"));
    if (gateway?.role==="admin" && page==="home") root.querySelector("main").insertAdjacentHTML("afterbegin",button("projector",projector?T("Обычный вид","Қалыпты көрініс"):T("Режим проектора","Проектор режимі"),"projector-switch",'aria-pressed="'+projector+'"'));
    root.querySelector(".demo-strip")?.remove();
    root.querySelector(".role-tag")?.remove();
    const back = root.querySelector(".back");
    if (["login","home"].includes(page)) back.remove();
    if (gateway?.token && page!=="home") root.querySelector(".topbar").insertAdjacentHTML("beforeend",
      `<button data-action="settings" class="profile-button" aria-label="${T("Профиль","Профиль")}">${icon("settings")}</button>`);
    if (page === "settings" && gateway?.role === "client")
      root.querySelector("main").insertAdjacentHTML("beforeend",button("inbox",T("Сообщения безопасности","Қауіпсіздік хабарламалары"),"secondary"));
    if (page === "safety") {
      const section=root.querySelector("main");
      section.querySelector(".heading")?.insertAdjacentHTML("afterend",wallet.telegram(account,circle)+shortcuts(T));
    }

    if (page === "scan") {
      const form=root.querySelector("#scan-form");
      form.insertAdjacentHTML("afterbegin",'<label>'+T("Прочитать скриншот","Скриншотты оқу")+'<input class="ocr-input" type="file" accept="image/png,image/jpeg"></label><p class="hint" role="status" id="ocr-status">'+T("Изображение остаётся на телефоне. Перед проверкой можно исправить текст.","Сурет телефонда қалады. Тексерер алдында мәтінді түзете аласыз.")+'</p>');
      form.querySelector("input[type=file]").onchange = async e => {
        const file=e.target.files[0], message=form.querySelector("#ocr-status"), submit=form.querySelector("[type=submit]");
        if(!file) return;
        e.target.disabled=submit.disabled=true;
        message.textContent=T("Распознаём на устройстве…","Құрылғыда мәтін танылуда…");
        try {const text=await readScreenshot(file); if(text && form.isConnected){scanText=text;form.elements.text.value=text;scanResult=null;}
          message.textContent=text?T("Проверьте распознанный текст.","Танылған мәтінді тексеріңіз."):T("Не удалось прочитать текст. Введите его вручную.","Мәтін оқылмады. Қолмен енгізіңіз.");}
        catch{message.textContent=T("Не удалось открыть изображение. Выберите PNG/JPEG до 8 МБ или введите текст.","Сурет ашылмады. 8 МБ дейінгі PNG/JPEG таңдаңыз немесе мәтінді енгізіңіз.");}
        finally {e.target.disabled=submit.disabled=false;e.target.value="";}
      };
    }
    if (page === "call") root.querySelector("main").insertAdjacentHTML("beforeend",
      button("report",T("Сообщить о звонке","Қоңырау туралы хабарлау"),"secondary"));
    if (page === "contacts") {
      if(account?.contact_limit && (data?.contacts||[]).filter(c=>c.state!=="CONTACT_REVOKED").length>=account.contact_limit){
        const invite=root.querySelector('[data-action="invite-confirm"]');if(invite){invite.disabled=true;invite.textContent=T("Достигнут лимит контактов","Контактілер саны шегіне жетті")+" · "+account.contact_limit;}
      }
      if (account?.telegram_bot) root.querySelector(".callout")?.remove();
      for (const [i,c] of (data?.contacts ?? []).entries()) {
        const saved = invitation?.[c.id];
        if(c.state==="CONTACT_VERIFIED") root.querySelectorAll(".contact")[i]?.insertAdjacentHTML("beforeend",'<button class="secondary" data-pref="'+E(c.id)+'">'+(c.notifications_enabled?T("Выключить уведомления","Хабарламаларды өшіру"):T("Включить уведомления","Хабарламаларды қосу"))+'</button>');
        if (saved && c.state === "CONTACT_PENDING_CONSENT") {
          const el = root.querySelectorAll(".contact")[i];
          const active = Date.parse(saved.expires) > Date.now();
          el.insertAdjacentHTML("beforeend", `<p>${active ? T("Действует до","Жарамды мерзімі") + " " + when(saved.expires) : T("Приглашение истекло. Отзови его и создай новое.","Шақыру мерзімі өтті. Оны қайтарып, жаңасын жаса.")}</p>`);
          if(active && !account?.telegram_bot)el.insertAdjacentHTML("beforeend",'<button class="secondary" data-copy-invite="'+E(c.id)+'">'+T("Скопировать код для тестового адаптера","Тест адаптері үшін кодты көшіру")+'</button>');
          if (active && account?.telegram_bot) el.insertAdjacentHTML("beforeend", `<button class="secondary" data-share="${E(c.id)}">${T("Поделиться приглашением","Шақыруды бөлісу")}</button>`);
        }
      }
    }
    if(page==="reportDetail" && data) {
      const log=reportHistory.map(e=>'<p>'+E(label(e.event))+' · '+when(e.created_at)+'</p>').join("");
      root.querySelector("main").insertAdjacentHTML("beforeend",'<section class="paper"><h2>'+T("История обращения","Өтініш тарихы")+'</h2>'+log+'</section>'+
        requests.map(r=>'<section class="paper"><h3>'+E(r[lang==="ru"?"description_ru":"description_kk"])+'</h3>'+(r.answered?T("Ответ получен","Жауап алынды"):'<form class="form-stack" id="request-answer" data-id="'+E(r.id)+'"><label>'+T("Ответ для демо-SOC","Демо-SOC үшін жауап")+'<textarea name="body" minlength="10" maxlength="500" required></textarea></label><button>'+T("Отправить ответ","Жауапты жіберу")+'</button></form>')+'</section>').join(""));
    }
    if (page === "report" && !reportChoice && reportDraft) {
      const form = root.querySelector("#report-form");
      form.elements.category.value = reportDraft.category;
      form.elements.description.value = reportDraft.description;
      form.elements.consent.checked = reportDraft.consent;
    }
    if (page === "graph" && data) {
      camera=graphCamera(root.querySelector(".graph"));
      const nodes = data.nodes ?? [], edges = data.edges ?? [];
      const controls = `<div class="inline-actions">${button("graph-zoom",T("Увеличить","Үлкейту"),"secondary")}${button("graph-fit",T("Вместить","Сыйғызу"),"secondary")}${button("graph-full",T("На весь экран","Толық экран"),"secondary")}</div>
        <p>${T("Зелёная линия — связь, отмеченная анализатором. Красные узлы требуют проверки.","Жасыл сызық — талдаушы жүйе белгілеген байланыс. Қызыл түйіндер тексеруді қажет етеді.")}</p>
        <label>${T("Выбрать связь","Байланысты таңдау")}<select id="edge-focus"><option value="">—</option>${edges.filter(e=>nodes.slice(0,30).some(n=>n.id===e.source)&&nodes.slice(0,30).some(n=>n.id===e.target)).map(e =>
          `<option value="${E(e.id)}">${E(nodes.find(n=>n.id===e.source)?.data.label)} → ${E(nodes.find(n=>n.id===e.target)?.data.label)}</option>`).join("")}</select></label><p id="edge-detail" aria-live="polite"></p>`;
      root.querySelector(".graph")?.insertAdjacentHTML("afterend",controls);
      const menu=root.querySelector("#edge-focus").parentElement;
      menu.insertAdjacentHTML("beforebegin",'<label>'+T("Выбрать узел","Түйінді таңдау")+'<select id="node-focus"><option value="">—</option>'+nodes.slice(0,30).map((n,i)=>'<option value="'+i+'">'+(i+1)+'. '+E(n.data.label)+'</option>').join("")+'</select></label><p id="node-detail" aria-live="polite"></p>');
      let selection=0;
      const sourceRows=async(node,recipient,position=0)=>{
        const target=root.querySelector("#graph-records"), ticket=++selection;
        target.replaceChildren();if(!node)return;
        target.textContent=T("Загружаем операции…","Операциялар жүктелуде…");
        try{
          const q=new URLSearchParams({node,offset:String(position)});
          if(recipient)q.set("recipient",recipient);
          const batch=await gateway.request("/wallet/graph-operations?"+q);
          if(ticket!==selection||!target.isConnected)return;
          target.innerHTML='<h3>'+T("Операции в журнале","Журналдағы операциялар")+'</h3>'+
            (batch.items.map(tx=>'<button class="graph-record" data-detail="'+E(tx.transaction_id)+'"><strong>'+amount(tx.amount)+'</strong><span>'+E(status(tx.status))+' · '+E(when(tx.created_at))+'</span></button>').join("")||'<p>'+T("Для этой связи операций в журнале нет.","Бұл байланыс бойынша журналда операциялар жоқ.")+'</p>');
          for(const [show,next,text] of [[position>0,position-20,T("Назад","Артқа")],[batch.has_more,position+20,T("Далее","Әрі қарай")]]){
            if(show){const b=document.createElement("button");b.className="secondary";b.textContent=text;b.onclick=()=>sourceRows(node,recipient,next);target.append(b);}
          }
        }catch(e){if(ticket===selection && target.isConnected)target.textContent=errText(e.status);}
      };
      root.querySelector("#edge-detail").insertAdjacentHTML("afterend",'<section class="paper" id="graph-records" aria-live="polite"></section>');
      const selectNode=i=>{
        const n=nodes[i];
        void sourceRows(n?.id);
        camera.focus(root.querySelectorAll(".graph circle")[i]);
        root.querySelector("#node-focus").value=i;
        [...(root.querySelectorAll(".graph g"))].forEach((g,j)=>g.classList.toggle("focused-node",String(j)===String(i)));
        root.querySelector("#node-detail").textContent=n? n.data.label+' · '+T("Входящие / исходящие","Кіріс / шығыс")+' '+n.data.in_degree+' / '+n.data.out_degree:'';
      };
      root.querySelector("#node-focus").onchange=e=>selectNode(e.target.value);
      root.querySelectorAll(".graph g").forEach((g,i)=>g.onclick=()=>selectNode(i));
      root.querySelector("#edge-focus").onchange = e => {
        const edge = edges.find(v=>v.id===e.target.value);
        void sourceRows(edge?.data.edge_type==="transfer"?edge.source:null,edge?.target);
        for(const l of root.querySelectorAll(".graph line")) l.classList.toggle("selected-edge", l.dataset.edge===edge?.id);
        root.querySelector("#edge-detail").textContent = edge ? (edge.data.edge_type==="transfer" ? T("Переводы","Аударымдар") : T("Общее устройство","Ортақ құрылғы"))+" · "+edge.data.tx_count : "";
      };
    }
    if(page==="case" && caseTransaction){
      const panel=document.createElement("section");
      panel.className="paper case-investigation";
      panel.innerHTML='<div><h2>'+T("Операция по делу","Іске қатысты операция")+'</h2><strong class="amount">'+amount(caseTransaction.amount)+'</strong><p>'+E(caseTransaction.recipient.display_name)+'</p>'+wallet.badge(caseTransaction.status)+'<p>'+E(moneyOutcome(caseTransaction.status))+'</p></div>'+
        (caseNetwork?'<div>'+graphView(caseNetwork,true)+'<button class="secondary" data-graph="'+E(caseTransaction.recipient.id)+'">'+T("Исследовать связи","Байланыстарды зерттеу")+'</button></div>':"");
      root.querySelector("main .paper")?.after(panel);
    }
    if (page === "case" && data) root.querySelector("main").insertAdjacentHTML("beforeend",
      `<section class="paper case-rail"><h2>${T("История дела","Іс тарихы")}</h2>${caseEvents.map(e => `<p>${E(e[lang === "ru" ? "description_ru" : "description_kk"])} · ${when(e.timestamp)}</p>`).join("")}</section>
      <form id="case-note" class="form-stack paper"><label>${T("Заметка аналитика","Талдаушы жазбасы")}<textarea name="note" required minlength="10" maxlength="500"></textarea></label><button>${T("Сохранить","Сақтау")}</button></form>` +
      (caseEvidence?.transaction_id?'<button class="secondary" data-detail="'+E(caseEvidence.transaction_id)+'">'+T("Связанная операция","Байланысты операция")+'</button>':"") +
      (data.source==="owner_demo" && ["IN_REVIEW","ESCALATED"].includes(data.state)?button("case-information",T("Спросить, что требовал звонящий","Қоңырау шалушының талабын сұрау"),"secondary"):"") +
      button("case-assign",T("Назначить демо-аналитика","Демо-талдаушыны тағайындау"),"secondary"));
    if (page === "detail" && gateway?.role === "client" && evaluation) {
      root.querySelector(".paper")?.insertAdjacentHTML("afterbegin", `<small>${accountLabel()}</small>`);
      root.querySelector("main").insertAdjacentHTML("beforeend",
        (evaluation.context?.active_call || evaluation.status==="cooling_off" ? button("guard",T("Проверка после звонка","Қоңыраудан кейінгі тексеру"),"secondary") : "")+
        button("packet",T("Хронология и заявление","Хронология мен өтініш"),"secondary"));
      root.querySelector("main").insertAdjacentHTML("beforeend",button("report",T("Сообщить о мошенничестве","Алаяқтық туралы хабарлау"),"secondary"));
    }
  }
  if(page==="analytics")revealChartSelection(root);
  const locked = loading || (initializingAccount && page === "login");
  root.querySelector("main").setAttribute("aria-busy", String(locked));
  if (locked) {
    for (const field of root.querySelectorAll("main input, main select, main textarea, main button")) {
      field.disabled = true;
    }
  }

}
root.addEventListener("click", async (event) => {
  const b = event.target.closest("button");
  if (!b || loading) return;
  if(b.dataset.days){const value=Number(b.dataset.days);if(gateway.role==="admin")socDays=value;else walletDays=value;selectedDay=null;await open(page);return;}
  if(b.dataset.chartStep){stepChart(root,Number(b.dataset.chartStep));return;}
  if(b.dataset.chartDay){selectedDay=data.series.findIndex(v=>v.day===b.dataset.chartDay);render();root.querySelector('[data-chart-day="'+b.dataset.chartDay+'"]')?.focus({preventScroll:true});return;}
  if(b.hasAttribute("data-drill-status")||b.dataset.drillDay){ledgerFilter={...defaultLedger(),days:String(walletDays),status:b.dataset.drillStatus||"",day:b.dataset.drillDay||"",through:b.dataset.through||""};offset=0;await open("history");return;}
  if(b.dataset.payee){presetMode=false;draft={recipient_phone:b.dataset.payee,amount:"",context:{}};await open("transfer");return;}
  if(b.dataset.incoming){await open("incoming",b.dataset.incoming);return;}
  if (b.dataset.callId) { await open("guard",b.dataset.callId); return; }
  if (b.dataset.object) {
    const kind = b.dataset.object;
    await open(kind === "contact" ? "contacts" : kind === "report" ? "reportDetail" : "detail", b.dataset.objectId);
    if (kind === "contact") root.querySelector(`[data-revoke="${CSS.escape(b.dataset.objectId)}"]`)?.focus();
    return;
  }
  if(b.dataset.copyInvite){
    const saved=invitation?.[b.dataset.copyInvite];
    if(saved && Date.parse(saved.expires)>Date.now()){
      try {await navigator.clipboard.writeText(saved.token);b.textContent=T("Код скопирован","Код көшірілді");}
      catch {b.textContent=T("Копирование недоступно","Көшіру мүмкін емес");}
    }
    return;
  }
  if(b.dataset.pref){
    const c=data?.contacts?.find(v=>v.id===b.dataset.pref);
    if(c){await perform(()=>api("trusted-contacts/"+c.id+"/preferences","PATCH",{alias:c.alias,language:c.language,notifications_enabled:!c.notifications_enabled},crypto.randomUUID()));if(!error)await open("contacts");}
    return;
  }
  if (b.dataset.share) {
    const saved = invitation?.[b.dataset.share];
    if (account?.telegram_bot && saved && Date.parse(saved.expires) > Date.now())
      await perform(() => identity.shareInvite("https://t.me/" + account.telegram_bot + "?start=" + saved.token));
    return;
  }
  if (b.dataset.role) {
    chosenRole = b.dataset.role;
    render();
    return;
  }
  if (b.dataset.nav) {
    offset = 0;
    casePageCursor = null;
    if(b.dataset.nav==="history")ledgerFilter=defaultLedger();
    if (b.dataset.nav === "transfer") { presetMode = false; draft = null; }
    await open(b.dataset.nav);
    return;
  }
  if (b.dataset.detail) {
    await open("detail", b.dataset.detail);
    return;
  }
  if (b.dataset.graph) {
    await open("graph", b.dataset.graph);
    return;
  }
  if (b.dataset.case) {
    await open("case", b.dataset.case);
    return;
  }
  if (b.hasAttribute("data-filter")) {
    filter = b.dataset.filter;
    offset = 0;
    await open("home");
    return;
  }
  if (b.dataset.preset) {
    draft = structuredClone(presetValues[b.dataset.preset]);
    render();
    return;
  }
  if (b.dataset.revoke) {
    if (confirm(T("Отозвать это согласие?", "Осы келісім қайтарылсын ба?"))) {
      await perform(() =>
        api(`trusted-contacts/${b.dataset.revoke}`, "DELETE"),
      );
      if (!error) await open("contacts");
    }
    return;
  }
  if (b.dataset.ack) {
    await perform(() =>
      api(
        `integrations/guardian/reports/${b.dataset.ack}/acknowledge`,
        "POST",
        {},
      ),
    );
    if (!error) await open("reports");
    return;
  }
  if (b.dataset.openCase) {
    const reportId=b.dataset.openCase;
    const lookup=async()=> {
      const list=await gateway.request("/wallet/cases?report_id="+encodeURIComponent(reportId));
      return list.items.find(row=>row.report_id===reportId);
    };
    let target;
    await perform(async () => {
      if(product)target=await lookup();
      if(target)return;
      try {
        target=await api("integrations/guardian/soc/cases","POST",{report_id:reportId},crypto.randomUUID());
      } catch(failure) {
        if(!product || failure.status!==409)throw failure;
        target=await lookup();
        if(!target)throw failure;
      }
    });
    if(target)await open("case",target.id);
    return;
  }
  if (b.dataset.sample) {
    sampleId = b.dataset.sample;
    render();
    return;
  }
  const act = b.dataset.action;
  if (product && ["family","guard","packet"].includes(act)) { await open(act); return; }
  if (act === "call-transfer") { presetMode=false; draft={context:{active_call:true}}; await open("transfer"); return; }
  if (act === "family-on" || act === "family-off") {
    await perform(async()=>{data=await gateway.request("/protection/family","POST",{action:act==="family-on"?"enable":"disable"});}); return;
  }
  if (act === "guard-refresh") { await open("guard"); return; }
  if (["call-end","choice","pressure","notify-family"].includes(act)) {
    const path=act==="call-end"?"end":act==="notify-family"?"notify":"answer";
    await perform(async()=>{guardReceived=Date.now();data=await gateway.request("/protection/"+selectedId+"/"+path,"POST",
      path==="answer"?{answer:act==="choice"?"my_choice":"pressure"}:{});}); return;
  }
  if (act==="print-packet" && data) {await perform(()=>identity.printPacket(packetContent(data,T,when,status)));return;}
  if(act==="reload-screen" && lastRead){await open(lastRead.page,lastRead.id,false);return;}
  if (act==="retry-summary") {
    await perform(async()=>{summary=await gateway.request("/wallet/analytics?days=7");});
    return;
  }
  if(act==="retry-home"){await open("home",null,false);return;}
  if(act==="mask-balance"){const key="qadam.mask."+ownerScope;putLocal(key,getLocal(key,"0")==="1"?"0":"1");render();return;}
  if(act==="projector" && gateway.role==="admin"){projector=!projector;render();return;}
  if(act==="open-guardian"){if(account?.guardian_username)await perform(()=>identity.openGuardian(account.guardian_username));else await open("safety");return;}
  if(act==="clear-period"){ledgerFilter=defaultLedger();offset=0;await open("history");return;}
  if(act==="analytics"||act==="history"||act==="socAnalytics"){offset=0;if(act==="history")ledgerFilter=defaultLedger();await open(act);return;}
  if(act==="case-prev"||act==="case-next"){caseOffset=Math.max(0,caseOffset+(act==="case-prev"?-20:20));await open("cases");return;}
  if (act === "show-password") {
    const field = root.querySelector('[name=password]');
    const reveal = field.type === "password";
    field.type = reveal ? "text" : "password";
    b.setAttribute("aria-pressed",String(reveal));
    b.textContent = reveal ? T("Скрыть","Жасыру") : T("Показать","Көрсету");
    return;
  }
  if (act === "report") {
    const requested = page === "detail" ? selectedId : null;
    selectReport(requested);
    reportChoice = product && drafts.last && drafts.last !== reportKey(requested) && !!drafts.byOperation[drafts.last];
  }
  if (act === "report-current" || act === "report-previous") {
    selectReport(act === "report-previous" ? drafts.byOperation[drafts.last]?.transaction_id : reportTx);
    render(); return;
  }
  if (act === "clear-scan") { scanText=""; scanResult=null; error=""; render(); return; }
  if (act === "edit-transfer") { await back(); return; }
  if (act === "presets") { presetMode = true; render(); return; }
  if (
    [
      "home",
      "history",
      "inbox",
      "safety",
      "scan",
      "report",
      "reports",
      "contacts",
      "system",
      "cases",
      "gateway",
      "call",
      "settings",
      "timeline",
      "enrichment",
      "notifications",
    ].includes(act)
  ) {
    await open(act);
    return;
  }
  if (act === "language") {
    lang = lang === "ru" ? "kk" : "ru";
    putLocal("qadam.language", lang);
    if(error && failureState)error=failureText(failureState);
    render();
    return;
  }
  if (act === "back" && page === "sample") {
    if (sampleId) sampleId = null;
    else page = "login";
    render();
    return;
  }
  if (act === "graph-fit" || act === "graph-zoom") {
    if (act === "graph-fit") camera?.fit(); else camera?.enlarge(); return;
  }
  if (act === "graph-full") { const el=root.querySelector(".graph"); if (el?.requestFullscreen) await el.requestFullscreen().catch(()=>{}); return; }
  if (act === "back" && product) {await back();return;}
  if (act === "back") {
    if (page === "login") location.assign("index.html");
    else
      await open(
        page === "detail" || page === "settings" || page === "home"
          ? "home"
          : page === "questionnaire" || page === "confirmCancel"
            ? "detail"
            : "home",
      );
    return;
  }
  if (act === "offline") {
    if (product) { location.assign("index.html?offline=1"); return; }
    if (chosenRole === "admin") {
      page = "sample";
      sampleId = null;
      render();
    } else location.assign("index.html?offline=1");
    return;
  }
  if (act === "logout") {
    await perform(async () => {
      try { await gateway.logout(); } finally {
        if (product) await identity.write("session", null);
        clearVisible();
      }
      data = null;
      evaluation = null;
      page = "login";
    });
    if (!gateway?.token) {
      page = "login";
      render();
    }
    return;
  }
  if (act === "refresh") {
    await open(page);
    return;
  }
  if (act === "refresh-detail") {
    await open("detail");
    return;
  }
  if (act === "transfer") {
    presetMode = false; draft = product ? null : structuredClone(presetValues.normal);
    await open("transfer");
    return;
  }
  if (act === "next" || act === "prev") {
    offset = Math.max(0, offset + (act === "next" ? 20 : -20));
    await open(page);
    return;
  }
  if (act === "cases-more") {
    casePageCursor = data.next_cursor;
    await open("cases");
    return;
  }
  if (act === "timeline-more") {
    const cursor = data.next_cursor;
    await perform(async () => {
      data = await api(
        `integrations/soc/transactions/${selectedId}/timeline?cursor=${encodeURIComponent(cursor)}`,
      );
    });
    return;
  }
  if (act === "submit-transfer") {
    if (pending || !draft) return;
    await perform(async () => {
      const { request_id: id } = await gateway.request("/requests", "POST", {});
      await savePending(id);
      mutationOutcome = true;
      const value = await api("transfers/evaluate", "POST", {
        ...draft,
        request_id: id,
        currency: "KZT",
      });
      accept(value);
      await savePending("");
      page = "detail"; backStack=[];
      const guarded=product && draft.context?.active_call && value.status==="cooling_off";
      draft = null;
      if (product && value.status==="cooling_off") {
        try { data=await gateway.request("/protection/"+selectedId+"/check"); if(guarded)page="guard"; }
        catch (failure) { if(failure.status!==404) throw failure; }
      }
    });
    return;
  }
  if (act === "recover") {
    await perform(async () => {
      accept(await api(`transfers/${pending}`));
      await savePending("");
      page = "detail";
    });
    return;
  }
  if (act === "abandon") {
    if (!pending) return;
    await perform(async () => {
      const result = await api(
        `transfers/requests/${pending}/abandon`,
        "POST",
        {},
      );
      if (result.evaluation) {
        accept(result.evaluation);
        page = "detail";
      } else page = "home";
      await savePending("");
    });
    if (!error && page === "home") await open("home");
    return;
  }
  if (act === "questionnaire") {
    answers = {};
    step = 0;
    page = "questionnaire";
    render();
    return;
  }
  if (act === "answer-yes" || act === "answer-no") {
    if (step < questions.length) {
      answers[questions[step][0]] = act === "answer-yes";
      step++;
      render();
    }
    return;
  }
  if (act === "submit-answers") {
    await perform(async () => {
      accept(
        await api(`transfers/${selectedId}/resolve-cooling`, "POST", {
          answers,
        }),
      );
      page = "detail";
      answers = {};
      step = 0;
    });
    if(product && !error)await open("detail",selectedId,false);
    return;
  }
  if (act === "cancel-confirm") {
    page = "confirmCancel";
    render();
    return;
  }
  if (act === "cancel-transfer") {
    await perform(async () => {
      accept(await api(`transfers/${selectedId}/cancel`, "POST", {}));
      page = "detail";
    });
    return;
  }
  if (act === "check-call") {
    await perform(async () => {
      data = await api("call-check", "POST", {});
    });
    return;
  }
  if (act === "invite-confirm") {
    page = "invite";
    render();
    return;
  }
  if (act === "create-invite") {
    await perform(async () => {
      const created = await api("trusted-contacts", "POST", {
        owner_consent: true,
        language: lang,
      });
      invitation = {...invitation, [created.contact.id]: {token: created.invitation_token, expires: created.expires_at}};
      if (product) await identity.write("invite." + ownerScope, invitation);
    });
    if (!error) await open("contacts");
    return;
  }
  if (["case-review","case-resolve","case-assign","case-information"].includes(act)) {
    const current = data;
    await perform(async () => {
      data = await api(
        `integrations/guardian/soc/cases/${current.id}/actions`,
        "POST",
        {
          ...(act==="case-information"?{action:"request_information",question:"caller_request"}:act === "case-assign" ? {action:"assign",assignee:"demo_analyst_a"} : {
          action: "transition",
          expected_version: current.version,
          state: act === "case-review" ? "IN_REVIEW" : "RESOLVED",
          reason: act === "case-review" ? "review_started" : "review_complete"}),
          expected_version: current.version,
        },
        crypto.randomUUID(),
      );
    });
    if(!error)await open("case",current.id,false);
    return;
  }
});
root.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (loading) return;
  const form = event.target,
    fields = new FormData(form);
  if (form.id === "personal-login") {
    if(initializingAccount)return;
    loginName=String(fields.get("login")).trim();
    initializingAccount=true;
    try {
      let result;
      await perform(async () => {
        result=await identity.signIn(String(fields.get("login")).trim(),String(fields.get("password")));
      });
      if(result)await loadOwner(result.gateway,result.subject);
    } finally {initializingAccount=false;render();}
    return;
  }
  if(form.id==="ledger-filter"){ledgerFilter={...ledgerFilter,q:String(fields.get("q")||"").trim(),status:String(fields.get("status")||""),direction:String(fields.get("direction")||"")};offset=0;await open("history");return;}
  if(form.id==="case-filter"){caseFilter=String(fields.get("state")||"");caseOffset=0;await open("cases");return;}
  if(form.id==="request-answer"){const id=data.id;await perform(()=>api("integrations/guardian/reports/"+id+"/information-requests/"+form.dataset.id,"POST",{body:String(fields.get("body")),confirmed_demo_submission:true},crypto.randomUUID()));if(!error)await open("reportDetail",id);return;}
  if (form.id === "login-form") {
    const origin = gatewayOrigin(String(fields.get("origin") ?? ""));
    if (!origin) {
      error = T(
        "Для USB укажи 127.0.0.1:18001, для эмулятора — 10.0.2.2:18001. По Wi-Fi нужен HTTPS.",
        "USB үшін 127.0.0.1:18001, эмулятор үшін 10.0.2.2:18001 енгіз. Wi-Fi желісінде HTTPS қажет.",
      );
      render();
      return;
    }
    const code = String(fields.get("code"));
    form.querySelector('[name="code"]').value = "";
    loginOrigin = origin;
    await perform(async () => {
      const candidate = new Gateway(origin);
      await candidate.login(code);
      if (candidate.role !== chosenRole) {
        await candidate.logout();
        throw { status: 403 };
      }
      gateway = candidate;
      ownerScope = await identity.scopeKey(origin, candidate.role);
      pending = getLocal(pendingKey(), "");
      putLocal("qadam.gateway", origin);
      page = "home";
      offset = 0;
    });
    if (gateway?.token) await open("home");
    return;
  }
  if (form.id === "transfer-form") {
    draft = {
      recipient_phone: String(fields.get("recipient_phone")),
      amount: String(fields.get("amount")),
      context: {
        active_call: fields.has("active_call"),
        from_deposit: fields.has("from_deposit"),
        is_new_recipient: fields.has("is_new_recipient"),
      },
    };
    await open("review");
    return;
  }
  if (form.id === "case-note") {
    const id = data.id;
    await perform(() => api("integrations/guardian/soc/cases/"+id+"/actions","POST",{action:"note",body:fields.get("note"),expected_version:data.version},crypto.randomUUID()));
    if (!error) await open("case",id);
    return;
  }
  if (form.id === "search-form") {
    query = String(fields.get("q") ?? "");
    offset = 0;
    await open("home");
    return;
  }
  if (form.id === "scan-form") {
    const text = scanText = String(fields.get("text"));
    scanResult=null;
    await perform(async () => {
      scanResult = await api("integrations/guardian/scam-check", "POST", {
        text,
        language: lang,
      });
    });
    return;
  }
  if (form.id === "report-form") {
    const body = {
      ...(reportTx ? {transaction_id:reportTx} : {}),
      category: String(fields.get("category")),
      description: String(fields.get("description")),
      confirmed_demo_submission: true,
    };
    const key = reportDraft?.key || crypto.randomUUID();
    reportDraft = {...body, consent: fields.has("consent"), key};
    await perform(async () => {
      if (product) { drafts.byOperation[reportKey(reportTx)]=reportDraft; drafts.last=reportKey(reportTx); await persistDrafts(); }
      const receipt = await api("integrations/guardian/reports", "POST", body, key);
      if (product) { delete drafts.byOperation[reportKey(reportTx)]; drafts.last=null; await persistDrafts(); }
      reportDraft = null; reportTx = null; selectedId = receipt.id;
    });
    if (!error) await open(product ? "reportDetail" : "reports", selectedId);
    return;
  }
  if (form.id === "gateway-form") {
    await perform(async () => {
      data = await api(
        "external-checks",
        "POST",
        { identifier: String(fields.get("identifier")) },
        crypto.randomUUID(),
      );
    });
    return;
  }
});
installBackHandler(() => {
  if (loading) return true;
  if (product && page === "login") return false;
  if (page === "login") {
    location.assign("index.html");
    return true;
  }
  if (page !== "home") {
    if(product)void back();else void open("home",null,false);
    return true;
  }
  return false;
}).catch(() => {});
setInterval(() => {
  if (page==="guard" && data?.state==="waiting" && !loading && !document.hidden &&
      Date.now()-guardReceived >= Date.parse(data.ready_at)-Date.parse(data.server_time) && guardRefreshed!==data.ready_at) {
    guardRefreshed=data.ready_at; void open("guard"); return;
  }
  const timer = document.querySelector("#countdown");
  if (timer) {
    timer.textContent = timerText();
    if (product && timer.textContent === "00:00" && expiryChecked !== selectedId && !loading) {
      expiryChecked = selectedId; void open("detail",selectedId);
    }
  }
}, 1000);
render();

if (product) identity.initialize(loadOwner, e => {
  error = e.status === 499 ? T("Вход отменён.","Кіру тоқтатылды.") : e.status === 401 ?
    T("Войди заново, чтобы продолжить.","Жалғастыру үшін қайта кір.") : T("Сервис входа недоступен. Попробуй позже.","Кіру қызметі қолжетімсіз. Кейін қайтала.");
  render();
}).catch(() => { error = T("Защищённое хранилище недоступно.","Қорғалған қойма қолжетімсіз."); render(); }).finally(() => { initializingAccount=false;render(); });

root.addEventListener("input", event => {
  if (event.target.matches("#scan-form textarea")) { scanText=event.target.value; scanResult=null; }
  const form = event.target.closest("#report-form");
  if (!form || !product || !ownerScope) return;
  const fields = new FormData(form);
  const draft = {category: fields.get("category"), description: fields.get("description"),
    consent: fields.has("consent"), transaction_id: reportTx, key:reportDraft?.key || crypto.randomUUID()};
  reportDraft = draft;
  drafts.byOperation[reportKey(reportTx)] = draft; drafts.last=reportKey(reportTx);
  persistDrafts().catch(() => {
    error = T("Не удалось сохранить черновик на устройстве.","Құрылғыға нобайды сақтау мүмкін болмады.");
  });
});
// Reconcile visible read models only. A form or an in-flight mutation always wins.
async function refreshVisible() {
  if (!product || !gateway?.token || loading || polling || document.hidden || Date.now()<nextPoll) return;
  const editing=()=>{
    const search=root.querySelector("#search-form input");
    return document.activeElement?.matches("input,textarea,select") ||
      Array.from(root.querySelectorAll("#case-note textarea,#request-answer textarea")).some(field=>field.value) ||
      (search && search.value!==query);
  };
  if (editing()) return;
  const g=gateway, rev=viewRevision, screen=page, id=selectedId;
  const here=()=>g===gateway && rev===viewRevision && page===screen && id===selectedId && !loading && !document.hidden && !editing();
  const same=(a,b)=>JSON.stringify(a,(k,v)=>["server_time","as_of"].includes(k)?undefined:v)===JSON.stringify(b,(k,v)=>["server_time","as_of"].includes(k)?undefined:v);
  const params=new URLSearchParams({offset:String(offset),limit:"20"});
  for(const [key,value] of Object.entries(ledgerFilter))if(value)params.set(key,value);
  let read;
  if(screen==="home" && g.role==="client")read=async()=>{
    const [a,l]=await Promise.all([g.request("/account"),g.request("/wallet/operations?limit=3")]);
    if(!here() || same(a,account)&&same(l,data))return;
    const weekly=await g.request("/wallet/analytics?days=7").catch(e=>{if(e.status===401)throw e;return null;});
    if(here()){account=a;data=l;summary=weekly;render();}
  };
  if(screen==="history" && g.role==="client")read=async()=>{
    const rows=await g.request("/wallet/operations?"+params);
    if(here() && !same(data,rows)){data=rows;render();}
  };
  if(screen==="detail" && id)read=async()=>{
    const tx=await g.api("transfers/"+id);
    const protection=g.role==="client" && tx.status==="cooling_off"?await g.request("/protection/"+id+"/check"):null;
    if(here() && (!same(tx,evaluation)||!same(data,protection))){accept(tx);data=protection;render();}
  };
  if(screen==="contacts" || screen==="safety")read=async()=>{
    const rows=await g.api("trusted-contacts");
    const old=screen==="safety"?circle:data;
    if(here() && !same(old,rows)){if(screen==="safety")circle=rows;else data=rows;render();}
  };
  if(screen==="home" && g.role==="admin")read=async()=>{
    const [metrics,feed]=await Promise.all([g.request("/wallet/soc?days="+socDays),g.api("soc/feed?limit=20&offset="+offset+(filter?"&status="+encodeURIComponent(filter):"")+(query?"&q="+encodeURIComponent(query):""))]);
    if(here() && (!same(summary,metrics)||!same(data,feed))){summary=metrics;data=feed;render();}
  };
  const reads={
    inbox:()=>g.request("/inbox"),
    reports:()=>g.api("integrations/guardian/reports"),
    cases:()=>g.request("/wallet/cases?offset="+caseOffset+(caseFilter?"&state="+caseFilter:"")),
    notifications:()=>g.api("trusted-contacts/transactions/"+id+"/notifications"),
    timeline:()=>g.api("integrations/soc/transactions/"+id+"/timeline?limit=50"),
    analytics:()=>g.request("/wallet/analytics?days="+walletDays),
    socAnalytics:()=>g.request("/wallet/soc?days="+socDays)
  };
  if(Object.hasOwn(reads,screen))read=async()=>{
    const rows=await reads[screen]();
    if(here() && !same(data,rows)){data=rows;render();}
  };
  if(screen==="reportDetail" && data?.id)read=async()=>{
    const snapshot=await readReport(g,data.id);
    if(here() && !same([data,reportHistory,requests],snapshot)){
      [data,reportHistory,requests]=snapshot;render();
    }
  };
  if(!read)return;
  polling=true;
  try{await read();}
  catch(e){
    if(here() && e.status===401){clearVisible();await identity.write("session",null);error=errText(401);render();}
    if(e.status===429)nextPoll=Date.now()+Math.max(1000,(Number(e.retryAfter)||60)*1000);
  }finally{polling=false;}
}
setInterval(refreshVisible,3000);
window.addEventListener("online",refreshVisible);
document.addEventListener("visibilitychange", () => {
  if (product && !document.hidden && !loading && page==="guard")void open(page,selectedId,false);
  else void refreshVisible();
});
if(webWallet)window.addEventListener("popstate",event=>{
  if(loading || !gateway?.token)return;
  const state=event.state;
  const route=state?.scope===ownerScope && Object.hasOwn(screens,state.page) ? state.page : "home";
  void open(route==="review" && !draft ? "transfer" : route,state?.id,false);
});
