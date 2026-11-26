import { test, expect } from "@playwright/test";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sender = {id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",full_name:"Учебный клиент"};
const recipient = {id:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",full_name:"Учебный получатель"};
const transfer = {transaction_id:id,amount:"900000.00",status:"cooling_off",risk_score:70,
  created_at:"2026-11-25T10:00:00Z",cooling_until:"2099-11-25T10:15:00Z",sender,recipient,
  reasons:[{code:"ACTIVE_CALL",layer:"rules",score_delta:25,reason_ru:"Перевод во время звонка",reason_kk:"Қоңырау кезіндегі аударым"}]};

for (const width of [393,1440]) test(`SOC ${width}: same receipt, graph evidence and role cleanup`,async({page,baseURL},info)=>{
  await page.setViewportSize({width,height:900});
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  let role="admin",summaryUnavailable=false;
  let leads=[];
  await page.route("https://wallet.test/**",async route=>{
    const u=new URL(route.request().url());
    if(!u.pathname.startsWith("/mobile/v1/"))return route.fulfill({response:await route.fetch({url:new URL(u.pathname,baseURL).href})});
    const path=u.pathname.slice(11);let json={},status=200;
    if(path==="compatibility")return route.fulfill({json:{api_major:1,minimum_android_build:0}});
    if(path==="wallet/brand-reports"){
      if(route.request().method()==="POST")leads.push({...route.request().postDataJSON(),observed_at:"2026-11-26T10:00:00Z"});
      return route.fulfill({json:leads});
    }
    if(path==="auth/login")json={role,subject:role,token:"fixture-session"};
    else if(path==="session"&&route.request().method()==="DELETE")return route.fulfill({status:204});
    else if(path==="inbox")json={items:[]};
    else if(path==="account")json={display_name:"Учебный клиент",balance:"1000000",recipients:[],card_last4:"1001"};
    else if(path==="wallet/soc"){
      status=summaryUnavailable?503:200;
      json={days:7,states:{blocked:{amount:"0",count:0},cooling_off:{amount:"900000",count:1}},case_states:{NEW:1}};
    } else if(path==="api/soc/feed")json={items:[transfer],pagination:{has_more:false,total:1}};
    else if(path===`api/transfers/${id}`)json=transfer;
    else if(path.startsWith("api/soc/graph/"))json={nodes:[{id:recipient.id,data:{label:recipient.full_name,in_degree:1,out_degree:0,role:"client"}}],edges:[]};
    else if(path==="wallet/graph-operations")json={items:[transfer],has_more:false};
    else if(path==="wallet/operations")json={items:[{...transfer,counterparty:recipient.full_name,direction:"outgoing"}]};
    else if(path==="admin/metrics")json={scope:"wallet_transfer_api",buckets:[],requests:3,rate_limited:0,server_errors:0,p95_upper_ms:200};
    else if(path==="admin/staff")json={items:[{subject:sender.id,login:"admin_demo",enabled:true,version:1}],audit:[]};
    await route.fulfill({status,json});
  });
  await page.addInitScript(()=>localStorage.setItem("qadam.language","ru"));
  await page.goto("https://wallet.test/");
  const login=async name=>{
    await page.locator("[name=login]").fill(name);
    await page.locator("[name=password]").fill("fixture");
    await page.locator("#personal-login [type=submit]").click();
  };
  await login("admin_demo");
  await expect(page.locator(".sx-shell")).toBeVisible();
  await page.locator('[data-action="brand-reports"]').click();
  await page.locator('#brand-report-form [name="indicator"]').fill("fixture.example");
  await page.locator('#brand-report-form button').click();
  await page.getByText("Черновик обращения на удаление").click();
  await expect(page.locator("#app")).toContainText("fixture[.]example");
  await page.locator('[data-nav="home"]').first().click();
  await expect(page.locator(`[data-detail="${id}"]`)).toBeEnabled();
  await expect(page.locator(".sx-kpi").filter({hasText:"Участники в ленте"})).toContainText("2");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`soc-${width}.png`),animations:"disabled"});
  await page.locator(`[data-detail="${id}"]`).click();
  await expect(page.locator(".sx-tools")).toContainText(id);
  await expect(page.locator(".sx-why-row")).toContainText("Перевод во время звонка");
  await page.locator(`[data-graph="${recipient.id}"]`).click();
  await page.locator("[data-node-index='0']").click();
  await expect(page.locator("#graph-records")).toContainText("900 000");
  await page.locator("[data-action=graph-zoom]").click();
  await expect(page.locator("#graph-zoom-level")).toHaveText("160 %");
  await page.locator("[data-action=graph-shrink]").click();
  await expect(page.locator("#graph-zoom-level")).toHaveText("100 %");
  summaryUnavailable=true;
  await page.locator("[data-nav=home]").first().click();
  await expect(page.locator(".error-banner")).toBeVisible();
  await expect(page.locator(`[data-detail="${id}"]`)).toBeEnabled();
  await page.locator("[data-nav=settings]").click();
  await page.locator("[data-action=logout]").click();
  await expect(page.locator("#personal-login")).toBeVisible();
  role="client";await login("client_demo");
  await expect(page.locator(".q-card")).toBeVisible();
  await expect(page.locator(".sx-shell")).toHaveCount(0);
  await expect(page.locator("[data-nav=cases]")).toHaveCount(0);
  await page.locator("[data-nav=settings]").click();
  await page.locator("[data-action=logout]").click();
  role="platform_admin";await login("platform_demo");
  await expect(page.locator(".sx-hero")).toContainText("Нагрузка API");
  await expect(page.locator("[data-nav=cases]")).toHaveCount(0);
  await expect(page.locator(`[data-detail="${id}"]`)).toHaveCount(0);
  await page.locator("[data-nav=staff]").click();
  await expect(page.locator(".sx-staff")).toContainText("admin_demo");
  await page.screenshot({path:info.outputPath(`platform-${width}.png`),animations:"disabled"});
  expect(errors).toEqual([]);
});
