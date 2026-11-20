import { test } from "node:test";
import assert from "node:assert/strict";
import { serviceDesk } from "../www/service-desk.mjs";

function desk(kk=false) {
  return serviceDesk({
    T:(ru,kz)=>kk?kz:ru, E:String, when:String, title:heading=>heading,
    button:(action,label)=>'<button data-action="'+action+'">'+label+'</button>',
  });
}
const row={id:"synthetic-callback",case_id:"case-12345678",demonstration_only:true};
const invite={state:"IN_REVIEW",assignee:"demo_analyst_a"};
test("only an assigned officer can offer contact, a terminal answer requires a new customer request",()=>{
  for (const view of [{callback:null},{callback:{...row,status:"customer_requested"}}]) {
    assert.match(desk().officerCallback(invite,view),/data-action="officer-callback"/);
    assert.doesNotMatch(desk().officerCallback({...invite,assignee:"other"},view),/data-action=/);
    assert.doesNotMatch(desk().officerCallback({...invite,state:"CLOSED"},view),/data-action=/);
  }
  for(const status of ["accepted","declined","expired","requested"]) {
    assert.doesNotMatch(desk().officerCallback(invite,{callback:{...row,status}}),/data-action=|data-answer=|tel:/);
  }
});
test("case owner can renew declined or expired contact only when the case remains active",()=>{
  for(const status of ["declined","expired"]) {
    const view={case_id:row.case_id,case_state:"IN_REVIEW",callback:{...row,status}};
    assert.match(desk(true).reportCallback(view),/Кері қоңырау сұрау/);
    assert.doesNotMatch(desk().reportCallback({...view,case_state:"RESOLVED"}),/data-action="customer-callback"/);
  }
  assert.equal(desk().reportCallback(null),"");
});
test("no offered phone links before agreement, the accepted card ignores any number sent by the server",()=>{
  const ui=desk();
  for (const status of ["customer_requested","requested","declined","expired"]) {
    assert.doesNotMatch(ui.callbackCard({...row,status},true),/tel:/);
  }
  const card=ui.callbackCard({...row,status:"accepted",phone:"untrusted"},true);
  assert.match(card,/href="tel:505"/);
  assert.doesNotMatch(card,/untrusted|data-answer/);
  assert.equal(ui.callbackCard({...row,demonstration_only:false},true),"");
});
test("monitor presents the real p95 bound, overflow, and empty-data state separately",()=>{
  const stats={scope:"wallet_transfer_api",buckets:[],p95_upper_ms:null,requests:0,rate_limited:0,server_errors:0};
  assert.match(desk().metrics(stats),/<dd>—<\/dd>/);
  assert.match(desk().metrics({...stats,p95_upper_ms:25}),/<dd>≤ 25 мс<\/dd>/);
  assert.match(desk(true).metrics({...stats,p95_overflow:true}),/<dd>30 с артық<\/dd>/);
  assert.doesNotMatch(desk().metrics(null),/desk-stats/);
  assert.doesNotMatch(desk().queue({by_state:{NEW:0},oldest_current_status_seconds:{}}),/Самое долгое ожидание/);
});
