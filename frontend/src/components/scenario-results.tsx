"use client";

import { money, useLocale } from "@/lib/i18n";
import samples from "@/lib/scenario-details.json";
import signalNames from "@/lib/scenario-signals.json";
import results from "@/lib/scenario-summary.json";
import postCallReplay from "@/lib/post-call-replay.json";

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
  return <details id="scenario-results" className="panel scenario-results">
    <summary>{kk ? "Антифродты тексеру · 120 синтетикалық аударым" : "Проверка антифрода · 120 синтетических переводов"}</summary>
    <p>{kk
      ? `Жүйе ${scams.heldOrBlocked} алаяқтық аударымды тоқтатты (барлығы ${scams.total}). ${honest.total} адал аударым бойынша ${honest.heldOrBlocked} жалған дабыл тіркелді.`
      : `Система остановила ${scams.heldOrBlocked} из ${scams.total} мошеннических переводов. Ложные тревоги возникли в ${honest.heldOrBlocked} случаях из ${honest.total} честных переводов.`}</p>
    {[
      {label: kk ? "Тоқтатылған алаяқтық" : "Мошеннические переводы на паузе или в блоке", items: samples.filter(r => r.fraud && r.decision !== "approved")},
      {label: kk ? "Өтіп кеткен алаяқтық" : "Пропущенное мошенничество", items: samples.filter(r => r.fraud && r.decision === "approved")},
      {label: kk ? "Артық кідірген қалыпты төлемдер" : "Лишние задержки обычных платежей", items: samples.filter(r => !r.fraud && r.decision !== "approved")},
    ].map(({label, items}) => <details key={label}>
      <summary><strong>{items.length}</strong> · {label}</summary>
      <ul>{items.map(r => <li key={r.id}><b>{r.id}</b> · {labels[r.story as keyof typeof labels][kk ? 0 : 1]} ·
        {" "}{r.decision === "approved" ? (kk ? "Мақұлданды" : "Одобрено") : r.decision === "blocked" ? (kk ? "Бұғатталды" : "Блокировка") : (kk ? "Кідіріс" : "Пауза")}
        <small>{r.signals.map(code => signalNames[code as keyof typeof signalNames]?.[kk ? 0 : 1] ?? code).join(" · ") || (kk ? "Белгі анықталмады" : "Признаков не выявлено")}</small>
      </li>)}</ul>
    </details>)}
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
    <h3>{kk ? "Қоңыраудан кейінгі төрт аударымды қайта тексеру" : "Повторная проверка четырёх переводов после звонка"}</h3>
    <p>{kk ? "«Сол деректер» бағанында бастапқы сұрау өзгеріссіз қалды. Соңғы бағанда клиент дәл осы аударымды телефон арқылы сұрағанын хабарлады."
      : "В колонке «Те же данные» повторён исходный запрос. В последней колонке клиент сообщил, что в завершившемся звонке его попросили сделать именно этот перевод."}</p>
    <table className="post-call-replay"><thead><tr>
      <th scope="col">{kk ? "Операция" : "Операция"}</th><th scope="col">{kk ? "Бұрын" : "Раньше"}</th>
      <th scope="col">{kk ? "Сол деректер" : "Те же данные"}</th><th scope="col">{kk ? "Клиент хабарлады" : "Клиент сообщил"}</th>
    </tr></thead><tbody>{postCallReplay.map(row => <tr key={row.id}>
      <th scope="row">{row.id.startsWith("relative") ? (kk ? "Туысқа" : "Родственнику") : (kk ? "Алдын ала төлем" : "Предоплата")}<small>{money(row.amount, lang)}</small></th>
      {[row.baseline, row.unchanged, row.reported].map((result, index) => <td key={index}>
        <b>{result.score}</b><small>{result.decision === "cooling_off" ? (kk ? "Кідіріс" : "Пауза") : (kk ? "Мақұл" : "Одобрено")}</small>
      </td>)}
    </tr>)}</tbody></table>
  </details>;
}
