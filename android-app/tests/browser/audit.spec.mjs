import { test, expect } from "@playwright/test";

const ids = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"];
const items = ids.map((id,i)=>({transaction_id:id, counterparty:["Алия","Арман"][i],amount:"12500",status:"approved",direction:"outgoing",created_at:"2026-11-20T10:00:00Z"}));

async function enter(page,baseURL,fixture={}) {
  await page.route("https://wallet.test/**",async route=>{
    const u=new URL(route.request().url());
    if(!u.pathname.startsWith("/mobile/v1/")) return route.fulfill({response:await route.fetch({url:new URL(u.pathname,baseURL).href})});
    const path=u.pathname.slice(11);
    let status=200, json={};
    if(path==="auth/login")json={role:"client",subject:"audit-fixture",token:"fixture-session"};
    else if(path==="inbox")json={items:fixture.messages || []};
    else if(path==="account")json={display_name:"Алия",card_last4:"1001",balance:"50000",recipients:[{name:"Арман",phone:"+77010000002"}]};
    else if(path==="wallet/operations")json={items};
    else if(path==="wallet/analytics"){status=fixture.analytics||200;json={outgoing:"25000"};}
    else if(path.startsWith("api/transfers/"))json={...items.find(r=>r.transaction_id===path.split("/").at(-1)),recipient:{display_name:"Алия"}};
    else if(path.endsWith("/scam-check")){
      fixture.scanRequests = (fixture.scanRequests ?? 0) + 1;
      status = fixture.scan || 200;
      const ru = {language:"ru", guidance:"Проверено", signals:[{explanation:"Безопасный счёт"}], limitation:"Учебные правила"};
      const kk = {language:"kk", guidance:"Тексерілді", signals:[{explanation:"Қауіпсіз шот"}], limitation:"Оқу ережелері"};
      json = route.request().postDataJSON().language === "kk" ? {...kk, alternate:ru} : {...ru, alternate:kk};
    }
    else if(path.endsWith("/reports")&&route.request().method()==="POST"){fixture.sent=route.request().postDataJSON();status=fixture.reportStatus||200;json={id:ids[0]};}
    else if(path.endsWith("/history")||path.endsWith("/information-requests"))json={items:[]};
    else if(path.endsWith("trusted-contacts"))json={contacts:[]};
    await route.fulfill({status,json});
  });
  await page.addInitScript(()=>localStorage.setItem("qadam.language","ru"));
  await page.goto("https://wallet.test/");
  await page.locator("[name=login]").fill("client_demo");
  await page.locator("[name=password]").fill("fixture");
  await page.locator("#personal-login [type=submit]").click();
}
test("summary failure leaves the card and ledger available and supports retry",async({page,baseURL})=>{
  const fixture={analytics:503};await enter(page,baseURL,fixture);
  await expect(page.locator(".q-card")).toBeVisible();
  await expect(page.locator("[data-detail]").first()).toBeVisible();
  await expect(page.locator("[data-action=retry-summary]")).toBeVisible();
  fixture.analytics=200;await page.locator("[data-action=retry-summary]").click();
  await expect(page.locator("[data-action=retry-summary]")).toHaveCount(0);
});
test("both edit and toolbar Back retain the transfer draft",async({page,baseURL})=>{
  await enter(page,baseURL);await page.locator("[data-action=transfer]").click();
  await page.locator("[name=recipient_phone]").selectOption("+77010000002");
  await page.locator("[name=amount]").fill("12500");
  await page.locator("[name=active_call]").check();
  for(const action of ["back","edit-transfer"]){
    await page.locator("#transfer-form button").click();
    await page.locator('[data-action="'+action+'"]').click();
    await expect(page.locator("[name=amount]")).toHaveValue("12500");
    await expect(page.locator("[name=recipient_phone]")).toHaveValue("+77010000002");
    await expect(page.locator("[name=active_call]")).toBeChecked();
  }
});
test("Scam Check keeps edited text on failure, locale change and retry until cleared",async({page,baseURL})=>{
  const fixture={scan:503};await enter(page,baseURL,fixture);
  await page.locator("[data-nav=safety]").click();await page.locator("[data-action=scan]").click();
  const field=page.locator("#scan-form textarea"), text="Учебный текст после распознавания";
  await field.fill(text);await page.locator("#scan-form [type=submit]").click();
  await expect(page.getByRole("alert")).toBeVisible();await expect(field).toHaveValue(text);
  await page.locator("[data-action=language]:visible").first().click();await expect(field).toHaveValue(text);
  await expect(page.getByRole("alert")).toContainText("Қызмет уақытша");
  fixture.scan=200;await page.locator("#scan-form [type=submit]").click();
  for (const text of ["Тексерілді","Қауіпсіз шот","Оқу ережелері"]) await expect(page.getByText(text,{exact:true})).toBeVisible();
  await page.locator("[data-action=language]:visible").first().click();
  for (const text of ["Проверено","Безопасный счёт","Учебные правила"]) await expect(page.getByText(text,{exact:true})).toBeVisible();
  await expect(field).toHaveValue(text);
  expect(fixture.scanRequests).toBe(2); // The failed submission and its explicit retry.
  await page.locator("[data-action=clear-scan]").click();await expect(field).toHaveValue("");
});
test("switching a report from operation A to B preserves A and submits B",async({page,baseURL})=>{
  const fixture={};await enter(page,baseURL,fixture);
  const report=async(id)=>{await page.locator("[data-nav=history]").click();await page.locator('[data-detail="'+id+'"]').click();await page.locator("[data-action=report]").click();};
  await report(ids[0]);await page.locator("[name=description]").fill("Черновик первой операции");
  await report(ids[1]);await page.locator("[data-action=report-current]").click();
  await expect(page.locator("[name=description]")).toHaveValue("");
  await expect(page.locator(".report-context")).toContainText(ids[1]);
  await page.locator("[name=description]").fill("Сообщение о второй операции");await page.locator("[name=consent]").check();
  fixture.reportStatus=429;await page.locator("#report-form button").click();
  await expect(page.getByRole("alert")).toContainText("За 24 часа");
  await expect(page.locator("[name=description]")).toHaveValue("Сообщение о второй операции");
  fixture.reportStatus=200;await page.locator("#report-form button").click();await expect.poll(()=>fixture.sent?.transaction_id).toBe(ids[1]);
  await report(ids[0]);await expect(page.locator("[name=description]")).toHaveValue("Черновик первой операции");
});

test("desktop wallet navigation uses a vertical list of readable labels",async({page,baseURL})=>{
  await page.setViewportSize({width:1280,height:850});
  await enter(page,baseURL);
  const buttons=page.locator(".connected-nav [data-nav]");
  await expect(buttons.first()).toBeVisible();
  const geometry=await buttons.evaluateAll(items=>items.map(item=>{
    const box=item.getBoundingClientRect(), label=item.querySelector("span").getBoundingClientRect();
    return {top:box.top,height:box.height,labelHeight:label.height,width:box.width};
  }));
  expect(geometry).toHaveLength(5);
  expect(geometry.every((item,i)=>item.width>=140 && item.labelHeight<40 && (i===0||item.top>=geometry[i-1].top+geometry[i-1].height-1))).toBeTruthy();
});

test("a new security event appears in the open inbox without a manual reload",async({page,baseURL})=>{
  const fixture={messages:[]};
  await enter(page,baseURL,fixture);
  await page.locator("[data-nav=settings]").click();
  await page.locator("[data-action=inbox]").click();
  await expect(page.locator("h1")).toContainText("Сообщения безопасности");
  fixture.messages.push({kind:"transfer",object_id:ids[0],state:"cooling_off",time:"2026-11-20T10:00:00Z"});
  await expect(page.locator('[data-object-id="'+ids[0]+'"]')).toBeVisible({timeout:5500});
});
