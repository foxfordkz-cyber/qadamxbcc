import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {chromium} from "playwright";
const origin="http://127.0.0.1:18127";
const access=JSON.parse(await readFile(new URL("../../.local-checks/handoff-access/access.json",import.meta.url)));
const browser=await chromium.launch({channel:"chrome"});
try {
  for(const remember of [false,true]){
    const context=await browser.newContext({serviceWorkers:"block"});
    const page=await context.newPage();
    let recoveryStatus=0;
    await context.route("**/*",route=>{
      const u=new URL(route.request().url());
      if(u.origin!==origin)return route.abort();
      if(u.pathname==="/mobile/v1/session" && route.request().method()==="GET" && recoveryStatus){
        return route.fulfill({status:recoveryStatus,json:{}});
      }
      return route.continue();
    });
    await page.goto(origin+"/wallet/");
    const form=page.locator("#personal-login");
    await form.locator("[name=login]").fill("client_demo");
    await form.locator("[name=password]").fill(access.client);
    await form.locator("[name=remember]").setChecked(remember);
    await form.locator("button[type=submit]").click();
    await page.locator(".q-card").waitFor();
    const marker=await page.evaluate(()=>JSON.parse(localStorage.getItem("qadam.session")));
    assert.equal(Boolean(marker),remember);
    if(marker) assert.deepEqual(Object.keys(marker).sort(),["origin","remember","subject"]);
    const cookies=await context.cookies();
    const session=cookies.find(c=>c.httpOnly);
    assert.ok(session.secure && session.sameSite==="Strict");
    assert.equal(session.expires>0,remember);
    const reopened=await context.newPage();
    recoveryStatus=503;
    await reopened.goto(origin+"/wallet/");
    if(remember){
      await reopened.locator('[data-action="restore-access"]').waitFor();
      assert.equal(await reopened.locator(".q-card").count(),0);
      recoveryStatus=0;
      await reopened.locator('[data-action="restore-access"]').click();
      await reopened.locator(".q-card").waitFor();
      recoveryStatus=401;
      await reopened.reload();
      await reopened.locator("#personal-login button[type=submit]:enabled").waitFor();
      assert.equal(await reopened.evaluate(()=>localStorage.getItem("qadam.session")),null);
    } else {
      await reopened.locator("#personal-login button[type=submit]:enabled").waitFor();
      assert.equal(await reopened.locator(".q-card").count(),0);
    }
    await context.close();
  }
  console.log("Passed persistent and browser-session cookies, new tab, recoverable 503 and invalid session.");
} finally { await browser.close(); }
