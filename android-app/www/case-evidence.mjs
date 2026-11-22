import { formatTenge } from "./wallet.mjs";

// A receipt is historical context. Only the engine can attribute a score to a signal.
export function caseLedgerView(history, T, escape, when) {
  const title = T("Выписка получателя до перевода", "Аударымға дейінгі алушының үзінді көшірмесі");
  const section = body => '<section class="case-ledger"><h3>'+title+'</h3>'+body+'</section>';
  if (!history) return section('<p>'+T("История операций недоступна.", "Операциялар тарихы қолжетімсіз.")+'</p>');
  const period = escape(when(history.from_time))+' — '+escape(when(history.before_time));
  const intro = T("Исполненные переводы за 24 часа до этой операции. По ним можно проверить движение денег.", "Осы операцияға дейінгі 24 сағатта орындалған аударымдар. Олар арқылы ақша қозғалысын тексеруге болады.");
  const rows = history.items.map(row => {
    const label = row.direction === "incoming" ? T("Зачисление", "Түсім") : T("Списание", "Шығыс");
    return '<button class="graph-record" data-detail="'+escape(row.transaction_id)+'"><strong>'+label+' · '+escape(formatTenge(row.amount))+'</strong><span>'+escape(when(row.settled_at))+' · '+escape(row.transaction_id.slice(-8))+'</span></button>';
  }).join("");
  const empty = T("За этот период в журнале нет исполненных переводов по счёту получателя.", "Осы кезеңде журналда алушының шоты бойынша орындалған аударымдар жоқ.");
  const more = T("Показаны последние 8 операций.", "Соңғы 8 операция көрсетілді.");
  return section('<p>'+intro+'</p><small>'+period+'</small>'+(rows || '<p>'+empty+'</p>')+(history.has_more ? '<p>'+more+'</p>' : ''));
}

export function caseEvidenceView(tx, T, escape, when) {
  const rows = tx.reasons ?? [];
  const fact = r => '<li><strong>'+escape(T(r.reason_ru,r.reason_kk) || r.code)+'</strong><small>'+
    escape(r.layer)+' · '+escape(r.code)+' · '+escape(String(r.score_delta))+
    (r.evidence?.recorded_at ? ' · '+escape(when(r.evidence.recorded_at)) : '')+'</small></li>';
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

