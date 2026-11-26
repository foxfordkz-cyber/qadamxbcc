export function participantStatements(view,T,E,button,jury=false,href="") {
  if (!view) return "";
  const answers = {
    agreed:T("Стороны согласовали платёж","Төлем алдын ала келісілді"),
    unexpected:T("Перевод оказался неожиданным","Аударым күтпеген жерден болды"),
    redirect_requested:T("Просили переслать деньги третьему лицу","Ақшаны басқа адамға жіберуді сұрады")
  };
  const line = reply => reply ? E(answers[reply.answer])+(reply.source==="jury_invite"?" · "+T("Учебное приглашение","Оқу шақыруы"):"") : T("Ответа пока нет","Жауап әлі жоқ");
  if(view.audience === "soc")return '<section class="paper"><h2>'+T("Объяснения участников","Қатысушылардың түсініктемелері")+'</h2><p>'+T("Отправитель","Жіберуші")+' · '+line(view.sender)+'</p><p>'+T("Получатель","Алушы")+' · ' +line(view.recipient)+'</p>'+
    (jury && (!view.sender || !view.recipient) ? (href ? '<a target="_blank" rel="noreferrer" href="'+E(href)+'">'+T("Открыть форму второго участника","Екінші қатысушының формасын ашу")+'</a>' : button("jury-interview",T("Пригласить второго учебного участника","Екінші оқу қатысушысын шақыру"),"secondary")) : "")+'</section>' ;
  const question=view.audience==="sender"?T("Как вы договорились об этом переводе?","Бұл аударым туралы қалай келістіңіз?"):T("Ожидали ли вы деньги и просили ли их переслать?","Бұл ақшаны күттіңіз бе және оны қайта жіберуді сұрады ма?");
  return '<section class="paper"><h2>'+question+'</h2><p>'+T("Ответ увидит специалист, который проверяет случай.","Жауапты істі қарайтын маман көреді.")+'</p>'+
    (view[view.audience] ? line(view[view.audience]) : Object.entries(answers).map(([key,label])=>button("statement-"+key,label,"secondary")).join(""))+'</section>';
}
