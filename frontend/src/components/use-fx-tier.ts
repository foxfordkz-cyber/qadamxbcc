"use client";

import { useEffect, useState } from "react";
import { decideFx, FX_STORAGE_KEY, readFxOverride, type FxTier } from "@/lib/fx-tier";

let cached: FxTier | null = null;
/** ?fx=on is a presenter's explicit choice: keep 3D even if frames run long. */
let forced = false;

function probe(): FxTier {
  let stored: string | null = null;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("fx");
    if (fromUrl === "on" || fromUrl === "off") window.sessionStorage.setItem(FX_STORAGE_KEY, fromUrl);
    stored = window.sessionStorage.getItem(FX_STORAGE_KEY);
  } catch { /* Storage can be blocked; the URL still works for this page. */ }
  let webgl = false; let renderer = "";
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: true }) ?? canvas.getContext("webgl", { failIfMajorPerformanceCaveat: true });
    if (gl) {
      webgl = true;
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) ?? "");
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch { webgl = false; }
  forced = readFxOverride(window.location.search, stored) === "on";
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return decideFx({
    override: readFxOverride(window.location.search, stored),
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    saveData: nav.connection?.saveData === true,
    cores: nav.hardwareConcurrency ?? 0,
    memory: nav.deviceMemory ?? 0,
    webgl,
    renderer,
  });
}

export function fxForced() { return forced; }

/** "lite" during server render and the first paint; "rich" afterwards only on capable devices. */
export function useFxTier(): [FxTier, () => void] {
  const [tier, setTier] = useState<FxTier>("lite");
  useEffect(() => { cached ??= probe(); setTier(cached); }, []);
  // Called by a scene whose frames run too long: everything on the page drops to lite.
  const degrade = () => { if (forced) return; cached = "lite"; setTier("lite"); };
  return [tier, degrade];
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update(); query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}
