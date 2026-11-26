"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Banknote, BarChart3, Check, ChevronLeft, ChevronRight, CircleDashed, Expand, FileText, Fingerprint, Globe2, KeyRound,
  Mail, Minus, MonitorSmartphone, Pause, PhoneCall, Play, RotateCcw, Scale, ShieldAlert, StickyNote, X,
} from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { landingText, type LandingKey } from "@/lib/landing-copy";
import { bank, fit, hero, hold, how, pilot, problem, proof, tech, value, type L } from "@/content/pitch-site";
import { BrandMark } from "./brand-mark";
import { CountUp } from "./count-up";
import { DropNetwork } from "./drop-network";
import type { DropStage } from "./drop-scene";
import { FxCard } from "./fx-card";
import { HeroDemo } from "./hero-demo";
import { useReducedMotion } from "./use-fx-tier";
import "./landing.css";
import "./pitch-show.css";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const W = 1920;
const H = 1080;

type Slide = { id: string; tone: "deep" | "light"; seconds: number; note: L };

/** 14 slides, 300 seconds. Notes are what the speaker says (see docs/PITCH_5MIN_KK.md). */
const SLIDES: Slide[] = [
  { id: "cover", tone: "deep", seconds: 20, note: ["Қайырлы күн. Біз — Saq Bol. Алаяққа аударымды ақша шотта тұрғанда тоқтатамыз.", "Добрый день. Мы — Saq Bol. Останавливаем перевод мошеннику, пока деньги ещё на счёте."] },
  { id: "scam", tone: "light", seconds: 25, note: ["Нацбанк: 80 871 инцидент. Сценарий бір: «банктің қауіпсіздік қызметі» қоңырау шалып, ақшаны «қауіпсіз шотқа» аудартады.", "Нацбанк: 80 871 инцидент. Сценарий один: «служба безопасности банка» звонит и уводит деньги на «безопасный счёт»."] },
  { id: "blind", tone: "light", seconds: 20, note: ["SMS-код дұрыс, құрылғы өзінікі — антифрод үшін бәрі қалыпты. BCC ережесі дұрыс, бірақ қоңырау кезінде жұмыс істемейді.", "Код верный, устройство своё — для антифрода всё нормально. Правило BCC верное, но во время звонка не работает."] },
  { id: "layers", tone: "deep", seconds: 25, note: ["Әр аударым төрт қабаттан өтеді. Ережелер шешеді, ML ең көбі +15 балл. 40–74 балл — 15 минут кідіріс.", "Каждый перевод проходит четыре слоя. Решают правила, ML максимум +15. 40–74 балла — пауза 15 минут."] },
  { id: "demo", tone: "light", seconds: 30, note: ["Бір аударым — бес экран: қоңырау, кідіріс, «банк маған қоңырау шалып тұр ма?», жақын адам, ақша орнында.", "Один перевод — пять экранов: звонок, пауза, «банк мне звонит?», близкий, деньги на месте."] },
  { id: "freeze", tone: "deep", seconds: 15, note: ["Бұл — басты сәт. Карта мұздайды, ақша шотта қалады.", "Это главный момент. Карта замерзает, деньги остаются на счёте."] },
  { id: "family", tone: "light", seconds: 20, note: ["Немересі Telegram-да хабар алады. Ақшаға билігі жоқ, бірақ «Бұл алаяқтар» деген жауабы растауды бұғаттайды.", "Внук получает сообщение в Telegram. Деньгами не распоряжается, но ответ «Это мошенники» блокирует подтверждение."] },
  { id: "drops", tone: "light", seconds: 25, note: ["Бір құрбан — желінің бөлігі. 30 минутта 13 жіберуші бір хабқа. SOC хабты белгілейді.", "Одна жертва — часть сети. 13 отправителей за 30 минут на один хаб. SOC помечает хаб."] },
  { id: "soc", tone: "deep", seconds: 20, note: ["Оператор бүкіл желіні көреді: аналитика 7/30/90 күн, CSV, екі тараптың түсіндірмесі, банкомат, жалған домендер.", "Оператор видит всю сеть: аналитика 7/30/90 дней, CSV, объяснения обеих сторон, банкомат, поддельные домены."] },
  { id: "value", tone: "light", seconds: 25, note: ["BCC не алады: ақша шоттан шықпайды, ереже дәл сәтте жұмыс істейді, SOC жылдам, зейнеткерлерге түсінікті, банк өзегіне тимейміз.", "Что получает BCC: деньги не уходят, правило срабатывает вовремя, SOC быстрее, понятно пенсионерам, ядро банка не трогаем."] },
  { id: "arch", tone: "light", seconds: 25, note: ["FastAPI, PostgreSQL 16, Redis 7, NetworkX. Скоринг өзегі p95 — 5 мс. Әр балдың себебі бар.", "FastAPI, PostgreSQL 16, Redis 7, NetworkX. Ядро скоринга p95 — 5 мс. У каждого балла есть причина."] },
  { id: "proof", tone: "deep", seconds: 20, note: ["57/60 тоқтатылды, 4/60 артық кідіріс. 1,17 %-ды жасырмаймыз — сол үшін модель жалғыз шешпейді.", "57/60 остановлено, 4/60 лишних пауз. 1,17 % не прячем — поэтому модель не решает в одиночку."] },
  { id: "market", tone: "light", seconds: 10, note: ["Басқаларда — бөлек функциялар. Бізде — бір ағын.", "У других — отдельные функции. У нас — один поток."] },
  { id: "pilot", tone: "deep", seconds: 20, note: ["Shadow-пилот ұсынамыз. (Баяу:) Алаяқ адамды көндіре алады. Saq Bol сол адамға 15 минут береді. Рақмет.", "Предлагаем shadow-пилот. (Медленно:) Мошенник может уговорить человека. Saq Bol даёт ему 15 минут. Спасибо."] },
];
const TOTAL = SLIDES.reduce((sum, slide) => sum + slide.seconds, 0);

/** Steps through 0..length-1 every `ms` while `on`; back to 0 when the slide is left. */
function useCycle(on: boolean, length: number, ms: number) {
  const [step, setStep] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!on) { setStep(0); return; }
    if (reduced) return;
    const timer = setInterval(() => setStep(value => (value + 1) % length), ms);
    return () => clearInterval(timer);
  }, [on, length, ms, reduced]);
  return step;
}

/** Fits the 1920×1080 stage into the window. */
function useFit() {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / W, window.innerHeight / H));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return scale;
}

const d = (n: number): CSSProperties => ({ "--d": `${n * 0.14}s` } as CSSProperties);

export function PitchShow() {
  const { lang, setLang } = useLocale();
  const p = useCallback((pair: L) => pair[lang === "kk" ? 0 : 1], [lang]);
  const LT = (key: LandingKey) => landingText(lang, key);
  const scale = useFit();
  const [index, setIndex] = useState(0);
  const [notes, setNotes] = useState(false);
  const [running, setRunning] = useState(false);
  const [left, setLeft] = useState(TOTAL);
  const [idle, setIdle] = useState(false);
  const touch = useRef<number | null>(null);

  // Kazakh by default; ?lang=ru for Russian. #5 opens slide 5.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setLang(params.get("lang") === "ru" ? "ru" : "kk");
    const fromHash = Number(window.location.hash.slice(1));
    if (fromHash >= 1 && fromHash <= SLIDES.length) setIndex(fromHash - 1);
  }, [setLang]);

  const go = useCallback((target: number) => {
    const next = Math.max(0, Math.min(SLIDES.length - 1, target));
    setIndex(next);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${next + 1}`);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const key = event.key;
      if (["ArrowRight", "PageDown", "ArrowDown", " ", "Enter"].includes(key)) { event.preventDefault(); go(index + 1); }
      else if (["ArrowLeft", "PageUp", "ArrowUp", "Backspace"].includes(key)) { event.preventDefault(); go(index - 1); }
      else if (key === "Home") go(0);
      else if (key === "End") go(SLIDES.length - 1);
      else if (key.toLowerCase() === "t") setRunning(value => !value);
      else if (key.toLowerCase() === "n") setNotes(value => !value);
      else if (key.toLowerCase() === "f") void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())?.catch(() => undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setLeft(value => { if (value <= 1) { setRunning(false); return 0; } return value - 1; }), 1000);
    return () => clearInterval(timer);
  }, [running]);

  // Controls fade out while the mouse rests, so the slide stays clean on a projector.
  useEffect(() => {
    let timer = setTimeout(() => setIdle(true), 2500);
    const wake = () => { setIdle(false); clearTimeout(timer); timer = setTimeout(() => setIdle(true), 2500); };
    window.addEventListener("pointermove", wake);
    return () => { window.removeEventListener("pointermove", wake); clearTimeout(timer); };
  }, []);

  const on = (id: string) => SLIDES[index].id === id;
  const near = (id: string) => Math.abs(SLIDES.findIndex(slide => slide.id === id) - index) <= 1;
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  const slide = SLIDES[index];

  return <div className={`sh-root${idle ? " is-idle" : ""}`} data-tone={slide.tone}
    onTouchStart={event => { touch.current = event.touches[0]?.clientX ?? null; }}
    onTouchEnd={event => { const start = touch.current; const end = event.changedTouches[0]?.clientX; if (start !== null && end !== undefined && Math.abs(end - start) > 50) go(index + (end < start ? 1 : -1)); touch.current = null; }}>
    <div className="sh-stage" style={{ width: W, height: H, transform: `translate(-50%, -50%) scale(${scale})` }}>
      {SLIDES.map((item, i) => <section key={item.id} className={`sh-slide sh-s-${item.id} sh-${item.tone}`} data-on={i === index || undefined} aria-hidden={i !== index} aria-label={`${i + 1} / ${SLIDES.length}`}>
        <header className="sh-mark"><BrandMark size={36} /><span>Saq Bol</span><small>{String(i + 1).padStart(2, "0")} / {SLIDES.length}</small></header>
        {item.id === "cover" && <Cover on={on("cover")} near={near("cover")} p={p} LT={LT} />}
        {item.id === "scam" && <Scam on={on("scam")} p={p} />}
        {item.id === "blind" && <Blind p={p} />}
        {item.id === "layers" && <Layers p={p} />}
        {item.id === "demo" && <Demo on={on("demo")} p={p} />}
        {item.id === "freeze" && <Freeze on={on("freeze")} near={near("freeze")} p={p} LT={LT} />}
        {item.id === "family" && <Family p={p} />}
        {item.id === "drops" && <Drops on={on("drops")} near={near("drops")} LT={LT} p={p} />}
        {item.id === "soc" && <Soc p={p} />}
        {item.id === "value" && <Value p={p} />}
        {item.id === "arch" && <Arch p={p} />}
        {item.id === "proof" && <Proof on={on("proof")} p={p} />}
        {item.id === "market" && <Market p={p} />}
        {item.id === "pilot" && <Pilot p={p} />}
      </section>)}
      <div className="sh-progress" aria-hidden="true"><i style={{ width: `${((index + 1) / SLIDES.length) * 100}%` }} /></div>
    </div>

    <button type="button" className="sh-edge sh-edge-prev" onClick={() => go(index - 1)} aria-label={p(["Артқа", "Назад"])} disabled={index === 0} />
    <button type="button" className="sh-edge sh-edge-next" onClick={() => go(index + 1)} aria-label={p(["Келесі", "Далее"])} disabled={index === SLIDES.length - 1} />

    {notes && <aside className="sh-notes" role="note"><b>{String(index + 1).padStart(2, "0")} · ~{slide.seconds} {p(["сек", "сек"])}</b><p>{p(slide.note)}</p></aside>}
    <nav className="sh-hud" aria-label={p(["Таныстырылымды басқару", "Управление презентацией"])}>
      <button type="button" onClick={() => go(index - 1)} disabled={index === 0} aria-label={p(["Артқа", "Назад"])}><ChevronLeft size={18} /></button>
      <span className="sh-count">{index + 1} / {SLIDES.length}</span>
      <button type="button" onClick={() => go(index + 1)} disabled={index === SLIDES.length - 1} aria-label={p(["Келесі", "Далее"])}><ChevronRight size={18} /></button>
      <i />
      <span className={`sh-clock${left === 0 ? " is-over" : ""}`} role="timer">{clock}</span>
      <button type="button" onClick={() => setRunning(value => !value)} aria-label={p(running ? ["Кідірту", "Пауза"] : ["Таймерді бастау", "Запустить таймер"])}>{running ? <Pause size={16} /> : <Play size={16} />}</button>
      <button type="button" onClick={() => { setRunning(false); setLeft(TOTAL); }} aria-label={p(["Қайта бастау", "Сбросить"])}><RotateCcw size={15} /></button>
      <button type="button" onClick={() => setNotes(value => !value)} aria-pressed={notes} aria-label={p(["Жазбалар", "Заметки"])}><StickyNote size={16} /></button>
      <button type="button" onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())?.catch(() => undefined)} aria-label={p(["Толық экран", "Полный экран"])}><Expand size={16} /></button>
      <i />
      {(["kk", "ru"] as const).map(code => <button key={code} type="button" className="sh-lang" aria-pressed={lang === code} onClick={() => setLang(code)}>{code === "kk" ? "ҚАЗ" : "РУС"}</button>)}
    </nav>
  </div>;
}

type Tr = (pair: L) => string;
type LTr = (key: LandingKey) => string;

function Title({ kicker, children, light = false }: { kicker: string; children: ReactNode; light?: boolean }) {
  return <div className={`sh-title${light ? " is-light" : ""}`}><p className="sh-kicker sh-in">{kicker}</p><h2 className="sh-in" style={d(1)}>{children}</h2></div>;
}

/* 01 · Cover: the card freezes every few seconds */
function Cover({ on, near, p, LT }: { on: boolean; near: boolean; p: Tr; LT: LTr }) {
  // The card freezes once, two seconds in, and stays frozen: that is the product.
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (!on) { setPhase(0); return; }
    const timer = setTimeout(() => setPhase(1), 2000);
    return () => clearTimeout(timer);
  }, [on]);
  return <div className="sh-cover">
    <div className="sh-cover-copy">
      <p className="sh-kicker sh-in">{p(["Банк ЦентрКредит клиенттеріне арналған антифрод", "Антифрод для клиентов Банка ЦентрКредит"])}</p>
      <h1 className="sh-in" style={d(1)}>{p(hero.titleA)}<br /><mark>{p(hero.titleB)}</mark></h1>
      <ul className="sh-cover-points">
        {([["15 минут кідіріс", "15 минут паузы"], ["Банк қоңырауын тексеру", "Проверка звонка банка"], ["Жақын адам Telegram-да", "Близкий в Telegram"], ["Дроптар графы SOC-та", "Граф дропов в SOC"]] as L[]).map((item, i) =>
          <li key={item[1]} className="sh-in" style={d(2 + i)}><Check size={22} />{p(item)}</li>)}
      </ul>
    </div>
    <div className="sh-cover-card sh-in" style={d(2)}>
      {near && <FxCard size="hero" state={phase ? "frozen" : "idle"} ring={phase ? 1 : 0} label={LT("heroCardLabel")} />}
      <span className={`sh-chip sh-chip-hold${phase ? " is-on" : ""}`}><i />{p(["Аударым кідіртілді · 15:00", "Перевод на паузе · 15:00"])}</span>
      <span className={`sh-chip sh-chip-safe${phase ? " is-on" : ""}`}><Check size={18} />{p(["Ақша шотта", "Деньги на счёте"])}</span>
    </div>
  </div>;
}

/* 02 · The scam, played out: call, script, money flies to a "safe account" */
function Scam({ on, p }: { on: boolean; p: Tr }) {
  return <div className="sh-split">
    <div className="sh-scam-copy">
      <p className="sh-kicker sh-in">{p(problem.eyebrow)}</p>
      <CountUp value={problem.stat} run={on} className="sh-huge sh-in" />
      <p className="sh-lead sh-in" style={d(1)}>{p(problem.statLabel)}</p>
      <p className="sh-source sh-in" style={d(2)}>{problem.statSource.label}</p>
    </div>
    <div className="sh-scam-scene" aria-hidden="true">
      <div className="sh-callphone sh-in" style={d(1)}>
        <span className="sh-ring" /><span className="sh-ring sh-ring-2" />
        <div className="sh-callphone-screen">
          <small>{p(["Кіріс қоңырау", "Входящий звонок"])}</small>
          <b>{p(["Банктің қауіпсіздік қызметі", "Служба безопасности банка"])}</b>
          <span className="sh-callphone-btn"><PhoneCall size={26} /></span>
        </div>
      </div>
      <div className="sh-bubble sh-bubble-1">{p(["Картаңыз бойынша күдікті операция байқалды", "По вашей карте замечена подозрительная операция"])}</div>
      <div className="sh-bubble sh-bubble-2">{p(["Ақшаны «қауіпсіз шотқа» аударыңыз", "Переведите деньги на «безопасный счёт»"])}</div>
      <div className="sh-flowbox">
        <svg className="sh-flow" width="520" height="220" viewBox="0 0 520 220"><path d="M20 180 C 160 180, 240 40, 500 60" /></svg>
        <div className="sh-coin">450 000 ₸</div>
      </div>
      <div className="sh-safe">
        <span className="sh-safe-front">{p(["«Қауіпсіз шот»", "«Безопасный счёт»"])}</span>
        <span className="sh-safe-back"><ShieldAlert size={22} />{p(["Дроп шоты", "Счёт дропа"])}</span>
      </div>
    </div>
  </div>;
}

/* 03 · Why classic antifraud misses it */
function Blind({ p }: { p: Tr }) {
  const checks: L[] = [["SMS-код дұрыс", "Код из SMS верный"], ["Құрылғы өзінікі", "Устройство своё"], ["Кіру әдеттегідей", "Вход как обычно"]];
  const icons = [KeyRound, MonitorSmartphone, Fingerprint];
  return <div className="sh-blind">
    <Title kicker={p(["Неге қазіргі антифрод көрмейді", "Почему антифрод этого не видит"])}>{p(problem.title)}</Title>
    <div className="sh-blind-row">
      {checks.map((item, i) => { const Icon = icons[i]; return <div key={item[1]} className="sh-check sh-in" style={d(2 + i)}><Icon size={34} /><span>{p(item)}</span><b><Check size={26} /></b></div>; })}
      <div className="sh-arrow sh-in" style={d(5)}>→</div>
      <div className="sh-verdict sh-in" style={d(6)}><small>{p(["Антифрод", "Антифрод"])}</small><b>{p(["Қалыпты операция", "Обычная операция"])}</b></div>
    </div>
    <div className="sh-stamp">{p(["450 000 ₸ алаяққа кетті", "450 000 ₸ ушли мошеннику"])}</div>
    <blockquote className="sh-quote sh-in" style={d(8)}>«{p(problem.quote)}» <cite>— bcc.kz</cite><span>{p(problem.quoteNote)}</span></blockquote>
  </div>;
}

/* 04 · Four layers as a 3D stack; the transfer drops through and stops at 74 */
function Layers({ p }: { p: Tr }) {
  return <div className="sh-split sh-layers-wrap">
    <div className="sh-stack-scene" aria-hidden="true">
      <div className="sh-stack">
        {[0, 1, 2, 3].map(i => <div key={i} className="sh-plate" style={{ "--z": `${i * 86}px`, "--d": `${0.5 + (3 - i) * 0.45}s` } as CSSProperties}><span>{String(4 - i).padStart(2, "0")}</span></div>)}
        <div className="sh-packet">450 000 ₸</div>
      </div>
    </div>
    <div className="sh-layers-copy">
      <Title kicker={p(["Шешім", "Решение"])} light>{p(["Төрт қабат — бір түсінікті шешім", "Четыре слоя — одно понятное решение"])}</Title>
      <ol className="sh-layer-list">{tech.layers.map((layer, i) => <li key={layer.name[1]} className="sh-in" style={d(3 + i * 2)}>
        <span>{String(i + 1).padStart(2, "0")}</span><div><b>{p(layer.name)}</b><small>{p(layer.detail)}</small></div>
      </li>)}</ol>
      <div className="sh-result sh-in" style={d(12)}><b>74</b><span>{p(["балл → 15 минут кідіріс, ақша шотта", "балла → пауза 15 минут, деньги на счёте"])}</span></div>
    </div>
  </div>;
}

/* 05 · The live phone walks through the five screens */
function Demo({ on, p }: { on: boolean; p: Tr }) {
  const step = useCycle(on, 5, 4200);
  return <div className="sh-split sh-demo">
    <div>
      <Title kicker={p(how.eyebrow)}>{p(["Клиент экранында не болады", "Что видит клиент"])}</Title>
      <ol className="sh-steps">{how.steps.map((item, i) => <li key={item.title[1]} className={i === step ? "is-on" : i < step ? "is-done" : undefined}>
        <span className="sh-steps-bar"><i /></span>
        <b>{p(item.title)}</b>
        {i === step && <small>{p(item.text)}</small>}
      </li>)}</ol>
    </div>
    <div className="sh-demo-phone sh-in" style={d(1)}><HeroDemo step={step} bare /></div>
  </div>;
}

/* 06 · The moment: the card freezes, the clock runs */
function Freeze({ on, near, p, LT }: { on: boolean; near: boolean; p: Tr; LT: LTr }) {
  const [left, setLeft] = useState(900);
  useEffect(() => {
    if (!on) { setLeft(900); return; }
    const timer = setInterval(() => setLeft(value => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [on]);
  const phase = useCycle(on, 3, 2600);
  return <div className="sh-split sh-freeze">
    <div className="sh-freeze-card sh-in">{near && <FxCard size="hero" state={on ? "frozen" : "idle"} ring={on ? 1 : 0} label={LT("heroCardLabel")} />}</div>
    <div className="sh-freeze-copy">
      <p className="sh-kicker sh-in">{p(hold.eyebrow)}</p>
      <strong className="sh-timer sh-in" style={d(1)}>{String(Math.floor(left / 60)).padStart(2, "0")}:{String(left % 60).padStart(2, "0")}</strong>
      <ol className="sh-freeze-steps">{hold.captions.map((caption, i) => <li key={caption[1]} className={i <= phase ? "is-on" : undefined}><span>{String(i + 1).padStart(2, "0")}</span>{p(caption)}</li>)}</ol>
      <p className="sh-lead sh-in" style={d(3)}>{p(hold.sub)}</p>
    </div>
  </div>;
}

/* 07 · Grandmother's phone → Telegram → grandson's answer */
function Family({ p }: { p: Tr }) {
  return <div className="sh-family">
    <Title kicker={p(["Жақын адам", "Близкий человек"])}>{p(["Жақын адам — екінші пікір, бірақ ақшаға билік жоқ", "Близкий — второе мнение, но без доступа к деньгам"])}</Title>
    <div className="sh-family-row">
      <figure className="sh-in" style={d(2)}><HeroDemo step={1} bare /><figcaption>{p(["Әже · аударым кідіртілді", "Бабушка · перевод на паузе"])}</figcaption></figure>
      <div className="sh-link" aria-hidden="true">
        <svg viewBox="0 0 420 120" preserveAspectRatio="none"><path d="M10 60 H410" /></svg>
        <span className="sh-envelope"><Mail size={26} />Telegram</span>
        <span className="sh-reply">{p(["Бұл алаяқтар", "Это мошенники"])}</span>
        <span className="sh-lock"><X size={20} />{p(["Растау бұғатталды", "Подтверждение заблокировано"])}</span>
      </div>
      <figure className="sh-in" style={d(3)}><HeroDemo step={3} bare /><figcaption>{p(["Немересі · Telegram", "Внук · Telegram"])}</figcaption></figure>
    </div>
  </div>;
}

/* 08 · The drop network in 3D */
function Drops({ on, near, LT, p }: { on: boolean; near: boolean; LT: LTr; p: Tr }) {
  const stage = useCycle(on, 4, 3800) as DropStage;
  return <div className="sh-split sh-drops">
    <div className="sh-drops-stage sh-in">{near && <DropNetwork stage={stage} label={LT("dropsLabel")} legend={{ client: LT("legendClient"), drop: LT("legendDrop"), hub: LT("legendHub"), cash: LT("legendCash") }} />}</div>
    <div>
      <Title kicker={p(["Бір құрбан — желінің бөлігі", "Одна жертва — часть сети"])}>{LT("dropsTitle")}</Title>
      <ol className="sh-drops-steps">{([1, 2, 3, 4] as const).map((n, i) => <li key={n} className={i === stage ? "is-on" : undefined}>
        <span>{n}</span><div><b>{LT(`d${n}Title` as LandingKey)}</b>{i === stage && <small>{LT(`d${n}Text` as LandingKey)}</small>}</div>
      </li>)}</ol>
    </div>
  </div>;
}

/* 09 · SOC: the screen tilts in, the capabilities float around it */
function Soc({ p }: { p: Tr }) {
  const icons = [BarChart3, Network3, Banknote, Scale, Globe2];
  return <div className="sh-soc">
    <Title kicker={p(bank.eyebrow)} light>{p(bank.title)}</Title>
    <div className="sh-soc-scene">
      <figure className="sh-browser">
        <div className="sh-browser-bar" aria-hidden="true"><i /><i /><i /><span>saq-bol · SOC</span></div>
        <img src={`${BASE}/pitch/soc-ru.webp`} alt={p(["SOC мониторингі", "Мониторинг SOC"])} />
      </figure>
      {bank.features.slice(0, 5).map((feature, i) => { const Icon = icons[i]; return <div key={feature.title[1]} className={`sh-float sh-float-${i + 1}`}><Icon size={22} /><b>{p(feature.title)}</b></div>; })}
    </div>
  </div>;
}
function Network3({ size = 22 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="5" cy="6" r="2.5" /><circle cx="19" cy="6" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="M7 7.5 10.5 16M17 7.5 13.5 16M7.5 6h9" /></svg>;
}

/* 10 · What BCC gets */
function Value({ p }: { p: Tr }) {
  return <div className="sh-value">
    <Title kicker={p(value.eyebrow)}>{p(value.title)}</Title>
    <ul className="sh-bento">{value.items.map((item, i) => <li key={item.title[1]} className={`sh-in sh-bento-${i + 1}`} style={d(2 + i)}>
      <span>{item.kpi}</span><b>{p(item.title)}</b><small>{p(item.text)}</small>
    </li>)}</ul>
  </div>;
}

/* 11 · Architecture: a request travels the pipeline, the gauge settles on 74 */
function Arch({ p }: { p: Tr }) {
  return <div className="sh-arch">
    <Title kicker={p(tech.eyebrow)}>{p(["Бір сұраныс — 5 миллисекунд", "Один запрос — 5 миллисекунд"])}</Title>
    <div className="sh-pipe">
      <div className="sh-pipe-track" aria-hidden="true"><i /></div>
      <div className="sh-pipe-col sh-in" style={d(2)}><small>{p(["Арналар", "Каналы"])}</small>{tech.channels.map(item => <span key={item[1]}>{p(item)}</span>)}</div>
      <div className="sh-pipe-col sh-pipe-core sh-in" style={d(3)}><small>FastAPI</small>{tech.layers.map(layer => <span key={layer.name[1]}><b>{p(layer.name)}</b>{p(layer.detail)}</span>)}</div>
      <div className="sh-pipe-col sh-gauge-col sh-in" style={d(4)}>
        <small>{p(["Шешім, 0–100", "Решение, 0–100"])}</small>
        <strong className="sh-gauge-value">74</strong>
        <svg className="sh-gauge" viewBox="0 0 300 170" aria-hidden="true">
          <path className="g-ok" d="M30 150 A120 120 0 0 1 107.6 37.8" />
          <path className="g-hold" d="M112.9 35.9 A120 120 0 0 1 230.7 61.2" />
          <path className="g-stop" d="M234.9 65.1 A120 120 0 0 1 270 150" />
          <g className="g-needle"><path d="M150 150 L150 48" /><circle cx="150" cy="150" r="10" /></g>
        </svg>
        <div className="sh-gauge-legend">{tech.decisions.map(item => <span key={item.range} className={`is-${item.tone}`}><b>{item.range}</b>{p(item.label)}</span>)}</div>
      </div>
      <div className="sh-pipe-col sh-in" style={d(5)}><small>{p(["Нәтиже", "Результат"])}</small>{tech.outputs.map(item => <span key={item[1]}>{p(item)}</span>)}</div>
    </div>
    <p className="sh-foot sh-in" style={d(7)}>{p(tech.principle)} <span>{p(tech.infra)}</span></p>
  </div>;
}

/* 12 · Evidence */
function Proof({ on, p }: { on: boolean; p: Tr }) {
  return <div className="sh-proof">
    <Title kicker={p(proof.eyebrow)} light>{p(proof.title)}</Title>
    <ul className="sh-metrics">{proof.metrics.map((metric, i) => <li key={metric.value} className="sh-in" style={d(2 + i)}>
      <CountUp value={metric.value} run={on} />
      <p>{p(metric.label)}</p>
      <small><FileText size={14} />{metric.file}</small>
    </li>)}</ul>
    <p className="sh-foot sh-in" style={d(9)}>{p(proof.note)}</p>
  </div>;
}

/* 13 · Market */
function Market({ p }: { p: Tr }) {
  return <div className="sh-market">
    <Title kicker={p(fit.eyebrow)}>{p(fit.competitorsTitle)} — {p(["бізде бір ағын", "у нас один поток"])}</Title>
    <table className="sh-table">
      <thead><tr><th />{fit.competitors.map((name, i) => <th key={name} className={`sh-in${i === fit.competitors.length - 1 ? " ours" : ""}`} style={d(2 + i)}>{name}</th>)}</tr></thead>
      <tbody>{fit.rows.map((row, r) => <tr key={row.feature[1]}><th className="sh-in" style={d(2 + r)}>{p(row.feature)}</th>{row.cells.map((cell, i) => <td key={fit.competitors[i]} className={`sh-in ${cell}${i === fit.competitors.length - 1 ? " ours" : ""}`} style={d(3 + i + r * 0.5)}>
        {cell === "yes" ? <Check size={28} /> : cell === "no" ? <Minus size={24} /> : <CircleDashed size={24} />}
      </td>)}</tr>)}</tbody>
    </table>
    <p className="sh-foot sh-in" style={d(10)}>{p(fit.note)}</p>
  </div>;
}

/* 14 · Pilot and close */
function Pilot({ p }: { p: Tr }) {
  return <div className="sh-pilot">
    <Title kicker={p(pilot.eyebrow)} light>{p(pilot.title)}</Title>
    <ol className="sh-phases">{pilot.phases.map((phase, i) => <li key={phase.name[1]} className="sh-in" style={d(2 + i)}><span>{i + 1}</span><b>{p(phase.name)}</b><small>{p(phase.detail)}</small></li>)}</ol>
    <div className="sh-close">
      <blockquote className="sh-in" style={d(6)}>{p(pilot.final)}</blockquote>
      <div className="sh-qr sh-in" style={d(7)}><img src={`${BASE}/downloads/android-qr.svg`} alt="" /><span>{p(["Android қосымшасы", "Приложение для Android"])}<small>saq-bol-bcc…/download/android</small></span></div>
    </div>
    <ul className="sh-team sh-in" style={d(8)}>{pilot.team.map(member => <li key={member.name[1]}><b>{p(member.name)}</b>{p(member.role)}</li>)}</ul>
  </div>;
}
