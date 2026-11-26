"use client";

import { useEffect, useState } from "react";

const KEY = "saq-bol.text-size";

/**
 * "Aa" switch for large text. Older clients asked for bigger type; the whole page
 * scales (globals.css, html[data-text-size="large"]) so layouts keep their proportions.
 */
export function TextSizeToggle({ label }: { label: string }) {
  const [large, setLarge] = useState(false);
  useEffect(() => {
    try { if (window.localStorage.getItem(KEY) === "large") setLarge(true); } catch { /* Works in memory only. */ }
  }, []);
  useEffect(() => {
    if (large) document.documentElement.dataset.textSize = "large";
    else delete document.documentElement.dataset.textSize;
  }, [large]);
  const toggle = () => setLarge(value => {
    try { window.localStorage.setItem(KEY, value ? "normal" : "large"); } catch { /* Works in memory only. */ }
    return !value;
  });
  return <button type="button" className="text-size-toggle" aria-pressed={large} aria-label={label} title={label} onClick={toggle}>
    <span aria-hidden="true">A<b>A</b></span>
  </button>;
}
