import { latencySummary } from "./latency-summary";
import { ids } from "./demo-ids";
import type { PriorReceiptQuery, PriorReceipts } from "./recipient-lookback";
import { feedQuerySchema, type FeedQuery } from "./contracts";
import { countBlockedHubs } from "./feed-summary";
import type { AbandonResult, Answers, Decision, Evaluation, Feed, FeedItem, Graph, GraphData, Party, Reason, Status, TransferInput } from "./contracts";
import { recipientFlagInputSchema, type RecipientFlag, type RecipientFlagInput, type RecipientFlagReceipt } from "./recipient-flag";

const accounts = [
  { id: ids.sender, full_name: "Аружан С.", phone: "+77010000001", iban: "KZ000000000000000001" },
  { id: ids.friend, full_name: "Данияр А.", phone: "+77010000002", iban: "KZ000000000000000002" },
  { id: ids.stranger, full_name: "Алексей К.", phone: "+77010000003", iban: "KZ000000000000000003" },
  { id: ids.hub, full_name: "Марат Т.", phone: "+77010000004", iban: "KZ000000000000000004" },
];
const root = globalThis as typeof globalThis & { bccDemoTransfers?: FeedItem[]; bccDemoDetails?: Map<string, Evaluation>; bccDemoRequests?: Map<string, { body: string; result: Evaluation }>; bccDemoAbandoned?: Set<string> };
const rows = () => root.bccDemoTransfers ??= [];
const details = () => root.bccDemoDetails ??= new Map();
const requests = () => root.bccDemoRequests ??= new Map();
const abandoned = () => root.bccDemoAbandoned ??= new Set();
const flagRoot = root as typeof root & { bccDemoRecipientFlags?: Map<string, RecipientFlag>; bccDemoFlagReceipts?: Map<string, { body: string; result: RecipientFlagReceipt }> };
const flags = () => flagRoot.bccDemoRecipientFlags ??= new Map();
const flagReceipts = () => flagRoot.bccDemoFlagReceipts ??= new Map();
export function recipientFlagDemo(accountId: string): RecipientFlag {
  if (!accounts.some(account => account.id === accountId)) throw new DemoError(404, "account_not_found");
  return structuredClone(flags().get(accountId) ?? { account_id: accountId, flagged: false, version: 0, updated_at: null });
}
export function priorReceiptsDemo(accountId: string, query: PriorReceiptQuery): PriorReceipts {
  const flag = recipientFlagDemo(accountId);
  if (!flag.flagged || !flag.updated_at || flag.version !== query.version) throw new DemoError(409, "reviewed_flag_required");
  const until = Date.parse(flag.updated_at);
  const since = until - query.days * 86_400_000;
  const matches = rows().filter(item => item.recipient.id === accountId && item.sender.id !== accountId
    && item.status === "approved" && item.currency === "KZT" && Date.parse(item.created_at) >= since
    && Date.parse(item.created_at) <= until && Date.parse(item.resolved_at ?? item.created_at) <= until)
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at) || right.transaction_id.localeCompare(left.transaction_id));
  const start = query.cursor ? matches.findIndex(item => item.transaction_id === query.cursor) + 1 : 0;
  if (query.cursor && !start) throw new DemoError(422, "invalid_receipt_cursor");
  const page = matches.slice(start, start + 20);
  return {
    account_id: accountId, flag_version: flag.version, flagged_at: flag.updated_at, from_time: new Date(since).toISOString(),
    items: page.map(item => ({ transaction_id: item.transaction_id, sender_ref: item.sender.id.slice(-8),
      amount: String(item.amount), settled_at: item.resolved_at ?? item.created_at, status: "approved" })),
    next_cursor: start + page.length < matches.length ? page[page.length - 1].transaction_id : null,
  };
}
export function setRecipientFlagDemo(accountId: string, input: RecipientFlagInput): RecipientFlagReceipt {
  const body = recipientFlagInputSchema.parse(input);
  const identity = JSON.stringify({ accountId, ...body });
  const replay = flagReceipts().get(body.request_id);
  if (replay) {
    if (replay.body !== identity) throw new DemoError(409, "flag_idempotency_conflict");
    return structuredClone(replay.result);
  }
  const current = recipientFlagDemo(accountId);
  if (body.expected_version !== current.version) throw new DemoError(409, "flag_version_conflict");
  if (flagReceipts().size >= 5000) throw new DemoError(503, "demoCapacity");
  const value: RecipientFlagReceipt = { account_id: accountId, flagged: body.flagged, version: current.version + 1, updated_at: new Date().toISOString(), audit_id: globalThis.crypto.randomUUID(), actor: "demo_soc_operator", note: body.note, previous_flagged: current.flagged };
  flags().set(accountId, { account_id: accountId, flagged: value.flagged, version: value.version, updated_at: value.updated_at });
  flagReceipts().set(body.request_id, { body: identity, result: value });
  return structuredClone(value);
}
// «Банк мне звонит?» — a simulated bank outbound call log and the checks made against it.
const demoCalls = root as typeof root & { bccDemoBankCalls?: Map<string, number>; bccDemoCallChecks?: Map<string, { customer: string; verified: boolean; at: number }> };
const bankCalls = () => demoCalls.bccDemoBankCalls ??= new Map();
const callChecks = () => demoCalls.bccDemoCallChecks ??= new Map();
const BANK_CALL_TTL_MS = 10 * 60_000;
const CALL_CHECK_TTL_MS = 30 * 60_000;
const DEMO_EMPLOYEE = { employee_name: "Асем Нурланова", department: "Кредиттеу бөлімі / Отдел кредитования" };
export function bankCallDemo(customerId: string, now = Date.now()) {
  if (!accounts.some(a => a.id === customerId)) throw new DemoError(404, "notFound");
  bankCalls().set(customerId, now + BANK_CALL_TTL_MS);
  return { customer_id: customerId, ...DEMO_EMPLOYEE, expires_in_s: BANK_CALL_TTL_MS / 1000 };
}
export function callCheckDemo(customerId: string, now = Date.now()) {
  if (!accounts.some(a => a.id === customerId)) throw new DemoError(404, "notFound");
  if (callChecks().size >= 5000) callChecks().clear();
  const verified = (bankCalls().get(customerId) ?? 0) > now;
  const check_id = globalThis.crypto.randomUUID();
  callChecks().set(check_id, { customer: customerId, verified, at: now });
  return {
    check_id, verified, checked_at: new Date(now).toISOString(), simulated_log: true,
    employee_name: verified ? DEMO_EMPLOYEE.employee_name : null, department: verified ? DEMO_EMPLOYEE.department : null,
    message_kk: verified ? `Иә, бұл банк қызметкері: ${DEMO_EMPLOYEE.employee_name}, ${DEMO_EMPLOYEE.department}.` : "Банк сізге қазір қоңырау шалып жатқан жоқ. Тұтқаны қойыңыз: бұл алаяқтар болуы мүмкін.",
    message_ru: verified ? `Да, это сотрудник банка: ${DEMO_EMPLOYEE.employee_name}, ${DEMO_EMPLOYEE.department}.` : "Банк вам сейчас НЕ звонит. Положите трубку: это могут быть мошенники.",
  };
}
function bankCallDenied(checkId: string | undefined, customerId: string, now: number) {
  const check = checkId ? callChecks().get(checkId) : undefined;
  return Boolean(check && check.customer === customerId && !check.verified && now - check.at <= CALL_CHECK_TTL_MS);
}
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
    cancelled: ["Аударымнан бас тартылды", "Перевод отменён"],
  };
  return { transaction_id, status, risk_score, headline_kk: headlines[status][0], headline_ru: headlines[status][1], reasons_kk: reasons.map(r => r.reason_kk), reasons_ru: reasons.map(r => r.reason_ru) };
}
function knownPayee(senderId: string, recipientId: string, now: number) {
  // Seeded friendship or settled history, never the caller's is_new_recipient override.
  return (senderId === ids.sender && recipientId === ids.friend) || rows().some(row =>
    row.sender.id === senderId && row.recipient.id === recipientId && row.status === "approved" && Date.parse(row.resolved_at ?? row.created_at) <= now);
}
function activeOriginalHold(senderId: string, recipientId: string, now: number): FeedItem | undefined {
  const known = knownPayee(senderId, recipientId, now);
  return rows().filter(row => row.sender.id === senderId && row.status === "cooling_off"
    && (row.recipient.id === recipientId || !known)
    && !row.reasons.some(item => item.code === "ACTIVE_HOLD_RETRY")
    && Date.parse(row.created_at) <= now && Date.parse(row.created_at) + 900000 > now
    && row.cooling_until && Date.parse(row.cooling_until) > now)
    .sort((a, b) => Date.parse(a.cooling_until!) - Date.parse(b.cooling_until!))[0];
}
function splitPayeeReason(senderId: string, recipientId: string, amount: number, score: number, now: number): Reason | null {
  if (senderId === ids.sender && recipientId === ids.friend) return null;
  let settledCount = 0;
  let settledCents = 0;
  const currentCents = Math.round(amount * 100);
  let largestCents = currentCents;
  for (const row of rows()) {
    if (row.sender.id !== senderId || row.recipient.id !== recipientId || row.status !== "approved") continue;
    const paidAt = Date.parse(row.resolved_at ?? row.created_at);
    if (paidAt <= now - 86_400_000 || paidAt > now) return null;
    const cents = Math.round(Number(row.amount) * 100);
    settledCount += 1;
    settledCents += cents;
    largestCents = Math.max(largestCents, cents);
  }
  // The static demo uses a 40,000 KZT sender baseline (its 3x amount spike is 120,000).
  const threshold = 150_000;
  const totalCents = settledCents + currentCents;
  if (settledCount < 2 || totalCents < threshold * 100 || largestCents * 5 > totalCents * 4) return null;
  const n = settledCount + 1;
  const total = totalCents / 100;
  const formatted = total.toLocaleString("ru-RU", { minimumFractionDigits: totalCents % 100 ? 2 : 0, maximumFractionDigits: 2 });
  return {
    ...reason("SPLIT_TRANSFERS_24H", "velocity", Math.max(0, 40 - score),
      `Соңғы 24 сағатта жаңа алушыға бірнеше рет ақша жібердіңіз. Осы аударымды қоса есептегенде, жалпы сома ${formatted} ₸ болады.`,
      `За последние 24 часа вы несколько раз отправили деньги новому получателю. С учётом этого перевода общая сумма составит ${formatted} ₸.`),
    evidence: { settled_count: settledCount, n, settled_amount_kzt: settledCents / 100, total_kzt: total, threshold_kzt: threshold, window_hours: 24, amount: formatted },
  };
}
const almatyHour = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Almaty", hour: "2-digit", hourCycle: "h23" });
export function evaluateDemo(input: TransferInput, now = Date.now(), capacity = 5000): Evaluation {
  if (input.request_id && abandoned().has(input.request_id)) throw new DemoError(409, "conflict");
  const replay = input.request_id ? requests().get(input.request_id) : undefined;
  if (replay) {
    if (replay.body !== JSON.stringify(input)) throw new DemoError(409, "conflict");
    return structuredClone(replay.result);
  }
  if (details().size >= capacity || details().size + abandoned().size >= capacity * 2) throw new DemoError(503, "demoCapacity");
  const start = performance.now();
  const sender = accounts.find(a => a.id === input.sender_id);
  const recipient = accounts.find(a => a.id === input.recipient_id || a.phone === input.recipient_phone || a.iban === input.recipient_iban);
  if (!sender || !recipient) throw new DemoError(404, "notFound");
  if (sender.id === recipient.id) throw new DemoError(422, "invalid");
  const ctx = input.context;
  const requested = !!ctx.payment_requested_after_call && !ctx.active_call;
  // The static demo uses a 40,000 KZT reference average; the live engine uses the sender's own average.
  const nightSpike = Number(input.amount) >= 120000 && Number(almatyHour.format(now)) < 6;
  const isNew = requested || nightSpike ? !knownPayee(sender.id, recipient.id, now)
    : (ctx.is_new_recipient ?? recipient.id !== ids.friend);
  const reasons: Reason[] = [];
  // Same rule and text as backend DURESS_SIGNAL: the client's own alarm blocks the transfer.
  if (ctx.duress) reasons.push(reason("DURESS_SIGNAL", "behavioral", 100, "Клиент жасырын дабыл берді (растау батырмасын ұстап тұрды): аударым тоқтатылды, экран клиенттің жанындағы адамға ештеңе көрсетпейді.", "Клиент подал тихий сигнал тревоги (удержал кнопку подтверждения): перевод остановлен, экран ничего не выдаёт человеку рядом с клиентом."));
  if (ctx.active_call) reasons.push(reason("ACTIVE_CALL", "behavioral", 25, "Аударым кезінде қоңырау белсенді.", "Во время перевода активен телефонный звонок."));
  if (ctx.active_call && ctx.pasted_recipient) reasons.push(reason("PASTED_DURING_CALL", "behavioral", 15, "Реквизиттер белсенді қоңырау кезінде алмасу буферінен қойылды", "Реквизиты вставлены из буфера обмена во время активного звонка"));
  if (ctx.active_call && bankCallDenied(ctx.bank_call_check_id, sender.id, now)) reasons.push(reason("BANK_CALL_DENIED", "behavioral", 20, "Клиент «Банк маған қоңырау шалып тұр ма?» деп тексерді: банк журналы бойынша банк бұл клиентке қоңырау шалмайды.", "Клиент проверил «Банк мне звонит?»: по журналу банка банк этому клиенту не звонит."));
  if (ctx.from_deposit) reasons.push(reason("DEPOSIT_WITHDRAWAL", "behavioral", 15, "Қаражат депозиттен жаңа шығарылған.", "Средства только что сняты с депозита."));
  if (ctx.is_new_device) reasons.push(reason("NEW_DEVICE", "behavioral", 15, "Аударым жаңа құрылғыдан жасалуда.", "Перевод выполняется с нового устройства."));
  if (isNew) reasons.push(reason("NEW_RECIPIENT", "behavioral", 10, "Бұл алушыға алғашқы аударым.", "Первый перевод этому получателю."));
  if (Number(input.amount) >= 120000) reasons.push(reason("AMOUNT_SPIKE", "behavioral", Number(input.amount) >= 400000 ? 20 : 10, "Сома әдеттегі аударымнан едәуір жоғары.", "Сумма значительно выше обычного перевода."));
  if (ctx.active_call && (ctx.from_deposit || isNew)) reasons.push(reason("SOCIAL_ENGINEERING_PATTERN", "behavioral", 10, "Белгілер әлеуметтік инженерияға сәйкес келеді.", "Сочетание сигналов указывает на социальную инженерию."));
  const behavioral = Math.min(ctx.duress ? 100 : 74, reasons.reduce((sum, r) => sum + r.score_delta, 0));
  const t1 = performance.now();
  if (recipient.id === ids.hub) reasons.push(
    reason("DROP_HUB_FAN_IN", "velocity", 35, "Демо граф: 30 минутта 12 кіріс аударым.", "Демо граф: 12 входящих переводов за 30 минут."),
    reason("RECIPIENT_MANY_SENDERS", "graph", 20, "Алушымен 12 жіберуші байланысқан.", "С получателем связаны 12 отправителей."),
    reason("RECIPIENT_SHARED_DEVICE", "graph", 15, "Екі шот бір құрылғыны пайдаланады.", "Два счёта используют общее устройство."),
    reason("RECIPIENT_TRANSIT_RATIO", "graph", 15, "Кіріс қаражаттың 85%-ы әрі қарай шығарылған.", "85% входящих средств переведены дальше."),
  );
  const flagged = flags().get(recipient.id)?.flagged === true;
  if (flagged) reasons.push(reason("RECIPIENT_FLAGGED", "graph", 40, "Алушы SOC тарапынан күдікті дроп ретінде белгіленген.", "Получатель отмечен SOC как подозреваемый дроп."));
  let score = Math.min(100, behavioral + reasons.filter(r => r.layer !== "behavioral").reduce((n, r) => n + r.score_delta, 0));
  if (flagged && score < 75) {
    const flagReason = reasons.find(item => item.code === "RECIPIENT_FLAGGED")!;
    flagReason.score_delta += 75 - score;
    flagReason.evidence = { ...flagReason.evidence, confirmed_flag_minimum: 75 };
    reasons.sort((a, b) => b.score_delta - a.score_delta || a.code.localeCompare(b.code));
    score = 75;
  }
  const split = splitPayeeReason(sender.id, recipient.id, Number(input.amount), score, now);
  if (split) {
    reasons.push(split);
    score += split.score_delta;
  }
  if (isNew && (requested || nightSpike)) {
    if (nightSpike) {
      reasons.push(reason("NEW_PAYEE_NIGHT_SPIKE", "behavioral", Math.max(0, 40 - score),
        "Жаңа алушыға түнде әдеттегіден кемінде үш есе көп сома аударылып жатыр.",
        "Первый перевод получателю ночью на сумму как минимум втрое выше обычной."));
      score = Math.max(score, 40);
    }
    if (requested) {
      reasons.push({ ...reason("POST_CALL_PAYMENT_REQUEST", "behavioral", Math.max(0, 40 - score),
        "Клиент жаңа алушыға осы аударымды жасауды қоңырауда сұрағанын хабарлады.",
        "Клиент сообщил, что во время завершившегося звонка его попросили сделать этот перевод новому получателю."), evidence: { source: "customer_report" } });
      score = Math.max(score, 40);
    }
  }
  // Only bridge an otherwise approved retry. Independent risk retains its own full hold.
  const originalHold = score < 40 ? activeOriginalHold(sender.id, recipient.id, now) : undefined;
  if (originalHold) {
    const guard = reason("ACTIVE_HOLD_RETRY", "behavioral", 40 - score,
      "Алдыңғы аударымды тексеру әлі аяқталған жоқ. Алушыны немесе реквизиттерді өзгерту қолданыстағы кідірісті жоймайды.",
      "Проверка предыдущего перевода ещё не завершена. Повторная отправка или смена реквизитов не отменяет действующую паузу.");
    guard.evidence = { source: "local_demo", original_transaction_id: originalHold.transaction_id, cooling_off_until: originalHold.cooling_until, recipient_changed: originalHold.recipient.id !== recipient.id, minimum_score: 40 };
    reasons.push(guard); score = 40;
  }
  const status: Status = score >= 75 ? "blocked" : score >= 40 ? "cooling_off" : "approved";
  const until = status === "cooling_off" ? new Date(originalHold
    ? Math.min(Date.parse(originalHold.cooling_until!), Date.parse(originalHold.created_at) + 900000)
    : now + 900000).toISOString() : null;
  const id = input.request_id ?? globalThis.crypto.randomUUID();
  const latency = Math.round((performance.now() - start) * 1000) / 1000;
  rows().unshift({ transaction_id: id, created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(), status, risk_score: score, amount: input.amount, currency: "KZT", latency_ms: latency, sender, recipient, ...ctx, context: ctx, is_new_recipient: isNew, cooling_until: until, resolved_at: null, reasons });
  const result: Evaluation = { ...decision(status, score, id, reasons), reasons, latency_ms: latency,
    layer_latency_ms: { behavioral: t1 - start, graph: performance.now() - t1 },
    cooling_off_until: until, is_new_recipient: isNew, is_new_device: ctx.is_new_device,
    recipient: { id: recipient.id, display_name: recipient.full_name, iban_masked: `KZ** •••• ${recipient.iban.slice(-4)}` },
    amount: input.amount, context: ctx, server_time: new Date(now).toISOString(), created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(), verification_answers: null, resolved_at: null, red_flags: [] };
  if (originalHold) {
    result.headline_kk = "Бұрын басталған тексеру жалғасуда. Бастапқы кідіріс мерзімі сақталды.";
    result.headline_ru = "Продолжается ранее начатая проверка. Срок исходной паузы сохранён.";
  }
  details().set(id, structuredClone(result));
  if (input.request_id) requests().set(input.request_id, { body: JSON.stringify(input), result: structuredClone(result) });
  return result;
}
export function detailDemo(id: string, now = Date.now()): Evaluation {
  const result = details().get(id);
  if (!result) throw new DemoError(404, "notFound");
  return { ...structuredClone(result), server_time: new Date(now).toISOString() };
}
export function abandonDemo(id: string, now = Date.now(), capacity = 5000): AbandonResult {
  if (details().has(id)) return { request_id: id, status: "processed", evaluation: detailDemo(id, now), server_time: new Date(now).toISOString() };
  if (!abandoned().has(id) && details().size + abandoned().size >= capacity * 2) throw new DemoError(503, "demoCapacity");
  abandoned().add(id);
  return { request_id: id, status: "abandoned", server_time: new Date(now).toISOString() };
}
export function resolveDemo(id: string, answers: Answers, now = Date.now(), contactSuspicion = false): Evaluation {
  const row = rows().find(r => r.transaction_id === id);
  if (!row) throw new DemoError(404, "notFound");
  const detail = detailDemo(id, now);
  if (row.status !== "cooling_off") {
    if (row.status !== "cancelled" && JSON.stringify(detail.verification_answers) === JSON.stringify(answers)) return detail;
    throw new DemoError(409, "conflict");
  }
  if (!contactSuspicion && detail.reasons.some(r => r.code === "POST_CALL_ENDED") && !detail.reasons.some(r => r.code === "POST_CALL_RECOGNIZED")) throw new DemoError(409, "conflict");
  const unknownUnderPressure = !answers.knows_recipient_personally && (row.active_call || row.from_deposit || detail.reasons.some(r => r.code === "POST_CALL_PAYMENT_REQUEST"));
  const flagged = answers.caller_claims_bank_or_police || answers.asked_to_move_to_safe_account || answers.asked_to_keep_secret_or_install_app || !answers.initiated_by_customer || unknownUnderPressure;
  const recipientFlagged = flags().get(row.recipient.id)?.flagged === true;
  const blocked = contactSuspicion || flagged || recipientFlagged;
  const previousRisk = row.risk_score;
  row.verification_answers = answers;
  detail.verification_answers = answers;
  row.updated_at = new Date(now).toISOString();
  detail.updated_at = row.updated_at;
  if (!blocked && row.cooling_until && now < Date.parse(row.cooling_until)) {
    details().set(id, detail);
    return detail;
  }
  row.status = blocked ? "blocked" : "approved";
  row.risk_score = blocked ? Math.max(90, previousRisk) : 0;
  row.resolved_at = new Date(now).toISOString();
  row.cooling_until = null;
  row.reasons = recipientFlagged && !flagged ? [...row.reasons, reason("RECIPIENT_FLAGGED_AT_RELEASE", "questionnaire", Math.max(0, 90 - previousRisk),
    "Алушы SOC тарапынан күдікті дроп ретінде белгіленген.", "Получатель отмечен SOC как подозреваемый дроп.")] : [reason("QUESTIONNAIRE", "questionnaire", flagged ? 90 : 0,
    flagged ? "Жауаптарда алаяқтық белгілері бар. Аударым бұғатталды." : "Қауіпсіздік тексеруі аяқталды. Аударым мақұлданды.",
    flagged ? "В ответах обнаружены признаки обмана. Перевод заблокирован." : "Проверка безопасности пройдена. Перевод одобрен."), ...row.reasons];
  if (contactSuspicion) row.reasons = [reason("TRUSTED_CONTACT_SUSPICION", "questionnaire", Math.max(0, row.risk_score - previousRisk),
    "Сенімді адамыңыз алаяқтыққа күдіктенетінін хабарлады. Аударым бұғатталды.",
    "Доверенное лицо сообщило о подозрении на мошенничество. Перевод заблокирован."), ...detail.reasons];
  const result = { ...detail, ...decision(row.status, row.risk_score, id, row.reasons), reasons: row.reasons, cooling_off_until: null, resolved_at: row.resolved_at };
  details().set(id, result);
  return structuredClone(result);
}
export function postCallDemo(id: string, action: "ended" | "recognized", now = Date.now()): Evaluation {
  const detail = detailDemo(id, now);
  const code = action === "ended" ? "POST_CALL_ENDED" : "POST_CALL_RECOGNIZED";
  if (detail.reasons.some(r => r.code === code)) return detail;
  if (detail.status !== "cooling_off" || !detail.context?.active_call
    || (action === "recognized" && !detail.reasons.some(r => r.code === "POST_CALL_ENDED"))) throw new DemoError(409, "conflict");
  const kk = action === "ended" ? "Клиент қоңыраудың аяқталғанын хабарлады. Аударым кідіртілген." : "Қоңыраудан кейін клиент аударымды өзі бастағанын растады.";
  const ru = action === "ended" ? "Клиент сообщил о завершении звонка. Перевод удерживается." : "После звонка клиент подтвердил, что сам начал перевод.";
  const row = rows().find(r => r.transaction_id === id)!;
  row.reasons = [{ ...reason(code, "questionnaire", 0, kk, ru), evidence: { source: "customer_report" } }, ...detail.reasons];
  row.updated_at = new Date(now).toISOString();
  const result = { ...detail, ...decision(row.status, row.risk_score, id, row.reasons), reasons: row.reasons, updated_at: row.updated_at };
  details().set(id, result);
  return structuredClone(result);
}
export function cancelDemo(id: string, now = Date.now(), postCallScam = false): Evaluation {
  const detail = detailDemo(id, now);
  if (postCallScam && (!detail.reasons.some(r => r.code === "POST_CALL_ENDED")
    || (detail.status === "cancelled" && !detail.reasons.some(r => r.code === "POST_CALL_SCAM_REPORTED")))) throw new DemoError(409, "conflict");
  if (detail.status === "cancelled") return detail;
  if (detail.status !== "cooling_off") throw new DemoError(409, "conflict");
  const row = rows().find(r => r.transaction_id === id)!;
  const reasons = [reason("CUSTOMER_CANCELLED", "decision", 0, "Клиент аударымнан бас тартты. Қаражат жіберілген жоқ.", "Клиент отменил перевод. Средства не отправлены."), ...detail.reasons];
  if (postCallScam) reasons.unshift({ ...reason("POST_CALL_SCAM_REPORTED", "questionnaire", 0, "Қоңыраудан кейін клиент алаяқтық туралы хабарлады. Аударым тоқтатылды.", "После звонка клиент сообщил об обмане. Перевод отменён."), evidence: { source: "customer_report" } });
  row.status = "cancelled"; row.cooling_until = null; row.resolved_at = new Date(now).toISOString(); row.updated_at = row.resolved_at; row.reasons = reasons;
  const result = { ...detail, ...decision("cancelled", detail.risk_score, id, reasons), reasons, cooling_off_until: null, resolved_at: row.resolved_at, updated_at: row.updated_at };
  details().set(id, result);
  return structuredClone(result);
}
export function feedDemo(query: Partial<FeedQuery> = {}): Feed {
  const { limit, offset, q, status, since, min_score, alerts_only } = feedQuerySchema.parse(query);
  const items = rows();
  const search = q.toLowerCase();
  const compactId = search.replace(/-/g, "");
  const uuidSearch = /^[0-9a-f]{32}$/.test(compactId) ? compactId : null;
  const filtered = items.filter(row => (!status || row.status === status) && row.risk_score >= min_score
    && (!alerts_only || row.status === "cooling_off" || row.status === "blocked" || row.reasons.some(r => r.code === "POST_CALL_SCAM_REPORTED"))
    && (!since || Date.parse(row.updated_at ?? row.created_at) > Date.parse(since))
    && (!search || row.sender.full_name.toLowerCase().includes(search) || row.recipient.full_name.toLowerCase().includes(search)
      || (uuidSearch !== null && row.transaction_id.replace(/-/g, "") === uuidSearch)))
    .sort((a, b) => Date.parse(b.updated_at ?? b.created_at) - Date.parse(a.updated_at ?? a.created_at)
      || Date.parse(b.created_at) - Date.parse(a.created_at) || b.transaction_id.localeCompare(a.transaction_id));
  return { server_time: new Date().toISOString(), items: filtered.slice(offset, offset + limit), pagination: { total_filtered: filtered.length, offset, limit, has_more: offset + limit < filtered.length }, stats: {
    total: items.length, approved: items.filter(r => r.status === "approved").length,
    cooling_off: items.filter(r => r.status === "cooling_off").length, blocked: items.filter(r => r.status === "blocked").length,
    blocked_hubs: countBlockedHubs(items), ...latencySummary(items),
    cancelled: items.filter(r => r.status === "cancelled").length,
    blocked_amount: String(items.filter(r => r.status === "blocked").reduce((n, r) => n + Number(r.amount), 0)),
    held_amount: String(items.filter(r => r.status === "cooling_off").reduce((n, r) => n + Number(r.amount), 0)),
    cancelled_amount: String(items.filter(r => r.status === "cancelled").reduce((n, r) => n + Number(r.amount), 0)),
    avg_latency_ms: items.length ? items.reduce((n, r) => n + r.latency_ms, 0) / items.length : 0,
    max_latency_ms: Math.max(0, ...items.map(r => r.latency_ms)),
  } };
}
export function graphDemo(center: string, depth = 2): Graph {
  const account = accounts.find(a => a.id === center);
  if (!account) throw new DemoError(404, "notFound");
  const isHub = center === ids.hub;
  const data = (party: Party, patch: Partial<GraphData> = {}): GraphData => ({ label: party.full_name, role: "normal", depth: 1, device_id: `device-${party.id.slice(-4)}`, flagged: flags().get(party.id)?.flagged === true, suspected_mule: false, in_degree: 0, out_degree: 1, in_weight: 0, out_weight: 90000, transit_ratio: 0, shared_device_accounts: 0, ...patch });
  const nodes: Graph["nodes"] = [{ id: center, type: "account", position: { x: 0, y: 0 }, data: data(account, { role: "center", depth: 0, suspected_mule: isHub, in_degree: isHub ? 12 : 1, shared_device_accounts: isHub ? 2 : 0, transit_ratio: isHub ? 0.85 : 0 }) }];
  const edges: Graph["edges"] = [];
  const count = isHub ? 12 : 1;
  const neighbour = accounts.find(party => party.id !== center)!;
  for (let i = 0; i < count; i++) {
    const id = isHub ? `feeder-${i + 1}` : neighbour.id;
    const angle = (i / count) * Math.PI * 2;
    nodes.push({ id, type: "account", position: { x: Math.cos(angle) * 440, y: Math.sin(angle) * 440 }, data: data({ id, full_name: isHub ? `•••• ${1101 + i}` : neighbour.full_name, iban: "" }) });
    edges.push({ id: `${id}-${center}`, source: id, target: center, type: "default", animated: isHub, label: isHub ? "90 000 ₸" : "25 000 ₸", data: { edge_type: "transfer", weight: isHub ? 90000 : 25000, tx_count: 1, highlight: isHub } });
  }
  if (isHub) {
    nodes.push({ id: "shared-account", type: "account", position: { x: 700, y: 0 }, data: data({ id: "shared-account", full_name: "•••• 9001", iban: "" }, { role: "mule", suspected_mule: true, shared_device_accounts: 2, device_id: "device-0004" }) });
    edges.push({ id: "shared-device", source: center, target: "shared-account", type: "straight", animated: false, label: null, data: { edge_type: "shared_device", weight: 0, tx_count: 0, highlight: true } });
  }
  return { center, depth, nodes, edges };
}
