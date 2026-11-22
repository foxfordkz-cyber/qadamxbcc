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
    else if(path==="inbox"){
      fixture.inboxReads=(fixture.inboxReads||0)+1;
      if (fixture.inboxGate) await fixture.inboxGate;
      const actions = u.search === "?view=actions";
      status = fixture.inboxStatus || 200;
      json = {items: actions ? fixture.actions || [] : fixture.messages || []};
    }
    else if(path==="account")json={display_name:"Алия",card_last4:"1001",balance:"50000",supports_call_question:fixture.supportsCallQuestion,recipients:fixture.recipients || [{name:"Арман",phone:"+77010000002"}]};
    else if(path==="api/payee-check"){
      const body=route.request().postDataJSON();
      fixture.payee=body;
      const outcome=body.bank!=="bcc"?"unavailable":body.expected_name && body.expected_name!=="Арман"?"mismatch":"identified";
      json={recipient:fixture.returnedRef || body.recipient,bank:body.bank,status:outcome,source:"synthetic_directory",display_name:outcome==="unavailable"?null:"Арман А.",
        ask_about_call: body.review_amount ? Number(body.review_amount) >= 50000 : undefined};
    }
    else if(path==="requests")json={request_id:ids[0]};
    else if(path==="api/transfers/evaluate"){
      fixture.evaluated=route.request().postDataJSON();
      json={...items[0],recipient:{display_name:"Арман"},reasons:[],risk_score:0,context:fixture.evaluated.context};
    }
    else if(path.endsWith("/packet"))json=fixture.packet || {transaction_id:path.split("/")[1],reports:[]};
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
    else if(/^api\/integrations\/guardian\/reports\/[\da-f-]+$/.test(path))
      json={id:path.split("/").at(-1),state:"SUBMITTED",description:"Сообщение клиента"};
    else if(path.startsWith("api/integrations/guardian/reports/")&&path.endsWith("/information-requests"))
      json=fixture.questions||[];
    else if(path.endsWith("/history")||path.endsWith("/information-requests"))json=[];
    else if(path.endsWith("trusted-contacts"))json={contacts:[]};
    await route.fulfill({status,json});
  });
  await page.addInitScript(()=>localStorage.setItem("qadam.language","ru"));
  await page.goto("https://wallet.test/");
  await page.locator("[name=login]").fill("client_demo");
  await page.locator("[name=password]").fill("fixture");
  await page.locator("#personal-login [type=submit]").click();
}

test("dashboard hierarchy, hidden amounts and RU/KK fit phone and desktop at large text",async({page,baseURL},info)=>{
  await enter(page,baseURL);
  await expect(page.locator(".transfer-primary")).toBeVisible();
  for(const width of [360,412,1440]) {
    await page.setViewportSize({width,height:900});
    await page.screenshot({path:info.outputPath(`home-ru-${width}.png`),fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.evaluate(()=>document.documentElement.style.fontSize="200%");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.locator(".transfer-primary").scrollIntoViewIfNeeded();
    await expect(page.locator(".transfer-primary")).toBeVisible();
    await page.evaluate(()=>document.documentElement.style.fontSize="");
  }
  await page.locator("[data-action=mask-balance]").click();
  await expect(page.locator(".week-summary strong")).toHaveText("•••••• ₸");
  await expect(page.locator(".q-balance strong")).toHaveText("•••••• ₸");
  await page.locator("[data-action=language]:visible").first().click();
await expect(page.locator(".transfer-primary")).toHaveAccessibleName("Аудару");
  await page.setViewportSize({width:360,height:900});
  await page.screenshot({path:info.outputPath("home-kk-360.png"),fullPage:true});
  await page.locator(".transfer-primary").click();
  await expect(page.locator(".transfer-steps [aria-current=step]")).toContainText("Деректемелер");
  await expect(page.locator(".from-account")).toContainText("•••••• ₸");
  await expect(page.locator(".from-account")).not.toContainText("1001");
  await page.locator("[name=recipient_phone]").selectOption("+77010000002");
  await page.locator("[name=amount]").fill("12500");
  await page.locator("#transfer-form button").click();
  await expect(page.locator(".transfer-steps [aria-current=step]")).toContainText("Тексеру");
  await page.screenshot({path:info.outputPath("review-kk-360.png"),fullPage:true});
});
test("summary failure leaves the card and ledger available and supports retry",async({page,baseURL})=>{
  const fixture={analytics:503};await enter(page,baseURL,fixture);
  await expect(page.locator(".q-card")).toBeVisible();
  await expect(page.locator("[data-detail]").first()).toBeVisible();
  await expect(page.locator("[data-action=retry-summary]")).toBeVisible();
  fixture.analytics=200;await page.locator("[data-action=retry-summary]").click();
  await expect(page.locator("[data-action=retry-summary]")).toHaveCount(0);
});
test("profile shortcut returns to the wallet and a quick amount survives a language switch", async ({page,baseURL}) => {
  const fixture = {};
  await enter(page,baseURL,fixture);
  await page.locator(".profile-entry").click();
  await expect(page.locator("#app")).toHaveAttribute("data-screen","settings");
  await page.locator(".back").click();
  await expect(page.locator(".q-card")).toContainText("Мои счета");
  await page.locator("[data-payee]").first().click();
  const form = page.locator("#transfer-form");
  await form.locator('[data-quick-amount="10000"]').click();
  await expect(form.locator("[name=amount]")).toHaveValue("10000");
  await form.locator("[name=active_call]").check();
  await form.locator("[name=recipient_phone]").selectOption("manual");
  await form.locator("[name=manual_phone]").fill("+7 (701) 000-00-02");
  await form.locator("[name=payee_name]").fill("Арман");
  await page.locator("[data-action=language]:visible").first().click();
  await expect(form.locator("[name=manual_phone]")).toHaveValue("+7 (701) 000-00-02");
  await expect(form.locator("[name=payee_name]")).toHaveValue("Арман");
  await expect(form.locator("[name=active_call]")).toBeChecked();
  await expect(form.locator("[name=amount]")).toHaveValue("10000");
  await form.locator("button.primary").click();
  await expect(page.locator("[data-payee-status=identified]")).toBeVisible();
  expect(fixture.evaluated).toBeUndefined();
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
test("changed bank and mismatched expected name remove the previous recipient confirmation",async({page,baseURL})=>{
  const fixture={};
  await enter(page,baseURL,fixture);
  await page.locator("[data-action=transfer]").click();
  await page.locator("[name=recipient_phone]").selectOption("+77010000002");
  await page.locator("[name=amount]").fill("45000");
  await page.locator("#transfer-form button").click();
  await expect(page.locator("[data-payee-status=identified]")).toBeVisible();
  await expect(page.locator("[data-action=submit-transfer]")).toBeEnabled();
  for (const [field,value,outcome] of [["payee_name","Другой","mismatch"],["payee_bank","other","unavailable"]]) {
    await page.locator("[data-action=edit-transfer]").click();
    const target=page.locator('[name="'+field+'"]');
    if(field==="payee_name") await target.fill(value); else await target.selectOption(value);
    await page.locator("#transfer-form button").click();
    await expect(page.locator('[data-payee-status="'+outcome+'"]')).toBeVisible();
    await expect(page.locator("[data-action=submit-transfer]")).toBeDisabled();
  }
  expect(fixture.evaluated).toBeUndefined();
});
test("a saved wallet contact can be checked and paid only after the matching directory response",async({page,baseURL})=>{
  const contact={phone:"+77015550124",name:"Арман А.",payee_ref:"saved-3"};
  const fixture={recipients:[contact],returnedRef:"saved-1"};
  await enter(page,baseURL,fixture);
  await page.locator(`[data-payee="${contact.phone}"]`).click();
  await expect(page.locator("[name=recipient_phone]")).toHaveValue(contact.phone);
  await page.locator("[name=amount]").fill("4050.25");
  await page.locator("#transfer-form button").click();
  expect(fixture.payee).toEqual({recipient:"saved-3",bank:"bcc",expected_name:""});
  await expect(page.locator("[data-payee-status=unavailable]")).toBeVisible();
  await expect(page.locator("[data-action=submit-transfer]")).toBeDisabled();
  fixture.returnedRef=contact.payee_ref;
  await page.locator("[data-action=edit-transfer]").click();
  await page.locator("#transfer-form button").click();
  await expect(page.locator("[data-payee-status=identified]")).toContainText(contact.name);
  await page.locator("[data-action=language]:visible").first().click();
  await expect(page.locator("[data-payee-status]")).toContainText("Алушы табылды");
  await page.locator("[data-action=submit-transfer]").click();
  await expect.poll(()=>fixture.evaluated?.recipient_phone).toBe(contact.phone);
  expect(fixture.evaluated.amount).toBe("4050.25");
});
test("the payer reports a request from an ended call for the reviewed draft only",async({page,baseURL})=>{
  const fixture={};await enter(page,baseURL,fixture);
  await page.locator("[data-action=transfer]").click();
  await page.locator("[name=recipient_phone]").selectOption("+77010000002");
  await page.locator("[name=amount]").fill("22000");
  await page.locator("#transfer-form button").click();
  const report=page.getByRole("checkbox",{name:/завершившемся звонке/});
  await expect(report).not.toBeChecked();
  await report.check();
  await page.locator("[data-action=edit-transfer]").click();
  await page.locator("[name=amount]").fill("32000");
  await page.locator("#transfer-form button").click();
  await expect(report).not.toBeChecked();
  await report.check();
  await page.locator("[data-action=submit-transfer]").click();
  await expect.poll(()=>fixture.evaluated?.context?.payment_requested_after_call).toBe(true);
  expect(fixture.evaluated.context.active_call).toBe(false);
});
test("borderline review asks one bilingual question before any submission",async({page,baseURL})=>{
  const fixture={supportsCallQuestion:true};
  await enter(page,baseURL,fixture);
  await page.locator("[data-action=transfer]").click();
  await page.locator("[name=recipient_phone]").selectOption("+77010000002");
  await page.locator("[name=amount]").fill("25000");
  await page.locator("#transfer-form button").click();
  await expect(page.locator("[data-action=submit-transfer]")).toBeEnabled();
  await expect(page.locator(".call-question")).toHaveCount(0);
  await page.locator("[data-action=edit-transfer]").click();
  await page.locator("[name=amount]").fill("55000");
  await page.locator("#transfer-form button").click();
  await expect(page.getByRole("group",{name:/по телефону/})).toBeVisible();
  await expect(page.locator("[data-action=submit-transfer]")).toBeDisabled();
  expect(fixture.evaluated).toBeUndefined();
  await page.getByRole("radio",{name:/уже закончился/}).check();
  await page.locator("[data-action=language]:visible").first().click();
  await expect(page.getByRole("radio",{name:/қоңырау аяқталды/})).toBeChecked();
  await page.locator("[data-action=submit-transfer]").click();
  await expect.poll(()=>fixture.evaluated?.context?.call_pressure_answer).toBe("after_call");
  expect(fixture.evaluated.context.payment_requested_after_call).toBe(true);
  expect(fixture.evaluated.context.active_call).toBe(false);
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

test("client can open pending questions, case updates and the exact family-approved transfer in kk and ru",async({page,baseURL})=>{
  const reportClosed="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const event=(kind,state,id)=>({kind,state,object_id:id,time:"2026-11-21T10:00:00Z"});
  const messages=[
    event("report","CASE_REVIEW_CLOSED",reportClosed),
    event("transfer","FAMILY_APPROVAL_RECORDED",ids[1]),
    event("report","CASE_INFORMATION_REQUIRED",ids[0]),
    event("report","CASE_REVIEW_REOPENED",ids[0]),
  ];
  const fixture={messages,actions:[messages[2],messages[3],messages[0],messages[1]],questions:[{id:ids[1],answered:false,description_ru:"Уточните обстоятельства",description_kk:"Мән-жайды нақтылаңыз"}]};
  await enter(page,baseURL,fixture);
  const home=page.locator(".home-security");
  const row=(panel,state)=>panel.locator('[data-inbox-state="'+state+'"]');
  await expect(home.locator(".security-notice")).toHaveCount(3);
  await expect(home.locator(".security-notice").first()).toContainText("Ответить на вопрос");
  await expect(row(home,"CASE_REVIEW_REOPENED")).toHaveCount(0);
  await row(home,"CASE_INFORMATION_REQUIRED").click();
  await expect(page.locator("main")).toContainText(ids[0]);
  await expect(page.locator("#request-answer")).toBeVisible();
  await page.locator("[data-nav=home]").click();
  await row(home,"CASE_REVIEW_CLOSED").click();
  await expect(page.locator("main")).toContainText(reportClosed);
  await page.locator("[data-nav=home]").click();
  await home.locator("[data-action=inbox]").click();
  const inbox=page.locator("main");
  await expect(row(inbox,"CASE_REVIEW_REOPENED")).toContainText("Рассмотрение обращения возобновлено");
  await expect(row(inbox,"FAMILY_APPROVAL_RECORDED")).toContainText("Проверить статус перевода");
  await page.locator("[data-action=language]:visible").first().click();
  await expect(row(inbox,"CASE_INFORMATION_REQUIRED")).toContainText("Сұраққа жауап беру");
  await expect(row(inbox,"CASE_REVIEW_CLOSED")).toContainText("Қорытындыны көру");
  await expect(row(inbox,"CASE_REVIEW_REOPENED")).toContainText("Өтініш қайта қаралуда");
  await expect(row(inbox,"FAMILY_APPROVAL_RECORDED")).toContainText("Аударым күйін тексеру");
  await row(inbox,"FAMILY_APPROVAL_RECORDED").click();
  await expect(page.locator(".break-id")).toHaveText(ids[1]);
});

test("an unavailable or slow security inbox leaves the client wallet usable", async({page,baseURL})=>{
  let release;
  const fixture={inboxStatus:503,inboxGate:new Promise(resolve=>{release=resolve;})};
  await enter(page,baseURL,fixture);
  await expect(page.locator(".q-card")).toBeVisible();
  await expect.poll(()=>fixture.inboxReads).toBe(1);
  await page.locator("[data-nav=history]").click();
  release();
  await expect(page.locator("h1")).toContainText("Операции");
  await expect(page.locator(".home-security")).toHaveCount(0);
  await page.locator("[data-nav=home]").click();
  await expect(page.locator(".home-security")).toContainText("Не удалось загрузить сообщения");
  await expect(page.locator(".q-card")).toBeVisible();
  await expect(page.locator("[data-action=transfer]")).toBeEnabled();
});

test("home refreshes security updates without frequent inbox reads or stale transfer shortcuts", async({page,baseURL})=>{
  await page.clock.install();
  const familyApproval = {kind:"transfer",state:"FAMILY_APPROVAL_RECORDED",object_id:ids[0],time:"2026-11-21T10:00:00Z"};
  const fixture = {actions:[familyApproval], messages:[familyApproval]};
  await enter(page,baseURL,fixture);
  const home=page.locator(".home-security");
  await expect(home.locator("[data-inbox-state=FAMILY_APPROVAL_RECORDED]")).toBeVisible();
  await page.clock.fastForward(12000);
  expect(fixture.inboxReads).toBe(1);
  fixture.messages = Array.from({length:30},()=>({
    kind:"transfer",state:"approved",object_id:ids[0],time:"2026-11-21T12:00:00Z",
  }));
  fixture.actions = Array.from({length:4},(_,index)=>({
    kind:"report",state:"CASE_INFORMATION_REQUIRED",object_id:"cccccccc-cccc-4ccc-8ccc-ccccccccccc"+index,time:"2026-11-21T10:02:00Z",
  }));
  await page.clock.fastForward(25000);
  await expect(home.locator("[data-inbox-state=CASE_INFORMATION_REQUIRED]:visible")).toHaveCount(3);
  await home.locator(".more-security summary").click();
  await expect(home.locator("[data-inbox-state=CASE_INFORMATION_REQUIRED]:visible")).toHaveCount(4);
  await expect(home.locator("[data-inbox-state=FAMILY_APPROVAL_RECORDED]")).toHaveCount(0);
  expect(fixture.inboxReads).toBe(2);
});

test("a mismatched incident packet ends loading and can be refreshed",async({page,baseURL})=>{
  const fixture={packet:{transaction_id:ids[1],reports:[{id:"wrong-case",state:"OPEN"}]}};
  await enter(page,baseURL,fixture);
  await page.locator("[data-nav=history]").click();
  await page.locator('[data-detail="'+ids[0]+'"]').first().click();
  await expect(page.getByText("Не удалось загрузить сведения об обращении.")).toBeVisible();
  await expect(page.getByText("wrong-case",{exact:false})).toHaveCount(0);
  fixture.packet={transaction_id:ids[0],reports:[]};
  await page.locator("[data-action=refresh-detail]").click();
  await expect(page.getByText("Связанных обращений нет.")).toBeVisible();
});
