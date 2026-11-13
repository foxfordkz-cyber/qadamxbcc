import { randomUUID } from "node:crypto";
import { ids } from "./config";
import type { Answers, Decision, Evaluation, Feed, FeedItem, Graph, GraphData, Party, Reason, Status, TransferInput } from "./contracts";

const accounts = [
  { id: ids.sender, full_name: "Аружан С.", phone: "+77010000001", iban: "KZ000000000000000001" },
  { id: ids.friend, full_name: "Данияр А.", phone: "+77010000002", iban: "KZ000000000000000002" },
  { id: ids.stranger, full_name: "Алексей К.", phone: "+77010000003", iban: "KZ000000000000000003" },
  { id: ids.hub, full_name: "Марат Т.", phone: "+77010000004", iban: "KZ000000000000000004" },
];
const root = globalThis as typeof globalThis & { bccDemoTransfers?: FeedItem[] };
const rows = () => root.bccDemoTransfers ??= [];
export class DemoError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function reason(code: string, layer: string, score_delta: number, reason_kk: string, reason_ru: string): Reason {
  return { code, layer, score_delta, reason_kk, reason_ru };
}
function decision(status: Status, risk_score: number, transaction_id: string, reasons: Reason[]): Decision {
  const headlines = {
    approved: ["Аударым мақұлданды", "Перевод одобрен"],
    cooling_off: ["Аударым 15 минутқа кідіртілді", "Перевод приостановлен на 15 минут"],
    blocked: ["Қауіпті аударым бұғатталды", "Опасный перевод заблокирован"],
  };
  return { transaction_id, status, risk_score, headline_kk: headlines[status][0], headline_ru: headlines[status][1], reasons_kk: reasons.map(r => r.reason_kk), reasons_ru: reasons.map(r => r.reason_ru) };
}
export function evaluateDemo(input: TransferInput): Evaluation {
  const start = performance.now();
  const sender = accounts.find(a => a.id === input.sender_id);
  const recipient = accounts.find(a => a.id === input.recipient_id || a.phone === input.recipient_phone || a.iban === input.recipient_iban);
  if (!sender || !recipient) throw new DemoError(404, "notFound");
  if (sender.id === recipient.id) throw new DemoError(422, "invalid");
  const ctx = input.context;
  const isNew = ctx.is_new_recipient ?? recipient.id !== ids.friend;
  const reasons: Reason[] = [];
  if (ctx.active_call) reasons.push(reason("ACTIVE_CALL", "behavioral", 25, "Аударым кезінде қоңырау белсенді.", "Во время перевода активен телефонный звонок."));
  if (ctx.from_deposit) reasons.push(reason("DEPOSIT_WITHDRAWAL", "behavioral", 15, "Қаражат депозиттен жаңа шығарылған.", "Средства только что сняты с депозита."));
  if (ctx.is_new_device) reasons.push(reason("NEW_DEVICE", "behavioral", 15, "Аударым жаңа құрылғыдан жасалуда.", "Перевод выполняется с нового устройства."));
  if (isNew) reasons.push(reason("NEW_RECIPIENT", "behavioral", 10, "Бұл алушыға алғашқы аударым.", "Первый перевод этому получателю."));
  if (Number(input.amount) >= 120000) reasons.push(reason("AMOUNT_SPIKE", "behavioral", Number(input.amount) >= 400000 ? 20 : 10, "Сома әдеттегі аударымнан едәуір жоғары.", "Сумма значительно выше обычного перевода."));
  if (ctx.active_call && (ctx.from_deposit || isNew)) reasons.push(reason("SOCIAL_ENGINEERING_PATTERN", "behavioral", 10, "Белгілер әлеуметтік инженерияға сәйкес келеді.", "Сочетание сигналов указывает на социальную инженерию."));
  const behavioral = Math.min(74, reasons.reduce((sum, r) => sum + r.score_delta, 0));
  const t1 = performance.now();
  if (recipient.id === ids.hub) reasons.push(
    reason("DROP_HUB_FAN_IN", "velocity", 35, "Демо граф: 30 минутта 12 кіріс аударым.", "Демо граф: 12 входящих переводов за 30 минут."),
    reason("RECIPIENT_MANY_SENDERS", "graph", 20, "Алушымен 12 жіберуші байланысқан.", "С получателем связаны 12 отправителей."),
    reason("RECIPIENT_SHARED_DEVICE", "graph", 15, "Екі шот бір құрылғыны пайдаланады.", "Два счёта используют общее устройство."),
    reason("RECIPIENT_TRANSIT_RATIO", "graph", 15, "Кіріс қаражаттың 85%-ы әрі қарай шығарылған.", "85% входящих средств переведены дальше."),
  );
  const score = Math.min(100, behavioral + reasons.filter(r => r.layer !== "behavioral").reduce((n, r) => n + r.score_delta, 0));
  const status: Status = score >= 75 ? "blocked" : score >= 40 ? "cooling_off" : "approved";
  const now = Date.now();
  const until = status === "cooling_off" ? new Date(now + 900000).toISOString() : null;
  const id = randomUUID();
  const latency = Math.round((performance.now() - start) * 1000) / 1000;
  rows().unshift({ transaction_id: id, created_at: new Date(now).toISOString(), status, risk_score: score, amount: input.amount, currency: "KZT", latency_ms: latency, sender, recipient, ...ctx, is_new_recipient: isNew, cooling_until: until, resolved_at: null, reasons });
  rows().splice(200);
  return { ...decision(status, score, id, reasons), reasons, latency_ms: latency,
    layer_latency_ms: { behavioral: t1 - start, graph: performance.now() - t1 },
    cooling_off_until: until, is_new_recipient: isNew, is_new_device: ctx.is_new_device,
    recipient: { id: recipient.id, display_name: recipient.full_name, iban_masked: `KZ** •••• ${recipient.iban.slice(-4)}` } };
}
export function resolveDemo(id: string, answers: Answers): Decision {
  const row = rows().find(r => r.transaction_id === id);
  if (!row) throw new DemoError(404, "notFound");
  if (row.status !== "cooling_off") throw new DemoError(409, "conflict");
  const flagged = answers.caller_claims_bank_or_police || answers.asked_to_move_to_safe_account || answers.asked_to_keep_secret_or_install_app || !answers.initiated_by_customer;
  row.status = flagged ? "blocked" : "approved";
  row.risk_score = flagged ? 90 : 0;
  row.resolved_at = new Date().toISOString();
  row.cooling_until = null;
  row.reasons = [reason("QUESTIONNAIRE", "questionnaire", flagged ? 90 : 0,
    flagged ? "Жауаптарда алаяқтық белгілері бар. Аударым бұғатталды." : "Қауіпсіздік тексеруі аяқталды. Аударым мақұлданды.",
    flagged ? "В ответах обнаружены признаки обмана. Перевод заблокирован." : "Проверка безопасности пройдена. Перевод одобрен.")];
  return decision(row.status, row.risk_score, id, row.reasons);
}
export function feedDemo(): Feed {
  const items = rows();
  return { server_time: new Date().toISOString(), items, stats: {
    total: items.length, approved: items.filter(r => r.status === "approved").length,
    cooling_off: items.filter(r => r.status === "cooling_off").length, blocked: items.filter(r => r.status === "blocked").length,
    avg_latency_ms: items.length ? items.reduce((n, r) => n + r.latency_ms, 0) / items.length : 0,
    max_latency_ms: Math.max(0, ...items.map(r => r.latency_ms)),
  } };
}
export function graphDemo(center: string): Graph {
  const account = accounts.find(a => a.id === center);
  if (!account) throw new DemoError(404, "notFound");
  const isHub = center === ids.hub;
  const data = (party: Party, patch: Partial<GraphData> = {}): GraphData => ({ label: party.full_name, role: "normal", depth: 1, device_id: `device-${party.id.slice(-4)}`, flagged: false, suspected_mule: false, in_degree: 0, out_degree: 1, in_weight: 0, out_weight: 90000, transit_ratio: 0, shared_device_accounts: 0, ...patch });
  const nodes: Graph["nodes"] = [{ id: center, type: "account", position: { x: 0, y: 0 }, data: data(account, { role: "center", depth: 0, suspected_mule: isHub, in_degree: isHub ? 12 : 1, shared_device_accounts: isHub ? 2 : 0, transit_ratio: isHub ? 0.85 : 0 }) }];
  const edges: Graph["edges"] = [];
  const count = isHub ? 12 : 1;
  for (let i = 0; i < count; i++) {
    const id = isHub ? `feeder-${i + 1}` : ids.sender;
    const angle = (i / count) * Math.PI * 2;
    nodes.push({ id, type: "account", position: { x: Math.cos(angle) * 440, y: Math.sin(angle) * 440 }, data: data({ id, full_name: isHub ? `•••• ${1101 + i}` : accounts[0].full_name, iban: "" }) });
    edges.push({ id: `${id}-${center}`, source: id, target: center, type: "default", animated: isHub, label: isHub ? "90 000 ₸" : "25 000 ₸", data: { edge_type: "transfer", weight: isHub ? 90000 : 25000, tx_count: 1, highlight: isHub } });
  }
  if (isHub) {
    nodes.push({ id: "shared-account", type: "account", position: { x: 700, y: 0 }, data: data({ id: "shared-account", full_name: "•••• 9001", iban: "" }, { role: "mule", suspected_mule: true, shared_device_accounts: 2, device_id: "device-0004" }) });
    edges.push({ id: "shared-device", source: center, target: "shared-account", type: "straight", animated: false, label: null, data: { edge_type: "shared_device", weight: 0, tx_count: 0, highlight: true } });
  }
  return { center, depth: 2, nodes, edges };
}
