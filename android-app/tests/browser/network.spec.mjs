import { test, expect } from "@playwright/test";
test("fit and zoom keep every node reachable on phone and presentation widths", async({page})=>{
  await page.goto("/");
  for(const width of [360,1280]){
    await page.setViewportSize({width,height:800});
    for(const count of [5,15,30]){
      const checked=await page.evaluate(async count=>{
        const {layoutNetwork,graphCamera}=await import("/network-graph.mjs");
        const {points,box}=layoutNetwork(Array.from({length:count},(_,id)=>({id})));
        const main=document.querySelector("main");
        main.innerHTML='<svg tabindex="0" class="graph" viewBox="'+box.join(" ")+'">'+[...points.values()].map(p=>'<circle cx="'+p.x+'" cy="'+p.y+'" r="15"/>').join("")+'</svg>';
        const svg=main.querySelector("svg"),camera=graphCamera(svg);
        const initial=svg.getAttribute("viewBox");camera.enlarge();camera.enlarge();
        for(const c of svg.querySelectorAll("circle")){
          camera.focus(c);
          const b=svg.viewBox.baseVal;
          if(c.cx.baseVal.value-15<b.x-.01||c.cx.baseVal.value+15>b.x+b.width+.01||c.cy.baseVal.value-15<b.y-.01||c.cy.baseVal.value+15>b.y+b.height+.01)return false;
        }
        camera.fit();return svg.getAttribute("viewBox")===initial && svg.getBoundingClientRect().width<=innerWidth;
      },count);
      expect(checked).toBe(true);
    }
  }
});
