import { LoaderCircle, PhoneCall, ShieldCheck } from "lucide-react";
import type { CallCheck } from "@/lib/contracts";
import { useLocale } from "@/lib/i18n";
import { mobileText } from "@/lib/mobile-copy";

export function CallCheckButton({ busy, disabled, checked, onCheck }: { busy?: boolean; disabled?: boolean; checked?: boolean; onCheck: () => void }) {
  const { lang } = useLocale();
  return <button type="button" className="call-check-cta" disabled={busy || disabled} onClick={onCheck}>
    {busy ? <LoaderCircle className="animate-spin" size={16} aria-hidden /> : <ShieldCheck size={16} aria-hidden />}
    {mobileText(lang, busy ? "callChecking" : checked ? "callRecheck" : "callCheckCta")}
  </button>;
}

export function CallLogResult({ check, showHotline = true }: { check: CallCheck | null; showHotline?: boolean }) {
  const { lang } = useLocale();
  const m = (key: Parameters<typeof mobileText>[1]) => mobileText(lang, key);
  const clock = new Intl.DateTimeFormat(lang === "kk" ? "kk-KZ" : "ru-KZ", {
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Almaty",
  });
  const time = (value: string) => <time dateTime={value}>{clock.format(new Date(value))}</time>;
  return <div className="call-log-summary">
    <div role="status">
      <strong>{check ? m(check.verified ? "callVerified" : "callDenied") : m("callCheckFailed")}</strong>
      {check && <dl>
        {check.verified && check.employee_name && <div><dt>{m("callStaffRecord")}</dt><dd>{check.employee_name}</dd></div>}
        {check.verified && check.started_at && <div><dt>{m("callStartedAt")}</dt><dd>{time(check.started_at)}</dd></div>}
        <div><dt>{m("callCheckedAt")}</dt><dd>{time(check.checked_at)}</dd></div>
      </dl>}
      {check && <p>{m("callCaution")}</p>}
      {check && check.simulated_log !== false && <small>{m("callLogSimulated")}</small>}
    </div>
    {showHotline && <a className="secondary" href="tel:505"><PhoneCall size={16} aria-hidden="true" />{m("postCallBank")} · 505</a>}
  </div>;
}
