// Shared product views. Every amount passed here comes from the mobile gateway.
const paths = {
  transfer:"M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4",history:"M12 5v7l4 2 M21 12a9 9 0 1 1-3-6",
  safety:"M12 2 4 5v6c0 5 4 9 8 11 4-2 8-6 8-11V5z M8 11l3 3 5-6",guardian:"M3 10 21 3l-4 18-6-6-4 3v-5z M7 13 18 6",
  analytics:"M3 20h18 M6 16v-5m6 5V5m6 11V9",settings:"M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21c0-8 16-8 16 0",
  home:"m3 10 9-7 9 7v11h-6v-7H9v7H3z",bell:"M5 17h14l-2-4V9a5 5 0 0 0-10 0v4z M10 20h4",
  eye:"M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12z M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
  arrow:"M5 12h14m-5-5 5 5-5 5",incoming:"M18 5 6 17m0-8v8h8",outgoing:"M6 18 18 6m-8 0h8v8",
  cases:"M3 7h18v13H3z M8 7V4h8v3",system:"M2 12h5l3-7 4 14 3-7h5",call:"m5 3 4 5-2 3c2 3 3 4 6 6l3-2 5 4c-1 5-6 3-10 0S2 10 2 6z"
};
export const icon = k=>'<svg aria-hidden="true" viewBox="0 0 24 24" class="wi"><path d="'+(paths[k]||paths.arrow)+'"/></svg>';
const initials=name=>String(name||"Q").trim().split(/\s+/).slice(0,2).map(w=>Array.from(w)[0]).join("").toUpperCase();
const contours=Array.from({length:21},(_,i)=>'<path d="M '+(112+i*4)+' -16 C '+(264+i*2)+' 28 '+(90+i*4)+' 110 '+(248+i*4)+' 152 S 332 202 396 234"/>').join('');
const chip='<svg class="chip" viewBox="0 0 40 30" aria-hidden="true"><rect x="1" y="1" width="38" height="28" rx="6" fill="#e6d6aa"/><path d="M1 10h11l4 4v3l-5 5H1m38-12H28l-4 4v3l5 5h10M15 1v6l4 4h3l5-5V1M16 29v-5l3-4h4l4 5v4" fill="none" stroke="#927f56" stroke-width="1.1"/></svg>';
export function walletUI({T,E,amount,when,button,status}) {
  const heading = (name,extra="")=>'<div class="w-heading"><h2>'+name+'</h2>'+extra+'</div>';
  const little = (act,title)=>'<button class="w-link" data-action="'+act+'">'+title+' '+icon('arrow')+'</button>';
  const mark=s=>({approved:"✓",cooling_off:"◷",blocked:"⊘",cancelled:"×"})[s]||"·";
  const badge=s=>'<span class="wb '+E(s)+'">'+mark(s)+' '+E(status(s))+'</span>';
  const dayOf=(v)=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Almaty",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(v));
  const dateLabel=(v,short=false)=>new Intl.DateTimeFormat(T("ru-KZ","kk-KZ"),{timeZone:"Asia/Almaty",day:"numeric",month:short?"short":"long"}).format(new Date(v));
  function rows(items,group=false) {
    if(!items?.length)return '<p class="empty">'+T("Операций по этим условиям нет.","Бұл шарттарға сай операция жоқ.")+'</p>';
    let last="";
    return '<div class="ledger">'+items.map(r=>{
      const day=dayOf(r.created_at),incoming=r.direction==="incoming";
      const h=group && day!==last?'<h3 class="day-title">'+dateLabel(r.created_at)+'</h3>':""; last=day;
      return h+'<button class="ledger-row" '+(incoming?'data-incoming':'data-detail')+'="'+E(r.transaction_id)+'"><i class="flow '+(incoming?'credit':'')+'">'+icon(r.direction)+'</i><span><strong>'+E(r.counterparty)+'</strong><small>'+E(when(r.created_at))+'</small></span><span class="right"><strong>'+(r.status==="approved"?(incoming?"+":"−"):"")+amount(r.amount)+'</strong>'+badge(r.status)+'</span></button>';
    }).join("")+'</div>';
  }
  function card(a,hidden) {
    return '<article class="q-card"><svg class="contour" viewBox="0 0 390 210" preserveAspectRatio="none" aria-hidden="true">'+contours+'</svg><div class="q-card-top"><b>Qadam Shield</b>'+chip+'</div><div class="q-balance"><small>'+T("Баланс учебной карты","Оқу картасының балансы")+'</small><div><strong>'+(hidden?'•••••• ₸':amount(a.balance))+'</strong><button data-action="mask-balance" aria-pressed="'+hidden+'" aria-label="'+T("Скрыть или показать баланс","Балансты жасыру немесе көрсету")+'">'+icon("eye")+'</button></div></div><div class="card-foot"><span>•••• &nbsp; •••• &nbsp; •••• &nbsp; '+E(a.card_last4)+'</span><b>'+E(a.display_name)+'</b></div></article>';
  }
  function home(a,ledger,stats,hidden,pending) {
    if(!a||!ledger)return "";
    const keys=[["transfer",T("Перевод","Аудару")],["history",T("История","Тарих")],["safety",T("Защита","Қорғаныс")],["open-guardian","Telegram"]];
    const first=String(a.display_name||"").split(" ")[0];
    return '<div class="welcome"><span class="avatar">'+E(initials(a.display_name))+'</span><div><small>'+T("Добро пожаловать","Қош келдіңіз")+'</small><h1>'+E(first)+'</h1></div><button data-action="inbox" aria-label="'+T("Уведомления","Хабарламалар")+'">'+icon("bell")+'</button></div>'+
    card(a,hidden)+'<div class="quick-grid">'+keys.map(([k,n])=>'<button data-action="'+k+'"><i>'+icon(k==="open-guardian"?"guardian":k)+'</i>'+n+'</button>').join("")+'</div>'+
    (pending?button("recover",T("Проверить незавершённый запрос","Аяқталмаған сұрауды тексеру"))+button("abandon",T("Закрыть запрос после проверки","Тексергеннен кейін сұрауды жабу"),"secondary"):"")+
    (a.active_pause?'<button class="pause-link" data-detail="'+E(a.active_pause)+'"><b>◷</b><span><strong>'+T("Перевод на проверке","Аударым тексерілуде")+'</strong><small>'+T("Открыть защитную паузу","Қорғаныс кідірісін ашу")+'</small></span>'+icon("arrow")+'</button>':"")+
    (a.pending_call?'<button class="w-link" data-call-id="'+E(a.pending_call)+'">'+T("Вернуться к проверке звонка","Қоңырауды тексеруге оралу")+' →</button>':"")+
    heading(T("Быстрые получатели","Жиі таңдалатын алушылар"))+'<div class="people">'+a.recipients.map((r,i)=>'<button data-payee="'+E(r.phone)+'"><i class="person p'+i+'">'+E(initials(r.name))+'</i><span>'+E(r.name)+'</span></button>').join("")+'</div>'+
    heading(T("Последние операции","Соңғы операциялар"),little("history",T("Все","Барлығы")))+rows(ledger.items?.slice(0,3))+
    (stats?'<button class="period-summary" data-action="analytics">'+icon("analytics")+'<span><strong>'+T("Обзор за 7 дней","7 күндік шолу")+'</strong><small>'+T("Расходы","Шығыс")+' · '+amount(stats.outgoing)+'</small></span>'+icon('arrow')+'</button>':"");
  }
  const periods=(n)=>'<div class="segments">'+[7,30,90].map(v=>'<button data-days="'+v+'" aria-pressed="'+(v===n)+'">'+v+' '+T("дн.","күн")+'</button>').join("")+'</div>';
  const options=(values,current)=>values.map(([v,label])=>'<option value="'+E(v)+'" '+(v===current?'selected':'')+'>'+E(label)+'</option>').join('');
  function history(d,s) {
    return '<h1>'+T("Операции","Операциялар")+'</h1><form id="ledger-filter" class="ledger-filter"><label>'+T("Поиск по имени или ID","Аты немесе ID бойынша іздеу")+'<input name="q" maxlength="128" value="'+E(s.q)+'"></label><div><select name="status" aria-label="'+T("Статус","Күй")+'">'+options([["",T("Все статусы","Барлық күй")],...["approved","cooling_off","blocked","cancelled"].map(k=>[k,status(k)])],s.status)+'</select><select name="direction" aria-label="'+T("Направление","Бағыт")+'">'+options([["",T("Оба направления","Екі бағыт")],["outgoing",T("Исходящие","Шығыс")],["incoming",T("Входящие","Кіріс")]],s.direction)+'</select></div><button class="secondary">'+T("Применить","Қолдану")+'</button></form>'+
    (s.day||s.days?'<button class="w-link" data-action="clear-period">'+E(s.day||s.days+' '+T("дн.","күн"))+' ×</button>':'')+rows(d?.items,true)+
    (d?.offset?button("prev",T("Предыдущие","Алдыңғысы"),"secondary"):"")+(d?.has_more?button("next",T("Дальше","Келесі"),"secondary"):"");
  }
  function analytics(d,index) {
    if(!d)return "";
    const day=d.series[Math.min(index??d.series.length-1,d.series.length-1)];
    const max=Math.max(1,...d.series.flatMap(x=>[Number(x.incoming),Number(x.outgoing)]));
    const bars=d.series.map(x=>'<button data-chart-day="'+x.day+'" aria-pressed="'+(x.day===day.day)+'" aria-label="'+E(x.day+' · '+amount(x.incoming)+' / '+amount(x.outgoing))+'"><svg viewBox="0 0 12 100" preserveAspectRatio="none" aria-hidden="true"><rect x="1" y="'+(100-97*Number(x.incoming)/max)+'" width="4" height="'+97*Number(x.incoming)/max+'" rx="1"/><rect x="6" y="'+(100-97*Number(x.outgoing)/max)+'" width="4" height="'+97*Number(x.outgoing)/max+'" rx="1"/></svg></button>').join('');
    return '<h1>'+T("Аналитика","Аналитика")+'</h1>'+periods(d.days)+'<section class="insight"><div class="money-pair"><div><small>'+T("Поступления","Кіріс")+'</small><strong>'+amount(d.incoming)+'</strong></div><div><small>'+T("Расходы","Шығыс")+'</small><strong>'+amount(d.outgoing)+'</strong></div></div>'+
    (d.count?'<div class="chart-legend"><span>● '+T("Поступления","Кіріс")+'</span><span>● '+T("Расходы","Шығыс")+'</span></div><small class="chart-scale">'+amount(max)+'</small><div class="chart-scroll"><div class="bars">'+bars+'</div></div><div class="axis"><span>'+E(d.from)+'</span><span>'+E(d.series.at(-1).day)+'</span></div><button class="selected-day" data-drill-day="'+E(day.day)+'"><strong>'+dateLabel(day.day+"T12:00:00Z")+'</strong><span>+'+amount(day.incoming)+' / −'+amount(day.outgoing)+'</span>'+icon("arrow")+'</button>':'<p class="empty">'+T("За период операций нет.","Бұл кезеңде операция жоқ.")+'</p>')+'</section>'+
    '<div class="kpis">'+[["",d.count,T("Все операции","Барлық операциялар")],["blocked",d.blocked,T("Отклонены","Қабылданбады")],["cooling_off",d.paused,T("На проверке","Тексерілуде")]].map(([k,v,n])=>'<button data-drill-status="'+k+'"><strong>'+v+'</strong><small>'+n+'</small></button>').join("")+'</div><p class="hint">'+T("Суммы учитывают только проведённые операции. Даты по времени Казахстана.","Сома тек орындалған операциялардан есептеледі. Күндер Қазақстан уақытымен.")+'</p>';
  }
  function soc(d,full=false){
    if(!d)return "";
    const s=d.states,c=d.case_states,open=Object.entries(c).reduce((v,[k,n])=>v+(!["RESOLVED","CLOSED"].includes(k)?n:0),0);
    const lines=Object.entries(s).map(([k,v])=>'<div class="soc-line">'+badge(k)+'<strong>'+v.count+' · '+amount(v.amount)+'</strong></div>').join("");
    return '<h1>'+T(full?"Аналитика безопасности":"Обзор безопасности",full?"Қауіпсіздік аналитикасы":"Қауіпсіздік шолуы")+'</h1>'+periods(d.days)+'<div class="soc-hero"><small>'+T("Сумма отклонённых переводов","Қабылданбаған аударымдар сомасы")+'</small><strong>'+amount(s.blocked?.amount||0)+'</strong><small>'+T("По текущему решению · KZT","Ағымдағы шешім бойынша · KZT")+'</small></div><div class="kpis soc-kpis">'+[[s.cooling_off?.count||0,T("На проверке","Тексерілуде")],[d.blocked_recipients,T("Получатели блокировок","Бұғатталған аударым алушылары")],[open,T("Открытые дела","Ашық істер")],[(c.RESOLVED||0)+(c.CLOSED||0),T("Завершённые дела","Аяқталған істер")]].map(([v,n])=>'<div><strong>'+v+'</strong><small>'+n+'</small></div>').join("")+'</div>'+
    (full?'<section class="paper"><h2>'+T("Решения по операциям","Операциялар бойынша шешімдер")+'</h2>'+lines+'<p>'+T("Среднее время оценки движком","Қозғалтқыштың орташа бағалау уақыты")+' · '+(d.mean_engine_ms==null?'—':Number(d.mean_engine_ms).toFixed(1)+' ms')+'</p></section>':'')+'<p class="hint">'+T("Операции и дела, созданные с","Операциялар мен істердің басталу күні")+' '+E(d.from)+' · UTC+5</p>';
  }
  function telegram(a,contacts) {
    const verified=(contacts?.contacts||[]).filter(c=>c.state==="CONTACT_VERIFIED").length;
    return '<section class="telegram-panel">'+icon("guardian")+'<div><h2>Telegram Guardian</h2><p>'+T("Доверенный человек получит предупреждение и сможет сообщить о подозрении.","Сенімді адам ескерту алып, күдік туралы хабарлай алады.")+'</p><strong>'+T("Согласившиеся контакты","Келісім берген контактілер")+' · '+verified+' / '+(a?.contact_limit??"—")+'</strong><p class="hint">'+(a?.telegram_mode==="test"?T("Тестовый канал Telegram","Telegram тест арнасы"):T("На этом стенде доставка через тестовый адаптер.","Бұл стендте жеткізу тест адаптерімен орындалады."))+'</p></div>'+
    (a?.guardian_username?button("open-guardian",T("Открыть Telegram Guardian","Telegram Guardian ашу")):'<p>'+T("Адрес бота на стенде не настроен.","Стендте боттың мекенжайы бапталмаған.")+'</p>')+button("contacts",T("Мой доверенный круг","Сенімді адамдарым"),"secondary")+'</section>';
  }
  return {home,history,analytics,soc,telegram,rows,badge,periods};
}
