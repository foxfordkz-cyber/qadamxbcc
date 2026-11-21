const contacts = new Map([
  ["+77010000002", "normal"], ["+77010000003", "scam"], ["+77010000004", "hub"],
]);

export function phoneNumber(raw) {
  const digits = raw.trim().replace(/[ ()-]/g, "");
  return /^[78]\d{10}$/.test(digits) ? "+7" + digits.slice(1) : digits;
}

export async function checkPayee(draft, api, recipients = []) {
  const savedRef = recipients.find(contact => contact.phone === draft.recipient_phone)?.payee_ref;
  const recipient = contacts.get(draft.recipient_phone) || (/^saved-[1-4]$/.test(savedRef) ? savedRef : null);
  const unavailable = {status: "unavailable"};
  if (!recipient) return unavailable;
  const {bank, expectedName} = draft.payee;
  try {
    const reply = await api("payee-check", "POST", {recipient, bank, expected_name: expectedName});
    if (reply?.source !== "synthetic_directory" || reply.recipient !== recipient || reply.bank !== bank) return unavailable;
    if (!["identified", "match", "close", "mismatch"].includes(reply.status) ||
        typeof reply.display_name !== "string" || !/^[\p{L}\p{M}'’-]+ \p{L}\.$/u.test(reply.display_name)) return unavailable;
    return reply;
  } catch (error) {
    if ([401, 403].includes(error?.status)) throw error;
    return unavailable;
  }
}

export function payeeFields(draft, T, E) {
  const p = draft?.payee;
  return `<label data-manual-phone ${p?.manual ? "" : "hidden"}>${T("Телефон получателя", "Алушының телефоны")}
    <input type="tel" name="manual_phone" autocomplete="off" maxlength="24" ${p?.manual ? "required" : "disabled"} value="${E(p?.manual ? draft.recipient_phone : "")}"></label>
    <label>${T("Банк получателя", "Алушының банкі")}<select name="payee_bank">
      <option value="bcc">Bank CenterCredit</option><option value="other" ${p?.bank === "other" ? "selected" : ""}>${T("Другой банк", "Басқа банк")}</option></select></label>
    <label>${T("Ожидаемое имя получателя (необязательно)", "Алушының күтілетін аты (міндетті емес)")}
      <input name="payee_name" autocomplete="off" maxlength="80" value="${E(p?.expectedName || "")}"></label>`;
}

const labels = {
  identified: ["Получатель найден", "Алушы табылды"],
  match: ["Имя совпадает", "Аты сәйкес келеді"],
  close: ["Имя совпало частично. Сверьте написание.", "Аты ішінара сәйкес. Жазылуын тексеріңіз."],
  mismatch: ["Имя отличается. Вернитесь и проверьте реквизиты.", "Аты сәйкес емес. Деректемелерге оралып, тексеріңіз."],
  unavailable: ["Получателя подтвердить не удалось. Проверьте телефон и банк.", "Алушы расталмады. Телефон нөмірі мен банкті тексеріңіз."],
};

export function payeeVerdict(result, bank, T, E) {
  return `<section class="paper" role="status" data-payee-status="${result?.status || "unavailable"}">
    <small>${T("Учебный справочник получателей", "Алушылардың оқу анықтамалығы")} · ${bank === "bcc" ? "Bank CenterCredit" : T("Другой банк", "Басқа банк")}</small>
    <h2>${T(...labels[result?.status || "unavailable"])}</h2>${result?.display_name ? "<p>"+E(result.display_name)+"</p>" : ""}</section>`;
}

export const canConfirmPayee = result => ["identified", "match", "close"].includes(result?.status);
