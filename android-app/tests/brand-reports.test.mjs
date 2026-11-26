import test from "node:test";
import assert from "node:assert/strict";
import {brandReports} from "../www/brand-reports.mjs";
test("SOC drafts defang indicators and provide both languages, with no external action",()=>{
  const leads=[{indicator:"scam-fixture.example",basis:"asks_for_code",observed_at:"2026-11-26"}];
  for(const lang of ["kk","ru"]){
    const html=brandReports(leads,(ru,kk)=>lang==="kk"?kk:ru,String);
    assert.ok(html.includes("scam-fixture[.]example"));
    assert.ok(html.includes(lang==="ru"?"Черновик обращения":"Өтініш жобасы"));
    assert.doesNotMatch(html,/href=|action="https?:/);
  }
});
