"use client";

import { useLocale } from "@/lib/i18n";
import results from "@/lib/scenario-summary.json";

const labels: Record<keyof typeof results, [string, string]> = {
  bank: ["Банктің қауіпсіздік қызметі", "Звонок от службы безопасности"],
  police: ["Полиция атынан қоңырау", "Звонок от имени полиции"],
  reserve: ["«Қауіпсіз шот»", "«Безопасный счёт»"],
  invest: ["Жалған брокер", "Ложный брокер"],
  relative: ["Туысқа шұғыл көмек", "Срочная помощь родственнику"],
  market: ["Жалған сатушыға алдын ала төлем", "Предоплата ложному продавцу"],
  loan: ["Телефонмен нұсқау алып несие рәсімдеу", "Кредит под диктовку"],
  hub: ["Дроп-шотқа аударым", "Транзитный дроп-счёт"],
  family: ["Отбасына тұрақты көмек", "Регулярная помощь семье"],
  seller: ["Қоңырау кезінде таныс сатушыға төлеу", "Оплата знакомому продавцу во время звонка"],
  purchase: ["Жоспарланған ірі сатып алу", "Крупная плановая покупка"],
  savings: ["Депозиттен өз картасына аудару", "Пополнение своей карты с депозита"],
  friend: ["Досқа алғашқы аударым", "Первый перевод другу"],
  collection: ["Ортақ мақсатқа ақша жинау", "Общий сбор без вывода денег"],
};

export function ScenarioResults() {
  const { lang } = useLocale();
  const kk = lang === "kk";
  return <details className="panel scenario-results">
    <summary>{kk ? "Антифродты тексеру · 120 синтетикалық аударым" : "Проверка антифрода · 120 синтетических переводов"}</summary>
    <p>{kk ? "60 алаяқтық сценарийіндегі мақұлдау — өткізіп алған жағдай. 60 адал аударымдағы кідіріс немесе бұғаттау — жалған дабыл."
      : "Для 60 мошеннических сценариев одобрение означает пропуск. Для 60 честных переводов пауза или блокировка означает ложную тревогу."}</p>
    <table><thead><tr>
      <th scope="col">{kk ? "Сценарий" : "Сценарий"}</th>
      <th scope="col">{kk ? "Мақұлдау" : "Одобрено"}</th>
      <th scope="col">{kk ? "Кідіріс" : "Пауза"}</th>
      <th scope="col">{kk ? "Бұғаттау" : "Блок"}</th>
    </tr></thead>
    {[["bank","police","reserve","invest","relative","market","loan","hub"], ["family","seller","purchase","savings","friend","collection"]].map((group, i) =>
      <tbody key={group[0]}><tr><th colSpan={4} scope="rowgroup">{i === 0 ? (kk ? "Алаяқтық" : "Мошеннические переводы") : (kk ? "Адал аударымдар" : "Честные переводы")}</th></tr>
        {(group as (keyof typeof results)[]).map(key => <tr key={key}><th scope="row">{labels[key][kk ? 0 : 1]}</th><td>{results[key].approved}</td><td>{results[key].cooling_off}</td><td>{results[key].blocked}</td></tr>)}
      </tbody>)}</table>
  </details>;
}
