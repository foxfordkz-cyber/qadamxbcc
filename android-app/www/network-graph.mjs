// Node labels stay inside numbered circles. The selected account's full name is shown below.
export function layoutNetwork(nodes) {
  const points = new Map();
  let index = 0;
  for (let ring = 0; index < nodes.length; ring++) {
    const count = Math.min(nodes.length - index, ring ? 8 * ring : 1);
    for (let n = 0; n < count; n++) {
      const angle = 2 * Math.PI * n / count - Math.PI / 2 + (ring % 2 ? 0 : Math.PI / count);
      points.set(nodes[index++].id, {x: ring * 62 * Math.cos(angle), y: ring * 62 * Math.sin(angle)});
    }
  }
  const all = [...points.values()];
  const bounds = axis => [Math.min(0,...all.map(p=>p[axis]))-24, Math.max(0,...all.map(p=>p[axis]))+24];
  const [left,right]=bounds("x"), [top,bottom]=bounds("y");
  const size=Math.max(100,right-left,bottom-top);
  return {points,box:[(left+right-size)/2,(top+bottom-size)/2,size,size]};
}

export function graphCamera(svg) {
  const [left,top,size]=svg.getAttribute("viewBox").split(" ").map(Number);
  let zoom=1, x=left, y=top, drag=null, moved=false;
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
  const draw=()=>{
    const width=size/zoom;
    x=clamp(x,left,left+size-width); y=clamp(y,top,top+size-width);
    svg.setAttribute("viewBox",[x,y,width,width].join(" "));
    camera.onchange?.();
  };
  const center=(cx,cy)=>{x=cx-size/zoom/2;y=cy-size/zoom/2;draw();};
  svg.onpointerdown=e=>{if(zoom>1) {drag={id:e.pointerId,x:e.clientX,y:e.clientY,originX:x,originY:y};moved=false;}};
  svg.onpointermove=e=>{
    if(!drag||e.pointerId!==drag.id)return;
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(!moved && Math.hypot(dx,dy)<4)return;
    moved=true;svg.setPointerCapture(e.pointerId);
    const scale=svg.getScreenCTM()?.a || 1;
    x=drag.originX-dx/scale;y=drag.originY-dy/scale;draw();
  };
  svg.onpointerup=svg.onpointercancel=()=>{drag=null;};
  svg.addEventListener("click",e=>{if(moved){e.stopImmediatePropagation();moved=false;}},true);
  svg.onkeydown=e=>{
    const step=size/zoom/5;
    const dirs={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]};
    if(dirs[e.key]){e.preventDefault();x+=dirs[e.key][0];y+=dirs[e.key][1];draw();}
  };
  const camera = {
    level(){return zoom;},
    shrink(){const midX=x+size/zoom/2,midY=y+size/zoom/2;zoom=Math.max(1,zoom/1.6);center(midX,midY);},
    fit(){zoom=1;x=left;y=top;draw();},
    enlarge(){const midX=x+size/zoom/2,midY=y+size/zoom/2;zoom=Math.min(4,zoom*1.6);center(midX,midY);},
    focus(circle){if(circle && zoom>1)center(Number(circle.getAttribute("cx")),Number(circle.getAttribute("cy")));}
  };
  return camera;
}
