import assert from "node:assert/strict";
import test from "node:test";
import { layoutNetwork } from "../www/network-graph.mjs";
for (const count of [5,15,30]) {
  test(count+" network nodes fit with room for diameter and border",()=>{
    const fitted=layoutNetwork(Array.from({length:count},(_,id)=>({id})));
    const [x,y,w,h]=fitted.box, pts=[...fitted.points.values()];
    assert.equal(pts.length,count);
    for(const [i,p] of pts.entries()){
      assert.ok(p.x-17>=x && p.x+17<=x+w && p.y-17>=y && p.y+17<=y+h);
      for(const other of pts.slice(i+1))assert.ok(Math.hypot(p.x-other.x,p.y-other.y)>34);
    }
  });
}
