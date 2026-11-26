"use client";

import { useEffect, useId, useRef, useState } from "react";
import { fxForced, useFxTier, useReducedMotion } from "./use-fx-tier";
import type { DropScene, DropStage } from "./drop-scene";

type Legend = { client: string; drop: string; hub: string; cash: string };
type Props = { stage: DropStage; label: string; legend: Legend };

/** Same layout as drop-scene.ts, projected onto the drawn (SVG) version. */
const CLIENTS: [number, number][] = [[-5.4, -2.5], [-5.9, -1.25], [-6.1, 0], [-5.9, 1.25], [-5.4, 2.5]];
const DROPS: [number, number][] = [[-1.7, -1.9], [-1.4, 0], [-1.7, 1.9]];
const HUB: [number, number] = [1.9, 0];
const CASH: [number, number] = [5.2, 0];
const ROUTE = [0, 0, 1, 2, 2];
const HELD_CLIENT = 2;
const at = ([x, z]: [number, number]) => [330 + x * 48, 196 + z * 38] as const;

function Person({ x, y, role, scale = 1 }: { x: number; y: number; role: string; scale?: number }) {
  return <g className={`drops-person drops-${role}`} transform={`translate(${x} ${y}) scale(${scale})`}>
    <ellipse className="drops-shadow" cx="0" cy="1" rx="15" ry="4.5" />
    <rect x="-9" y="-34" width="18" height="31" rx="9" />
    <circle cx="0" cy="-43" r="8" />
  </g>;
}

function edge(from: readonly [number, number], to: readonly [number, number]) {
  const [ax, ay] = [from[0], from[1] - 24]; const [bx, by] = [to[0], to[1] - 24];
  return `M${ax} ${ay} Q ${(ax + bx) / 2} ${Math.min(ay, by) - 46} ${bx} ${by}`;
}

/** The drawn network every device gets first; capable devices fade the 3D scene in over it. */
function DrawnNetwork({ animate }: { animate: boolean }) {
  const id = useId().replace(/:/g, "");
  const clients = CLIENTS.map(at); const drops = DROPS.map(at); const hub = at(HUB); const cash = at(CASH);
  const routes = [
    ...clients.map((c, i) => ({ key: `c${i}`, d: edge(c, drops[ROUTE[i]]), kind: i === HELD_CLIENT ? "held" : "client" })),
    ...drops.map((d, i) => ({ key: `d${i}`, d: edge(d, hub), kind: "hub" })),
    { key: "cash", d: edge(hub, cash), kind: "cash" },
  ];
  return <svg className="drops-svg" viewBox="0 0 640 340" aria-hidden="true">
    {routes.map(route => <path key={route.key} id={`${id}-${route.key}`} d={route.d} className={`drops-edge drops-edge-${route.kind}`} />)}
    <circle className="drops-shield" cx={clients[HELD_CLIENT][0]} cy={clients[HELD_CLIENT][1] - 20} r="34" />
    {[0, 1, 2].map(i => <circle key={i} className="drops-ring" cx={hub[0]} cy={hub[1] - 4} r="30" style={{ animationDelay: `${i * .6}s` }} />)}
    <ellipse className="drops-gate" cx={hub[0]} cy={hub[1] - 24} rx="40" ry="13" />
    {routes.map((route, i) => <circle key={`coin-${route.key}`} className={`drops-coin drops-coin-${route.kind}`} r="5.5">
      {animate
        ? <animateMotion dur={route.kind === "client" || route.kind === "held" ? "2.8s" : "2.2s"} begin={`${(i * .37) % 2.2}s`} repeatCount="indefinite"><mpath href={`#${id}-${route.key}`} /></animateMotion>
        : <animateMotion dur="1s" keyPoints=".5;.5" keyTimes="0;1" calcMode="linear" fill="freeze"><mpath href={`#${id}-${route.key}`} /></animateMotion>}
    </circle>)}
    <circle className="drops-coin drops-coin-frozen" cx={clients[HELD_CLIENT][0] + 18} cy={clients[HELD_CLIENT][1] - 30} r="6" />
    <ellipse className="drops-pedestal" cx={hub[0]} cy={hub[1] + 2} rx="28" ry="8" />
    {clients.map(([x, y], i) => <Person key={`p${i}`} x={x} y={y} role="client" scale={.92} />)}
    {drops.map(([x, y], i) => <Person key={`q${i}`} x={x} y={y} role="drop" />)}
    <Person x={hub[0]} y={hub[1] - 4} role="hub" scale={1.15} />
    <g className="drops-atm" transform={`translate(${cash[0]} ${cash[1]})`}>
      <ellipse className="drops-shadow" cx="0" cy="1" rx="20" ry="5" />
      <rect x="-15" y="-52" width="30" height="52" rx="4" />
      <rect className="drops-atm-screen" x="-10" y="-46" width="20" height="13" rx="2" />
    </g>
  </svg>;
}

export function DropNetwork({ stage, label, legend }: Props) {
  const [tier, degrade] = useFxTier();
  const reduced = useReducedMotion();
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<DropScene | null>(null);
  const [live, setLive] = useState(false);
  const [near, setNear] = useState(false);
  const rich = tier === "rich" && !reduced;

  useEffect(() => {
    if (!host.current) return;
    const io = new IntersectionObserver(entries => {
      const visible = entries.some(entry => entry.isIntersecting);
      if (visible) setNear(true);
      scene.current?.setVisible(visible);
    }, { rootMargin: "240px" });
    io.observe(host.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!rich || !near || !canvas.current) return;
    let disposed = false;
    void import("./drop-scene").then(({ mountDropScene }) => {
      if (disposed || !canvas.current) return;
      try {
        scene.current = mountDropScene({ canvas: canvas.current, watchFrames: !fxForced(), onReady: () => !disposed && setLive(true), onSlow: () => { setLive(false); degrade(); } });
      } catch { setLive(false); degrade(); }
    }).catch(() => setLive(false));
    return () => { disposed = true; scene.current?.dispose(); scene.current = null; setLive(false); };
  }, [rich, near]);

  useEffect(() => { scene.current?.setStage(stage); }, [stage, live]);

  function move(event: React.PointerEvent) {
    if (event.pointerType === "touch") return;
    const box = host.current?.getBoundingClientRect(); if (!box) return;
    scene.current?.setPointer((event.clientX - box.left) / box.width * 2 - 1, (event.clientY - box.top) / box.height * 2 - 1);
  }

  return <div ref={host} className="drops-visual" data-stage={stage} data-live={live || undefined} role="img" aria-label={label}
    onPointerMove={move} onPointerLeave={() => scene.current?.setPointer(0, 0)}>
    <DrawnNetwork animate={!reduced} />
    {rich && <canvas ref={canvas} className="drops-canvas" aria-hidden="true" />}
    <ul className="drops-legend" aria-hidden="true">
      <li data-role="client">{legend.client}</li>
      <li data-role="drop">{legend.drop}</li>
      <li data-role="hub">{legend.hub}</li>
      <li data-role="cash">{legend.cash}</li>
    </ul>
  </div>;
}
