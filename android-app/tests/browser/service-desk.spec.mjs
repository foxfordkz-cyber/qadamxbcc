import { test,expect } from "@playwright/test";

const subject="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
async function login(page,baseURL,role,handle) {
  await page.route("https://wallet.test/**",async route=>{
    const url=new URL(route.request().url());
    if(!url.pathname.startsWith("/mobile/v1/")) return route.fulfill({response:await route.fetch({url:new URL(url.pathname,baseURL).href})});
    const path=url.pathname.slice("/mobile/v1".length);
    if(path==="/auth/login")return route.fulfill({json:{role,subject,token:"synthetic"}});
    const response=await handle(path,route.request());
    await route.fulfill(response);
  });
  await page.addInitScript(()=>localStorage.setItem("qadam.language","ru"));
  await page.goto("https://wallet.test/");
  await page.locator("[name=login]").fill("fixture");
  await page.locator("[name=password]").fill("fixture");
  await page.locator("#personal-login [type=submit]").click();
  await expect(page.locator('[data-screen="home"][data-actor="'+role+'"]')).toBeVisible();
}
test("platform navigation uses only aggregate endpoints, reports a stale change and rereads employee access",async({page,baseURL})=>{
  const staff={subject,role:"officer",login:"admin_demo",enabled:true,version:0};
  const requests=[];
  await login(page,baseURL,"platform_admin",(path,req)=>{
    requests.push(path);
    if(path==="/admin/metrics")return {json:{scope:"wallet_transfer_api",requests:8,rate_limited:2,server_errors:1,p95_upper_ms:50,
      buckets:[{minute:"2026-11-20T15:00:00Z",requests:8,rate_limited:2,server_errors:1}]}};
    if(path==="/admin/staff")return {json:{items:[staff],audit:[]}};
    if(path==="/admin/staff/"+subject){
      expect(req.postDataJSON()).toEqual({expected_version:0,enabled:false});
      Object.assign(staff,{version:1,enabled:false});
      return {status:409,json:{detail:"version_conflict"}};
    }
    return {status:403,json:{}};
  });
  await expect(page.locator(".desk-stats")).toContainText("≤ 50 мс");
  await page.locator("summary").click();
  await expect(page.locator(".desk-table tbody tr")).toContainText("20:00");
  await expect(page.locator("nav [data-nav]")).toHaveCount(3);
  await page.locator("[data-nav=staff]").click();
  page.once("dialog",dialog=>dialog.accept());
  await page.locator("[data-staff]").click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.locator("[data-action=reload-screen]").click();
  await expect(page.locator("[data-staff]")).toHaveText("Восстановить доступ");
  await page.locator("[data-action=language]:visible").first().click();
  await expect(page.locator("[data-staff]")).toHaveText("Рұқсатты қалпына келтіру");
  expect(requests.every(path=>path.startsWith("/admin/"))).toBe(true);
});
test("customer can explicitly retry a failed reply without duplicating consent or opening a dialer",async({page,baseURL})=>{
  const row={id,case_id:subject,status:"requested",expires_at:"2026-11-20T18:00:00Z",demonstration_only:true};
  const keys=[];
  await login(page,baseURL,"client",(path,req)=>{
    if(path==="/account")return {json:{display_name:"Алия",card_last4:"1001",balance:"50000",recipients:[]}};
    if(path==="/wallet/operations")return {json:{items:[]}};
    if(path==="/wallet/analytics")return {json:{outgoing:"0"}};
    if(path==="/api/trusted-contacts")return {json:{contacts:[]}};
    if(path==="/callbacks")return {json:{items:[row]}};
    if(path==="/callbacks/"+id+"/answer"){
      keys.push(req.headers()["idempotency-key"]);
      expect(req.postDataJSON()).toEqual({answer:"declined"});
      if(keys.length===1)return {status:503,json:{}};
      row.status="declined";
      return {json:row};
    }
    return {status:403,json:{}};
  });
  await expect(page.locator("[data-action=callbacks]")).toContainText("Отдел антифрода ждёт ответа · 1",{timeout:8000});
  await page.locator("[data-nav=safety]").click();
  await page.locator("[data-action=callbacks]").click();
  const decline=page.locator('[data-answer="declined"]');
  await decline.click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator("a[href^='tel:']")).toHaveCount(0);
  await decline.click();
  await expect(page.locator(".desk-callback h3")).toHaveText("Клиент отказался");
  await expect(page.locator("[data-answer],a[href^='tel:']")).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/i);
  expect(keys[1]).toBe(keys[0]);
});

test("saved answers survive navigation and delayed saving never releases a transfer",async({page,baseURL})=>{
  const saved={caller_claims_bank_or_police:false,asked_to_move_to_safe_account:false,
    asked_to_keep_secret_or_install_app:false,initiated_by_customer:true,knows_recipient_personally:true};
  const now=Date.now();
  const tx={transaction_id:id,status:"cooling_off",recipient:{display_name:"Арман",iban_masked:"KZ** 0191"},
    counterparty:"Арман",direction:"outgoing",amount:"12500.25",created_at:new Date(now).toISOString(),
    server_time:new Date(now).toISOString(),cooling_off_until:new Date(now+900000).toISOString(),verification_answers:{...saved}};
  const intents=[];
  await login(page,baseURL,"client",(path,req)=>{
    if(path==="/account")return {json:{display_name:"Алия",balance:"50000",recipients:[]}};
    if(path==="/wallet/operations")return {json:{items:[tx]}};
    if(path==="/wallet/analytics")return {json:{outgoing:"0"}};
    if(path==="/api/transfers/"+id)return {json:tx};
    if(path==="/protection/"+id+"/check")return {json:{transaction_id:id}};
    if(path==="/api/transfers/"+id+"/resolve-cooling"){
      const {save_only,answers}=req.postDataJSON();
      intents.push(save_only);
      tx.verification_answers=answers;
      tx.server_time=tx.cooling_off_until;
      if(!save_only)tx.status="approved";
      return {json:tx};
    }
    return {json:{items:[],contacts:[]}};
  });
  await page.locator('[data-detail="'+id+'"]').first().click();
  await page.locator("details summary").filter({hasText:"Сохранённые ответы"}).click();
  await page.locator('[data-action="questionnaire"]').click();
  await expect(page.locator("main")).toContainText(/12\s500,25/);
  await expect(page.locator('[data-action="submit-answers"]')).toBeDisabled();
  await page.locator('[data-action="edit-answer"][data-index="4"]').click();
  await page.locator('[data-action="answer-no"]').click();
  await page.locator('[data-action="submit-answers"]').click();
  await expect(page.locator("h1")).toHaveText("На проверке");
  expect(intents).toEqual([true]);
  await page.locator('[data-action="questionnaire"]').click();
  await expect(page.locator('[data-action="release-transfer"]')).toBeVisible();
  await page.locator('[data-action="release-transfer"]').click();
  await expect(page.locator("h1")).toHaveText("Выполнен");
  expect(intents).toEqual([true,false]);
});

test("cancellation reviews the current receipt and reconciles a lost acknowledgement", async ({page,baseURL}) => {
  const tx = {transaction_id:id, amount:"12500.25", status:"cooling_off", direction:"outgoing",
    recipient:{display_name:"Алия", iban_masked:"KZ** 1234"}, created_at:new Date().toISOString(),
    server_time:new Date().toISOString(), cooling_off_until:new Date(Date.now()+900000).toISOString()};
  let writes=0;
  await login(page,baseURL,"client",path=>{
    if(path==="/account") return {json:{display_name:"Данияр",balance:"100000",recipients:[]}};
    if(path==="/wallet/operations") return {json:{items:[tx]}};
    if(path==="/wallet/analytics") return {json:{outgoing:"0"}};
    if(path==="/api/transfers/"+id) return {json:tx};
    if(path==="/api/transfers/"+id+"/cancel") {
      writes++; tx.status="cancelled"; return {status:503,json:{}};
    }
    if(path==="/protection/"+id+"/check") return {json:{transaction_id:id}};
    return {json:{items:[],contacts:[]}};
  });
  await page.locator(`[data-detail="${id}"]`).first().click();
  await page.locator('[data-action="cancel-confirm"]').click();
  const sheet=page.locator('[data-screen="confirmCancel"]');
  await expect(sheet.locator(".receipt")).toContainText("Алия");
  await expect(sheet.locator(".amount")).toHaveText("12 500,25 ₸");
  expect(writes).toBe(0);
  await sheet.locator(`[data-action="cancel-transfer"][data-transaction="${id}"]`).click();
  await expect(page.locator("main h1")).toHaveText("Отменён");
  expect(writes).toBe(1);
});
