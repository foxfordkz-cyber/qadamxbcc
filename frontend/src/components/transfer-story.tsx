"use client";

import { useState } from "react";
import { History, LockKeyhole, Radio, ShieldCheck, Smartphone, UsersRound } from "lucide-react";
import { money, useLocale } from "@/lib/i18n";
import type { Evaluation } from "@/lib/contracts";
import { rehearsalStory, selectedStory, type PrivateStory, type StoryRole } from "@/lib/transfer-story";
import { storyLabel } from "@/lib/transfer-story-copy";
import { useSocPoll } from "./use-soc-poll";
import styles from "./transfer-story.module.css";

const icons = { customer: Smartphone, guardian: UsersRound, soc: ShieldCheck };
const roles: StoryRole[] = ["customer", "guardian", "soc"];

export function TransferStory({ detail, privateAccess, revision }: {
  detail: Evaluation | null; privateAccess: boolean; revision: number;
}) {
  const { lang } = useLocale();
  const [example, setReplay] = useState(false);
  const text = (ru: string, kk: string) => lang === "kk" ? kk : ru;
  const path = !example && privateAccess && detail ? `integrations/soc/transactions/${detail.transaction_id}/story` : null;
  const snapshot = useSocPoll<PrivateStory>(path, revision, 30_000);
  const internal = path && !snapshot.error && detail && snapshot.data?.transaction_id === detail.transaction_id ? snapshot.data : null;
  const steps = example ? rehearsalStory.steps : detail ? selectedStory(detail, internal) : [];
  const reference = example ? rehearsalStory : detail;
  const formatter = new Intl.DateTimeFormat(lang === "kk" ? "kk-KZ" : "ru-KZ", {
    timeZone: "Asia/Qyzylorda", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const roleSummary = (role: StoryRole) => {
    if (!reference) return "—";
    if (role === "customer") return text("Решение по переводу", "Аударым бойынша шешім");
    if (!example && !privateAccess) return role === "guardian" ? text("Личный канал", "Жеке арна") : text("Перевод виден в ленте", "Аударым таспада көрінеді");
    if (!example && !internal) return snapshot.error ? text("Журнал недоступен", "Журнал қолжетімсіз") : text("Загрузка журнала", "Журнал жүктелуде");
    return steps.some(step => step.role === role)
      ? (role === "guardian" ? text("Журнал уведомлений", "Хабарламалар журналы") : text("Журнал дела", "Іс журналы"))
      : text("События не зарегистрированы", "Оқиғалар тіркелмеген");
  };
  return <section className={`panel ${styles.story}`} aria-labelledby="story-title" data-testid="transfer-story">
    <div className={styles.header}><div><h2 id="story-title"><History size={20} />{text("Один перевод — три роли", "Бір аударым — үш рөл")}</h2>
      <p className="muted">{text("Как связаны решение по переводу, ответ близкого и работа SOC.", "Аударым бойынша шешім, жақын адамның жауабы және SOC жұмысы қалай байланысқанын көріңіз.")}</p></div>
      <div className="segmented" role="group" aria-label={text("Источник истории", "Оқиғалар дереккөзі")}>
        <button type="button" aria-pressed={!example} onClick={() => setReplay(false)}>{text("Из ленты", "Таспадан")}</button>
        <button type="button" aria-pressed={example} onClick={() => setReplay(true)}>{text("Запись репетиции", "Дайындық жазбасы")}</button>
      </div></div>
    <div className={styles.roles}>{roles.map(role => {
      const Icon = icons[role];
      return <div key={role} className={styles.role}><Icon size={19} /><div><strong>{storyLabel(role, lang)}</strong><small>{roleSummary(role)}</small></div></div>;
    })}</div>
    <p className={styles.scope}>{example ? <History size={15} /> : privateAccess ? <Radio size={15} /> : <LockKeyhole size={15} />}
      {example ? text("Запись синтетического прогона с имитатором Telegram. Все события ниже относятся к этой записи.", "Telegram имитаторымен жасалған сынақ жазбасы. Төмендегі оқиғалар осы сынаққа қатысты.")
        : !detail ? text("Выберите перевод в ленте или откройте запись репетиции.", "Таспадан аударымды таңдаңыз немесе дайындық жазбасын ашыңыз.")
        : privateAccess ? text("Сохранённые события выбранного перевода.", "Таңдалған аударымның сақталған оқиғалары.")
        : text("Открытая лента показывает решение по переводу. Журналы контакта и сотрудников доступны в служебной панели.", "Ашық таспада аударым бойынша шешім көрсетіледі. Сенімді адам мен қызметкерлердің журналдары қызметтік панельде ашылады.")}</p>
    {reference && <div className={styles.reference}><span>#{reference.transaction_id.slice(0, 8)}</span>
      <span>{text("Оценка риска", "Тәуекел бағасы")} <b>{reference.risk_score}/100</b></span>
      {reference.amount != null && <strong>{money(reference.amount, lang)}</strong>}</div>}
    <ol className={styles.events}>{steps.map((event, index) => <li key={`${event.role}-${event.code}-${index}`}>
      <time dateTime={event.timestamp ?? undefined} title={event.timestamp ?? undefined}>{event.timestamp ? formatter.format(new Date(event.timestamp)) : text("Время не записано", "Уақыт жазылмаған")}</time>
      <span className={`${styles.badge} ${styles[event.role]}`}>{storyLabel(event.role, lang)}</span>
      <div>{storyLabel(event.code, lang)}{event.code === "NOTIFICATION_SENT" && <small>{text("Получение подтверждается отдельным ответом контакта.", "Хабарламаны алғанын сенімді адам бөлек жауаппен растайды.")}</small>}</div>
    </li>)}</ol>
    {!example && internal?.truncated && <small>{text("Показаны последние 40 служебных событий.", "Соңғы 40 қызметтік оқиға көрсетілді.")}</small>}
  </section>;
}
