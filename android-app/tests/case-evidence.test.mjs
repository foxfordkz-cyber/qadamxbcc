import {test} from "node:test";
import assert from "node:assert/strict";
import {caseEvidenceView} from "../www/case-evidence.mjs";

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

