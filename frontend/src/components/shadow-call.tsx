"use client";

import type { ShadowCall } from "@/lib/contracts";
import { useLocale } from "@/lib/i18n";
import styles from "./model-trial.module.css";

export function ShadowCallPanel({ observation }: { observation: ShadowCall }) {
  const { lang } = useLocale();
  const kk = lang === "kk";
  const value = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
  return <section className={styles.observer}>
    <h3>{kk ? "Сынақ моделінің бағасы" : "Оценка экспериментальной модели"}</h3>
    <p><strong>{value.format(observation.score)} / 100</strong>{" · "}
      {kk ? "Тексеру шегі" : "Порог проверки"} {value.format(observation.review_threshold)}</p>
    <p>{observation.review_suggested
      ? (kk ? "Модель қосымша тексеруді ұсынады." : "Модель предлагает дополнительную проверку.")
      : (kk ? "Модель қосымша тексеруді ұсынған жоқ." : "Модель не запрашивает дополнительную проверку.")}{" "}
      {kk ? "Аударым туралы шешімді қолданыстағы жүйе қабылдады." : "Решение по переводу приняла действующая система."}</p>
    <details><summary>{kk ? "Бағаға әсер еткен белгілер" : "Какие признаки повлияли на оценку"}</summary>
      <ul>{observation.contributors.map(item => <li key={item.feature}>
        {kk ? item.label_kk : item.label_ru} <b>{item.contribution > 0 ? "+" : ""}{value.format(item.contribution)}</b>
      </li>)}</ul><small>{observation.model_version}</small>
    </details>
  </section>;
}
