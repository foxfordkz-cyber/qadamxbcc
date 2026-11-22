import { hasOwn } from "./compat.mjs";
// Explicit, deterministic presentation fixtures. This is NOT the bank risk engine.
export const STORAGE_KEY = "qadam.android.demo.v1";
export const PRESETS = Object.freeze({
  everyday: { amount: 12500, recipient: "A. Demo", status: "approved" },
  pressure: { amount: 185000, recipient: "B. Demo", status: "cooling_off" },
  network: { amount: 420000, recipient: "C. Demo", status: "blocked" },
});
export const initialState = () => ({
  version: 1,
  language: "kk",
  welcomed: false,
  transfers: [],
});
const states = new Set(["approved", "cooling_off", "blocked", "cancelled"]);
export function restore(raw) {
  try {
    const value = JSON.parse(raw);
    if (value?.version !== 1 || !Array.isArray(value.transfers))
      return initialState();
    const transfers = value.transfers
      .filter(
        (t) =>
          t &&
          typeof t.id === "string" &&
          /^[a-zA-Z0-9-]{1,64}$/.test(t.id) &&
          hasOwn(PRESETS, t.preset) &&
          states.has(t.status) &&
          Number.isFinite(t.createdAt) &&
          t.createdAt > 0 &&
          (t.status === PRESETS[t.preset].status ||
            (t.preset === "pressure" && t.status === "cancelled")),
      )
      .slice(0, 30)
      .map((t) => ({
        id: t.id,
        preset: t.preset,
        status: t.status,
        createdAt: t.createdAt,
      }));
    return {
      version: 1,
      language: value.language === "ru" ? "ru" : "kk",
      welcomed: value.welcomed === true,
      transfers: transfers.filter(
        (t, i) => transfers.findIndex((other) => other.id === t.id) === i,
      ),
    };
  } catch {
    return initialState();
  }
}
export function addTransfer(state, preset, id, now = Date.now()) {
  if (
    !hasOwn(PRESETS, preset) ||
    !/^[a-zA-Z0-9-]{1,64}$/.test(id) ||
    !Number.isFinite(now) ||
    now <= 0
  )
    throw new Error("Invalid demo fixture");
  if (state.transfers.some((t) => t.id === id)) return state; // double-tap idempotency
  return {
    ...state,
    transfers: [
      { id, preset, status: PRESETS[preset].status, createdAt: now },
      ...state.transfers,
    ].slice(0, 30),
  };
}
export function cancelTransfer(state, id) {
  return {
    ...state,
    transfers: state.transfers.map((t) =>
      t.id === id && t.status === "cooling_off"
        ? { ...t, status: "cancelled" }
        : t,
    ),
  };
}
export function safetyResult(answers) {
  if (
    !Array.isArray(answers) ||
    answers.length !== 3 ||
    answers.some((a) => typeof a !== "boolean")
  )
    return null;
  return answers.some(Boolean) ? "pause" : "aware";
}
