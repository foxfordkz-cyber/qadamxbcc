import type { Evaluation, Lang } from "./contracts";
import { coolingQuestions } from "./cooling-flow";
import { caseTimeline } from "./case-timeline";
import type { MessageKey } from "./i18n";

type T = (key: MessageKey) => string;
const pick = (lang: Lang, kk: string, ru: string) => lang === "kk" ? kk : ru;
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const signalLabels: Record<string, MessageKey> = { active_call: "active_call", from_deposit: "from_deposit", is_new_device: "is_new_device", is_new_recipient: "is_new_recipient", pasted_recipient: "pasteDetected" };

/**
 * A printable statement for the client's police report and the bank's fraud team.
 * Built from the same allowlisted fields as the JSON record; no biometrics, no full
 * account numbers. The legal references are for orientation and need the bank's legal review.
 */
export function policeReportHtml(detail: Evaluation, lang: Lang, t: T, now = new Date()) {
  const when = (value: string | null) => value ? new Date(value).toLocaleString(lang === "kk" ? "kk-KZ" : "ru-KZ", { timeZone: "Asia/Qyzylorda", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
  const amount = detail.amount === undefined ? "—" : `${Number(detail.amount).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₸`;
  const reasons = detail.reasons.filter(reason => reason.score_delta !== 0 || reason.code.startsWith("QUESTIONNAIRE"));
  const signals = Object.keys(signalLabels).filter(key => detail.context?.[key as keyof NonNullable<Evaluation["context"]>] === true);
  const answers = detail.verification_answers;
  const legal = [
    pick(lang, "ҚР «Төлемдер және төлем жүйелері туралы» Заңы (2025 ж. 30 маусымдағы өзгерістермен): алаяқтық белгілері бар операцияны банк 5 жұмыс күніне дейін тоқтата алады.", "Закон РК «О платежах и платёжных системах» (с изменениями от 30.06.2025): банк вправе приостановить операцию с признаками мошенничества на срок до 5 рабочих дней."),
    pick(lang, "ҚР Қылмыстық кодексі, 190-бап «Алаяқтық».", "Уголовный кодекс РК, ст. 190 «Мошенничество»."),
    pick(lang, "ҚР Қылмыстық кодексі, 232-1-бап (2025 ж. 16 қыркүйектен): банк шотына немесе төлем құралына қол жеткізуді заңсыз беру («дропперлік») — алушыға қатысты, егер расталса.", "Уголовный кодекс РК, ст. 232-1 (с 16.09.2025): незаконная передача доступа к банковскому счёту или платёжному инструменту («дропперство») — в отношении получателя, если подтвердится."),
  ];
  const rows = (items: [string, string][]) => items.map(([label, value]) => `<tr><th>${escape(label)}</th><td>${escape(value)}</td></tr>`).join("");
  const timeline = caseTimeline(detail).map(event => `<li class="${event.tone}"><time>${escape(when(event.time))}</time><span>${escape(t(event.key))}${event.signals ? `: ${escape(event.signals.map(key => t(signalLabels[key])).join(", "))}` : ""}${event.score !== undefined ? ` · ${escape(pick(lang, "тәуекел", "риск"))} ${event.score}/100` : ""}</span></li>`).join("");
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(t("policeReport"))} · ${escape(detail.transaction_id.slice(-8))}</title>
<style>
body{font:14px/1.5 "Roboto Flex",Roboto,Arial,sans-serif;color:#1C1C1E;background:#fff;margin:0;padding:32px;max-width:820px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:24px 0 8px;border-bottom:1px solid #D1D5E5;padding-bottom:4px}
.lead{color:#5b5d66;margin:0 0 16px}.note{font-size:12px;color:#5b5d66;background:#F5F5FA;border-radius:8px;padding:8px 12px}
table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:6px 8px;border-bottom:1px solid #eceef5}th{width:38%;font-weight:600;color:#3A3A3B}
ol{margin:0;padding-left:20px}li{margin:4px 0}ol.tl{list-style:none;padding:0}ol.tl li{display:grid;grid-template-columns:170px 1fr;gap:12px;padding-left:14px;position:relative}
ol.tl li:before{content:"";position:absolute;left:0;top:8px;width:7px;height:7px;border-radius:50%;background:#00AB75}ol.tl li.risk:before{background:#DC2626}ol.tl li.planned:before{background:#D97706}
time{color:#5b5d66;font-variant-numeric:tabular-nums}.sign{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:40px}.sign div{border-top:1px solid #1C1C1E;padding-top:4px;font-size:12px;color:#5b5d66}
.print{position:fixed;top:16px;right:16px;padding:8px 16px;border-radius:10px;border:0;background:#00AB75;color:#fff;font-weight:600;cursor:pointer}@media print{.print{display:none}body{padding:0}}
</style></head><body>
<button class="print" onclick="window.print()">${escape(pick(lang, "Басып шығару / PDF", "Печать / PDF"))}</button>
<h1>${escape(t("policeReport"))}</h1>
<p class="lead">${escape(pick(lang, "Күдікті аударым туралы — клиенттің полицияға арызына және банктің алаяқтыққа қарсы бөліміне", "О подозрительном переводе — к заявлению клиента в полицию и для антифрод-службы банка"))}</p>
<p class="note">${escape(pick(lang, "Saq Bol оқу прототипі: деректер синтетикалық, банк төлемдері орындалмайды. Құқықтық сілтемелер бағдар үшін; банктің заң қызметі тексеруі қажет.", "Учебный прототип Saq Bol: данные синтетические, банковские платежи не выполняются. Правовые ссылки — для ориентира; требуется проверка юридической службой банка."))}</p>
<h2>${escape(pick(lang, "Операция", "Операция"))}</h2><table>${rows([
    [pick(lang, "Операция нөмірі", "Номер операции"), detail.transaction_id],
    [pick(lang, "Уақыты (UTC+5)", "Время (UTC+5)"), when(detail.created_at ?? null)],
    [pick(lang, "Сомасы", "Сумма"), amount],
    [pick(lang, "Алушы", "Получатель"), `${detail.recipient.display_name} · ${detail.recipient.iban_masked}`],
    [pick(lang, "Ағымдағы мәртебе", "Текущий статус"), t(detail.status)],
    [pick(lang, "Тәуекел бағасы", "Оценка риска"), `${detail.risk_score} / 100`],
  ])}</table>
<h2>${escape(pick(lang, "Оқиғалар хронологиясы", "Хронология событий"))}</h2><ol class="tl">${timeline}</ol>
<h2>${escape(pick(lang, "Қысым белгілері және шешім себептері", "Признаки давления и причины решения"))}</h2>
${signals.length ? `<p>${escape(pick(lang, "Құрылғы сигналдары", "Сигналы устройства"))}: ${escape(signals.map(key => t(signalLabels[key])).join(", "))}</p>` : ""}
<ol>${reasons.map(reason => `<li>${escape(lang === "kk" ? reason.reason_kk : reason.reason_ru)}${reason.score_delta ? ` <small>(${reason.score_delta > 0 ? "+" : ""}${reason.score_delta})</small>` : ""}</li>`).join("") || `<li>—</li>`}</ol>
${answers ? `<h2>${escape(pick(lang, "Клиенттің жауаптары", "Ответы клиента"))}</h2><table>${rows(coolingQuestions.map(key => [t(key), t(answers[key] ? "yes" : "no")]))}</table>` : ""}
<h2>${escape(pick(lang, "Құқықтық негіз", "Правовые основания"))}</h2><ol>${legal.map(item => `<li>${escape(item)}</li>`).join("")}</ol>
<p class="note">${escape(pick(lang, "Анықтамада биометрия, толық шот нөмірлері және қоңырау мазмұны жоқ: Saq Bol әңгімелерді тыңдамайды.", "В справке нет биометрии, полных номеров счетов и содержания звонков: Saq Bol не слушает разговоры."))} ${escape(pick(lang, "Құрастырылды", "Сформировано"))}: ${escape(when(now.toISOString()))}</p>
<div class="sign"><div>${escape(pick(lang, "Банк талдаушысы (аты-жөні, қолы)", "Аналитик банка (ФИО, подпись)"))}</div><div>${escape(pick(lang, "Клиент (аты-жөні, қолы)", "Клиент (ФИО, подпись)"))}</div></div>
</body></html>`;
}
