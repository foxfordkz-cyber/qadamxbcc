import { PRESETS } from "./demo.mjs";
import { ledgerInstant } from "./wallet-date.mjs";

const OPENING_BALANCE = 850000;
const DAY = 86400000;
// Built-in practice operations, shown before the visitor creates any example.
// Times are fixed in the ledger's timezone and placed on previous days, so they never appear in the future.
export const SAMPLE_OPERATIONS = Object.freeze([
  Object.freeze({ id: "sample-everyday", counterparty: "Айгерім Сейітова", amount: 15000, status: "approved", daysAgo: 1, time: "14:20" }),
  Object.freeze({ id: "sample-call-hold", counterparty: "Нұрлан Бекұлы", amount: 450000, status: "cancelled", heldDuringCall: true, daysAgo: 2, time: "11:05" }),
]);
export const SAMPLE_RECIPIENTS = Object.freeze([Object.freeze({ name: "Айгерім Сейітова", phone: "+77015550142" })]);

export function sampleInstant(sample, now = Date.now()) {
  const today = ledgerInstant(now)?.day;
  return new Date(Date.parse(today + "T" + sample.time + ":00+05:00") - sample.daysAgo * DAY).toISOString();
}

// Read only the local practice ledger. No server session or remote transport is used.
export function offlineWallet(state, now = Date.now()) {
  const created = state.transfers.map(tx=>({
    transaction_id:tx.id, counterparty:PRESETS[tx.preset].recipient, amount:PRESETS[tx.preset].amount,
    status:tx.status, direction:"outgoing", created_at:new Date(tx.createdAt).toISOString()
  }));
  const samples = SAMPLE_OPERATIONS.map(s=>({
    transaction_id:s.id, counterparty:s.counterparty, amount:s.amount, status:s.status, direction:"outgoing", created_at:sampleInstant(s, now)
  }));
  const items=[...created,...samples].sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));
  // The balance moves only with executed transfers; held and cancelled ones keep the money on the account.
  const posted=items.filter(r=>r.status==="approved").reduce((s,r)=>s+r.amount,0);
  const account={display_name:"Сәуле Ахметова",card_last4:"4821",card_expiry:"11/29",balance:OPENING_BALANCE-posted,
    recipients:SAMPLE_RECIPIENTS.map(r=>({...r})),
    active_pause:items.find(r=>r.status==="cooling_off")?.transaction_id};
  function analytics(days,at=new Date(now)){
    const last=ledgerInstant(at).day;
    const end=Date.parse(last+"T12:00:00Z");
    const series=Array.from({length:days},(_,i)=>({day:new Date(end-(days-i-1)*DAY).toISOString().slice(0,10),incoming:0,outgoing:0,count:0,paused:0,blocked:0}));
    const dates=new Map(series.map(d=>[d.day,d]));
    for(const item of items){
      const d=dates.get(ledgerInstant(item.created_at).day);
      if(!d)continue;
      d.count++;
      if(item.status==="approved")d.outgoing+=item.amount;
      if(item.status==="cooling_off")d.paused++;
      if(item.status==="blocked")d.blocked++;
    }
    return {days,from:series[0].day,series,incoming:0,...Object.fromEntries(
      ["outgoing","count","paused","blocked"].map(k=>[k,series.reduce((sum,d)=>sum+d[k],0)]))};
  }
  return {account,items,analytics};
}
