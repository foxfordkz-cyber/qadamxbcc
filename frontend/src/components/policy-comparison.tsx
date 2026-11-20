"use client";
import type { CaseAnalytics } from "@/lib/soc-integrations";
import { useLocale } from "@/lib/i18n";

export function PolicyComparison({ data }: { data: NonNullable<CaseAnalytics["policy_comparison"]> }) {
  const kk = useLocale().lang === "kk";
  const rows = [
    [kk ? "Анықталған алаяқтық" : "Выявлено мошеннических", data.baseline_detected, data.candidate_detected, data.fraud_labelled],
    [kk ? "Адал аударымға араласу" : "Вмешательства в честные переводы", data.baseline_false_interventions, data.candidate_false_interventions, data.legitimate_labelled],
  ] as const;
  return <details className="scenario-results panel" data-policy-comparison>
    <summary>{kk ? "Шешімдерді көлеңкелі салыстыру" : "Теневое сравнение решений"}</summary>
    <p>{kk ? `Соңғы ${data.sampled} операцияның ${data.evaluated} бастапқы шешімі салыстырылды. Сынақ ережесі тәуекел 35-тен басталғанда қосымша ${data.extra_holds} аударымды кідіртер еді.`
      : `Из последних ${data.sampled} операций для ${data.evaluated} есть исходное решение. Порог 35 добавил бы пауз для ${data.extra_holds} переводов. Действующие ограничения сохранены.`}</p>
    <table><thead><tr>{[kk ? "Көрсеткіш" : "Метрика", kk ? "Ағымдағы" : "Действующая", kk ? "Сынақ" : "Пробная", kk ? "Белгіленгені" : "Размечено"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{rows.map(([label, actual, shadow, labelled]) => <tr key={label}><th scope="row">{label}</th><td>{labelled ? actual : "—"}</td><td>{labelled ? shadow : "—"}</td><td>{labelled}</td></tr>)}</tbody></table>
    <p>{kk ? "Нәтижелер жабылған істер бойынша есептеледі. Бұл салыстыру ақша қозғалысына әсер етпейді." : "Метки берутся из закрытых дел. Переводы с неизвестным или спорным исходом исключены из оценки качества. Сравнение не меняет движение денег."}</p>
  </details>;
}
