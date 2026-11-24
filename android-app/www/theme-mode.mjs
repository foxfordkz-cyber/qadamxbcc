// Light / dark appearance. The choice is a per-device preference, so it lives in localStorage.
const KEY = "qadam.theme";
const BAR = { light: "#f3f5f4", dark: "#0b1512" };

export function currentTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function applyTheme(mode) {
  const theme = mode === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BAR[theme]);
  return theme;
}

export function loadTheme() {
  let saved = "light";
  try {
    saved = localStorage.getItem(KEY) || "light";
  } catch {
    // Storage can be disabled; the light theme is the default.
  }
  return applyTheme(saved);
}

export function toggleTheme() {
  const next = applyTheme(currentTheme() === "dark" ? "light" : "dark");
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // The theme still applies for this session.
  }
  return next;
}
