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
let pending = getLocal("qadam.mobile.pending", ""),
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
const status = (value) => (statuses[value] ? T(...statuses[value]) : value);
const amount = (value) =>
  `${new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "kk-KZ").format(Number(value) || 0)} ₸`;
const when = (value) => {
  const d = new Date(value);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString(lang === "ru" ? "ru-RU" : "kk-KZ", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
};
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
      "Код неверен или сессия истекла. Войди снова.",
      "Код қате немесе сессия аяқталды. Қайта кір.",
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
      "Лимит запросов. Подожди минуту и обнови вручную.",
      "Сұрау шегі. Бір минут күтіп, қолмен жаңарт.",
    ),
    503: T(
      "Функция временно недоступна на стенде. Данные не подменяются демо-результатом.",
      "Функция стендте уақытша қолжетімсіз. Демо-нәтижемен алмастырылмайды.",
    ),
  })[code] ?? T("Не удалось выполнить действие.", "Әрекет орындалмады.");
async function perform(task) {
  if (loading) return;
  loading = true;
  error = "";
  render();
  try {
    await task();
  } catch (failure) {
    error = errText(failure.status);
    if (failure.status === 401) {
      page = "login";
      data = null;
      evaluation = null;
    }
  } finally {
    loading = false;
    render();
  }
}
if (pending && !/^[0-9a-f-]{36}$/i.test(pending)) pending = "";
function accept(value) {
  evaluation = value;
  selectedId = value.transaction_id;
  receivedAt = Date.now();
}
async function open(next, id) {
  if (!gateway?.token && next !== "login") return;
  page = next;
  data = null;
  error = "";
  scanResult = null;
  if (id) selectedId = id;
  if (next !== "questionnaire") {
    answers = {};
    step = 0;
  }
  await perform(async () => {
    if (next === "home" || next === "history") {
      if (gateway.role === "admin")
        data = await api(
          `soc/feed?limit=20&offset=${offset}${filter ? `&status=${filter}` : ""}${query ? `&q=${encodeURIComponent(query)}` : ""}`,
        );
      else data = await gateway.request(`/transfers?limit=20&offset=${offset}`);
    } else if (next === "detail") {
      accept(await api(`transfers/${selectedId}`));
    } else if (next === "graph") data = await api(`soc/graph/${id}?depth=2`);
    else if (next === "timeline")
      data = await api(
        `integrations/soc/transactions/${selectedId}/timeline?limit=50`,
      );
    else if (next === "enrichment")
      data = await api(`integrations/soc/transactions/${selectedId}`);
    else if (next === "system") data = await api("integrations/health/details");
    else if (next === "contacts") data = await api("trusted-contacts");
    else if (next === "reports")
      data = await api("integrations/guardian/reports");
    else if (next === "cases")
      data = await api(
        `integrations/guardian/soc/cases?limit=20${casePageCursor ? `&cursor=${encodeURIComponent(casePageCursor)}` : ""}`,
      );
    else if (next === "case")
      data = await api(`integrations/guardian/soc/cases/${id}`);
    else if (next === "notifications")
      data = await api(
        `trusted-contacts/transactions/${selectedId}/notifications`,
      );
  });
  window.scrollTo(0, 0);
}
function loginView() {
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
function reviewView() {
  return `${title(T("Подтверди тестовый перевод", "Тест аударымын раста"))}<section class="paper"><p>${T("Тестовый получатель", "Тест алушысы")}</p><h2>${E(draft.recipient_phone)}</h2><div class="amount">${amount(draft.amount)}</div><p>${T("Запрос уйдёт в тестовый antifraud и сохранится в его истории. Это не настоящий банковский перевод.", "Сұрау тест antifraud-қа жіберіліп, тарихта сақталады. Бұл нақты банк аударымы емес.")}</p></section>${button("submit-transfer", T("Отправить на анализ", "Талдауға жіберу"))}`;
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
function detailView() {
  if (!evaluation) return "";
  const tx = evaluation,
    admin = gateway.role === "admin";
  const reasons = tx.reasons ?? [],
    contributors = tx.ml_contributors ?? [];
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
      T("Scam Check · проверка сообщения", "Scam Check · хабарламаны тексеру"),
      T(
        "Локальные правила без внешнего AI и сохранения текста",
        "Мәтінді сақтамайтын, сыртқы AI қолданбайтын ережелер",
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
        "Синтетическое обращение в демо-SOC",
        "Демо-SOC-қа жасанды деректермен хабарлама",
      ),
    ],
    [
      "reports",
      T("Мои обращения", "Менің өтініштерім"),
      T("История и отметка оператора", "Тарих пен оператор белгісі"),
    ],
    [
      "gateway",
      T("Mock Gateway", "Mock Gateway"),
      T(
        "Только синтетические идентификаторы; не НБК",
        "Тек жасанды идентификаторлар; ҰБ емес",
      ),
    ],
  ];
  return `${title(T("Защита рядом", "Қорғаныс жаныңда"))}<div class="action-list">${cards.map(([key, label, sub]) => `<button data-action="${key}">${label}<small>${sub}</small></button>`).join("")}</div>`;
}
function scanView() {
  return `${title("Scam Check", T("Вводи только синтетический текст, без кодов и реквизитов.", "Кодтар мен деректемелерсіз тек жасанды мәтін енгіз."))}<section class="paper"><form id="scan-form" class="form-stack"><label>${T("Текст сообщения", "Хабарлама мәтіні")}<textarea name="text" minlength="1" maxlength="2000" required autocomplete="off"></textarea></label><button class="primary" type="submit">${T("Проверить", "Тексеру")} →</button></form></section>${scanResult ? `<section class="paper"><h2>${T("Результат", "Нәтиже")}</h2><p>${E(scanResult.guidance)}</p>${(scanResult.signals ?? []).map((s) => `<div class="reason"><p>${E(s.explanation)}</p></div>`).join("")}<p class="fine">${E(scanResult.limitation)}</p></section>` : ""}`;
}
function reportView() {
  return `${title(T("Демо-обращение", "Демо-өтініш"))}<section class="paper"><form id="report-form" class="form-stack"><label>${T("Категория", "Санат")}<select name="category"><option value="impersonation">${T("Представился банком", "Банк атынан танысты")}</option><option value="safe_account">${T("«Безопасный счёт»", "«Қауіпсіз шот»")}</option><option value="remote_access">${T("Удалённый доступ", "Қашықтан кіру")}</option><option value="other">${T("Другое", "Басқа")}</option></select></label><label>${T("Синтетическое описание", "Жасанды сипаттама")}<textarea name="description" minlength="10" maxlength="500" required autocomplete="off"></textarea></label><label class="tick-field"><input type="checkbox" name="consent" required>${T("Подтверждаю отправку в демо-SOC. В тексте нет настоящих личных данных.", "Демо-SOC-қа жіберуді растаймын. Мәтінде нақты жеке деректер жоқ.")}</label><button class="primary" type="submit">${T("Отправить в демо-SOC", "Демо-SOC-қа жіберу")} →</button></form></section>`;
}
function reportsView() {
  return `${title(T("Обращения", "Өтініштер"))}${!data?.length ? `<p class="empty">${T("Обращений нет", "Өтініштер жоқ")}</p>` : data.map((r) => `<section class="paper"><span class="status-pill">${E(r.state)}</span><p>${E(r.description)}</p><p class="fine">${E(r.category)} · ${when(r.created_at)}</p>${gateway.role === "admin" ? `<div class="inline-actions"><button data-ack="${E(r.id)}">${T("Отметить", "Белгілеу")}</button><button data-open-case="${E(r.id)}">${T("Открыть дело", "Іс ашу")}</button></div>` : ""}</section>`).join("")}${button("reports", T("Обновить", "Жаңарту"), "secondary")}`;
}
function contactsView() {
  return `${title(T("Круг доверия", "Сенім шеңбері"), T("Контакт может сообщить о подозрении, но не одобрить перевод. Приглашение не означает согласие.", "Сенімді адам күдік туралы хабарлай алады, бірақ аударымды мақұлдай алмайды. Шақыру келісім болып саналмайды."))}<section class="paper">${(data?.contacts ?? []).map((c) => `<div class="contact"><strong>${E(c.alias || T("Контакт", "Контакт"))}</strong><p>${E(c.state)}</p><small>${E(c.language)}</small>${c.state !== "CONTACT_REVOKED" ? `<button class="text-button" data-revoke="${E(c.id)}">${T("Отозвать согласие", "Келісімді қайтарып алу")}</button>` : ""}</div>`).join("") || `<p>${T("Контакты не подключены.", "Контактілер қосылмаған.")}</p>`}</section><p class="callout">${T("Этот стенд работает с Fake Telegram. Реальные сообщения из приложения выключены. Подключение живого бота — отдельная согласованная проверка.", "Бұл стенд Fake Telegram-мен жұмыс істейді. Қолданбадан нақты хабарлама жіберу өшірулі. Нақты ботты қосу — бөлек келісілген тексеру.")}</p>${button("invite-confirm", T("Создать тестовое приглашение", "Тест шақыруын жасау"), "secondary")}`;
}
function graphView() {
  const nodes = data?.nodes ?? [],
    edges = data?.edges ?? [],
    visible = nodes.slice(0, 30);
  const coords = new Map(
    visible.map((n, i) => [
      n.id,
      {
        x:
          180 + 125 * Math.cos((2 * Math.PI * i) / Math.max(visible.length, 1)),
        y:
          150 + 110 * Math.sin((2 * Math.PI * i) / Math.max(visible.length, 1)),
      },
    ]),
  );
  return `${title(T("Связи получателя", "Алушының байланыстары"), T("Признаки дроп-сети — основание для проверки, а не доказательство вины.", "Дроп-желі белгілері — тексеруге негіз, кінәнің дәлелі емес."))}<svg class="graph" viewBox="0 0 360 300" role="img" aria-label="${T("Граф связей", "Байланыстар графы")}">${edges
    .filter((e) => coords.has(e.source) && coords.has(e.target))
    .map(
      (e) =>
        `<line x1="${coords.get(e.source).x}" y1="${coords.get(e.source).y}" x2="${coords.get(e.target).x}" y2="${coords.get(e.target).y}"/>`,
    )
    .join(
      "",
    )}${visible.map((n, i) => `<g class="${["mule", "hub"].includes(n.data.role) ? n.data.role : "normal"}"><circle cx="${coords.get(n.id).x}" cy="${coords.get(n.id).y}" r="15"/><text x="${coords.get(n.id).x}" y="${coords.get(n.id).y + 4}" text-anchor="middle">${i + 1}</text></g>`).join("")}</svg><p class="fine">${T("Схема показывает до 30 узлов; полный ответ ограничен сервером.", "Сызба 30 түйінге дейін көрсетеді; толық жауапты сервер шектейді.")}</p><div class="node-list">${nodes.map((n, i) => `<div><strong>${i + 1}. ${E(n.data.label)}</strong><small>${E(n.data.role)} · ${T("входящие / исходящие", "кіріс / шығыс")}: ${Number(n.data.in_degree)} / ${Number(n.data.out_degree)}</small><small>${T("Подозрение на транзит", "Транзит күдігі")}: ${n.data.suspected_mule ? T("да", "иә") : T("нет", "жоқ")} · ${T("общие устройства", "ортақ құрылғылар")}: ${Number(n.data.shared_device_accounts)}</small></div>`).join("")}</div>`;
}
function timelineView() {
  return `${title("Incident Timeline")}<section class="paper"><ol class="timeline">${(data?.events ?? []).map((e) => `<li><strong>${E(e[lang === "ru" ? "description_ru" : "description_kk"])}</strong><small>${when(e.timestamp)} · ${E(e.category)}</small></li>`).join("")}</ol></section>${data?.next_cursor ? button("timeline-more", T("Следующие события", "Келесі оқиғалар"), "secondary") : ""}`;
}
function systemView() {
  return `${title(T("Состояние интеграций", "Интеграциялар күйі"))}<section class="paper">${["database", "redis", "worker", "telegram", "gateway"].map((k) => `<div class="connection"><strong>${E(k)}</strong><small>${E(data?.[k] ?? "—")}</small></div>`).join("")}<p>${T("В очереди", "Кезекте")}: ${Number(data?.queue?.notifications_queued ?? 0)}</p><p>${T("Ошибок доставки", "Жеткізу қатесі")}: ${Number(data?.queue?.notifications_failed ?? 0)}</p><p class="fine">${when(data?.checked_at)} · ${T("Настоящие провайдеры не опрашиваются", "Нақты провайдерлер сұралмайды")}</p></section>${button("system", T("Обновить", "Жаңарту"), "secondary")}`;
}
function casesView() {
  return `${title(T("Дела SOC", "SOC істері"))}<div class="inline-actions">${button("reports", T("Обращения", "Өтініштер"), "secondary")}</div>${(data?.items ?? []).map((c) => `<button class="live-row" data-case="${E(c.id)}"><div><strong>${E(c.category)}</strong><span class="status-pill">${E(c.state)}</span></div><small>${when(c.created_at)} · v${Number(c.version)}</small></button>`).join("") || `<p class="empty">${T("Дел пока нет", "Істер әзірге жоқ")}</p>`}${data?.next_cursor ? button("cases-more", T("Ещё", "Тағы"), "secondary") : ""}`;
}
function caseView() {
  return data
    ? `${title(T("Работа с делом", "Іспен жұмыс"))}<section class="paper"><h2>${E(data.category)}</h2><p>${E(data.state)} · v${Number(data.version)}</p><p class="fine">${E(data.assignee ?? T("Не назначено", "Тағайындалмаған"))}</p><p class="break-id">${E(data.id)}</p></section>${data.state === "NEW" ? button("case-review", T("Взять в рассмотрение", "Қарауға алу")) : ""}${data.state === "IN_REVIEW" ? button("case-resolve", T("Завершить демо-разбор", "Демо-тексеруді аяқтау")) : ""}<p class="fine">${T("Действия фиксируются в журнале. Это не решение банка.", "Әрекеттер журналда сақталады. Бұл банк шешімі емес.")}</p>`
    : "";
}
function enrichmentView() {
  return `${title(T("Доказательства интеграций", "Интеграция деректері"))}<section class="paper"><h2>Mock Gateway</h2>${(data?.external_checks ?? []).map((c) => `<p>${E(c[lang === "ru" ? "description_ru" : "description_kk"] ?? c.result?.status)}</p>`).join("") || `<p>${T("Проверок нет", "Тексерулер жоқ")}</p>`}<h2>${T("Уведомления", "Хабарламалар")}</h2>${(data?.notifications ?? []).map((n) => `<p>${E(n.state)}</p>`).join("") || `<p>${T("Отправок нет", "Жіберілімдер жоқ")}</p>`}</section>`;
}
function gatewayView() {
  return `${title("Mock Gateway", T("Учебные данные. Это не обращение в НБК.", "Оқу деректері. Бұл ҰБ-ке сұрау емес."))}<section class="paper"><form id="gateway-form" class="form-stack"><label>${T("Синтетический идентификатор", "Жасанды идентификатор")}<select name="identifier"><option>SYN-CLEAR-001</option><option>SYN-REVIEW-001</option><option>SYN-NETWORK-001</option></select></label><button type="submit" class="primary">${T("Проверить", "Тексеру")} →</button></form>${data ? `<p>${E(data[lang === "ru" ? "description_ru" : "description_kk"])}</p><p class="fine">${E(data.result?.status)} · MOCK</p>` : ""}</section>`;
}
function settingsView() {
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
const screens = {
  sample: sampleView,
  login: loginView,
  home: historyView,
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
    `${title(T("Уведомления", "Хабарламалар"))}<section class="paper">${data?.length ? data.map((n) => `<p>${E(n.state)} · ${when(n.expires_at)}</p>`).join("") : T("Уведомлений нет. Реальные сообщения в этой сессии выключены.", "Хабарламалар жоқ. Осы сессияда нақты хабарламалар өшірулі.")}</section>`,
  confirmCancel: () =>
    `${title(T("Отменить перевод?", "Аударым тоқтатылсын ба?"))}<p class="callout">${T("Отмена тестовой операции необратима. Администратор не может отправить её за тебя.", "Тест әрекетін тоқтату қайтарылмайды. Әкімші оны сенің атыңнан жібере алмайды.")}</p>${button("cancel-transfer", T("Да, отменить", "Иә, тоқтату"))}${button("refresh-detail", T("Вернуться", "Қайту"), "secondary")}`,
  invite: () =>
    `${title(T("Тестовое приглашение", "Тест шақыруы"))}<p class="callout">${T("Подтверждаю своё согласие пригласить синтетический контакт. Согласие контакта отдельно; сообщение в Telegram не отправляется.", "Жасанды контактіні шақыруға келісімімді растаймын. Контактінің келісімі бөлек; Telegram-ға хабарлама жіберілмейді.")}</p>${button("create-invite", T("Подтверждаю", "Растаймын"))}`,
};
function render() {
  document.documentElement.lang = lang;
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
  root.innerHTML = `<div class="shell"><header class="topbar"><button class="back" data-action="back" aria-label="${T("Назад", "Артқа")}">←</button><div class="wordmark"><img src="mark.svg" alt=""><span>qadam</span></div><span class="role-tag">${gateway?.role === "admin" ? "SOC" : gateway?.role === "client" ? "CLIENT" : "ANDROID"}</span><button class="text-button" data-action="language">${lang === "ru" ? "ҚАЗ" : "РУС"}</button></header><div class="demo-strip ${gateway?.token ? "connected-strip" : ""}">${gateway?.token ? T("ТЕСТОВЫЙ BACKEND · СИНТЕТИЧЕСКИЕ ДАННЫЕ", "ТЕСТ BACKEND · ЖАСАНДЫ ДЕРЕКТЕР") : "QADAM SHIELD · CLIENT / SOC"}</div><main>${error ? `<div class="error-banner" role="alert">${E(error)}</div>` : ""}${loading ? `<div class="busy-banner" role="status"><span class="spinner"></span>${T("Получаем данные…", "Деректер алынуда…")}</div>` : ""}${(screens[page] ?? loginView)()}</main>${gateway?.token ? `<nav class="bottom-nav connected-nav" aria-label="${T("Навигация", "Навигация")}">${nav.map(([key, mark, label]) => `<button data-nav="${key}" aria-current="${page === key ? "page" : "false"}" ${loading ? "disabled" : ""}><b aria-hidden="true">${mark}</b><span>${label}</span></button>`).join("")}</nav>` : ""}</div>`;
}
root.addEventListener("click", async (event) => {
  const b = event.target.closest("button");
  if (!b || loading) return;
  if (b.dataset.role) {
    chosenRole = b.dataset.role;
    render();
    return;
  }
  if (b.dataset.nav) {
    offset = 0;
    casePageCursor = null;
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
    await perform(async () => {
      data = await api(
        "integrations/guardian/soc/cases",
        "POST",
        { report_id: b.dataset.openCase },
        crypto.randomUUID(),
      );
      page = "case";
    });
    return;
  }
  if (b.dataset.sample) {
    sampleId = b.dataset.sample;
    render();
    return;
  }
  const act = b.dataset.action;
  if (
    [
      "home",
      "history",
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
    render();
    return;
  }
  if (act === "back" && page === "sample") {
    if (sampleId) sampleId = null;
    else page = "login";
    render();
    return;
  }
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
    if (chosenRole === "admin") {
      page = "sample";
      sampleId = null;
      render();
    } else location.assign("index.html?offline=1");
    return;
  }
  if (act === "logout") {
    await perform(async () => {
      await gateway.logout();
      data = null;
      evaluation = null;
      page = "login";
    });
    if (!gateway.token) {
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
    draft = structuredClone(presetValues.normal);
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
      if (!putLocal("qadam.mobile.pending", id))
        throw new Error("storage unavailable");
      pending = id;
      const value = await api("transfers/evaluate", "POST", {
        ...draft,
        request_id: id,
        currency: "KZT",
      });
      accept(value);
      pending = "";
      putLocal("qadam.mobile.pending", "");
      page = "detail";
      draft = null;
    });
    return;
  }
  if (act === "recover") {
    await perform(async () => {
      accept(await api(`transfers/${pending}`));
      pending = "";
      putLocal("qadam.mobile.pending", "");
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
      pending = "";
      putLocal("qadam.mobile.pending", "");
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
      await api("trusted-contacts", "POST", {
        owner_consent: true,
        language: lang,
      });
    });
    if (!error) await open("contacts");
    return;
  }
  if (act === "case-review" || act === "case-resolve") {
    const current = data;
    await perform(async () => {
      data = await api(
        `integrations/guardian/soc/cases/${current.id}/actions`,
        "POST",
        {
          action: "transition",
          expected_version: current.version,
          state: act === "case-review" ? "IN_REVIEW" : "RESOLVED",
          reason: act === "case-review" ? "review_started" : "review_complete",
        },
        crypto.randomUUID(),
      );
    });
    return;
  }
});
root.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (loading) return;
  const form = event.target,
    fields = new FormData(form);
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
    page = "review";
    render();
    return;
  }
  if (form.id === "search-form") {
    query = String(fields.get("q") ?? "");
    offset = 0;
    await open("home");
    return;
  }
  if (form.id === "scan-form") {
    const text = String(fields.get("text"));
    form.reset();
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
      category: String(fields.get("category")),
      description: String(fields.get("description")),
      confirmed_demo_submission: true,
    };
    form.reset();
    await perform(() =>
      api("integrations/guardian/reports", "POST", body, crypto.randomUUID()),
    );
    if (!error) await open("reports");
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
  if (page === "login") {
    location.assign("index.html");
    return true;
  }
  if (page !== "home") {
    void open("home");
    return true;
  }
  return false;
}).catch(() => {});
setInterval(() => {
  const timer = document.querySelector("#countdown");
  if (timer) timer.textContent = timerText();
}, 1000);
render();
