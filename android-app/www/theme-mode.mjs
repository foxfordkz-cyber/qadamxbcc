// Light / dark appearance. The choice is a per-device preference, so it lives in localStorage.
const KEY = "qadam.theme";
const BAR = { light: "#f5f5fa", dark: "#0f1412" };

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

// Large text for older clients. The whole app scales so screens keep their layout.
const TEXT_KEY = "qadam.text-size";

export function currentTextSize() {
  return document.documentElement.dataset.textSize === "large" ? "large" : "normal";
}

export function applyTextSize(mode) {
  if (mode === "large") document.documentElement.dataset.textSize = "large";
  else delete document.documentElement.dataset.textSize;
  return currentTextSize();
}

export function loadTextSize() {
  let saved = "normal";
  try {
    saved = localStorage.getItem(TEXT_KEY) || "normal";
  } catch {
    // Storage can be disabled; normal text is the default.
  }
  return applyTextSize(saved);
}

export function toggleTextSize() {
  const next = applyTextSize(currentTextSize() === "large" ? "normal" : "large");
  try {
    localStorage.setItem(TEXT_KEY, next);
  } catch {
    // The size still applies for this session.
  }
  return next;
}
