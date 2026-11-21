// Browser acceptance of the prepared, loopback-only dataset. Run from android-app.
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const origin = "http://127.0.0.1:18127";
const output = new URL("../../docs/handoff-evidence/", import.meta.url);
const access = JSON.parse(await readFile(new URL("../../.local-checks/handoff-access/access.json", import.meta.url)));
await mkdir(output, {recursive:true});
const browser = await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL || "chrome"});
async function signIn(name, field) {
  const page = await browser.newPage({viewport:{width:465,height:900},serviceWorkers:"block"});
  await page.route("**/*", route => new URL(route.request().url()).origin===origin ? route.continue() : route.abort());
  await page.goto(origin+"/wallet/");
  const login = page.locator("#personal-login");
  await login.locator("[name=login]").fill(name);
  await login.locator("[name=password]").fill(access[field]);
  const response = page.waitForResponse(r=>r.url()===origin+"/mobile/v1/auth/login");
  await login.locator("[type=submit]").click();
  const session=await (await response).json();
  assert.equal(session.role,field);
  await page.locator("nav").waitFor();
  return {page,subject:session.subject};
}
async function api(actor, path, expected=200) {
  const response=await actor.page.request.get(origin+"/mobile/v1"+path,{headers:{
    "X-Qadam-Subject":actor.subject,"X-Qadam-Web":"1",Origin:origin}});
  assert.equal(response.status(),expected,path);
  return response.json();
}
async function screen(page,name,selector) {
  await page.locator(selector).first().waitFor();
  await page.locator(".busy-banner").waitFor({state:"hidden"});
  await page.screenshot({path:new URL(name+".png",output).pathname.replace(/^\/([A-Z]:)/i,"$1")});
}
try {
  const client=await signIn("client_demo","client");
  const soc=await signIn("admin_demo","admin");
  const platform=await signIn("platform_demo","platform_admin");
  await api(platform,"/admin/staff");
  await api(client,"/wallet/cases",403);
  const account=await api(client,"/account");
  assert.equal(account.recipients.length,7);
  for(const days of [7,30,90]) {
    const stats=await api(client,"/wallet/analytics?days="+days);
    let rows=[],more=true;
    while(more) {
      const batch=await api(client,"/wallet/operations?days="+days+"&limit=50&offset="+rows.length);
      rows.push(...batch.items);more=batch.has_more;
    }
    assert.equal(stats.count,rows.length);
    for(const dir of ["incoming","outgoing"]) {
      const cents=rows.filter(r=>r.direction===dir && r.status==="approved")
        .reduce((sum,r)=>sum+Math.round(Number(r.amount)*100),0);
      assert.equal(cents,Math.round(Number(stats[dir])*100));
    }
  }
  const reports=await api(client,"/api/integrations/guardian/reports");
  const cases=await api(soc,"/wallet/cases");
  assert.ok(reports.length>=4 && cases.items.length>=10);
  const report=reports.find(r=>r.transaction_id);
  const linked=cases.items.find(c=>c.report_id===report.id);
  assert.ok(linked);
  const evidence=await api(soc,"/api/integrations/guardian/soc/cases/"+linked.id+"/evidence");
  assert.equal(evidence.transaction_id,report.transaction_id);
  const receipt=await api(client,"/api/transfers/"+report.transaction_id);
  const same=await api(soc,"/api/transfers/"+report.transaction_id);
  assert.deepEqual([receipt.amount,receipt.status,receipt.recipient.id],[same.amount,same.status,same.recipient.id]);
  await screen(client.page,"client-home",".q-card");
  await client.page.locator('[data-nav="analytics"]').click();
  await screen(client.page,"client-analytics","main h1");
  await client.page.goto(origin+"/wallet/?report="+report.id);
  await screen(client.page,"client-report",".paper");
  await screen(soc.page,"soc-feed","[data-detail]");
  await soc.page.locator("details summary").first().click();
  await soc.page.locator("details [data-graph]").first().click();
  await screen(soc.page,"soc-network","#graph-records [data-detail]");
  await soc.page.locator('[data-nav="cases"]').click();
  await screen(soc.page,"soc-cases","[data-case]");
  await soc.page.locator('[data-case="'+linked.id+'"]').click();
  await screen(soc.page,"soc-case",'[data-detail="'+report.transaction_id+'"]');
  console.log("Verified three roles, seven recipients, 7/30/90-day totals, report/case/receipt, graph sources and browser views.");
} finally {await browser.close();}
