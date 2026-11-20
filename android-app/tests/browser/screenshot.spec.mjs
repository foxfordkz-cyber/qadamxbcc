import { test, expect } from "@playwright/test";

test("Cyrillic screenshot OCR runs from packaged assets", async ({page}) => {
  test.setTimeout(120000);
  const requests=[];
  page.on("request", r=>requests.push(new URL(r.url()).hostname));
  await page.goto("/");
  const text = await page.evaluate(async()=>{
    const {readScreenshot}=await import("/screenshot.mjs");
    const c=document.createElement("canvas"); c.width=970;c.height=150;
    const ctx=c.getContext("2d");
    ctx.fillStyle="white";ctx.fillRect(0,0,c.width,c.height);
    ctx.fillStyle="black";ctx.font="44px Arial";ctx.fillText("Переведите на безопасный счет",18,68);
    const blob=await new Promise(r=>c.toBlob(r,"image/png"));
    return readScreenshot(new File([blob],"fixture.png",{type:"image/png"}));
  });
  expect(text.toLowerCase()).toContain("безопасный");
  expect(requests.filter(host=>host && host!=="127.0.0.1")).toEqual([]);
});
