export function disputeView(info, role, issue, verdict, T, E, money, button) {
  if (!info?.statement) return "";
  const doc = info.statement;
  const copy = {
    none:T("Если вас просят вернуть поступление на другие реквизиты, сообщите об этом банку.", "Түскен ақшаны басқа деректемелерге қайтаруды сұраса, банкке хабарлаңыз."),
    reported:T("О спорном зачислении сообщено сотруднику.", "Даулы түсім туралы қызметкерге хабарланды."),
    appealed:T("Клиент запросил повторное рассмотрение.", "Клиент қайта қарауды сұрады."),
    upheld:T("Сотрудник сохранил ограничение.", "Қызметкер шектеуді күшінде қалдырды."),
    cleared:T("Сотрудник снял ограничение.", "Қызметкер шектеуді алып тастады."),
  };
  if (role === "admin" && doc.status === "none") return "";
  let controls = "";
  if (role === "client" && doc.status === "none") controls = button("dispute-report",T("Сообщить и зарезервировать эту сумму","Хабарлап, осы соманы резервке қою"),"secondary");
  if (role === "client" && info.can_appeal) controls = button("dispute-appeal",T("Запросить пересмотр","Қайта қарауды сұрау"),"secondary");
  if (role === "admin" && ["reported","appealed"].includes(doc.status)) {
    controls = button("dispute-clear",T("Снять ограничение","Шектеуді алып тастау"),"secondary")+
      button("dispute-uphold",T("Сохранить ограничение","Шектеуді сақтау"),"secondary");
  }
  const verify = verdict ? '<p role="status">'+(verdict.current ?
    T("Подпись и статус подтверждены","Қолтаңба мен күй расталды") : verdict.authentic ?
    T("Подпись подлинная. Статус с тех пор изменился.","Қолтаңба түпнұсқа. Содан бері күй өзгерді.") :
    T("Подпись не подтверждена","Қолтаңба расталмады"))+'</p>' : "";
  return '<section class="paper"><h2>'+T("Спорное зачисление","Даулы түсім")+'</h2><p>'+E(copy[doc.status])+'</p>'+
    '<p>'+T("Зарезервировано по этому переводу","Осы аударым бойынша резервте")+' <strong>'+money(doc.restricted_amount)+'</strong></p>'+
    (role === "client" ? '<p>'+T("Доступно для других переводов","Басқа аударымдарға қолжетімді")+' <strong>'+money(info.available_kzt)+'</strong></p>' : "")+
    controls+(doc.status === "none" ? "" : button("dispute-certificate",T("Сохранить справку · JSON","Анықтаманы сақтау · JSON"),"text-button"))+
    (issue ? button("dispute-verify",T("Проверить подпись","Қолтаңбаны тексеру"),"secondary") : "")+
    (doc.status !== "none" ? '<label>'+T("Сверить сохранённую справку", "Сақталған анықтаманы тексеру")+
      '<input type="file" accept=".json,application/json" data-dispute-file></label>' : "")+verify+'</section>';
}
