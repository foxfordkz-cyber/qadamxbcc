import {test} from "node:test";
import assert from "node:assert/strict";
import {caseEvidenceView,caseLedgerView} from "../www/case-evidence.mjs";

test("a missing answer and a neutral rule cannot become exculpatory evidence",()=>{
  const tx={transaction_id:"tx-1",created_at:"2026-11-22",reasons:[
    {code:"TEST",layer:"risk",score_delta:5,reason_ru:"Positive"},
    {code:"EMPTY",layer:"risk",score_delta:0,reason_ru:"Neutral"},
  ]};
  const render=()=>caseEvidenceView(tx,(ru)=>ru,String,String);
  assert.match(render(),/Positive/);
  assert.doesNotMatch(render(),/Neutral/);
  assert.match(render(),/Снижающих риск факторов в расчёте нет/);
  assert.match(render(),/не зарегистрирован/);
  tx.reasons.push({code:"KNOWN",layer:"risk",score_delta:-3,reason_ru:"Known payee"});
  assert.match(render(),/Ослабляет подозрение[\s\S]*Known payee/);
  assert.match(render(),/data-detail="tx-1"/);
});

test("case ledger links actual receipts and distinguishes missing and empty history in both languages", () => {
  const history={from_time:"2026-11-21",before_time:"2026-11-22",has_more:true,items:[
    {transaction_id:"tx-incoming",direction:"incoming",amount:"1001.25",settled_at:"12:01"},
    {transaction_id:"tx-outgoing",direction:"outgoing",amount:"19.75",settled_at:"11:02"},
  ]};
  for (const [T,incoming,outgoing,empty,missing] of [
    [(ru)=>ru,"Зачисление","Списание","нет исполненных переводов","недоступна"],
    [(_,kk)=>kk,"Түсім","Шығыс","орындалған аударымдар жоқ","қолжетімсіз"],
  ]) {
    const view=caseLedgerView(history,T,String,String);
    assert.ok(view.includes(incoming+" · 1\u00a0001,25 ₸") && view.includes(outgoing+" · 19,75 ₸"));
    assert.match(view,/data-detail="tx-outgoing"/);
    assert.ok(view.includes("12:01") && view.includes("11:02") && view.includes("8"));
    assert.ok(caseLedgerView({...history,items:[],has_more:false},T,String,String).includes(empty));
    assert.ok(caseLedgerView(null,T,String,String).includes(missing));
  }
});

test("later evidence displays its own recorded time", () => {
  const tx={transaction_id:"tx",created_at:"earlier",reasons:[
    {code:"R",layer:"rule",score_delta:1,reason_ru:"signal",evidence:{recorded_at:"later"}},
  ]};
  const result=caseEvidenceView(tx,(ru)=>ru,String,String);
  assert.match(result,/later/);
  assert.doesNotMatch(result,/earlier/);
});


test("a recorded pressure answer specifies the limit of the observation", () => {
  const tx = {transaction_id:"reviewed", context:{call_pressure_answer:"after_call"}, reasons:[]};
  for (const [translate, expected] of [[ru=>ru,/нельзя установить личность/], [(_,kk)=>kk,/анықтау мүмкін емес/]]) {
    assert.match(caseEvidenceView(tx,translate,String,String), expected);
  }
});
