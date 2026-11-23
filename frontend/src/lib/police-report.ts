import type { Answers, Evaluation, Lang } from "./contracts";
import { coolingQuestions } from "./cooling-flow";
import { caseTimeline } from "./case-timeline";
import type { MessageKey } from "./i18n";

type T = (key: MessageKey) => string;
const pick = (lang: Lang, kk: string, ru: string) => lang === "kk" ? kk : ru;
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const signalLabels: Record<string, MessageKey> = { active_call: "active_call", from_deposit: "from_deposit", is_new_device: "is_new_device", is_new_recipient: "is_new_recipient", pasted_recipient: "pasteDetected" };

export function legalReferences(lang: Lang) {
  const base = `https://old.adilet.zan.kz/${lang === "kk" ? "kaz" : "rus"}/docs/`;
  return [
    { url: base + "Z1600000011#" + pick(lang, "z908", "z11102"), label: pick(lang, "«Төлемдер және төлем жүйелері туралы» ҚР Заңы, 25-1-бап", "Закон РК «О платежах и платёжных системах», ст. 25-1"),
      note: pick(lang, "Алаяқтық белгілері анықталса, банк заңда көзделген жағдайларда операцияны бес жұмыс күніне дейін тоқтата тұра алады.", "При признаках мошенничества банк может приостановить операцию на срок до пяти рабочих дней в предусмотренных законом случаях.") },
    { url: base + "K1400000226#" + pick(lang, "z190", "z711"), label: pick(lang, "ҚР Қылмыстық кодексі, 190-бап · Алаяқтық", "УК РК, ст. 190 · Мошенничество"), note: "" },
    { url: base + "K1400000226#" + pick(lang, "z2227", "z3123"), label: pick(lang, "ҚР Қылмыстық кодексі, 232-1-бап · Шотқа қолжетімділікті заңсыз беру", "УК РК, ст. 232-1 · Незаконная передача доступа к счёту"),
      note: pick(lang, "Алушының әрекетіне құқықтық баға беру үшін істің мән-жайын тексеру қажет.", "Применимость к действиям получателя зависит от установленных обстоятельств.") },
  ];
}

/**
 * A printable statement for the client's police report and the bank's fraud team.
 * Built from the same allowlisted fields as the JSON record; no biometrics, no full
 * account numbers. The legal references are for orientation and need the bank's legal review.
 */
export function policeReportHtml(detail: Evaluation, lang: Lang, t: T, now = new Date(), answers: Partial<Answers> | null | undefined = detail.verification_answers) {
  const when = (value: string | null) => value ? new Date(value).toLocaleString(lang === "kk" ? "kk-KZ" : "ru-KZ", { timeZone: "Asia/Qyzylorda", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
  const amount = detail.amount === undefined ? "—" : `${Number(detail.amount).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₸`;
  const reasons = detail.reasons.filter(reason => reason.score_delta !== 0 || reason.code.startsWith("QUESTIONNAIRE"));
  const signals = Object.keys(signalLabels).filter(key => detail.context?.[key as keyof NonNullable<Evaluation["context"]>] === true);
  const answered = coolingQuestions.filter(key => typeof answers?.[key] === "boolean");
  const rows = (items: [string, string][]) => items.map(([label, value]) => `<tr><th>${escape(label)}</th><td>${escape(value)}</td></tr>`).join("");
  const timeline = caseTimeline(detail).map(event => `<li class="${event.tone}"><time>${escape(when(event.time))}</time><span>${escape(t(event.key))}${event.signals ? `: ${escape(event.signals.map(key => t(signalLabels[key])).join(", "))}` : ""}${event.score !== undefined ? ` · ${escape(pick(lang, "тәуекел", "риск"))} ${event.score}/100` : ""}</span></li>`).join("");
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(t("policeReport"))} · ${escape(detail.transaction_id.slice(-8))}</title>
<style>
body{font:14px/1.5 Onest,"Segoe UI",Arial,sans-serif;color:#0E1311;background:#fff;margin:0;padding:32px;max-width:820px}
h1,h2{font-family:Geologica,Onest,"Segoe UI",sans-serif}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:24px 0 8px;border-bottom:1px solid #d7dcd6;padding-bottom:4px}
.lead{color:#3B4540;margin:0 0 16px}.note{font-size:12px;color:#3B4540;background:#F2F3F0;border-radius:8px;padding:8px 12px}a{color:#086446}
table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:6px 8px;border-bottom:1px solid #ECEEEA}th{width:38%;font-weight:600;color:#3B4540}
ol{margin:0;padding-left:20px}li{margin:4px 0}ol.tl{list-style:none;padding:0}ol.tl li{display:grid;grid-template-columns:170px 1fr;gap:12px;padding-left:14px;position:relative}
ol.tl li:before{content:"";position:absolute;left:0;top:8px;width:7px;height:7px;border-radius:50%;background:#0B7A56}ol.tl li.risk:before{background:#D92D3A}ol.tl li.planned:before{background:#5E8BA8}
time{color:#3B4540;font-variant-numeric:tabular-nums}.sign{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:40px}.sign div{border-top:1px solid #0E1311;padding-top:4px;font-size:12px;color:#3B4540}
.print{position:fixed;top:16px;right:16px;min-height:44px;padding:8px 18px;border-radius:99px;border:0;background:#0E1311;color:#fff;font-weight:600;cursor:pointer}@media print{.print{display:none}body{padding:0}}
@media(max-width:540px){body{padding:14px;overflow-wrap:anywhere}ol.tl li{grid-template-columns:1fr;gap:1px}.print{position:static;float:none;min-height:44px;margin-bottom:10px}th,td{padding:5px}}
</style></head><body>
<button class="print" onclick="window.print()">${escape(pick(lang, "Басып шығару / PDF", "Печать / PDF"))}</button>
<h1>${escape(t("policeReport"))}</h1>
<p class="lead">${escape(pick(lang, "Күдікті аударым туралы — клиенттің полицияға арызына және банктің алаяқтыққа қарсы бөліміне", "О подозрительном переводе — к заявлению клиента в полицию и для антифрод-службы банка"))}</p>
<p class="note">${escape(pick(lang, "Saq Bol стендіндегі оқу операциясы. Құқықтық негізді банктің заң қызметі нақтылайды.", "Учебная операция на стенде Saq Bol. Правовую оценку уточняет юридическая служба банка."))}</p>
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
${answered.length ? `<h2>${escape(pick(lang, "Клиенттің жауаптары", "Ответы клиента"))}</h2><table>${rows(answered.map(key => [t(key), t(answers?.[key] ? "yes" : "no")]))}</table>` : ""}
<h2>${escape(pick(lang, "Құқықтық негіз", "Правовые основания"))}</h2><ol>${legalReferences(lang).map(item => `<li><a href="${escape(item.url)}" target="_blank" rel="noopener noreferrer">${escape(item.label)}</a> ${escape(item.note)}</li>`).join("")}</ol>
<p class="note">${escape(pick(lang, "Анықтамада биометрия, толық шот нөмірлері және қоңырау мазмұны жоқ: Saq Bol әңгімелерді тыңдамайды.", "В справке нет биометрии, полных номеров счетов и содержания звонков: Saq Bol не слушает разговоры."))} ${escape(pick(lang, "Құрастырылды", "Сформировано"))}: ${escape(when(now.toISOString()))}</p>
<div class="sign"><div>${escape(pick(lang, "Банк талдаушысы (аты-жөні, қолы)", "Аналитик банка (ФИО, подпись)"))}</div><div>${escape(pick(lang, "Клиент (аты-жөні, қолы)", "Клиент (ФИО, подпись)"))}</div></div>
</body></html>`;
}
