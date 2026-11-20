import { Capacitor, registerPlugin } from "./vendor/capacitor.js";
import { Gateway, GatewayError } from "./gateway.mjs";
const vault = registerPlugin("DeviceVault");
const native = Capacitor.isNativePlatform();
const utf8 = new TextEncoder();
const web = !native && typeof document !== "undefined" && document.documentElement.hasAttribute("data-web-wallet");
const fallback = new Map(); // Browser preview has no durable secret storage.
export const read = async slot => {
  const value = native ? (await vault.read({slot})).value : web ? sessionStorage.getItem("qadam."+slot) : fallback.get(slot);
  return value ? JSON.parse(value) : null;
};
export const write = async (slot, value) => {
  const record = value == null ? null : JSON.stringify(value);
  if (native) await vault.put({slot, value:record});
  else if (web) {
    if (record === null) sessionStorage.removeItem("qadam."+slot);
    else sessionStorage.setItem("qadam."+slot,record);
  } else if (record == null) fallback.delete(slot);
  else fallback.set(slot, record);
};
export const scopeKey = async (origin, owner) => Array.from(new Uint8Array(
  await crypto.subtle.digest("SHA-256", utf8.encode(origin+"|"+owner))), b=>b.toString(16).padStart(2,"0")).join("");
export const printPacket = lines => native ? registerPlugin("PacketPrinter").print({lines}) : window.print();
export const openGuardian = username => {
  if (!/^[A-Za-z][A-Za-z0-9_]{3,28}bot$/i.test(username)) throw Error("guardian_unavailable");
  const url="https://t.me/"+username;
  if (native) return vault.openGuardian({username});
  window.open(url, "_blank", "noopener,noreferrer");
};
export const shareInvite = url => native ? vault.shareInvite({url}) : navigator.share({url});
let origin;
async function getGateway() {
  if (native) origin = (await vault.config()).origin;
  else origin = location.protocol === "https:" || (web && ["127.0.0.1","localhost"].includes(location.hostname)) ? location.origin : "";
  if (!origin) throw new GatewayError(503);
  const gateway=new Gateway(origin, undefined, origin);
  gateway.webSession=web;
  return gateway;
}
export async function signIn(login, password) {
  const gateway = await getGateway();
  const result = await gateway.request("/auth/login","POST",{login,password});
  if (!["client","admin"].includes(result.role) || (!web && typeof result.token !== "string") ||
      typeof result.subject !== "string") throw new GatewayError(502);
  gateway.role = result.role; gateway.token = web ? "cookie" : result.token; gateway.subject=result.subject;
  await write("session",web ? {origin,subject:result.subject} : {origin,token:result.token});
  return {gateway,subject:result.subject};
}
export async function initialize(onLogin,onFailure) {
  const saved = await read("session");
  if (!saved) return;
  try {
    const gateway = await getGateway();
    if (saved.origin !== origin) { await write("session",null); return; }
    gateway.token = web ? "cookie" : saved.token; gateway.subject=saved.subject;
    const user = await gateway.request("/session");
    gateway.role = user.role;
    await onLogin(gateway,user.subject);
  } catch(e) {
    if (e.status === 401) await write("session",null);
    onFailure(e);
  }
}
