const languageButton = document.getElementById("room-language");
const html = document.documentElement;
let language = navigator.languages.some(value => value.startsWith("ru")) ? "ru" : "kk";
try {
  const saved = localStorage.getItem("qadam.language");
  if (saved === "ru" || saved === "kk") language = saved;
} catch {}

function displayLanguage() {
  html.lang = language;
  html.dataset.language = language;
  languageButton.textContent = language === "kk" ? "РУС" : "ҚАЗ";
  languageButton.setAttribute("aria-label", language === "kk" ? "Русский" : "Қазақша");
  languageButton.hidden = false;
  try { localStorage.setItem("qadam.language", language); } catch {}
}

function showAccounts() {
  if (location.hash === "#accounts") document.getElementById("accounts").open = true;
}

displayLanguage();
showAccounts();
window.addEventListener("hashchange", showAccounts);
languageButton.addEventListener("click", () => {
  language = language === "kk" ? "ru" : "kk";
  displayLanguage();
});
