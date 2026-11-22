"use client";
import type { CaseAnalytics } from "@/lib/soc-integrations";
import { useLocale } from "@/lib/i18n";

export function PolicyComparison({ data }: { data: NonNullable<CaseAnalytics["policy_comparison"]> }) {
  const kk = useLocale().lang === "kk";
  const locale = kk ? "kk-KZ" : "ru-KZ";
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const date = new Intl.DateTimeFormat(locale, { timeZone: "Asia/Almaty", dateStyle: "short", timeStyle: "short" });
  const known = data.fraud_labelled + data.legitimate_labelled;
  const coverage = data.evaluated ? number.format(100 * known / data.evaluated) + "%" : "—";
  const legacyRow = (threshold: number | null, extra: number, detected: number, falseHolds: number) => ({
    threshold, extra_holds: extra,
    missed_fraud: data.fraud_labelled ? data.fraud_labelled - detected : null,
    false_interventions: data.legitimate_labelled ? falseHolds : null,
    false_per_1000_legitimate: data.legitimate_labelled ? 1000 * falseHolds / data.legitimate_labelled : null,
  });
  const policies = data.policies?.length ? data.policies : [
    legacyRow(null, 0, data.baseline_detected, data.baseline_false_interventions),
    legacyRow(data.candidate_threshold, data.extra_holds, data.candidate_detected, data.candidate_false_interventions),
  ];
  const columns = kk
    ? ["Қосымша кідіріс шегі", "Қосымша кідіріс", "Өткізіп алған алаяқтық", "1 000 заңды аударымға шаққандағы қате кідіріс"]
    : ["Порог дополнительной паузы", "Доп. паузы", "Пропущено мошеннических", "Ложные паузы на 1 000 законных"];
  const display = (value: number | null) => value === null ? "—" : number.format(value);
  return <details className="scenario-results panel" data-policy-comparison>
    <summary>{kk ? "Тәуекел шектерін салыстыру" : "Сравнение порогов риска"}</summary>
    <p>{kk ? `Соңғы ${data.sampled} аударымның ${data.evaluated} бастапқы шешімі салыстырылды.`
      : `Сравниваем исходные решения по ${data.evaluated} из последних ${data.sampled} переводов.`}
      {data.first_sample_at && data.last_sample_at && <> {date.format(new Date(data.first_sample_at))} – {date.format(new Date(data.last_sample_at))} (UTC+5).</>}</p>
    <p>{kk ? `Нәтижесі белгілі: ${known}/${data.evaluated} (${coverage}). Алаяқтық — ${data.fraud_labelled}, заңды аударым — ${data.legitimate_labelled}.`
      : `Известен исход ${known}/${data.evaluated} операций (${coverage}). Подтверждено мошеннических — ${data.fraud_labelled}, законных — ${data.legitimate_labelled}.`}</p>
    {!known && <p>{kk ? "Бағаланған аударымға қатысты істі жабу кезінде тергеу нәтижесін белгілеңіз. Деректер келесі жаңартуда көрсетіледі."
      : "При закрытии дела по оценённому переводу укажите исход расследования. Он появится при следующем обновлении."}</p>}
      <p>{kk ? "Әр шек қосымша кідірісті модельдейді. Бұрын тоқтатылған аударымдар барлық нұсқада тоқтатылған күйде қалады."
        : "Каждый порог добавляет паузу к действующим мерам. Ранее удержанные и заблокированные переводы учитываются при каждом пороге."}</p>
      <div className="policy-scroll"><table><thead><tr>{columns.map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{policies.map(row => <tr key={row.threshold ?? "current"}>
          <th scope="row">{row.threshold === null ? (kk ? "Қазіргі саясат" : "Текущая политика") : `≥ ${row.threshold}`}</th>
          <td>{data.evaluated ? row.extra_holds : "—"}</td><td>{display(row.missed_fraud)}</td>
          <td>{display(row.false_per_1000_legitimate)}{row.false_interventions !== null && <> ({row.false_interventions}/{data.legitimate_labelled})</>}</td>
        </tr>)}</tbody></table></div>
    <p>{kk ? "«—» тиісті дерек жоқ екенін білдіреді. Белгілер жабылған істерден алынады. Даулы немесе белгісіз нәтижелер сапа есебіне кірмейді. Осы аударымдар үшін толық HTTP сұрауының p95 уақыты қолжетімсіз."
      : "«—» означает, что для метрики нет данных. Исходы взяты из закрытых дел. Спорные и неизвестные исходы исключены из оценки качества. Для этих переводов p95 полного HTTP-запроса недоступен."}</p>
  </details>;
}
