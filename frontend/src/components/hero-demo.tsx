"use client";

import { useEffect, useRef, useState } from "react";
import { BatteryFull, Check, Clock3, FileText, Phone, PhoneOff, ShieldCheck, Signal, Wifi } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { landingText, type LandingKey } from "@/lib/landing-copy";
import { BrandMark } from "./brand-mark";
import { useReducedMotion } from "./use-fx-tier";

const STEP_MS = 3600;
const steps = ["demoStep1", "demoStep2", "demoStep3", "demoStep4", "demoStep5"] as const;

/** Seconds left on the 15-minute hold, counting down while the pause screen is on. */
function useHoldClock(active: boolean) {
  const [left, setLeft] = useState(899);
  useEffect(() => {
    if (!active) { setLeft(899); return; }
    const timer = setInterval(() => setLeft(value => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
}

/**
 * One transfer, five screens, played like a product film: the call, the
 * pause, the call check, the family member and the saved money. Visitors can
 * pick any step; autoplay stops for reduced motion and while hovered.
 */
export function HeroDemo() {
  const { lang } = useLocale();
  const L = (key: LandingKey) => landingText(lang, key);
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);
  const [hold, setHold] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const clock = useHoldClock(step === 1);

  useEffect(() => {
    if (!host.current) return;
    const io = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)));
    io.observe(host.current);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (reduced || hold || !visible) return;
    const timer = setTimeout(() => setStep(value => (value + 1) % steps.length), STEP_MS);
    return () => clearTimeout(timer);
  }, [step, reduced, hold, visible]);

  const tone = step === 1 ? "held" : step === 2 ? "alert" : step === 4 ? "saved" : "idle";
  return <div ref={host} className="hd" data-step={step} data-tone={tone} data-playing={!reduced && !hold && visible || undefined}
    onPointerEnter={event => { if (event.pointerType === "mouse") setHold(true); }} onPointerLeave={() => setHold(false)}>
    <div className="hd-device" aria-hidden="true">
      <div className="hd-screen">
        <div className="hd-status"><b>9:41</b><span className="hd-island" /><span><Signal size={13} /><Wifi size={13} /><BatteryFull size={17} /></span></div>

        <section className={`hd-view hd-transfer ${step === 0 ? "is-on" : ""}`}>
          <div className="hd-call"><i><Phone size={16} /></i><span><small>{L("demoIncoming")}</small><b>{L("demoCaller")}</b></span></div>
          <h4>{L("demoTransfer")}</h4>
          <dl className="hd-rows">
            <div><dt>{L("demoFrom")}</dt><dd><span className="hd-card" />{L("demoCard")} · 4821</dd></div>
            <div><dt>{L("demoTo")}</dt><dd><span className="hd-avatar">?</span>{L("demoNewRecipient")} · 0004</dd></div>
          </dl>
          <div className="hd-amount"><small>{L("demoAmount")}</small><b>450 000 ₸</b></div>
          <span className="hd-button hd-press">{L("demoSend")}</span>
        </section>

        <section className={`hd-view hd-pause ${step === 1 ? "is-on" : ""}`}>
          <div className="hd-hold">
            <span className="hd-pill"><Clock3 size={13} />{L("demoPaused")}</span>
            <strong>{clock}</strong><small>{L("demoLeft")}</small>
            <span className="hd-safe"><Check size={13} />{L("demoMoneySafe")}</span>
          </div>
          <p className="hd-label">{L("demoWhy")}</p>
          <ul className="hd-reasons">{(["demoR1", "demoR2", "demoR3", "demoR4"] as const).map(key => <li key={key}>{L(key)}</li>)}</ul>
          <span className="hd-button">{L("demoCancel")}</span>
          <span className="hd-button hd-secondary">{L("demoCheckCall")}</span>
        </section>

        <section className={`hd-view hd-check ${step === 2 ? "is-on" : ""}`}>
          <i className="hd-alert"><PhoneOff size={30} /></i>
          <h4>{L("demoNotBank")}</h4>
          <p>{L("demoNotBankText")}</p>
          <span className="hd-button"><Phone size={15} />{L("demoCall505")}</span>
        </section>

        <section className={`hd-view hd-chat ${step === 3 ? "is-on" : ""}`}>
          <div className="hd-chat-head"><BrandMark size={34} /><span><b>Saq Bol</b><small>{L("demoSon")} · Telegram</small></span></div>
          <div className="hd-bubble">{L("demoBotText")}<div className="hd-choices"><span className="hd-choice-scam">{L("demoScam")}</span><span>{L("demoFine")}</span></div></div>
          <div className="hd-reply">{L("demoScam")}</div>
        </section>

        <section className={`hd-view hd-saved ${step === 4 ? "is-on" : ""}`}>
          <i className="hd-ok"><ShieldCheck size={34} /></i>
          <h4>{L("demoSaved")}</h4>
          <p>{L("demoSavedText")}</p>
          <span className="hd-case"><FileText size={15} />{L("demoCase")} · …a91f</span>
        </section>
      </div>
    </div>
    <ol className="hd-steps" aria-label={L("navHow")}>{steps.map((key, index) => <li key={key}>
      <button type="button" aria-current={step === index ? "step" : undefined} onClick={() => setStep(index)}>
        <span className="hd-bar"><i /></span>{L(key)}
      </button>
    </li>)}</ol>
  </div>;
}
