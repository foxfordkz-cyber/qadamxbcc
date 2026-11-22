export const eventNames = {
  evaluated:["Запрос проверен","Сұрау тексерілді"], call_marked:["Клиент отметил звонок","Клиент қоңырауды белгіледі"],
  pause_started:["Началась защитная пауза","Қорғаныс кідірісі басталды"], resolved:["Обновлён итог операции","Операция нәтижесі жаңартылды"],
  call_ended:["Клиент закончил разговор","Клиент сөйлесуді аяқтады"], my_choice:["Клиент подтвердил свой выбор","Клиент өз таңдауын растады"],
  pressure:["Клиент сообщил о давлении","Клиент қысым туралы хабарлады"], contact_queued:["Уведомление поставлено в очередь","Хабарлама кезекке қойылды"],
  family_approved:["Доверенный человек подтвердил сумму и получателя","Сенімді адам сома мен алушыны растады"],
  report_created:["Создано обращение в демо-SOC","Демо-SOC өтініші жасалды"]
};
const icons = {
  "call-transfer":'<path d="M4 4l3-1 3 5-2 2c1 3 3 5 6 6l2-2 5 3-1 3c-1 4-9 0-13-4S1 5 4 4z"/>',
  family:'<path d="M12 21s8-4 8-12V5l-8-3-8 3v4c0 8 8 12 8 12z"/><path d="m8 11 3 3 5-6"/>'
};
const navPaths = {
  home:'<path d="m3 10 9-7 9 7v10h-6v-6H9v6H3z"/>',
  transfer:'<path d="M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4"/>',
  safety:icons.family, history:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  cases:'<path d="M3 7h18v13H3zM8 7V4h8v3"/>',system:'<path d="M2 12h5l3-7 4 14 3-7h5"/>',
  settings:'<circle cx="12" cy="8" r="3.5"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>'
};
export const navIcon=(key,fallback)=>navPaths[key]?'<svg viewBox="0 0 24 24">'+navPaths[key]+'</svg>':fallback;
export function shortcuts(T) {
  return '<div class="guard-actions">'+[["call-transfer",T("Идёт звонок","Қазір қоңырау жүріп жатыр")],["family",T("Семейный щит","Отбасы қорғанысы")]].map(([key,label])=>
    '<button data-action="'+key+'"><svg viewBox="0 0 24 24" aria-hidden="true">'+icons[key]+'</svg>'+label+'</button>').join("")+'</div>';
}
export function familyView(d,T,button,when) {
  if (!d) return "";
  const state = d.enabled ? (d.disable_at ? T("Выключится","Өшіріледі")+" · "+when(d.disable_at) : T("Щит включён","Қорғаныс қосулы")) : T("Щит выключен","Қорғаныс өшірулі");
  return '<h1>'+T("Семейный щит","Отбасы қорғанысы")+'</h1><section class="paper family-panel"><h2>'+state+'</h2><p>'+T("Асию торопят перевести деньги. На защитной паузе она может попросить Армана перезвонить по знакомому номеру. Он получает объяснение, а её ответ после звонка сохраняется отдельно.","Асияны ақша аударуға асықтыруда. Қорғаныс кідірісінде ол Арманнан таныс нөміріне хабарласуды сұрай алады. Арман себебін көреді, Асияның жауабы бөлек сақталады.")+'</p>'+button(d.enabled && !d.disable_at ? "family-off":"family-on",d.enabled ? (d.disable_at ? T("Оставить щит включённым","Қорғанысты қосулы қалдыру"):T("Запланировать отключение","Өшіруді жоспарлау")):T("Включить защиту","Қорғанысты қосу"))+'<p class="hint">'+T("Отключение щита занимает 24 часа. Каждый участник может сразу отозвать согласие на сообщения.","Қорғаныс 24 сағаттан соң өшеді. Әр қатысушы хабарламаларға келісімін бірден қайтара алады.")+'</p>'+button("contacts",T("Управлять контактами","Контактілерді басқару"),"secondary")+'</section>';
}
export function checkView(d,T,B,when,label) {
  if(!d) return "";
  const on=d.state==="on_call", wait=d.state==="waiting", ready=d.state==="ready", answered=d.state==="answered";
  const heading=on?T("Перевод в обработке","Аударым өңделуде"):wait?T("Разговор завершён","Әңгіме аяқталды"):ready?T("Это были вы?","Бұл сіз бе едіңіз?"):T("Проверка после звонка","Қоңыраудан кейінгі тексеру");
  const body=on?T("Деньги остаются на учебном счёте. Вернитесь сюда, когда закончите разговор.","Ақша оқу шотында қалады. Әңгіме аяқталғанда осы жерге оралыңыз."):wait?T("Пять минут тишины. Вернитесь после","Бес минут тыныштық. Мына уақыттан кейін оралыңыз")+" "+when(d.ready_at):ready?T("Вы сами решили сделать перевод или вас торопили?","Аударым жасауды өзіңіз шештіңіз бе, әлде сізді асықтырды ма?"):answered?T(...eventNames[d.answer]):T("Для этой операции отдельный опрос после звонка не назначен.","Бұл операцияға қоңыраудан кейінгі жеке сауалнама тағайындалмады.");
  return '<section class="paper guard-state"><h1>'+heading+'</h1><p>'+body+'</p>'+
   (on?B("call-end",T("Разговор закончился","Әңгіме аяқталды")):ready?B("choice",T("Это мой выбор","Бұл менің таңдауым")):wait?B("guard-refresh",T("Проверить время","Уақытты тексеру"),"secondary"):"")+((wait||ready)?B("pressure",T("Меня обманывают — отменить перевод","Мені алдап жатыр — аударымды тоқтату"),"secondary"):"")+'</section>'+
   (!on?'<section class="paper"><h2>'+T("Ответ доверенного лица","Сенімді адамның жауабы")+'</h2><p>'+ (d.contact_state?label(d.contact_state):T("Ответа пока нет","Әзірге жауап жоқ"))+'</p>'+(!d.contact_state && d.family_enabled && d.state!=="none"?B("notify-family",T("Попросить перезвонить","Қайта қоңырау шалуды сұрау"),"secondary"):"")+'</section>':"")+B("refresh-detail",T("Открыть квитанцию","Түбіртекті ашу"),"secondary");
}

export function secondSettingsView(settings, T, button, when, amount, escape, webWallet) {
  if (!settings) return "";
  const on = Boolean(settings.contact_id);
  const contacts = settings.contacts || [];
  const choose = T("Кто подтвердит перевод?", "Аударымды кім растайды?");
  const names = contacts.map((contact, index) => [
    contact.id, contact.alias || T("Контакт ", "Сенімді адам ") + (index + 1)
  ]);
  const current = names.find(([id]) => id === settings.contact_id);
  const jury = settings.channel === "jury";
  const delivery = jury ? T("в учебном кабинете", "оқу кабинетінде") :
    settings.channel === "telegram" ? T("в личном чате Telegram", "Telegram-дағы жеке чатта") :
    T("в симуляторе уведомлений", "хабарлама симуляторында");
  const control = on
    ? '<p><strong>' + (current ? escape(current[1]) : T("Контакт недоступен", "Сенімді адам қолжетімсіз")) + '</strong></p>' +
      (settings.disable_at ? '<p>' + T("Отключение после ", "Өшірілетін уақыт ") + escape(when(settings.disable_at)) + '</p>' +
          (current ? button("second-on", T("Оставить подтверждение включённым", "Растауды қосулы қалдыру"), "secondary") : "") :
        button("second-off", T("Отключить через 24 часа", "24 сағаттан кейін өшіру"), "secondary"))
    : names.length ? '<label>' + choose + '<select name="approval-contact">' +
        names.map(([id, name]) => '<option value="' + escape(id) + '">' + escape(name) + '</option>').join("") + '</select></label>' +
        button("second-on", T("Включить второе подтверждение", "Екінші растауды қосу")) :
      settings.owner_channel_ready === false
        ? '<p>' + T("Для подключения оператор стенда должен привязать ваш собственный Telegram. Затем выберите отдельный контакт близкого.", "Қосу үшін стенд операторы сіздің Telegram аккаунтыңызды байланыстыруы керек. Содан кейін жақыныңыздың жеке контактісін таңдаңыз.") + '</p>'
        : '<p>' + T("Добавьте доверенного человека и дождитесь его согласия.", "Сенімді адамды қосып, оның келісімін күтіңіз.") + '</p>' +
          button("contacts", T("Открыть доверенные контакты", "Сенімді адамдарды ашу"), "secondary");
  return '<section class="paper family-panel"><h2>' + T("Второе подтверждение", "Екінші растау") + '</h2><p>' +
    T("При первом переводе получателю на сумму от ", "Жаңа алушыға алғаш рет ") + escape(amount(settings.threshold_kzt)) +
    T(" выбранный человек увидит ", " немесе одан көп аударсаңыз, таңдаған адамыңыз ") + delivery +
    T(" сумму и скрытые реквизиты. После его согласия и защитной паузы вы сами подтверждаете отправку.", " соманы және жартылай жасырылған деректемелерді көреді. Оның келісімі мен қорғаныс кідірісінен кейін аударымды өзіңіз растайсыз.") +
    '</p>' + control + (jury && webWallet ? '<p><a href="/jury">' + T("Приглашение доверенному лицу", "Сенімді адамға шақыру") + '</a></p>' : "") + '</section>';
}

export function secondConfirmationView(approval, T, when) {
  if (!approval) return "";
  const statuses = {
    pending: ["Ждём подтверждения суммы и получателя от доверенного человека.", "Сенімді адамның сома мен алушыны растауын күтеміз."],
    confirmed: ["Сумма и получатель подтверждены. После паузы решение об отправке принимаете вы.", "Сома мен алушы расталды. Кідірістен кейін жіберу туралы шешімді өзіңіз қабылдайсыз."],
    closed: ["Перевод завершён. Запрос доверенному человеку закрыт.", "Аударым аяқталды. Сенімді адамға жіберілген сұрау жабылды."],
    suspicious: ["Доверенный человек сообщил о подозрении. Отмените перевод или обратитесь в службу безопасности.", "Сенімді адам күдіктенетінін хабарлады. Аударымды тоқтатыңыз немесе қауіпсіздік қызметіне хабарласыңыз."],
    expired: ["Срок подтверждения истёк. Деньги остаются у вас. Отмените перевод или отправьте обращение.", "Растау мерзімі аяқталды. Ақша шотыңызда қалды. Аударымды тоқтатыңыз немесе өтініш жіберіңіз."],
    unavailable: ["Подтверждение недоступно. Можно отменить перевод или отправить обращение.", "Растау қолжетімсіз. Аударымды тоқтатуға немесе өтініш жіберуге болады."]
  };
  const validUntil = approval.expires_at && ["pending","confirmed"].includes(approval.state)
    ? ' ' + T("Действует до ", "Растау мерзімі ") + when(approval.expires_at) + '.' : '';
  return '<div class="callout" role="status"><strong>' + T("Второе подтверждение", "Екінші растау") + '</strong><p>' +
    T(...(statuses[approval.state] || statuses.unavailable)) + validUntil + '</p></div>';
}
export function packetContent(d,T,when,status) {
  const heading=T("Qadam Shield · Пакет инцидента","Qadam Shield · Оқиға құжаттары");
  const lines=[heading, d.transaction_id, when(d.created_at)+" · "+new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(Number(d.amount))+" "+(d.currency==="KZT"?"₸ (KZT)":d.currency)+" · "+status(d.status),
    T("Хронология","Оқиғалар реті"),...d.events.map(e=>when(e.at)+" — "+T(...(eventNames[e.kind] ?? ["Обновление проверки","Тексеру жаңартылды"]))),
    ...(d.recipient_reference ? [T("Получатель","Алушы")+" · •••• "+d.recipient_reference] : []),
    ...(d.reports ?? []).map(r => T("Обращение","Өтініш")+" "+r.id+" · "+r.state),
    ...(d.soc_messages ?? []).map(m => when(m.at)+" · "+({
      CASE_INFORMATION_REQUIRED:T("SOC запросил информацию","SOC ақпарат сұрады"),
      CASE_REVIEW_CLOSED:T("SOC закрыл проверку","SOC тексеруді жапты"),
      CASE_REVIEW_REOPENED:T("SOC возобновил проверку","SOC тексеруді қайта ашты")
    }[m.kind] ?? T("Обновление SOC","SOC жаңартуы"))),
    ...(d.generated_at ? [T("Сформирован","Қалыптастырылған уақыты")+" · "+when(d.generated_at)] : []),
    T("Черновик заявления","Өтініш жобасы"),T("Прошу проверить обстоятельства учебной операции с указанным номером. Моё описание разговора и сведения о потерях я добавлю самостоятельно.","Көрсетілген нөмірлі оқу операциясының мән-жайын тексеруді сұраймын. Әңгіме сипаттамасы мен шығын туралы мәліметтерді өзім қосамын."),
    T("Учебный документ. При подозрении на обман завершите разговор и свяжитесь с банком по номеру из приложения. Черновик остаётся у вас.","Оқу құжаты. Алаяқтыққа күмәндансаңыз, әңгімені аяқтап, қолданбадағы нөмір арқылы банкке хабарласыңыз. Жоба өзіңізде қалады.")];
  return lines;
}
