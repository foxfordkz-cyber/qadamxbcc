import {chromium} from "playwright";
import {readFile,mkdir,writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
const stage=process.argv[2];
if (!["before","after"].includes(stage)) throw Error("Expected before or after");
const dir=new URL("../../docs/workspace-28/"+stage+"/",import.meta.url);
await mkdir(dir,{recursive:true});
const credentials=JSON.parse(await readFile(new URL("../../.local-checks/handoff-access/access.json",import.meta.url)));
const origin="http://127.0.0.1:18127";
const browser=await chromium.launch({channel:"chrome"});
const results=[];
try {
 for (const [login,role,selector] of [["client_demo","client",".q-card"],["admin_demo","admin","[data-detail]"],["platform_demo","platform_admin",".desk-stats"]]) {
  const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:"block"});
  await page.route("**/*",async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin)return route.abort();
    if(url.pathname.endsWith("/wallet/analytics"))await new Promise(r=>setTimeout(r,1200));
    return route.continue();
  });
  await page.goto(origin+"/wallet/");
  const form=page.locator("#personal-login");
  if (role==="client")await page.screenshot({path:fileURLToPath(new URL("login.png",dir))});
  await form.locator("[name=login]").fill(login);
  await form.locator("[name=password]").fill(credentials[role]);
  const remember=form.locator("[name=remember]");
  if(await remember.count())await remember.check();
  const start=Date.now();
  await form.locator("[type=submit]").click();
  await page.locator(selector).first().waitFor();
  const signInMs=Date.now()-start;
  await page.locator(".busy-banner").waitFor({state:"hidden"});
  const restore=[];
  for(let i=0;i<3;i++){
   const t=Date.now();
   await page.reload({waitUntil:"domcontentloaded"});
   await page.locator(selector).first().waitFor();
   restore.push(Date.now()-t);
  }
  await page.screenshot({path:fileURLToPath(new URL(role+".png",dir))});
  results.push({role,signInMs,restoreMs:restore});
  await page.close();
 }
 await writeFile(new URL("timings.json",dir),JSON.stringify({width:390,optionalAnalyticsDelayMs:1200,results},null,2)+"\n");
 console.log(JSON.stringify(results));
} finally {await browser.close()}
