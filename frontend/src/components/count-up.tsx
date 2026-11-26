"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./use-fx-tier";

const FIGURE = /^(\d[\d\s]*)(?:,(\d+))?(\D.*)?$/;

/**
 * Counts a figure such as "1 098", "57 / 60" or "1,17 %" up from zero.
 * Without `run` it starts the first time it is seen; with `run` (slides) it
 * replays every time `run` turns true.
 */
export function CountUp({ value, run, className }: { value: string; run?: boolean; className?: string }) {
  const node = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    const match = FIGURE.exec(value);
    if (!match || reduced || !node.current || run === false) { setShown(null); return; }
    const [, whole, fraction = "", rest = ""] = match;
    const target = Number(`${whole.replace(/\s/g, "")}.${fraction || "0"}`);
    const grouped = /\s/.test(whole.trim());
    const format = (n: number) => {
      const [i, f] = n.toFixed(fraction.length).split(".");
      return `${grouped ? i.replace(/\B(?=(\d{3})+(?!\d))/g, " ") : i}${f ? `,${f}` : ""}${whole.endsWith(" ") ? " " : ""}${rest}`;
    };
    let frame = 0;
    const start = () => {
      const began = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - began) / 1400);
        setShown(format(target * (1 - Math.pow(1 - t, 3))));
        if (t < 1) frame = requestAnimationFrame(tick); else setShown(null);
      };
      frame = requestAnimationFrame(tick);
    };
    setShown(format(0));
    if (run) { start(); return () => cancelAnimationFrame(frame); }
    const io = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      io.disconnect();
      start();
    }, { threshold: 0.6 });
    io.observe(node.current);
    return () => { io.disconnect(); cancelAnimationFrame(frame); };
  }, [value, reduced, run]);
  return <strong ref={node} className={className} aria-label={value}><span aria-hidden="true">{shown ?? value}</span></strong>;
}
