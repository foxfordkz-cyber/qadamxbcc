/**
 * Decides whether a device gets the real-time 3D scenes ("rich") or the
 * pre-drawn CSS versions ("lite"). Everything here is synchronous and pure so
 * the rules are testable; the browser probe lives in components/use-fx-tier.ts.
 *
 * No benchmark database and no network request: the decision uses what the
 * browser already reports, and the scene itself falls back to lite when the
 * measured frame time stays too long (see FRAME_BUDGET_MS).
 */
export type FxTier = "rich" | "lite";
export type FxOverride = "on" | "off" | null;

export type FxSignals = {
  override: FxOverride;
  reducedMotion: boolean;
  saveData: boolean;
  /** navigator.hardwareConcurrency; 0 when the browser does not say. */
  cores: number;
  /** navigator.deviceMemory in GB; 0 when the browser does not say (Safari, Firefox). */
  memory: number;
  webgl: boolean;
  /** Unmasked WebGL renderer string, or "" when the browser hides it. */
  renderer: string;
};

export const FX_STORAGE_KEY = "saq-bol.fx";
/** A frame that takes longer than this on average (about 45 fps) sends the scene to lite. */
export const FRAME_BUDGET_MS = 22;

// Software rasterisers and GPUs that cannot hold a lit, antialiased scene at 45 fps.
const weakRenderers = [
  /swiftshader/i, /llvmpipe/i, /softpipe/i, /software/i, /basic render driver/i,
  /mali-(?:4\d\d|t6\d\d|t7\d\d|g31|g51|g52)\b/i,
  /adreno\s*\(?tm\)?\s*(?:[1-4]\d\d|50\d|51\d)\b/i,
  /powervr\s+(?:sgx|rogue\s+ge)/i,
  /intel.*(?:hd graphics\s*(?:[2-5]\d{3}|[2-5]\d\d)\b|gma)/i,
];

export function isWeakRenderer(renderer: string) {
  return weakRenderers.some(pattern => pattern.test(renderer));
}

export function readFxOverride(search: string, stored: string | null): FxOverride {
  const value = new URLSearchParams(search).get("fx") ?? stored;
  return value === "on" || value === "off" ? value : null;
}

export function decideFx(signals: FxSignals): FxTier {
  if (!signals.webgl) return "lite";
  if (signals.override === "on") return "rich";
  if (signals.override === "off") return "lite";
  if (signals.reducedMotion || signals.saveData) return "lite";
  if (signals.cores > 0 && signals.cores < 4) return "lite";
  if (signals.memory > 0 && signals.memory < 4) return "lite";
  if (signals.renderer && isWeakRenderer(signals.renderer)) return "lite";
  return "rich";
}

/** Rolling frame-time check used by the 3D scenes; true once the device is too slow. */
export class FrameWatch {
  private samples: number[] = [];
  constructor(private readonly budget = FRAME_BUDGET_MS, private readonly window = 90) {}
  /** Feed one frame duration; returns true when the recent average exceeds the budget. */
  push(ms: number) {
    // Long gaps are tab switches or scroll jank, not render cost.
    if (!Number.isFinite(ms) || ms <= 0 || ms > 250) return false;
    this.samples.push(ms);
    if (this.samples.length > this.window) this.samples.shift();
    if (this.samples.length < this.window) return false;
    const average = this.samples.reduce((sum, value) => sum + value, 0) / this.samples.length;
    return average > this.budget;
  }
}
