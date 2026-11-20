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

const groups = [
  ["bank", "police", "reserve", "invest", "relative", "market", "loan", "hub"],
  ["family", "seller", "purchase", "savings", "friend", "collection"],
] as const satisfies readonly (readonly (keyof typeof results)[])[];

function counts(keys: readonly (keyof typeof results)[]) {
  let total = 0;
  let heldOrBlocked = 0;
  for (const key of keys) {
    const { approved, cooling_off, blocked } = results[key];
    total += approved + cooling_off + blocked;
    heldOrBlocked += cooling_off + blocked;
  }
  return { total, heldOrBlocked };
}

export function ScenarioResults() {
  const { lang } = useLocale();
  const kk = lang === "kk";
  const scams = counts(groups[0]);
  const honest = counts(groups[1]);
  return <details className="panel scenario-results">
    <summary>{kk ? "Антифродты тексеру · 120 синтетикалық аударым" : "Проверка антифрода · 120 синтетических переводов"}</summary>
    <p>{kk
      ? `Жүйе ${scams.heldOrBlocked} алаяқтық аударымды тоқтатты (барлығы ${scams.total}). ${honest.total} адал аударым бойынша ${honest.heldOrBlocked} жалған дабыл тіркелді.`
      : `Система остановила ${scams.heldOrBlocked} из ${scams.total} мошеннических переводов. Ложные тревоги возникли в ${honest.heldOrBlocked} случаях из ${honest.total} честных переводов.`}</p>
    <table><thead><tr>
      <th scope="col">{kk ? "Сценарий" : "Сценарий"}</th>
      <th scope="col">{kk ? "Мақұлдау" : "Одобрено"}</th>
      <th scope="col">{kk ? "Кідіріс" : "Пауза"}</th>
      <th scope="col">{kk ? "Бұғаттау" : "Блок"}</th>
    </tr></thead>
    {groups.map((group, i) =>
      <tbody key={group[0]}><tr><th colSpan={4} scope="rowgroup">{i === 0 ? (kk ? "Алаяқтық" : "Мошеннические переводы") : (kk ? "Адал аударымдар" : "Честные переводы")}</th></tr>
        {group.map(key => <tr key={key}><th scope="row">{labels[key][kk ? 0 : 1]}</th><td>{results[key].approved}</td><td>{results[key].cooling_off}</td><td>{results[key].blocked}</td></tr>)}
      </tbody>)}</table>
  </details>;
}
