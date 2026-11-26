const parts=location.hash.slice(1).split(".");
const route=parts.length===3 ? parts.shift() : null;
const [transfer,code]=parts;
history.replaceState(null,"",location.pathname);
let ru=false, state=transfer && code?"":"invalid", sending=false;
const labels={
 title:["Екінші қатысушының оқу жауабы","Учебный ответ второго участника"],
 scope:["Жауап осы бөлмедегі бір дау бойынша беріледі. Оны SOC қызметкері көреді.","Ответ относится к одному спору в этой комнате. Его увидит сотрудник SOC."],
 question:["Осы аударымға қандай түсініктеме бересіз?","Как вы объясняете этот перевод?"],
 agreed:["Тараптар төлемді алдын ала келісті","Стороны согласовали платёж"],
 unexpected:["Аударым күтпеген жерден болды","Перевод оказался неожиданным"],
 redirect_requested:["Ақшаны басқа адамға жіберуді сұрады","Просили переслать деньги третьему лицу"],
 submit:["Жауапты сақтау","Сохранить ответ"],
 done:["Жауап іс материалдарына қосылды.","Ответ добавлен к материалам спора."],
 invalid:["Сілтеменің мерзімі өткен немесе бөлме сәйкес емес.","Срок ссылки истёк или открыта другая комната."],
 error:["Жауапты сақтау мүмкін болмады. Қайталап көріңіз.","Не удалось сохранить ответ. Попробуйте ещё раз."],
 closed:["Осы дау бойынша жауап бұрын сақталған.","По этому спору уже сохранён ответ."]
};
try{ru=localStorage.getItem("qadam.language")==="ru";}catch{}
function render(){
  document.documentElement.lang=ru?"ru":"kk";
  for(const id of ["title","scope","question","agreed","unexpected","redirect_requested","submit"])document.getElementById(id).textContent=labels[id][+ru];
  document.getElementById("result").textContent=state?labels[state][+ru]:"";
  document.getElementById("interview").hidden=["done","invalid","closed"].includes(state);
  document.getElementById("submit").disabled=sending;
}
document.getElementById("language").onclick=()=>{ru=!ru;render();};
document.getElementById("interview").onsubmit=async e=>{
  e.preventDefault();if(sending)return;
  sending=true;render();
  try{
    const response=await fetch("/mobile/v1/wallet/jury-interview",{method:"POST",credentials:route ? "omit" : "same-origin",redirect:"error",cache:"no-store",
      headers:{"Content-Type":"application/json",...(route?{"X-Saq-Interview":route}:{})},body:JSON.stringify({transfer,code,answer:new FormData(e.target).get("answer")})});
    state=response.ok?"done":[403,404,422].includes(response.status)?"invalid":response.status===409?"closed":"error";
  }catch{state="error";}finally{sending=false;render();}
};
render();
