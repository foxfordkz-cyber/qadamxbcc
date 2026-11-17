import type { Evaluation, Lang } from "./contracts";

const signalKeys = ["active_call", "from_deposit", "is_new_device", "is_new_recipient", "pasted_recipient"] as const;
const timingKeys = ["behavioral", "velocity", "graph", "ml", "total"] as const;
const validTime = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? value : null;

/** Deliberate allowlist: never serialize an API response or arbitrary evidence wholesale. */
export function caseReport(detail: Evaluation, lang: Lang, exportedAt = new Date().toISOString()) {
  return {
    schema_version: 1,
    report_kind: "bcc-shield-decision-record",
    exported_at: exportedAt,
    language: lang,
    scope: {
      kk: "Ағымдағы шешім мен бастапқы ML бағасының сақталған жазбасы. Банк төлемінің растамасы немесе толық аудит журналы емес.",
      ru: "Сохранённая запись текущего решения и исходной ML-оценки. Не подтверждение банковского платежа и не полный журнал аудита.",
    },
    transaction: {
      id: detail.transaction_id, status: detail.status, risk_score: detail.risk_score,
      amount: detail.amount ?? null, currency: "KZT",
      created_at: validTime(detail.created_at), updated_at: validTime(detail.updated_at),
      resolved_at: validTime(detail.resolved_at), cooling_off_until: validTime(detail.cooling_off_until),
    },
    context_signals: Object.fromEntries(signalKeys.flatMap(key => {
      const value = detail.context?.[key];
      return typeof value === "boolean" ? [[key, value]] : [];
    })),
    verification_answers_saved: detail.verification_answers != null,
    reasons: detail.reasons.map(reason => ({ code: reason.code, layer: reason.layer, score_delta: reason.score_delta, reason_kk: reason.reason_kk, reason_ru: reason.reason_ru })),
    ml: {
      score: detail.ml_score ?? null, base_score: detail.ml_base_score ?? null,
      model_version: detail.ml_model_version ?? null, explanation_method: detail.ml_explanation_method ?? null,
      contributors: (detail.ml_contributors ?? []).map(item => ({ feature: item.feature, value: item.value, contribution: item.contribution, label_kk: item.label_kk, label_ru: item.label_ru })),
    },
    latency: {
      scoring_ms: detail.latency_ms,
      layers_ms: Object.fromEntries(timingKeys.flatMap(key => {
        const value = detail.layer_latency_ms[key];
        return typeof value === "number" && Number.isFinite(value) && value >= 0 ? [[key, value]] : [];
      })),
    },
  };
}

export function caseTimestamps(detail: Evaluation) {
  const values: { key: "caseCreated" | "caseUpdated" | "caseResolved" | "caseHoldDeadline"; time: string; future: boolean }[] = [];
  if (validTime(detail.created_at)) values.push({ key: "caseCreated", time: detail.created_at!, future: false });
  if (validTime(detail.updated_at) && detail.updated_at !== detail.created_at && detail.updated_at !== detail.resolved_at) values.push({ key: "caseUpdated", time: detail.updated_at!, future: false });
  if (validTime(detail.resolved_at)) values.push({ key: "caseResolved", time: detail.resolved_at!, future: false });
  if (detail.status === "cooling_off" && validTime(detail.cooling_off_until)) values.push({ key: "caseHoldDeadline", time: detail.cooling_off_until!, future: true });
  return values;
}
