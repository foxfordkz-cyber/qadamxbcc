"use client";

import { useState } from "react";
import { money, useLocale } from "@/lib/i18n";
import samples from "@/lib/scenario-details.json";
import { estimatePolicy } from "@/lib/scenario-policy";
import styles from "./scenario-policy.module.css";

export function ScenarioPolicy() {
  const { lang } = useLocale();
  const kk = lang === "kk";
  const [threshold, setThreshold] = useState<number | null>(null);
  const current = estimatePolicy(samples, null);
  const chosen = estimatePolicy(samples, threshold);
  const totals = [
    [kk ? "Өткізіп алған алаяқтық" : "Пропущенные мошеннические переводы",
      chosen.missedTiyn, current.missedTiyn, chosen.missed],
    [kk ? "Кідіртілген адал төлемдер" : "Задержанные честные платежи",
      chosen.honestHeldTiyn, current.honestHeldTiyn, chosen.honestHeld],
  ] as const;
  return <section id="risk-policy" className={styles.panel}>
    <h3>{kk ? "Шекті өзгертсек, не болады?" : "Что изменится при другом пороге?"}</h3>
    <p>{kk ? "120 оқу аударымының бастапқы бағалары бойынша есеп. Таңдалған шек бұрын мақұлданған төлемдерді ғана қосымша кідіртеді."
      : "Расчёт по исходным оценкам 120 учебных переводов. Выбранный порог добавляет паузу только к ранее одобренным платежам."}</p>
    <label>{kk ? "Қосымша кідіріс шегі" : "Порог дополнительной паузы"}
      <select value={threshold ?? ""} onChange={e => setThreshold(e.target.value ? Number(e.target.value) : null)}>
        <option value="">{kk ? "Қолданыстағы шешімдер" : "Исходные решения"}</option>
        {[25, 30, 35, 40].map(score => <option key={score} value={score}>≥ {score} / 100</option>)}
      </select>
    </label>
    <div className={styles.totals} aria-live="polite">
      {totals.map(([label, tiyn, base, count]) => <div key={label}>
        <span>{label}</span><strong>{money(tiyn / 100, lang)}</strong>
        <small>{count} {kk ? "аударым" : "операц."}{threshold !== null && " · " +
          (kk ? "бастапқысы " : "исходно ") + money(base / 100, lang)}</small>
      </div>)}
    </div>
  </section>;
}
