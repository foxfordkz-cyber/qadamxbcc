// Inputs are server instants. Form a date key in the ledger's timezone once,
// then render numeric dates consistently even on WebViews with limited ICU data.
const clock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export function ledgerInstant(value) {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return null;
  const parts = Object.fromEntries(clock.formatToParts(instant).map(p => [p.type, p.value]));
  return { day: parts.year + "-" + parts.month + "-" + parts.day, time: parts.hour + ":" + parts.minute };
}

export function shortDate(isoDay) {
  return isoDay.slice(8, 10) + "." + isoDay.slice(5, 7);
}

export function ledgerTime(value) {
  const local = ledgerInstant(value);
  return local ? shortDate(local.day) + " · " + local.time : "—";
}
