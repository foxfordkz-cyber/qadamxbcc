"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, BrainCircuit, Check, ChevronDown, Clock3, ExternalLink, Fingerprint, Maximize2, Network, Pause, Play, RotateCcw, ShieldCheck, ShieldX } from "lucide-react";
import content from "@/content/pitch.json";
import { LocaleProvider, money, useLocale } from "@/lib/i18n";
import { assumptionLimits, pilotDefaults, pilotEconomics, type PilotAssumptions } from "@/lib/pitch-math";
import "./pitch.css";

type Pair = readonly [string, string];
const labels = {
  back: ["Симулятор", "Симулятор"], title: ["Жобаны қорғау", "Защита проекта"], slides: ["Таныстырылым", "Презентация"], demo: ["3 минуттық демо", "Демо за 3 минуты"], economics: ["Пилот экономикасы", "Экономика пилота"], questions: ["Қазылар сұрақтары", "Вопросы жюри"],
  notes: ["Сөйлеуші жазбалары", "Заметки выступающего"], next: ["Келесі слайд", "Следующий слайд"], previous: ["Алдыңғы слайд", "Предыдущий слайд"], fullscreen: ["Толық экран", "Полный экран"], timer: ["5 минуттық репетиция", "Репетиция на 5 минут"], start: ["Бастау", "Начать"], pause: ["Кідірту", "Пауза"], reset: ["Қайта бастау", "Сбросить"], language: ["Тіл", "Язык"],
  format: ["5 минут таныстырылым · 3 минут демо · 2 минут сұрақтар — репетиция жоспары, расталған регламент емес.", "5 минут питч · 3 минуты демо · 2 минуты вопросы — план репетиции, не подтверждённый регламент."],
  disclaimer: ["Оқу прототипі · Синтетикалық деректер · Банк төлемдерін орындамайды", "Учебный прототип · Синтетические данные · Банковские платежи не исполняются"],
  openDemo: ["Демоны жаңа терезеде ашу", "Открыть демо в новой вкладке"], source: ["Дереккөз", "Источник"], minutes: ["мин", "мин"],
  assumed: ["Болжамдар мысалы. BCC деректері де, экономикалық тиімділікке уәде де емес.", "Пример предположений. Это не данные BCC и не обещание экономического эффекта."],
  transfers: ["Жылдық аударым саны", "Переводов в год"], fraudRatePct: ["Алаяқтық үлесі, %", "Доля мошенничества, %"], baselineCapturePct: ["Baseline анықтауы, %", "Выявление baseline, %"], additionalCapturePct: ["Қалған жағдайларды қосымша анықтау, %", "Дополнительное выявление пропусков, %"], averageLoss: ["Бір жағдайдағы шығын, ₸", "Ущерб на случай, ₸"], extraHoldPct: ["Қалыпты аударымдардың артық кідірісі, %", "Лишние задержки обычных переводов, %"], reviewCost: ["Бір тексеру құны, ₸", "Стоимость одной проверки, ₸"], annualCost: ["Жүйенің жылдық құны, ₸", "Годовая стоимость системы, ₸"],
  gross: ["Қосымша қорғаудың жалпы сомасы", "Потенциально защищённая сумма"], cost: ["Жылдық жиынтық шығын", "Суммарные годовые затраты"], net: ["Модельдік таза нәтиже", "Чистый эффект по сценарию"], additional: ["Қосымша анықталған жағдай", "Дополнительно выявленные случаи"], reviews: ["Артық тексеру саны", "Дополнительные проверки"],
  formula: ["Аударым × fraud үлесі × (1 − baseline) × қосымша анықтау × орташа шығын. Одан қалыпты операциялардың артық тексеру құны мен жүйе шығыны шегеріледі.", "Переводы × доля fraud × (1 − baseline) × дополнительное выявление × средний ущерб. Затем вычитаются проверки обычных переводов и стоимость системы."],
  excluded: ["Мысалда әр қосымша кідіріс тексеруді қажет етеді деп алынған. Клиент уақыты, қайтарымдар және құқықтық шығындар есептелмеген. Нақты әсер банк деректерімен өлшенеді.", "В примере каждая лишняя задержка требует проверки. Время клиента, возвраты и юридические издержки не учтены. Реальный эффект измеряется на данных банка."],
  invalid: ["Барлық мәнді көрсетілген шектерде енгізіңіз.", "Введите все значения в допустимых пределах."],
} satisfies Record<string, Pair>;

const demos: { time: string; title: Pair; detail: Pair; expected: Pair }[] = [
  { time: "00:00–00:35", title: ["Қалыпты аударым", "Обычный перевод"], detail: ["Бірінші пресетті басыңыз. Шешімді, уақытты және бірегей ID-ны көрсетіңіз. ҚАЗ / РУС ауыстырыңыз.", "Нажмите первый пресет. Покажите решение, время оценки и ID. Переключите ҚАЗ / РУС."], expected: ["APPROVED · түсіндірме аударылады", "APPROVED · объяснение переводится"] },
  { time: "00:35–01:25", title: ["Қоңырау және депозит", "Звонок и депозит"], detail: ["Екінші пресетті ашыңыз. «Қауіпсіз шот» ескертуін, 15 минутты және сұрақтарды көрсетіңіз. «Аударымды тоқтату» таңдаңыз.", "Откройте второй пресет. Покажите предупреждение о «безопасном счёте», 15 минут и вопросы. Нажмите «Отменить перевод»."], expected: ["COOLING_OFF → CANCELLED · таймерді айналып өту жоқ", "COOLING_OFF → CANCELLED · таймер не обходится"] },
  { time: "01:25–02:15", title: ["Дроппер желісі", "Сеть дропперов"], detail: ["Үшінші пресет SOC-ты ашады. 12 кіріс байланысын, транзитті, ортақ құрылғыларды және ML үлестерін көрсетіңіз.", "Третий пресет открывает SOC. Покажите 12 входящих связей, транзит, общие устройства и вклады ML-признаков."], expected: ["BLOCKED · желілік дәлелдер", "BLOCKED · сетевые доказательства"] },
  { time: "02:15–03:00", title: ["Тұрақтылық және келесі қадам", "Надёжность и следующий шаг"], detail: ["Бетті жаңартыңыз: шешімдер сақталады. Қажет болса ағынды 10 секундқа қосып, қайта тоқтатыңыз. Shadow-пилотқа ұсыныспен аяқтаңыз.", "Обновите страницу: решения сохраняются. При необходимости включите поток на 10 секунд и остановите. Завершите предложением shadow-пилота."], expected: ["Бір операцияның сақталған тарихы", "Сохранённая история одной операции"] },
];
const faqs: { q: Pair; a: Pair }[] = [
  { q: ["Қоңырау шынымен анықтала ма?", "Вы действительно определяете телефонный звонок?"], a: ["Браузерде жоқ. Демо белгісі қолмен беріледі; paste және теру көрсеткіштері нақты браузер оқиғаларынан алынады. Пилотқа банк рұқсат еткен дерек көзі қажет.", "В браузере — нет. Флаг демонстрационный; вставка и ввод измеряются настоящими событиями браузера. В пилоте нужен согласованный банковский источник контекста."] },
  { q: ["Жалған блокировка қанша?", "Какой у вас false-positive rate?"], a: ["Нақты банк деректерінде әзірге өлшенбеген. Синтетикалық бағалау мен сценарийлік панель бөлек жарияланады. Нақты FPR уақыт бойынша бөлінген банк деректерінде және аналитик белгілерімен өлшенеді.", "На банковских данных пока не измерен. Синтетическая оценка и сценарийная панель публикуются отдельно. Реальный FPR измерим на временном holdout банка и разметке аналитиков."] },
  { q: ["15 минуттан соң ақша автоматты жіберіле ме?", "Через 15 минут деньги отправляются автоматически?"], a: ["Жоқ. Қайта растау және алушының жаңа тәуекелін тексеру керек. Клиент аударымды тоқтата алады. Банк шығаруды және тәуелсіз тексеру тәртібін келісуі тиіс.", "Нет. Требуются повторное подтверждение и актуальная проверка получателя. Клиент может отменить перевод. Политику выпуска и независимой проверки должен согласовать банк."] },
  { q: ["Жауаптар алаяқ айтқандай берілсе ше?", "Если мошенник подсказывает ответы на анкету?"], a: ["Сұрақтар қауіпсіздікті дәлелдемейді. Сондықтан мерзім ерте қысқармайды, ал шығарудан бұрын желілік тәуекел қайта есептеледі. Қалған тәуекелді банктің тәуелсіз тексеруі шешуі тиіс.", "Анкета не доказывает безопасность. Поэтому она не сокращает срок удержания, а перед выпуском повторно проверяется сеть. Остаточный риск требует процедуры независимой проверки банка."] },
  { q: ["ML-score — нақты ықтималдық па?", "ML-score — вероятность мошенничества?"], a: ["Жоқ. Бұл синтетикалық деректерде үйретілген модельдің бағасы. Tree-path үлестері сол бағалауды түсіндіреді; нақты ықтималдық үшін банк деректеріндегі калибрлеу қажет.", "Нет. Это выход модели, обученной на синтетических данных. Tree-path объясняет этот выход; для вероятности нужна калибровка на данных банка."] },
  { q: ["Сервер не Redis істен шықса ше?", "Что будет при сбое сервера или Redis?"], a: ["Белгісіз нәтиже жаңа аударымға жол бермейді. request_id қайталануды шектейді; outbox граф пен санағыштарды қалпына келтіреді. Бұл банк операцияларының outbox-ы емес.", "Неизвестный результат не позволяет создать новый перевод. request_id ограничивает повтор; outbox восстанавливает граф и счётчики. Это ещё не outbox банковских проводок."] },
  { q: ["Банк масштабына дайын ба?", "Это готово к банковскому масштабу?"], a: ["Әзірге жоқ: бір worker, шектелген тарих және граф. Үлкен тарих 503 береді, деректер үнсіз қысқартылмайды. HA, серверлік агрегаттар және жүктеме сынағы пилоттың міндеттері.", "Пока нет: один worker, ограниченные история и граф. При превышении — 503, данные не обрезаются молча. HA, серверные агрегаты и нагрузочный тест входят в условия пилота."] },
  { q: ["Дербес деректер туралы талаптар орындалды ма?", "Вы соответствуете требованиям к персональным данным?"], a: ["Демода тек синтетикалық деректер бар. Нақты деректер үшін банкпен құқықтық негіз, сақтау орны, мерзімі, қолжетімділік және аудит келісімі керек. Заңға толық сәйкестік расталды деп мәлімдемейміз.", "В демо используются синтетические данные. Для реальных нужны согласованные с банком основания обработки, размещение, сроки хранения, доступ и аудит. Полное юридическое соответствие не заявляем."] },
];

function Stage() {
  const { lang, setLang } = useLocale();
  const pair = (value: Pair) => value[lang === "kk" ? 0 : 1];
  const t = (key: keyof typeof labels) => pair(labels[key]);
  const [section, setSection] = useState<"slides" | "demo" | "economics" | "questions">("slides");
  const [index, setIndex] = useState(0);
  const [notes, setNotes] = useState(false);
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(300);
  const timer = useRef<{ remainingMs: number; started: number | null }>({ remainingMs: 300_000, started: null });
  const host = useRef<HTMLDivElement>(null);
  const [fullscreenError, setFullscreenError] = useState(false);
  const [assumptions, setAssumptions] = useState<Record<keyof PilotAssumptions, string>>(() => Object.fromEntries(Object.entries(pilotDefaults).map(([key, value]) => [key, String(value)])) as Record<keyof PilotAssumptions, string>);
  let economics: ReturnType<typeof pilotEconomics> | null = null;
  try {
    if (Object.values(assumptions).some(value => !value.trim())) throw new Error();
    economics = pilotEconomics(Object.fromEntries(Object.entries(assumptions).map(([key, value]) => [key, Number(value.replace(",", "."))])) as PilotAssumptions);
  } catch { /* Invalid assumptions never render stale or invented estimates. */ }
  const navigate = (step: number) => setIndex(value => Math.min(content.slides.length - 1, Math.max(0, value + step)));
  function toggleTimer() {
    if (running) {
      const elapsed = timer.current.started === null ? 0 : performance.now() - timer.current.started;
      timer.current = { remainingMs: Math.max(0, timer.current.remainingMs - elapsed), started: null };
      setSeconds(Math.ceil(timer.current.remainingMs / 1000));
      setRunning(false);
    } else if (timer.current.remainingMs > 0) {
      timer.current.started = performance.now();
      setRunning(true);
    }
  }
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const elapsed = timer.current.started === null ? 0 : performance.now() - timer.current.started;
      const left = Math.max(0, timer.current.remainingMs - elapsed);
      setSeconds(Math.ceil(left / 1000));
      if (!left) { timer.current = { remainingMs: 0, started: null }; setRunning(false); }
    }, 200);
    return () => clearInterval(id);
  }, [running]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (section !== "slides" || event.altKey || event.ctrlKey || event.metaKey || (event.target instanceof Element && event.target.closest("input,textarea,select,summary,[contenteditable=true]"))) return;
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        if (event.key === "Home") setIndex(0); else if (event.key === "End") setIndex(content.slides.length - 1); else navigate(event.key === "ArrowLeft" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", keydown); return () => window.removeEventListener("keydown", keydown);
  }, [section]);
  const slide = content.slides[index]; const copy = slide[lang];
  return <div className="pitch-app" ref={host}>
    <header className="pitch-top"><Link className="pitch-brand" href="/"><ShieldCheck size={29} /><strong>saq<span> bol</span></strong></Link><span className="pitch-top-title">{t("title")}</span><div className="language" aria-label={t("language")}>{(["kk", "ru"] as const).map(value => <button key={value} aria-pressed={lang === value} onClick={() => setLang(value)}>{value === "kk" ? "ҚАЗ" : "РУС"}</button>)}</div><Link className="pitch-demo-link" href="/" target="_blank" rel="noopener"><ExternalLink size={17} />{t("back")}</Link></header>
    <div className="pitch-workspace">
      <nav className="pitch-nav" aria-label={t("title")}>{(["slides", "demo", "economics", "questions"] as const).map(key => <button key={key} aria-pressed={section === key} className={section === key ? "active" : ""} onClick={() => setSection(key)}>{t(key)}</button>)}</nav>
      {section === "slides" && <>
        <div className="pitch-tools"><div className="pitch-clock"><Clock3 size={18} /><span>{t("timer")}</span><strong className={seconds === 0 ? "pitch-time-up" : ""} role="timer">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</strong><button aria-label={t(running ? "pause" : "start")} disabled={!seconds} onClick={toggleTimer}>{running ? <Pause size={17} /> : <Play size={17} />}</button><button aria-label={t("reset")} onClick={() => { timer.current = { remainingMs: 300_000, started: null }; setRunning(false); setSeconds(300); }}><RotateCcw size={17} /></button></div><div className="language pitch-stage-language" aria-label={t("language")}>{(["kk", "ru"] as const).map(value => <button key={value} aria-pressed={lang === value} onClick={() => setLang(value)}>{value === "kk" ? "ҚАЗ" : "РУС"}</button>)}</div><button className="pitch-text-button pitch-notes-toggle" aria-pressed={notes} onClick={() => setNotes(value => !value)}>{t("notes")}</button><button className="pitch-text-button" onClick={() => { setFullscreenError(false); const request = document.fullscreenElement ? document.exitFullscreen?.() : host.current?.requestFullscreen?.(); if (!request) setFullscreenError(true); else void request.catch(() => setFullscreenError(true)); }}><Maximize2 size={16} />{t("fullscreen")}</button></div>
        {fullscreenError && <p role="status" className="pitch-hint">{pair(["Браузер толық экранға рұқсат бермеді. Таныстырылым осы терезеде жұмыс істейді.", "Браузер не разрешил полный экран. Презентация работает в этом окне."])}</p>}
        <article className={`pitch-slide pitch-slide-${slide.kind}`} aria-label={`${index + 1} / ${content.slides.length}`}>
          <div className="pitch-slide-mark"><ShieldCheck size={22} /><span>BCC SHIELD</span><span>{String(index + 1).padStart(2, "0")} / 08</span></div>
          <h1>{copy.title}</h1><p className="pitch-lead">{copy.lead}</p>
          {slide.kind === "decisions" ? <div className="pitch-decisions">{copy.points.map((value, i) => { const Icon = [Check, Clock3, ShieldX][i]; return <div key={value}><Icon size={32} /><p>{value}</p></div>; })}</div>
            : slide.kind === "pipeline" ? <div className="pitch-pipeline">{copy.points.map((value, i) => { const Icon = [Fingerprint, Network, BrainCircuit][i]; return <div key={value}><Icon size={38} /><span>0{i + 1}</span><p>{value}</p></div>; })}</div>
            : <ol className="pitch-points">{copy.points.map((value, i) => <li key={value}><span>{String(i + 1).padStart(2, "0")}</span><p>{value}</p></li>)}</ol>}
          <div className="pitch-slide-foot"><span>{slide.source ? <a href={slide.source.url} target="_blank" rel="noopener noreferrer">{t("source")}: {slide.source.label} <ExternalLink size={12} /></a> : t("disclaimer")}</span><span>ҚАЗ / РУС</span></div>
        </article>
        <div className="pitch-slide-controls"><button disabled={!index} onClick={() => navigate(-1)} aria-label={t("previous")}><ArrowLeft size={20} /></button><div className="pitch-dots">{content.slides.map((value, i) => <button key={value.id} aria-label={`${i + 1}: ${value[lang].title}`} aria-current={i === index ? "step" : undefined} onClick={() => setIndex(i)}>{i + 1}</button>)}</div><button disabled={index === content.slides.length - 1} onClick={() => navigate(1)} aria-label={t("next")}><ArrowRight size={20} /></button></div>
        {notes && <aside className="pitch-notes"><strong>{t("notes")} · ~{slide.duration} {pair(["сек", "сек"])}</strong><p>{copy.note}</p></aside>}
        <p className="pitch-hint">{t("format")}</p>
      </>}
      {section === "demo" && <section className="pitch-section"><p className="eyebrow">BCC SHIELD / LIVE DEMO</p><h1>{t("demo")}</h1><p className="pitch-section-lead">{pair(["Үш пресет, бір тарих. Қорғау алдында жаңа репетиция ортасын тексеріңіз.", "Три пресета, одна история. Перед защитой проверьте отдельную среду репетиции."])}</p><Link className="primary" href="/" target="_blank" rel="noopener">{t("openDemo")}<ExternalLink size={17} /></Link><div className="pitch-timeline">{demos.map(item => <article key={item.time}><time>{item.time}</time><div><h2>{pair(item.title)}</h2><p>{pair(item.detail)}</p><strong>{pair(item.expected)}</strong></div></article>)}</div><aside className="pitch-note"><strong>{pair(["Желі істен шықса", "Если сеть подвела"])}</strong><p>{pair(["Белгісіз аударымды жаңа ID-мен қайталамаңыз. Мәртебені тексеріңіз немесе расталмаған ниетті тоқтатыңыз. Презентацияға оралып, алдын ала тексерілген репетиция есебін көрсетіңіз.", "Не повторяйте неизвестный перевод с новым ID. Сверьте статус или отмените неподтверждённое намерение. Вернитесь к презентации и покажите предварительно проверенный отчёт репетиции."])}</p></aside></section>}
      {section === "economics" && <section className="pitch-section"><p className="eyebrow">BCC SHIELD / SHADOW PILOT</p><h1>{t("economics")}</h1><p className="pitch-section-lead">{t("assumed")}</p><div className="pitch-economics"><form className="pitch-assumptions" onSubmit={event => event.preventDefault()}>{(Object.keys(pilotDefaults) as (keyof PilotAssumptions)[]).map(key => <label key={key}>{t(key)}<input type="number" min="0" max={assumptionLimits[key]} step="any" value={assumptions[key]} onChange={event => setAssumptions(value => ({ ...value, [key]: event.target.value }))} /></label>)}<button type="button" className="secondary" onClick={() => setAssumptions(Object.fromEntries(Object.entries(pilotDefaults).map(([key, value]) => [key, String(value)])) as Record<keyof PilotAssumptions, string>)}><RotateCcw size={15} />{t("reset")}</button></form><div className="pitch-outcome" aria-live="polite">{economics ? <><span>{t("net")}</span><strong className={economics.net < 0 ? "negative" : ""}>{money(economics.net, lang)}</strong><dl><div><dt>{t("gross")}</dt><dd>{money(economics.gross, lang)}</dd></div><div><dt>{t("cost")}</dt><dd>{money(economics.cost, lang)}</dd></div><div><dt>{t("additional")}</dt><dd>{economics.additionalCases.toLocaleString(lang, { maximumFractionDigits: 2 })}</dd></div><div><dt>{t("reviews")}</dt><dd>{economics.extraReviews.toLocaleString(lang, { maximumFractionDigits: 2 })}</dd></div><div><dt>ROI</dt><dd>{economics.roiPct === null ? "—" : `${economics.roiPct.toFixed(1)}%`}</dd></div></dl></> : <p role="alert">{t("invalid")}</p>}</div></div><p className="pitch-formula">{t("formula")}</p><p className="pitch-hint">{t("excluded")}</p></section>}
      {section === "questions" && <section className="pitch-section"><p className="eyebrow">BCC SHIELD / Q&A</p><h1>{t("questions")}</h1><p className="pitch-section-lead">{pair(["Жұмыс істейтін мүмкіндік пен пилотта дәлелденуі тиіс нәтижені ажыратыңыз.", "Разделяйте работающие возможности и результаты, которые ещё нужно подтвердить в пилоте."])}</p><div className="pitch-faq">{faqs.map(item => <details key={item.q[1]}><summary>{pair(item.q)}<ChevronDown size={20} /></summary><p>{pair(item.a)}</p></details>)}</div><a className="pitch-source" href={lang === "kk" ? "https://www.bcc.kz/kz/about/press-center/safe-account/" : "https://www.bcc.kz/about/press-center/safe-account/"} target="_blank" rel="noopener noreferrer">BCC: {pair(["«Қауіпсіз шот»", "«Безопасный счёт»"])} <ExternalLink size={15} /></a></section>}
    </div><footer className="pitch-footer">Saq Bol · ITU Hackathon 2026<span>{t("disclaimer")}</span></footer>
  </div>;
}
export default function PitchConsole() { return <LocaleProvider><Stage /></LocaleProvider>; }
