export type AppTab = "mobile" | "soc";
export const appTabSessionKey = "saq-bol.active-tab.v1";

/** Navigation only: no transfer data, credentials or questionnaire contents. */
export function readAppTab(storage?: Pick<Storage, "getItem">): AppTab {
  try { return storage?.getItem(appTabSessionKey) === "soc" ? "soc" : "mobile"; }
  catch { return "mobile"; }
}

export function saveAppTab(tab: AppTab, storage?: Pick<Storage, "setItem">) {
  try { storage?.setItem(appTabSessionKey, tab); } catch { /* Navigation still works without storage. */ }
}
