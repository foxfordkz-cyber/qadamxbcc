"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownLeft, ArrowLeft, ChevronRight, RefreshCw, ShieldCheck } from "lucide-react";
import { api, type Lang } from "@/lib/contracts";
import { money, useLocale } from "@/lib/i18n";
import type { IncomingPayment, ReturnAction } from "@/lib/payment-returns";
import { Badge } from "./risk";

const words = {
  title: ["Түскен ақшаны қайтару", "Возврат поступления"],
  select: ["Қайтарғыңыз келетін кіріс аударымын таңдаңыз.", "Выберите поступление, которое хотите вернуть."],
  because: [
    "Сома мен жіберушінің деректемелері бастапқы аударымнан алынды.",
    "Сумма и реквизиты отправителя взяты из исходного перевода.",
  ],
  loading: ["Жүктелуде…", "Загружаем…"],
  refresh: ["Жаңарту", "Обновить"],
  empty: ["Қайтаруға болатын кіріс аударымдары жоқ.", "Пока нет подходящих входящих переводов."],
  failed: [
    "Серверден күйін тексеру мүмкін болмады. Қайталап тексеріңіз.",
    "Не удалось подтвердить состояние на сервере. Обновите данные.",
  ],
  back: ["Кіріс аударымдары", "К поступлениям"],
  received: ["Кімнен", "Поступление от"],
  return_to_sender: ["Жіберушіге қайтару", "Вернуть отправителю"],
  report_redirect: ["Басқа шотқа қайтаруды сұрады", "Просят вернуть на другой счёт"],
  appeal: ["Қайта қарауды сұрау", "Попросить пересмотр"],
  confirmReturn: [
    "Толық соманы бастапқы жіберушіге қайтаруды растайсыз ба?",
    "Подтверждаете возврат полной суммы первоначальному отправителю?",
  ],
  confirmReport: [
    "Қауіпсіздік қызметіне хабарлайсыз ба? Ақша өз шотыңызда қалады.",
    "Сообщить службе безопасности? Деньги останутся у вас.",
  ],
  confirmAppeal: ["Өтінішті қайта қарауға жібересіз бе?", "Передать обращение на повторную проверку?"],
  confirm: ["Растау", "Подтвердить"],
  cancel: ["Артқа", "Назад"],
  reported: [
    "Өтініш қауіпсіздік қызметіне жіберілді. Қайтару тоқтатылды.",
    "Обращение передано службе безопасности. Возврат приостановлен.",
  ],
  appealed: [
    "Өтініш қайта қаралуда. Қайтару тоқтатылды.",
    "Обращение на повторной проверке. Возврат приостановлен.",
  ],
  upheld: ["Қауіпсіздік қызметі шектеуді сақтады.", "Служба безопасности сохранила ограничение."],
  cleared: [
    "Қауіпсіздік қызметі бастапқы жіберушіге қайтаруға рұқсат берді.",
    "Служба безопасности разрешила возврат первоначальному отправителю.",
  ],
  outcome: ["Қайтарым нәтижесі", "Результат возврата"],
  check: ["Қайтарымды тексеру", "Проверить возврат"],
  review: ["Қайтару туралы өтініш", "Обращение о возврате"],
  clear: ["Жіберушіге қайтаруға рұқсат беру", "Разрешить возврат отправителю"],
  uphold: ["Шектеуді сақтау", "Сохранить ограничение"],
  reviewHint: [
    "Шешімді клиент көреді. Ақшаны қайтаруды клиент өзі растайды.",
    "Клиент увидит решение. Для возврата ему потребуется подтвердить операцию.",
  ],
} as const;
function copy(lang: Lang, key: keyof typeof words) {
  return words[key][lang === "kk" ? 0 : 1];
}
export function returnsTitle(lang: Lang) {
  return copy(lang, "title");
}

export function IncomingReturns({
  onReview,
  transferDisabled,
}: {
  onReview?: (id: string) => void;
  transferDisabled: boolean;
}) {
  const { lang } = useLocale();
  const t = (key: keyof typeof words) => copy(lang, key);
  const [items, setItems] = useState<IncomingPayment[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [intent, setIntent] = useState<ReturnAction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [version, setVersion] = useState(0);
  const lock = useRef(false);
  const payment = items.find((item) => item.original_id === selected);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(false);
    setIntent(null);
    const read = selected
      ? api<IncomingPayment>("returns/" + selected).then((p) => [p])
      : api<{ items: IncomingPayment[] }>("returns/incoming").then((page) => page.items);
    void read
      .then((data) => {
        if (current) setItems(data);
      })
      .catch(() => {
        if (current) setError(true);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [selected, version]);
  async function submit() {
    if (!payment || !intent || lock.current || (intent === "return_to_sender" && transferDisabled)) return;
    lock.current = true;
    setLoading(true);
    try {
      const updated = await api<IncomingPayment>("returns/" + payment.original_id, {
        method: "POST",
        body: JSON.stringify({ action: intent, confirmed: true }),
      });
      setItems([updated]);
    } catch {
      setError(true);
    } finally {
      lock.current = false;
      setLoading(false);
      setIntent(null);
    }
  }
  return (
    <section className="mobile-tool return-tool" aria-busy={loading}>
      <div className="tool-heading">
        {selected ? (
          <button className="secondary" disabled={loading} onClick={() => setSelected(null)}>
            <ArrowLeft size={16} />
            {t("back")}
          </button>
        ) : (
          <p>{t("select")}</p>
        )}
        <button
          className="secondary"
          title={t("refresh")}
          aria-label={t("refresh")}
          disabled={loading}
          onClick={() => setVersion((v) => v + 1)}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      {loading && <p role="status">{t("loading")}</p>}
      {error && (
        <p role="alert" className="phone-alert warning">
          {t("failed")}
        </p>
      )}
      {!loading &&
        !error &&
        (selected && payment ? (
          <>
            <div className="return-receipt">
              <span className="return-mark">
                <ArrowDownLeft size={23} />
              </span>
              <small>{t("received")}</small>
              <strong>{payment.payer.display_name}</strong>
              <span>{payment.payer.iban_masked}</span>
              <b>{money(payment.amount, lang)}</b>
              <small>
                {new Date(payment.received_at).toLocaleString(lang === "kk" ? "kk-KZ" : "ru-KZ", {
                  timeZone: "Asia/Almaty",
                })}
              </small>
            </div>
            <p>{t("because")}</p>
            {payment.review_state !== "none" && (
              <p className="safety-result" role="status">
                {t(payment.review_state)}
              </p>
            )}
            {payment.refund_status ? (
              <div className="return-completion">
                <strong>{t("outcome")}</strong>
                <Badge status={payment.refund_status} />
                {payment.refund_status === "cooling_off" && payment.refund_transaction_id && onReview && (
                  <button
                    className="secondary"
                    disabled={transferDisabled}
                    onClick={() => onReview(payment.refund_transaction_id!)}
                  >
                    {t("check")}
                  </button>
                )}
              </div>
            ) : intent ? (
              <div className="return-confirm">
                <strong>
                  {t(
                    intent === "return_to_sender"
                      ? "confirmReturn"
                      : intent === "report_redirect"
                        ? "confirmReport"
                        : "confirmAppeal",
                  )}
                </strong>
                <button
                  className="primary"
                  disabled={intent === "return_to_sender" && transferDisabled}
                  onClick={() => void submit()}
                >
                  {t("confirm")}
                </button>
                <button className="secondary" onClick={() => setIntent(null)}>
                  {t("cancel")}
                </button>
              </div>
            ) : (
              <>
                {(payment.review_state === "none" || payment.review_state === "cleared") && (
                  <button
                    className="primary"
                    disabled={transferDisabled}
                    onClick={() => setIntent("return_to_sender")}
                  >
                    <ShieldCheck size={18} />
                    {t("return_to_sender")}
                  </button>
                )}
                {payment.review_state === "none" && (
                  <button className="secondary" onClick={() => setIntent("report_redirect")}>
                    {t("report_redirect")}
                  </button>
                )}
                {payment.can_appeal && (
                  <button className="secondary" onClick={() => setIntent("appeal")}>
                    {t("appeal")}
                  </button>
                )}
              </>
            )}
          </>
        ) : items.length ? (
          <ul className="return-list">
            {items.map((item) => (
              <li key={item.original_id}>
                <button onClick={() => setSelected(item.original_id)}>
                  <span className="return-mark">
                    <ArrowDownLeft size={18} />
                  </span>
                  <span>
                    <strong>{item.payer.display_name}</strong>
                    <small>
                      {new Date(item.received_at).toLocaleDateString(lang === "kk" ? "kk-KZ" : "ru-KZ", {
                        timeZone: "Asia/Almaty",
                      })}
                    </small>
                  </span>
                  <b>{money(item.amount, lang)}</b>
                  <ChevronRight size={15} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>{t("empty")}</p>
        ))}
    </section>
  );
}

export function ReturnReviewControls({
  id,
  disabled,
  onChanged,
}: {
  id: string;
  disabled: boolean;
  onChanged: () => void;
}) {
  const { lang } = useLocale();
  const t = (key: keyof typeof words) => copy(lang, key);
  const [data, setData] = useState<IncomingPayment | null>(null);
  const [error, setError] = useState(false);
  const [version, setVersion] = useState(0);
  const [choice, setChoice] = useState<"clear" | "uphold" | null>(null);
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    setData(null);
    setError(false);
    setChoice(null);
    void api<IncomingPayment>("returns/" + id)
      .then((value) => {
        if (active) setData(value);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [id, version]);
  async function submit() {
    if (lock.current || !choice || !data || !["reported", "appealed"].includes(data.review_state)) return;
    lock.current = true;
    setSaving(true);
    try {
      setData(
        await api<IncomingPayment>("soc/returns/" + id + "/review", {
          method: "POST",
          body: JSON.stringify({ decision: choice, stage: data.review_state, confirmed: true }),
        }),
      );
      onChanged();
    } catch {
      setError(true);
    } finally {
      lock.current = false;
      setSaving(false);
      setChoice(null);
    }
  }
  return (
    <section className="return-review">
      <h3>{t("review")}</h3>
      {error ? (
        <>
          <p role="alert">{t("failed")}</p>
          <button className="secondary" onClick={() => setVersion((v) => v + 1)}>
            {t("refresh")}
          </button>
        </>
      ) : !data ? (
        <p role="status">{t("loading")}</p>
      ) : (
        <>
          {data.review_state !== "none" && <p>{t(data.review_state)}</p>}
          {(data.review_state === "reported" || data.review_state === "appealed") && (
            <>
              <p>{t("reviewHint")}</p>
              {choice ? (
                <>
                  <strong>{t(choice)}</strong>
                  <button className="primary" disabled={saving || disabled} onClick={() => void submit()}>
                    {t("confirm")}
                  </button>
                  <button className="secondary" disabled={saving} onClick={() => setChoice(null)}>
                    {t("cancel")}
                  </button>
                </>
              ) : (
                <>
                  {(["clear", "uphold"] as const).map((key) => (
                    <button
                      className="secondary"
                      key={key}
                      disabled={disabled}
                      onClick={() => setChoice(key)}
                    >
                      {t(key)}
                    </button>
                  ))}
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
