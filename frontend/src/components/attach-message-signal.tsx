"use client";

import { useRef, useState } from "react";
import { z } from "zod";
import { api } from "@/lib/contracts";
import { useLocale } from "@/lib/i18n";
import { mobileText } from "@/lib/mobile-copy";
import { signalCodes, type MessageSignal } from "@/lib/message-check";
import { CircleLogin, isCircleGuest } from "./circle-login";

const path = "trusted-circle/report-signals";
const optionsSchema = z.array(z.object({id:z.uuid(), created_at:z.iso.datetime({offset:true})})).max(50);
const receiptSchema = z.object({ report_id:z.uuid(), category:z.enum(signalCodes) });
type Options = z.infer<typeof optionsSchema>;

export function AttachMessageSignal({codes}: {codes: MessageSignal[]}) {
  const {lang} = useLocale();
  const L = (kk: string, ru: string) => lang === "kk" ? kk : ru;
  const [options, setOptions] = useState<Options | null>(null);
  const [report, setReport] = useState("");
  const [code, setCode] = useState<MessageSignal>(codes[0]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [guest, setGuest] = useState(false);
  const [error, setError] = useState(false);
  const [sent, setSent] = useState(false);
  const pending = useRef(false);
  async function load() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setGuest(false); setError(false);
    try {
      const data = optionsSchema.parse(await api(path));
      setOptions(data); setReport(""); setConsent(false);
    } catch (e) { if (isCircleGuest(e)) setGuest(true); else setError(true); }
    finally { pending.current = false; setBusy(false); }
  }
  async function send() {
    if (pending.current || !consent || !report || !codes.includes(code)) return;
    pending.current = true; setBusy(true); setError(false);
    try {
      const receipt = receiptSchema.parse(await api(path, {
        method:"POST", body: JSON.stringify({report_id:report, category:code, consent:true}),
      }));
      if (receipt.report_id !== report || receipt.category !== code) throw new Error("receipt");
      setSent(true);
    } catch (e) { if (isCircleGuest(e)) { setGuest(true); setOptions(null); } else setError(true); }
    finally { pending.current = false; setBusy(false); }
  }
  if (sent) return <p role="status">{L("Таңдалған белгі өтінішке қосылды.", "Выбранная категория добавлена в обращение.")} <bdi>#{report.slice(-8)}</bdi></p>;
  return <section className="safety-result signal-share">
    {options === null && !guest && <button type="button" className="secondary" disabled={busy} onClick={() => void load()}>
      {L("Өтінішіме белгі қосу", "Приложить категорию к моему обращению")}</button>}
    {guest && <CircleLogin onUnlocked={() => void load()} />}
    {options !== null && (options.length === 0
      ? <p>{L("Қолданыстағы ашық өтініштер жоқ.", "У вас пока нет открытых обращений.")}</p>
      : <fieldset disabled={busy}><legend>{L("Хабарламаға қатысты бір белгіні бөлісу", "Передать одну категорию сигнала")}</legend>
        <label>{L("Өтініш", "Обращение")}<select value={report} onChange={e => {setReport(e.target.value); setConsent(false);}}>
          <option value="">{L("Өтінішті таңдаңыз", "Выберите обращение")}</option>
          {options.map(row => <option key={row.id} value={row.id}>{new Date(row.created_at).toLocaleString(lang === "kk" ? "kk-KZ" : "ru-KZ")} · #{row.id.slice(-8)}</option>)}
        </select></label>
        <label>{L("Белгі", "Категория")}<select value={code} onChange={e => {setCode(e.target.value as MessageSignal); setConsent(false);}}>
          {codes.map(key => <option key={key} value={key}>{mobileText(lang, key)}</option>)}
        </select></label>
        <label><input type="checkbox" checked={consent} disabled={!report} onChange={e => setConsent(e.target.checked)} />
          {L("Қызметкерге тек осы санатты жіберуге келісемін. Хат мәтіні құрылғыда қалады.", "Согласен передать сотруднику только эту категорию. Текст переписки останется на устройстве.")}</label>
        <button type="button" className="primary" disabled={!consent || !report || busy} onClick={() => void send()}>{L("Өтінішке қосу", "Добавить в обращение")}</button>
      </fieldset>)}
    {error && <p role="status">{L("Өтінішті тексеріп, қайта көріңіз.", "Проверьте доступность обращения и повторите попытку.")}</p>}
  </section>;
}
