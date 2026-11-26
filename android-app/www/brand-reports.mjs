export function brandReports(rows,T,E) {
  const reason = key => key === "claims_bank" ? T("Представляется банком","Банк атынан әрекет етеді") : T("Просит одноразовый код","Бір реттік кодты сұрайды");
  const entries = (rows || []).map(row => {
    const name=row.indicator.replace(/\./g,"[.]");
    const draft = T("Черновик обращения. Просим проверить сообщение о возможной имитации банка. При подтверждении просим ограничить доступ согласно правилам платформы.",
      "Өтініш жобасы. Банк атынан әрекет етуі мүмкін ресурс туралы хабарламаны тексеруді сұраймыз. Расталса, платформа ережесіне сай қолжетімділікті шектеуді сұраймыз.");
    return '<article class="paper"><strong>'+E(name)+'</strong><p>'+reason(row.basis)+'</p><details><summary>'+T("Черновик обращения на удаление","Жою туралы өтініш жобасы")+'</summary><p>'+E(draft)+'</p><p>'+E(name)+' · '+reason(row.basis)+' · '+E(row.observed_at)+'</p></details></article>';
  }).join("");
  return '<section class="paper"><h1>'+T("Сообщения о подделках","Жалған ресурстар туралы хабарламалар")+'</h1><p>'+T("Журнал входящих сообщений. Черновик предназначен для ручной проверки.","Келіп түскен хабарламалар журналы. Жоба маманның тексеруіне арналған.")+'</p><form id="brand-report-form"><label>'+T("Домен или Telegram-имя","Домен немесе Telegram аты")+'<input required name="indicator" maxlength="253"></label><label>'+T("Что заметили","Не байқадыңыз")+'<select name="basis"><option value="claims_bank">'+reason("claims_bank")+'</option><option value="asks_for_code">'+reason("asks_for_code")+'</option></select></label><button>'+T("Добавить в журнал","Журналға қосу")+'</button></form></section>'+
    (entries||'<p>'+T("Сообщений пока нет.","Хабарлама әзірше жоқ.")+'</p>');
}
