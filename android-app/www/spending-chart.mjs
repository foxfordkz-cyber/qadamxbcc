import { shortDate } from "./wallet-date.mjs";
// The mobile gateway supplies decimal KZT amounts and one row per Kazakhstan date.
function cents(value) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw new TypeError("Invalid posted amount");
  return BigInt(match[1]) * 100n + BigInt((match[2] || "").padEnd(2, "0"));
}
const decimal = (n) =>
  String(n / 100n) + "." + String(n % 100n).padStart(2, "0");

export function bucketDays(series, days) {
  const width = days <= 7 ? 1 : days <= 30 ? 5 : 10;
  const ordered = [...series].sort((a, b) => a.day.localeCompare(b.day));
  const groups = [];
  for (let i = 0; i < ordered.length; i += width) {
    const rows = ordered.slice(i, i + width);
    let income = 0n,
      expense = 0n;
    for (const row of rows) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.day))
        throw new TypeError("Invalid ledger date");
      income += cents(row.incoming);
      expense += cents(row.outgoing);
    }
    groups.push({
      from: rows[0].day,
      to: rows.at(-1).day,
      incoming: decimal(income),
      outgoing: decimal(expense),
    });
  }
  return groups;
}
export function scaleMax(groups) {
  const peak = Math.max(
    0,
    ...groups.flatMap((g) => [Number(g.incoming), Number(g.outgoing)]),
  );
  if (!peak) return 0;
  const power = 10 ** Math.floor(Math.log10(peak));
  return [1, 2, 5, 10].find((n) => n * power >= peak) * power;
}
export function cashPlot(d, selectedDate, { T, E, amount, icon }) {
  let groups;
  try {
    groups = bucketDays(d.series, d.days);
  } catch {
    return (
      '<p class="error-banner">' +
      T(
        "Не удалось прочитать данные графика.",
        "График деректерін оқу мүмкін болмады.",
      ) +
      "</p>"
    );
  }
  const maximum = scaleMax(groups);
  if (!d.count || !groups.length)
    return (
      '<p class="empty">' +
      T("За этот период операций нет.", "Бұл кезеңде операция жоқ.") +
      "</p>"
    );
  if (!maximum)
    return (
      '<p class="empty">' +
      T(
        "Операции есть. Проведённых поступлений и расходов пока нет.",
        "Операциялар бар. Орындалған кіріс пен шығыс әзірге жоқ.",
      ) +
      "</p>"
    );
  const selected =
    groups.find((g) => selectedDate >= g.from && selectedDate <= g.to) ||
    groups.at(-1);
  const tickLabel = (value) => {
    const unit = value >= 1e9 ? [1e9, T("млрд", "млрд")] :
      value >= 1e6 ? [1e6, "млн"] : value >= 1e3 ? [1e3, T("тыс.", "мың")] : [1, ""];
    return String(Number((value / unit[0]).toPrecision(3))).replace(".", ",") + (unit[1] ? " " + unit[1] : "");
  };
  const cols = groups
    .map((g, i) => {
      const inc = (Number(g.incoming) * 100) / maximum,
        out = (Number(g.outgoing) * 100) / maximum;
      const tick =
        groups.length <= 4 ||
        i === 0 ||
        i === groups.length - 1 ||
        i === Math.floor(groups.length / 2)
          ? shortDate(g.from)
          : "";
      return (
        '<button class="plot-col" data-chart-day="' +
        g.to +
        '" aria-pressed="' +
        (g === selected) +
        '" aria-label="' +
        E(
          shortDate(g.from) +
            " / " +
            shortDate(g.to) +
            " · " +
            amount(g.incoming) +
            " / " +
            amount(g.outgoing),
        ) +
        '"><svg viewBox="0 0 20 100" preserveAspectRatio="none" aria-hidden="true"><rect x="2" width="7" y="' +
        (100 - inc) +
        '" height="' +
        inc +
        '" rx="1"/><rect x="11" width="7" y="' +
        (100 - out) +
        '" height="' +
        out +
        '" rx="1"/></svg><span>' +
        E(tick) +
        "</span></button>"
      );
    })
    .join("");
  const range =
    shortDate(selected.from) +
    (selected.from === selected.to ? "" : " – " + shortDate(selected.to));
  return (
    '<div class="plot-legend"><span>' +
    T("Поступления", "Кіріс") +
    "</span><span>" +
    T("Расходы", "Шығыс") +
    '</span></div><div class="plot-unit">₸</div><div class="chart-scroll plot-layout"><div class="plot-scale"><span>' +
    E(tickLabel(maximum)) +
    "</span><span>" +
    E(tickLabel(maximum / 2)) +
    '</span><span>0</span></div><div class="plot-columns">' +
    cols +
    "</div></div>" +
    '<button class="selected-day" data-drill-day="' +
    selected.from +
    '" data-through="' +
    selected.to +
    '"><span><b>' +
    E(range) +
    "</b><small>" +
    T("Открыть операции", "Операцияларды ашу") +
    '</small></span><span class="plot-values">+' +
    amount(selected.incoming) +
    "<br>−" +
    amount(selected.outgoing) +
    "</span>" +
    icon("arrow") +
    "</button>"
  );
}
