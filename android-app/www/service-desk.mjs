import { hasOwn, last as lastItem } from "./compat.mjs";
import { ledgerInstant } from "./wallet-date.mjs";

// Views for the connected wallet. Case and access decisions always come from the gateway.
export function serviceDesk({ T, E, when, title, button, amount, status }) {
  const outcomes = {
    confirmed_fraud: ["Мошенничество подтверждено", "Алаяқтық расталды"],
    legitimate_transfer: ["Перевод признан правомерным", "Аударым заңды деп танылды"],
    insufficient_evidence: ["Недостаточно сведений", "Мәлімет жеткіліксіз"],
  };
  const outcomeLabel = code => hasOwn(outcomes, code) ? T(...outcomes[code]) : "";
  function closeCase(c) {
    if (!["IN_REVIEW", "ESCALATED", "NEEDS_INFORMATION", "RESOLVED"].includes(c.state)) return "";
    return `<form id="case-close" class="form-stack paper"><h2>${T("Результат расследования", "Тексеру қорытындысы")}</h2>
      <label>${T("Заключение сотрудника", "Қызметкердің қорытындысы")}<select name="outcome" required>
      <option value="">${T("Выберите заключение", "Қорытындыны таңдаңыз")}</option>
      ${Object.keys(outcomes).map(code => `<option value="${code}">${outcomeLabel(code)}</option>`).join("")}</select></label>
      <p>${T("Заключение сохранится в деле. Статус перевода и баланс определяются отдельно.", "Қорытынды іске тіркеледі. Аударым күйі мен шоттағы қалдық бөлек анықталады.")}</p>
      <button class="primary">${T("Закрыть дело", "Істі жабу")}</button></form>`;
  }
  function resolution(view) {
    if (view?.case_state !== "CLOSED" || !view.resolution) return "";
    const { outcome, operation, closed_at, balance } = view.resolution;
    let next = T("Сохраните номер дела. Если появились новые сведения, сообщите их банку.", "Іс нөмірін сақтаңыз. Жаңа мәлімет шықса, банкке хабарлаңыз.");
    if (outcome === "confirmed_fraud") next = operation?.status === "approved"
      ? T("Обратитесь в банк через официальный канал по поводу уже проведённого перевода и укажите номер дела.", "Орындалған аударым бойынша банктің ресми арнасына хабарласып, іс нөмірін айтыңыз.")
      : operation?.status === "cooling_off"
        ? T("Деньги ещё на счёте. Прекратите разговор и отмените перевод.", "Ақша әлі шотыңызда. Әңгімені аяқтап, аударымды тоқтатыңыз.")
        : T("Прекратите общение со звонившим и сохраните номер дела для обращения в банк.", "Қоңырау шалушымен байланысты үзіп, банкке хабарласу үшін іс нөмірін сақтаңыз.");
    if (outcome === "legitimate_transfer" && operation?.status === "cooling_off") next = T("Откройте квитанцию. Если хотите продолжить, подтвердите перевод после окончания паузы.", "Түбіртекті ашыңыз. Жалғастырғыңыз келсе, кідіріс біткен соң аударымды растаңыз.");
    if (outcome === "insufficient_evidence") next = T("Уточните реквизиты у получателя по знакомому вам каналу. При новых сведениях обратитесь в банк с номером дела.", "Алушының деректемелерін өзіңіз білетін байланыс арнасымен тексеріңіз. Жаңа мәлімет болса, іс нөмірін көрсетіп банкке хабарласыңыз.");
    return `<section class="paper desk-resolution"><small>${T("Дело", "Іс")} № ${E(view.case_id)} · ${E(when(closed_at))}</small>
      <h2>${outcomeLabel(outcome) || T("Дело закрыто без классификации", "Іс қорытынды түрі көрсетілмей жабылды")}</h2>
      ${operation ? `<p>${T("Сумма перевода по делу", "Іске қатысты аударым сомасы")} <strong>${amount(operation.amount)}</strong></p><p>${T("Текущий статус перевода", "Аударымның қазіргі күйі")} · ${E(status(operation.status))}</p>` : `<p>${T("К обращению не привязан перевод.", "Өтінішке аударым тіркелмеген.")}</p>`}
      ${balance != null ? `<p>${T("Баланс учебного счёта сейчас", "Оқу шотының қазіргі қалдығы")} <strong>${amount(balance)}</strong></p>` : ""}
      <p>${next}</p>${outcome === "confirmed_fraud" && operation?.status === "cooling_off"
        ? `<button class="primary" data-case-cancel="${E(operation.transaction_id)}">${T("Отменить этот перевод", "Осы аударымды тоқтату")}</button>` : ""}
      ${operation ? `<button class="secondary" data-detail="${E(operation.transaction_id)}">${T("Открыть квитанцию перевода", "Аударым түбіртегін ашу")}</button>` : ""}</section>`;
  }
  const stateLabel = state => ({
    customer_requested: T("Клиент попросил связаться", "Клиент хабарласуды сұрады"),
    requested: T("Ожидается ответ клиента", "Клиенттің жауабы күтілуде"),
    accepted: T("Клиент согласился", "Клиент келісім берді"),
    declined: T("Клиент отказался", "Клиент бас тартты"),
    expired: T("Срок запроса истёк", "Сұрау мерзімі аяқталды"),
  })[state] ?? T("Обновите статус", "Күйін жаңартыңыз");
  const unavailable=()=>'<section class="paper contract-error"><p>'+T("Данные раздела недоступны. Обновите их с сервера.","Бөлім деректері қолжетімсіз. Серверден жаңартыңыз.")+'</p>'+button("refresh",T("Обновить","Жаңарту"),"secondary")+'</section>';
  const caption = () => T("Учебный запрос отдела антифрода по проверке перевода. Реальные звонки на стенде не совершаются.",
    "Аударымды тексеруге қатысты антифрод бөлімінің оқу сұрауы. Стендтен нақты қоңырау шалынбайды.");
  const caseLabel = () => T("Дело", "Іс");
  const agree = (id,answer,text) => '<button class="secondary" data-callback-id="'+E(id)+'" data-answer="'+answer+'">'+E(text)+'</button>';
  function callbackCard(row, owner) {
    if (!row || row.demonstration_only !== true) return "";
    return '<section class="paper desk-callback"><small>'+caseLabel()+' · '+E(row.case_id.slice(-8))+'</small><h3>'+stateLabel(row.status)+'</h3>'+
      '<p>'+caption()+'</p>' +
      (row.status==="requested" ? '<small>'+T("Ответить до","Жауап беру мерзімі")+' '+E(when(row.expires_at))+'</small>' : '') +
      (row.answered_at ? '<small>'+T("Ответ получен","Жауап алынды")+' · '+E(when(row.answered_at))+'</small>' : '') +
      (owner && row.status==="requested" ? '<div class="inline-actions">'+agree(row.id,"accepted",T("Согласиться на связь","Хабарласуға келісу"))+
        agree(row.id,"declined",T("Отказаться","Бас тарту"))+'</div>' : '') +
      (owner && row.status==="accepted" ? '<p>'+T("Если хотите обратиться в банк самостоятельно, откройте официальный номер в телефоне.",
        "Банкке өзіңіз хабарласқыңыз келсе, телефоннан ресми нөмірді ашыңыз.")+'</p><a class="text-button" href="tel:505">'+T("Открыть номер BCC 505","BCC-нің 505 нөмірін ашу")+'</a>' : '')+'</section>';
  }
  function callbacks(data) {
    const heading = title(T("Связь с сотрудником","Қызметкермен байланыс"));
    if (!Array.isArray(data?.items)) return heading+unavailable();
    return heading+(data.items.length ? data.items.map(r=>callbackCard(r,true)).join("") :
      '<p class="empty">'+T("Запросов на связь пока нет. Вы можете попросить о звонке из своего открытого дела.",
        "Әзірге хабарласу сұраулары жоқ. Ашық ісіңіз бойынша қоңырау сұрай аласыз.")+'</p>')+
      button("reports",T("Мои обращения","Менің өтініштерім"),"secondary");
  }
  function reportCallback(view) {
    if (!view?.case_id) return "";
    const requestable=["NEW","IN_REVIEW","NEEDS_INFORMATION","ESCALATED"].includes(view.case_state) &&
      (!view.callback || ["declined","expired"].includes(view.callback.status));
    return (view.callback ? callbackCard(view.callback,true) : "") + (requestable ?
      '<section class="paper"><h3>'+T("Связь по делу","Іс бойынша байланыс")+'</h3><p>'+caption()+'</p>'+
        button("customer-callback",T("Попросить обратный звонок","Кері қоңырау сұрау"),"secondary")+'</section>' : "");
  }
  function officerCallback(c,view) {
    if (!view || !hasOwn(view,"callback")) return "";
    const active = ["NEW","IN_REVIEW","NEEDS_INFORMATION","ESCALATED"].includes(c.state);
    const row = view.callback;
    const canInvite = active && c.assignee==="demo_analyst_a" && (!row || row.status==="customer_requested");
    return (row ? callbackCard(row,false) : "")+(canInvite ?
      '<section class="paper"><h3>'+T("Связь по делу","Іс бойынша байланыс")+'</h3><p>'+caption()+'</p>'+
      button("officer-callback",T("Предложить обратный звонок","Кері қоңырау ұсыну"),"secondary")+'</section>' : "");
  }
  function queue(v) {
    if (!v?.by_state || !v.oldest_current_status_seconds) return "";
    const count=v.by_state.NEW ?? 0;
    const seconds=v.oldest_current_status_seconds.NEW;
    return '<section class="paper desk-queue"><h2>'+T("Ожидают рассмотрения","Қарауды күтуде")+'</h2><strong>'+E(count)+'</strong>'+
      (count>0 && Number.isFinite(seconds) ? '<small>'+T("Самое долгое ожидание","Ең ұзақ күту уақыты")+' · '+E(Math.ceil(seconds/60))+' '+T("мин","мин")+'</small>' : '')+
      (v.as_of ? '<small>'+T("На момент","Уақыт белгісі")+' '+E(when(v.as_of))+'</small>' : '')+'</section>';
  }
  function metrics(v) {
    const heading=title(T("Нагрузка API","API жүктемесі"),T("Попытки проверки перевода в подключённом кошельке, включая повторные запросы.",
      "Қосылған әмияндағы аударымды тексеру әрекеттері. Қайталанған сұраулар да саналады."));
    if (v?.scope!=="wallet_transfer_api" || !Array.isArray(v.buckets)) return heading+unavailable();
    const p95=v.p95_overflow ? T("Более 30 с","30 с артық") : Number.isFinite(v.p95_upper_ms) ?
      "≤ "+E(v.p95_upper_ms)+" "+T("мс","мс") : "—";
    const metric=(label,value)=>'<div><dt>'+label+'</dt><dd>'+value+'</dd></div>';
    const minute=iso=>ledgerInstant(iso)?.time ?? "—";
    const max=Math.max(1,...v.buckets.map(b=>b.requests));
    return heading+'<section class="paper"><h2>'+T("Последние 15 минут","Соңғы 15 минут")+'</h2><dl class="desk-stats">'+
      metric(T("Всего запросов","Барлық сұраулар"),E(v.requests))+metric(T("Лимит частоты · 429","Жиілік шегі · 429"),E(v.rate_limited))+
      metric(T("Ошибки сервера · 5xx","Сервер қателері · 5xx"),E(v.server_errors))+
      metric(T("Полный ответ API · p95","API толық жауабы · p95"),p95)+'</dl><small>'+
      T("p95 — верхняя граница времени ответа для 95% запросов.","p95 — сұраулардың 95%-ына жауап беру уақытының жоғарғы шегі.")+'</small></section>'+
      '<section class="paper"><h2>'+T("Запросов в минуту","Минутына түскен сұраулар")+'</h2><svg aria-hidden="true" class="desk-bars" viewBox="0 0 150 100" preserveAspectRatio="none">'+
      v.buckets.map((b,i)=>{
        const height=Math.max(0,Math.min(100,100*b.requests/max));
        return '<rect x="'+(10*i)+'" y="'+(100-height)+'" width="8" height="'+height+'"/>';
      }).join("")+'</svg>'+
      (v.buckets.length ? '<div class="desk-axis"><small>'+minute(v.buckets[0].minute)+'</small><small>'+minute(lastItem(v.buckets).minute)+' · UTC+5</small></div>' : '')+
      '<details><summary>'+T("Поминутные значения","Әр минуттың мәндері")+'</summary><table class="desk-table"><thead><tr><th>'+T("Время","Уақыт")+'</th><th>'+
      T("Запросы","Сұраулар")+'</th><th>429</th><th>5xx</th></tr></thead><tbody>'+
      v.buckets.map(b=>'<tr><th>'+minute(b.minute)+'</th><td>'+E(b.requests)+'</td><td>'+E(b.rate_limited)+'</td><td>'+E(b.server_errors)+'</td></tr>').join("")+
      '</tbody></table></details></section>';
  }
  function staff(v) {
    const heading=title(T("Доступ сотрудников","Қызметкерлердің рұқсаты"));
    if (!Array.isArray(v?.items)) return heading+unavailable();
    const enabledText=value=>value?T("Доступ открыт","Рұқсат берілген"):T("Доступ приостановлен","Рұқсат тоқтатылған");
    return heading+v.items.map(s=>'<section class="paper"><small>'+T("Сотрудник SOC","SOC қызметкері")+'</small><h2>'+E(s.login)+'</h2><p>'+
      enabledText(s.enabled)+'</p><button class="secondary" data-staff="'+E(s.subject)+'">'+(s.enabled?T("Приостановить доступ","Рұқсатты тоқтату"):
        T("Восстановить доступ","Рұқсатты қалпына келтіру"))+'</button></section>').join("")+
      (v.audit?.length ? '<section class="paper"><h2>'+T("Журнал доступа","Рұқсат журналы")+'</h2><ol class="timeline">'+
        v.audit.map(a=>'<li><strong>'+enabledText(a.enabled)+'</strong><small>'+E(when(a.at))+' · '+E(v.items.find(s=>s.subject===a.subject)?.login??a.subject)+'</small>'+
          '<small>'+T("Администратор","Әкімші")+' · '+E(a.actor.slice(-8))+'</small></li>').join("")+'</ol></section>' : "");
  }
  return {callbackCard,callbacks,reportCallback,officerCallback,closeCase,resolution,outcomeLabel,queue,metrics,staff};
}
