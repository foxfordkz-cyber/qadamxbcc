"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Clock3, GitCompareArrows } from "lucide-react";
import { accounts, collectionReplay, readReplaySelection, type ReplayAccount, type ReplaySnapshot } from "@/lib/collection-replay";
import { money, useLocale } from "@/lib/i18n";
import { Badge } from "./risk";
import styles from "./collection-comparison.module.css";

const last = collectionReplay.checkpoints.length - 1;

function SnapshotCard({ account, snapshot, index, inspect = false }: {
  account: ReplayAccount; snapshot: ReplaySnapshot; index: number; inspect?: boolean;
}) {
  const { lang } = useLocale();
  const kk = lang === "kk";
  const title = kk ? `${account.toUpperCase()} шоты` : `Счёт ${account.toUpperCase()}`;
  return <article className={styles.account} aria-label={title}>
    <div className={styles.top}><h3>{title}</h3><Badge status={snapshot.decision} /></div>
    <dl className={styles.facts}>
      <div><dt>{kk ? "Жіберушілер" : "Отправители"}</dt><dd>{snapshot.senders}</dd></div>
      <div><dt>{kk ? "Түскен қаражат" : "Поступило"}</dt><dd>{money(snapshot.received, lang)}</dd></div>
      <div><dt>{kk ? "Әрі қарай аударылды" : "Переведено дальше"}</dt><dd>{money(snapshot.forwarded, lang)}</dd></div>
      <div><dt>{kk ? "Келесі аударым тәуекелі" : "Риск следующего перевода"}</dt><dd>{snapshot.score} / 100</dd></div>
    </dl>
    {inspect ? <>
      <h3>{kk ? "Шешімнің себептері" : "Основания решения"}</h3>
      {snapshot.signals.length ? <ul className={styles.reasons}>{snapshot.signals.map(signal => <li key={signal.code}>{signal[lang]}</li>)}</ul>
        : <p>{kk ? "Осы сәтте тәуекел белгісі анықталмады." : "На этот момент признаков риска не обнаружено."}</p>}
    </> : <Link className={styles.link} href={{ pathname: "/soc", query: { comparison: `${account}-${index + 1}` }, hash: "collection-inspector" }}>
      {kk ? "Шешімді SOC панелінде ашу" : "Разобрать решение в SOC"}<ArrowRight size={15} aria-hidden="true" />
    </Link>}
  </article>;
}

export function CollectionComparison() {
  const [index, setIndex] = useState(0);
  const { lang } = useLocale();
  const kk = lang === "kk";
  const checkpoint = collectionReplay.checkpoints[index];
  const amount = money(collectionReplay.payment, lang);
  return <details className={styles.panel} id="collection-comparison">
    <summary><GitCompareArrows size={20} aria-hidden="true" />{kk ? "Ортақ жинақ пен транзиттік шотты салыстыру" : "Сравнить честный сбор и дроп-счёт"}</summary>
    <div className={styles.body}>
      <p>{kk ? `Екі шотқа бір уақытта бірдей сомалар түседі. Әр қадамда жүйе бірінші жіберуші осы шоттардың әрқайсысына тағы ${amount} аударса, қандай шешім қабылданатынын көрсетеді. Есеп оқу операцияларына негізделген.` :
        `Два счёта получают одинаковые суммы в одно время. На каждом шаге движок оценивает, что произойдёт, если первый отправитель переведёт каждому получателю ещё ${amount}. Расчёт выполнен на учебных операциях.`}</p>
      <div className={styles.controls}>
        <button type="button" className="secondary" disabled={index === 0} onClick={() => setIndex(index - 1)}><ArrowLeft size={16} aria-hidden="true" />{kk ? "Артқа" : "Назад"}</button>
        <span><Clock3 size={15} aria-hidden="true" /><strong>{checkpoint.time}</strong> · {index + 1} / {last + 1}</span>
        <button type="button" className="secondary" disabled={index === last} onClick={() => setIndex(index + 1)}>{kk ? "Келесі оқиға" : "Следующее событие"}<ArrowRight size={16} aria-hidden="true" /></button>
      </div>
      <div aria-live="polite" aria-atomic="true" className={styles.event}>
        {index === last
          ? (kk ? `А шотындағы ақша орнында қалды. B шотынан басқа алушыға ${money(checkpoint.b.forwarded, lang)} аударылды.` :
            `На счёте A деньги остались. Со счёта B другому получателю перевели ${money(checkpoint.b.forwarded, lang)}.`)
          : (kk ? `Екі шоттың әрқайсысына ${checkpoint.a.senders} адамнан барлығы ${money(checkpoint.a.received, lang)} түсті. Шығыс аударымы әзірге жоқ.` :
            `На каждый счёт поступило ${money(checkpoint.a.received, lang)}. Число отправителей — ${checkpoint.a.senders}. Исходящих переводов пока нет.`)}
      </div>
      <div className={styles.pair}>{accounts.map(account => <SnapshotCard key={account} index={index} account={account} snapshot={checkpoint[account]} />)}</div>
    </div>
  </details>;
}

export function CollectionReplayInspector() {
  const params = useSearchParams();
  const selection = readReplaySelection(params.get("comparison"));
  const { lang } = useLocale();
  if (!selection) return null;
  const kk = lang === "kk";
  const { account, index, checkpoint } = selection;
  const amount = money(collectionReplay.payment, lang);
  return <section id="collection-inspector" className={styles.inspector} aria-labelledby="collection-inspector-title">
    <h2 id="collection-inspector-title">{kk ? "Оқу операциясын талдау" : "Разбор учебной операции"}</h2>
    <p>{kk ? `${checkpoint.time} · Келесі ${amount} аударымның бағасы. Есеп осы сәтке дейінгі операциялар бойынша жасалды.` :
      `${checkpoint.time} · Оценка следующего перевода на ${amount} по истории, известной к этому моменту.`}</p>
    <SnapshotCard account={account} snapshot={checkpoint[account]} index={index} inspect />
    <small>{kk ? "Есептеу моделі" : "Модель расчёта"} · {collectionReplay.model}</small>
  </section>;
}
