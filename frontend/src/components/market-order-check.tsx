"use client";

import { useState } from "react";
import { useLocale } from "@/lib/i18n";
import { demoOrderPayee, marketOrders, matchMarketOrder, type OrderMatch } from "@/lib/market-order";

const verdict: Record<OrderMatch, [string, string]> = {
  match: ["Төлем алушының нөмірі мен аты тапсырыстағы деректерге сәйкес.", "Номер и имя получателя совпадают с данными заказа."],
  close: ["Нөмір сәйкес. Сатушының аты басқа әліпбимен жазылған. Тапсырыстағы атты тексеріңіз.", "Номер совпал. Имя продавца записано другим алфавитом. Сверьте написание в заказе."],
  mismatch: ["Тапсырыста басқа нөмір көрсетілген. Сатушыны тапсырыс ашылған қолданбада тексеріңіз.", "В заказе указан другой номер. Свяжитесь с продавцом через исходный заказ."],
  unavailable: ["Бұл тапсырысты немесе деректемелерді тексеру мүмкін болмады.", "Для этого заказа или типа реквизитов проверка недоступна."],
};

export function MarketOrderCheck({ phone, onEdit, disabled }: { phone: string; onEdit: () => void; disabled: boolean }) {
  const { lang } = useLocale();
  const kk = lang === "kk";
  const [reference, setReference] = useState("");
  const [checked, setChecked] = useState(false);
  const result = matchMarketOrder(reference, phone);
  const order = marketOrders.find(item => item.reference === reference);
  return <details className="market-check">
    <summary>{kk ? "Алдын ала төлем · сатушыны тексеру" : "Предоплата · сверить продавца"}</summary>
    <p>{kk ? "Оқу алаңының тапсырысындағы деректерді осы аударыммен салыстырыңыз." : "Сравните реквизиты этого перевода с заказом учебной площадки."}</p>
    <label>{kk ? "Оқу тапсырысы" : "Учебный заказ"}
      <select value={reference} disabled={disabled} onChange={event => { setReference(event.target.value); setChecked(false); }}>
        <option value="">{kk ? "Тапсырысты таңдаңыз" : "Выберите заказ"}</option>
        {marketOrders.map(item => <option key={item.reference} value={item.reference}>{item.reference} · {item.seller}</option>)}
        <option value="unknown">{kk ? "Басқа тапсырыс" : "Другой заказ"}</option>
      </select>
    </label>
    <button type="button" className="secondary" disabled={!reference || disabled} onClick={() => setChecked(true)}>{kk ? "Салыстыру" : "Сверить"}</button>
    {checked && <div role="status" data-order-result={result}>
      <strong>{verdict[result][kk ? 0 : 1]}</strong>
      {order && result === "close" && <p>{order.seller} / {demoOrderPayee(order.destination)}</p>}
      <p>{kk ? "Сатып алушының қорғалуы мен тауардың жеткізілуін сауда алаңынан тексеріңіз." : "Условия защиты покупателя и доставки уточните на площадке."}</p>
      <button className="secondary" type="button" disabled={disabled} onClick={onEdit}>{kk ? "Деректемелерге оралу" : "Вернуться к реквизитам"}</button>
    </div>}
  </details>;
}
