"use client";

import { useState } from "react";
import { useLocale } from "@/lib/i18n";
import trial from "@/lib/settlement-trial.json";
import styles from "./model-trial.module.css";

const modes = {
  valid: ["Действующее подтверждение", "Жарамды растау"],
  expired: ["Срок истёк", "Мерзімі өткен"],
  revoked: ["Подтверждение отозвано", "Растау кері қайтарылған"],
  future: ["Получено после решения", "Шешімнен кейін алынған"],
  mismatch: ["В подтверждении другой получатель", "Растауда басқа алушы көрсетілген"],
  flagged: ["На счёте есть отдельная отметка SOC", "Шотта SOC-тың бөлек белгісі бар"],
} as const;
type Mode = keyof typeof modes;

export function SettlementTrial() {
  const { lang, t } = useLocale();
  const kk = lang === "kk";
  const [mode, setMode] = useState<Mode>("valid");
  const sample = trial.examples[mode];
  const { observed, contextual } = trial.cohort;
  const time = (date: string) => new Intl.DateTimeFormat(kk ? "kk-KZ" : "ru-KZ", {
    timeZone: "Asia/Almaty", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(new Date(date));
  const status = (key: string) => t(key === "approved" ? "approved" : key === "blocked" ? "blocked" : "cooling_off");
  return <section className={styles.panel} id="settlement-proof" aria-labelledby="settlement-title">
    <h3 id="settlement-title">{kk ? "Жинақтың заңды төлемін қалай танимыз?" : "Как распознать выплату из честного сбора?"}</h3>
    <p>{kk ? "12 адам 15 000 ₸-ден жинады. Ұйымдастырушы жеткізушіге 162 000 ₸ төледі. Оқу клиринг тізілімінің дерегі осы төлемнің нөмірі, тараптары, валютасы мен сомасын растауы мүмкін."
      : "12 человек внесли по 15 000 ₸. Организатор заплатил поставщику 162 000 ₸. Учебный клиринговый реестр может подтвердить номер, стороны, валюту и сумму этой конкретной выплаты."}</p>
    <label className={styles.select}>{kk ? "Шешім кезіндегі дерек" : "Что известно на момент оценки"}
      <select value={mode} onChange={e => setMode(e.target.value as Mode)}>
        {(Object.keys(modes) as Mode[]).map(key => <option key={key} value={key}>{modes[key][kk ? 1 : 0]}</option>)}
      </select>
    </label>
    <div aria-live="polite" aria-atomic="true" className={styles.result}>
      <p>{kk ? "Алматы уақыты. Растау алынды" : "Время Алматы. Подтверждение получено"} {time(sample.received_at)} · {kk ? "мерзімі" : "истекает"} {time(sample.expires_at)}
        {sample.revoked_at && <> · {kk ? "кері қайтарылды" : "отозвано"} {time(sample.revoked_at)}</>} · {kk ? "шешім" : "решение"} {time(trial.as_of)}</p>
      <table>
        <caption>{kk ? "Осы шотқа келесі аударым" : "Следующий перевод на счёт сбора"}</caption>
        <thead><tr><th scope="col">{kk ? "Есептеу тәсілі" : "Вариант оценки"}</th><th scope="col">{kk ? "Тәуекел" : "Риск"}</th><th scope="col">{kk ? "Шешім" : "Решение"}</th></tr></thead>
        <tbody>{(["observed", "contextual"] as const).map(key => <tr key={key}>
          <th scope="row">{key === "observed" ? (kk ? "Тек аударымдар" : "Только проводки") : (kk ? "Реестрді ескере отырып" : "С учётом реестра")}</th>
          <td>{sample[key].score} / 100</td><td>{status(sample[key].decision)}</td>
        </tr>)}</tbody>
      </table>
      <p>{mode === "valid" ? (kk ? "Реестр жеткізушіге төлемді уақытында растады. Қайта есептегенде осы төлемнің мақсаты ескерілді." : "Реестр вовремя подтвердил выплату поставщику. При пересчёте учтено назначение этой проводки.")
        : mode === "flagged" ? (kk ? "Төлем расталғанымен, SOC белгісі бұғаттауды сақтайды." : "Выплата подтверждена. Отдельная отметка сотрудника сохраняет блокировку.")
        : (kk ? "Осы сәтте бұл құжат төлемді растамайды. Бастапқы шешім сақталды." : "На момент оценки этот документ не подтверждает выплату. Исходное решение сохранено.")}</p>
    </div>
    <p className={styles.note}>{kk
      ? `Жеке оқу сынағында: ${observed.honest} адал жинақтың ${observed.false_pauses}-сі кідірген, реестрмен — ${contextual.false_pauses}. Екі нұсқа да ${observed.fraud} күмәнді шоттың ${contextual.caught}-ін тоқтатты. Сынақтағы растаулар жасанды.`
      : `Отдельная учебная проверка: из ${observed.honest} честных сборов задержано ${observed.false_pauses}, с реестром — ${contextual.false_pauses}. Среди ${observed.fraud} мошеннических сетей вмешательств до и после — ${observed.caught} и ${contextual.caught}. Подтверждения реестра смоделированы.`}</p>
  </section>;
}
