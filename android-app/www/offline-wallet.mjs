import { PRESETS } from "./demo.mjs";
import { ledgerInstant } from "./wallet-date.mjs";

// Read only the local practice ledger. No server session or remote transport is used.
export function offlineWallet(state) {
  const items=state.transfers.map(tx=>({
    transaction_id:tx.id, counterparty:PRESETS[tx.preset].recipient, amount:PRESETS[tx.preset].amount,
    status:tx.status, direction:"outgoing", created_at:new Date(tx.createdAt).toISOString()
  }));
  const posted=items.filter(r=>r.status==="approved").reduce((s,r)=>s+r.amount,0);
  const account={display_name:"Qadam Demo",card_last4:"0001",balance:850000-posted,recipients:[],
    active_pause:items.find(r=>r.status==="cooling_off")?.transaction_id};
  function analytics(days,now=new Date()){
    const last=ledgerInstant(now).day;
    const end=Date.parse(last+"T12:00:00Z");
    const series=Array.from({length:days},(_,i)=>({day:new Date(end-(days-i-1)*86400000).toISOString().slice(0,10),incoming:0,outgoing:0,count:0,paused:0,blocked:0}));
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
