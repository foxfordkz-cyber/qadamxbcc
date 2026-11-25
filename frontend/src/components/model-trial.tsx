"use client";

import { useState } from "react";
import { money, useLocale } from "@/lib/i18n";
import trial from "@/lib/familiar-call-trial.json";
import wallets from "@/lib/connected-wallet.json";
import { ShadowCallPanel } from "./shadow-call";
import styles from "./model-trial.module.css";

const sets = ["fresh", "missing", "historical"] as const;
type Cohort = typeof sets[number];

export function ModelTrial() {
  const { lang, t } = useLocale();
  const kk = lang === "kk";
  const [selected, select] = useState<Cohort>("fresh");
  const { size, baseline, candidate } = trial.cohorts[selected];
  const format = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
  const titles = kk
    ? { fresh: "Жаңа аударымдар", missing: "Дерегі толық емес", historical: "Бұрынғы сынақ" }
    : { fresh: "Новые переводы", missing: "Часть данных отсутствует", historical: "Прежняя выборка" };
  const fraud = baseline.caught + baseline.missed;
  const honest = baseline.false_pauses + baseline.honest_approved;
  return <section id="model-trial" className={styles.panel} aria-labelledby="model-trial-title">
    <h3 id="model-trial-title">{kk ? "Қоңырау кезінде таныс адамға аудару" : "Перевод знакомому во время звонка"}</h3>
    <p>{kk
      ? "Екі модель бірдей оқу аударымдарын бағалады. Мақсат — қысыммен жасалған төлемді тоқтатып, өз еркімен төлеген адамды азырақ кідірту."
      : "Две модели оценили одни и те же учебные переводы. Цель — заметить давление и реже задерживать человека, который платит по своей воле."}</p>
    <label className={styles.select}>{kk ? "Сынақ жиыны" : "Набор для проверки"}
      <select value={selected} onChange={event => select(event.target.value as Cohort)}>
        {sets.map(key => <option key={key} value={key}>{titles[key]}</option>)}
      </select>
    </label>
    <div aria-live="polite" aria-atomic="true" className={styles.result}>
      <table>
        <caption>{kk ? `${format.format(size)} синтетикалық аударым` : `Синтетические переводы · ${format.format(size)}`}</caption>
        <thead><tr><th scope="col">{kk ? "Шешім" : "Результат"}</th><th scope="col">{kk ? "Бұрынғы модель" : "Прежняя модель"}</th>
          <th scope="col">{kk ? "Жаңа модель" : "Новая модель"}</th></tr></thead>
        <tbody>
          <tr><th scope="row">{kk ? "Тоқтатылған алаяқтық" : "Мошеннические переводы на паузе"}</th>
            <td>{baseline.caught} / {fraud}</td><td>{candidate.caught} / {fraud}</td></tr>
          <tr><th scope="row">{kk ? "Адал төлемдегі артық кідіріс" : "Лишние паузы у честных клиентов"}</th>
            <td>{baseline.false_pauses} / {honest}</td><td>{candidate.false_pauses} / {honest}</td></tr>
        </tbody>
      </table>
    </div>
    <p className={styles.note}>{kk
      ? `Қоңыраусыз тексерілген аударымдар саны — ${format.format(trial.no_call_controls.size)}. Бағасы өзгергені — ${trial.no_call_controls.changed_predictions}. Енгізу белгілері бірдей болса, адамның ниетін тек сол деректен ажырату мүмкін емес. Нақты банк деректерімен сынақ әлі алда.`
      : `Проверено переводов без звонка — ${format.format(trial.no_call_controls.size)}. Изменившихся оценок — ${trial.no_call_controls.changed_predictions}. Если признаки ввода совпадают, по ним одним нельзя различить намерения людей. Проверка на банковских данных ещё впереди.`}</p>
    <strong className={styles.verdict}>{kk
      ? "Жаңа модельдің бағасын қызметкер көреді. Аударым туралы шешімді қолданыстағы жүйе қабылдайды."
      : "Сотрудник видит оценку новой модели. Решение по переводу принимает действующая система."}</strong>
    <details className={styles.example}>
      <summary>{kk ? "Бір аударымды қарау" : "Разобрать один перевод"}</summary>
      <p>{kk ? "Оқу мысалы. Клиент қоңырау кезінде таныс алушыға ақша жібереді."
        : "Учебный пример. Клиент переводит деньги знакомому во время звонка."}</p>
      <p><strong>{money(trial.example.amount, lang)}</strong>{" · "}
        {t(trial.example.incumbent_status === "approved" ? "approved" : trial.example.incumbent_status === "blocked" ? "blocked" : "cooling_off")}</p>
      <p>{kk ? "Қолданыстағы модельдің бағасы" : "Оценка действующей модели"}{" "}
        <b>{format.format(trial.example.incumbent_score)} / 100</b></p>
      <p>{kk
        ? `Модель ережелер бойынша есептелген бағаға ${trial.example.ml_uplift} ұпай қосты. Жалпы тәуекел — ${trial.example.incumbent_risk} / 100. Тексеру үшін кідіріс ${trial.example.pause_floor} ұпайдан басталады.`
        : `Модель добавила ${trial.example.ml_uplift} баллов к оценке по правилам. Итоговый риск — ${trial.example.incumbent_risk} / 100. Пауза для проверки начинается с ${trial.example.pause_floor} баллов.`}</p>
      <ShadowCallPanel observation={{
        model_version: trial.candidate_version, score: trial.example.candidate_score,
        review_threshold: trial.threshold, review_suggested: trial.example.candidate_suggests_review,
        contributors: trial.example.contributors,
      }} />
    </details>
    <a className={styles.verdict} href={new URL("jury/trial", wallets.juryUrl).href}>
      {kk ? "Өз CSV файлыңызды тексеру →" : "Проверить свой CSV в комнате жюри →"}
    </a>
  </section>;
}
