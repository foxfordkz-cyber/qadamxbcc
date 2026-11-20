/**
 * GitHub Pages only: a browser simulation of the trusted circle and the message-check
 * guide, so the static demo shows the full client journey without Telegram or a backend.
 * State lives in this browser's localStorage. The server build never imports this file.
 */
import { z } from "zod";
import { ApiError } from "./contracts";
import { detailDemo } from "./demo";

const STORE = "saqbol-static-circle-v1";
const LIMIT = 3;
const CONSENT_MS = 8000;
const SENT_MS = 1500;
const ACK_MS = 7000;

// Same text as backend app/integrations/guardian_education.py (QUESTIONS, ADVICE).
export const staticGuide = {
  questions: [
    { field: "caller_claims_bank_or_police", ru: "Звонящий представился сотрудником банка или полиции?", kk: "Қоңырау шалушы банк немесе полиция қызметкері болып танысты ма?", caution_answer: true },
    { field: "asked_to_move_to_safe_account", ru: "Просили перевести деньги на «безопасный счёт»?", kk: "Ақшаны «қауіпсіз шотқа» аударуды сұрады ма?", caution_answer: true },
    { field: "asked_to_keep_secret_or_install_app", ru: "Просили сохранить разговор в секрете или установить приложение?", kk: "Әңгімені құпия ұстауды немесе қолданба орнатуды сұрады ма?", caution_answer: true },
    { field: "initiated_by_customer", ru: "Вы сами решили сделать перевод?", kk: "Аударым жасауды өзіңіз шештіңіз бе?", caution_answer: false },
    { field: "knows_recipient_personally", ru: "Вы лично знаете получателя?", kk: "Алушыны жеке танисыз ба?", caution_answer: false },
  ],
  advice_ru: "Обратите внимание на отмеченные признаки. Не действуйте под давлением; самостоятельно свяжитесь с банком через известный официальный канал. Даже отсутствие отмеченных признаков не доказывает безопасность.",
  advice_kk: "Белгіленген белгілерге назар аударыңыз. Қысыммен әрекет етпеңіз; банкке белгілі ресми арна арқылы өзіңіз хабарласыңыз. Белгілердің болмауы қауіпсіздікті дәлелдемейді.",
};

interface Contact { id: string; alias: string; invitedAt: number | null }
interface Sent { id: string; contact_id: string; at: number }
interface State { contacts: Contact[]; sent: Record<string, Sent[]> }

const initial = (): State => ({ contacts: [{ id: "6b1f3c2a-5d4e-4f60-8a71-2c3d4e5f6a7b", alias: "Мама · Анам", invitedAt: null }], sent: {} });
function read(): State {
  try {
    const value = JSON.parse(localStorage.getItem(STORE) ?? "null") as State | null;
    if (value && Array.isArray(value.contacts) && value.sent && typeof value.sent === "object") return value;
  } catch { /* A fresh circle below. */ }
  return initial();
}
function load(): State { return read(); }
function save(state: State) { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* In-memory only. */ } }

const verified = (contact: Contact, now: number) => contact.invitedAt === null || now - contact.invitedAt >= CONSENT_MS;
const member = (contact: Contact, now: number) => ({ id: contact.id, alias: contact.alias, state: verified(contact, now) ? "CONTACT_VERIFIED" : "CONTACT_PENDING_CONSENT", notifications_enabled: true });
const notification = (item: Sent, now: number) => ({
  id: item.id, contact_id: item.contact_id, attempts: 1, expires_at: new Date(item.at + 15 * 60_000).toISOString(),
  state: now - item.at < SENT_MS ? "NOTIFICATION_QUEUED" : now - item.at < ACK_MS ? "NOTIFICATION_SENT" : "CONTACT_ACKNOWLEDGED",
});
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[byte % 64]).join("");

export function staticCircle(method: string, route: string, body: unknown, now = Date.now()): unknown {
  const state = load();
  if (route === "trusted-circle/members") {
    if (method === "GET") return { state: "CONTACT_VERIFIED", contacts: state.contacts.map(contact => member(contact, now)) };
    if (method === "POST") {
      const { language } = z.object({ owner_consent: z.literal(true), language: z.enum(["kk", "ru"]) }).strict().parse(body);
      if (state.contacts.length >= LIMIT) throw new ApiError("contact_limit_reached", 409);
      const contact = { id: crypto.randomUUID(), alias: language === "kk" ? `Байланыс ${state.contacts.length + 1}` : `Контакт ${state.contacts.length + 1}`, invitedAt: now };
      save({ ...state, contacts: [...state.contacts, contact] });
      return { contact: member(contact, now), invitation_token: token(), expires_at: new Date(now + 15 * 60_000).toISOString() };
    }
    if (method === "DELETE") {
      const { contact_id } = z.object({ contact_id: z.uuid() }).strict().parse(body);
      const contact = state.contacts.find(item => item.id === contact_id);
      if (!contact) throw new ApiError("notFound", 404);
      save({ ...state, contacts: state.contacts.filter(item => item.id !== contact_id) });
      return { ...member(contact, now), state: "CONTACT_REVOKED" };
    }
  }
  const match = /^trusted-circle\/([0-9a-f-]{36})$/i.exec(route);
  if (match) {
    const transfer = z.uuid().parse(match[1]);
    const contacts = state.contacts.filter(contact => verified(contact, now)).map(({ id, alias }) => ({ id, alias }));
    const view = (current: State) => ({ channel: "telegram", contact_state: contacts.length ? "CONTACT_VERIFIED" : "CONTACT_NOT_CONFIGURED", contacts, notifications: (current.sent[transfer] ?? []).map(item => notification(item, now)) });
    if (method === "GET") { detailDemo(transfer); return view(state); }
    if (method === "POST") {
      const { contact_id } = z.object({ contact_id: z.uuid() }).strict().parse(body);
      if (!contacts.some(contact => contact.id === contact_id)) throw new ApiError("contact_consent_required", 409);
      const detail = detailDemo(transfer);
      if (detail.status !== "cooling_off") throw new ApiError("active_cooling_required", 409);
      const sent = state.sent[transfer] ?? [];
      if (sent.some(item => item.contact_id === contact_id)) return view(state);
      const next = { ...state, sent: { ...state.sent, [transfer]: [...sent, { id: crypto.randomUUID(), contact_id, at: now }].slice(-10) } };
      save(next);
      return view(next);
    }
  }
  throw new ApiError("notFound", 404);
}
