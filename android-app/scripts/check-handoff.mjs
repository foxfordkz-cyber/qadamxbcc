// Browser acceptance of the prepared, loopback-only dataset. Run from android-app.
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const origin = "http://127.0.0.1:18127";
const output = new URL(process.argv.includes("--workspace28") ? "../../docs/workspace-28/after/flow/" : "../../docs/handoff-evidence/", import.meta.url);
const access = JSON.parse(await readFile(new URL("../../.local-checks/handoff-access/access.json", import.meta.url)));
await mkdir(output, {recursive:true});
const browser = await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL || "chrome"});
async function signIn(name, field) {
  const page = await browser.newPage({viewport:{width:465,height:900},serviceWorkers:"block"});
  page.setDefaultTimeout(90_000);
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
async function api({page, subject}, path, expected=200, method="GET", payload={}) {
  const reply = await page.evaluate(async ({subject, path, method, payload}) => {
    const headers = {"X-Qadam-Subject": subject, "X-Qadam-Web": "1"};
    if (method === "POST") {
      headers["Idempotency-Key"] = crypto.randomUUID();
      headers["Content-Type"] = "application/json";
    }
    const response = await fetch("/mobile/v1" + path, {
      method, headers, credentials: "same-origin", redirect: "error",
      body: method === "POST" ? JSON.stringify(payload) : undefined,
    });
    return {status: response.status, data: await response.json()};
  }, {subject, path, method, payload});
  assert.equal(reply.status, expected, path);
  return reply.data;
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
  await screen(platform.page,"platform-metrics",'[data-nav="staff"]');
  await platform.page.locator('[data-nav="staff"]').click();
  await screen(platform.page,"platform-staff","[data-staff]");
  await platform.page.close();
  await api(client,"/wallet/cases",403);
  const account=await api(client,"/account");
  assert.equal(account.recipients.length,7);
  const saved = account.recipients.filter(contact => /^saved-[1-4]$/.test(contact.payee_ref));
  assert.equal(new Set(saved.map(contact => contact.payee_ref)).size, 4);
  for (const contact of saved) {
    const result = await api(client, "/api/payee-check", 200, "POST", {
      recipient: contact.payee_ref, bank: "bcc",
    });
    assert.equal(result.status, "identified");
    assert.equal(result.recipient, contact.payee_ref);
    assert.ok(result.display_name);
  }
  for(const days of [7,30,90]) {
    const stats=await api(client,"/wallet/analytics?days="+days);
    let rows=[],more=true;
    while(more) {
      const batch=await api(client,"/wallet/operations?days="+days+"&limit=50&offset="+rows.length);
      rows.push(...batch.items);more=batch.has_more;
    }
    assert.equal(stats.count,rows.length);
    console.log(days + " days: " + rows.length + " operations; " +
      stats.incoming + " KZT incoming, " + stats.outgoing + " KZT outgoing.");
    for(const dir of ["incoming","outgoing"]) {
      const cents=rows.filter(r=>r.direction===dir && r.status==="approved")
        .reduce((sum,r)=>sum+Math.round(Number(r.amount)*100),0);
      assert.equal(cents,Math.round(Number(stats[dir])*100));
    }
  }
  const reports=await api(client,"/api/integrations/guardian/reports");
  const cases=await api(soc,"/wallet/cases");
  assert.ok(reports.length>=4 && cases.items.length>=10);
  // wallet-v1 out/0 contains the information request and the client's answer.
  const report=reports.find(r=>r.transaction_id==="c374f6fa-0f91-5f8d-ad9b-9812698fa305");
  assert.ok(report, "The signed-in client owns the linked demonstration report");
  const reportPath = "/api/integrations/guardian/reports/" + report.id;
  await api(soc, reportPath + "/acknowledge", 200, "POST");
  assert.equal((await api(client, reportPath)).state, "DEMO_ACKNOWLEDGED");
  const linked=cases.items.find(c=>c.report_id===report.id);
  assert.ok(linked);
  const evidence=await api(soc,"/api/integrations/guardian/soc/cases/"+linked.id+"/evidence");
  assert.equal(evidence.transaction_id,report.transaction_id);
  const receipt=await api(client,"/api/transfers/"+report.transaction_id);
  const same=await api(soc,"/api/transfers/"+report.transaction_id);
  assert.deepEqual([receipt.amount,receipt.status,receipt.recipient.id],[same.amount,same.status,same.recipient.id]);
  await screen(client.page,"client-home",".q-card");
  await client.page.locator('[data-nav="history"]').click();
  await screen(client.page,"client-history","[data-detail]");
  await client.page.locator("[data-detail]").first().click();
  await screen(client.page,"client-receipt",'[data-screen="detail"] main');
  await client.page.locator('[data-nav="analytics"]').click();
  await screen(client.page,"client-analytics","main h1");
  await client.page.goto(origin+"/wallet/?report="+report.id);
  await client.page.getByText(report.description, {exact: true}).first().waitFor();
  await screen(client.page,"client-report",'[data-screen="reportDetail"] main .paper');
  await screen(soc.page,"soc-feed","[data-detail]");
  await soc.page.locator("details summary").first().click();
  await soc.page.locator("details [data-graph]").first().click();
  await soc.page.locator("#node-focus").selectOption({index: 1});
  await screen(soc.page,"soc-network","#graph-records [data-detail]");
  await soc.page.locator('[data-nav="cases"]').click();
  await screen(soc.page,"soc-cases","[data-case]");
  await soc.page.locator('[data-case="'+linked.id+'"]').click();
  await screen(soc.page,"soc-case",'[data-detail="'+report.transaction_id+'"]');
  console.log("Verified three roles, seven recipients, 7/30/90-day totals, report/case/receipt, graph sources and browser views.");
} finally {await browser.close();}
