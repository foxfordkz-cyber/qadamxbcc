"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { fxForced, useFxTier, useReducedMotion } from "./use-fx-tier";
import type { CardScene, CardState } from "./fx-card-scene";
import "./fx.css";

type Props = {
  state?: CardState;
  /** 0..1: how far the glass shield has slid in front of the card (scroll-driven scenes). */
  ring?: number;
  size?: "hero" | "sheet" | "wallet";
  last4?: string;
  label: string;
  /** false keeps this placement on the drawn card even on strong devices. */
  allow3d?: boolean;
  className?: string;
};

const MARK = <svg viewBox="0 0 64 64" aria-hidden="true"><path className="fx-mark-top" d="M50 12H29.6C20.5 12 14 16.9 14 24.2c0 5.2 2.9 8.5 8.8 10.7l2.7 1 7-7.6-5.9-2.1c-2-.7-2.9-1.4-2.9-2.6 0-1.8 1.9-3 5.3-3h13.2Z" /><path className="fx-mark-bottom" d="M14 52h20.4C43.5 52 50 47.1 50 39.8c0-5.2-2.9-8.5-8.8-10.7l-2.7-1-7 7.6 5.9 2.1c2 .7 2.9 1.4 2.9 2.6 0 1.8-1.9 3-5.3 3H21.8Z" /></svg>;

/**
 * The Saq Bol card. Every device gets the drawn card (CSS, tilts with the pointer);
 * capable devices then fade in the real-time 3D scene on top of it.
 */
export function FxCard({ state = "idle", ring = 0, size = "sheet", last4 = "4821", label, allow3d = true, className = "" }: Props) {
  const [tier, degrade] = useFxTier();
  const reduced = useReducedMotion();
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<CardScene | null>(null);
  const [live, setLive] = useState(false);
  const [near, setNear] = useState(false);
  const rich = allow3d && tier === "rich" && !reduced;

  useEffect(() => {
    if (!rich || !host.current) return;
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setNear(true); io.disconnect(); } }, { rootMargin: "300px" });
    io.observe(host.current); return () => io.disconnect();
  }, [rich]);

  useEffect(() => {
    if (!rich || !near || !canvas.current) return;
    let disposed = false;
    void import("./fx-card-scene").then(({ mountCardScene }) => {
      if (disposed || !canvas.current) return;
      try {
        scene.current = mountCardScene({ canvas: canvas.current, last4, fit: size === "hero" ? "ring" : "card", watchFrames: !fxForced(), onReady: () => !disposed && setLive(true), onSlow: () => degrade() });
      } catch { setLive(false); degrade(); }
    }).catch(() => setLive(false));
    return () => { disposed = true; scene.current?.dispose(); scene.current = null; setLive(false); };
  }, [rich, near, last4, size]);

  useEffect(() => { scene.current?.setState(state); }, [state, live]);
  useEffect(() => { scene.current?.setRing(ring); }, [ring, live]);

  function move(event: React.PointerEvent) {
    if (reduced || event.pointerType === "touch") return;
    const box = host.current?.getBoundingClientRect(); if (!box) return;
    const x = (event.clientX - box.left) / box.width * 2 - 1; const y = (event.clientY - box.top) / box.height * 2 - 1;
    scene.current?.setPointer(x, y);
    host.current?.style.setProperty("--px", x.toFixed(3)); host.current?.style.setProperty("--py", y.toFixed(3));
  }
  function leave() { scene.current?.setPointer(0, 0); host.current?.style.setProperty("--px", "0"); host.current?.style.setProperty("--py", "0"); }

  return <div ref={host} role="img" aria-label={label} className={`fx-card fx-${size} ${className}`} data-state={state} data-live={live || undefined}
    style={{ "--ring": ring.toFixed(3) } as CSSProperties} onPointerMove={move} onPointerLeave={leave}>
    <div className="fx-stage">
      <div className="fx-css-card" aria-hidden="true">
        <span className="fx-css-mark">{MARK}</span>
        <span className="fx-chip" /><svg className="fx-wave" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7a7 7 0 0 1 0 10M12 4.5a11 11 0 0 1 0 15M16 2a15 15 0 0 1 0 20" /></svg>
        <span className="fx-css-name">Saq Bol</span><span className="fx-css-number">•••• {last4}</span>
        <span className="fx-sheen" />
      </div>
      <span className="fx-glass" aria-hidden="true"><span className="fx-frost" /></span>
    </div>
    {rich && <canvas ref={canvas} className="fx-canvas" aria-hidden="true" />}
    <span className="fx-floor" aria-hidden="true" />
  </div>;
}
