// Keep the engine's signed contributions and its own record identifiers.
export function caseEvidenceView(tx, T, escape, when) {
  const rows = tx.reasons ?? [];
  const fact = r => '<li><strong>'+escape(T(r.reason_ru,r.reason_kk) || r.code)+'</strong><small>'+
    escape(r.layer)+' · '+escape(r.code)+' · '+escape(String(r.score_delta))+' · '+escape(when(tx.created_at))+'</small></li>';
  const group = (heading, items, empty) => '<section><h3>'+heading+'</h3>'+
    (items.length ? '<ul>'+items.map(fact).join("")+'</ul>' : '<p>'+empty+'</p>')+'</section>';
  return '<section class="reason-groups"><h2>'+T("Почему подозрительно?","Күдік неден туды?")+'</h2>'+
    group(T("Поддерживает подозрение","Күдікті күшейтеді"), rows.filter(r=>r.score_delta>0),T("Усиливающих факторов в расчёте нет.","Есепте күдікті күшейтетін белгі жоқ."))+
    group(T("Ослабляет подозрение","Күдікті әлсіретеді"), rows.filter(r=>r.score_delta<0),T("Снижающих риск факторов в расчёте нет.","Есепте тәуекелді азайтатын белгі жоқ."))+
    '<section><h3>'+T("Недостаточно данных","Дерек жеткіліксіз")+'</h3><p>'+
    (!tx.context?.call_pressure_answer ? T("Ответ клиента о давлении не зарегистрирован.","Клиенттің қысым туралы жауабы тіркелмеген.") :
       T("Ответ о давлении зарегистрирован со слов клиента.","Қысым туралы жауап клиенттің сөзімен тіркелген."))+
    '</p></section><button class="secondary" data-detail="'+escape(tx.transaction_id)+'">'+T("Открыть исходную операцию","Бастапқы операцияны ашу")+'</button></section>';
}

