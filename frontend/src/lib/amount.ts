/** Display amounts like a banking app ("25 000") while the form keeps the raw number. */
export function groupAmount(value: string) {
  const [whole, fraction] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
  return fraction === undefined ? grouped : `${grouped},${fraction}`;
}
export function rawAmount(display: string) {
  const raw = display.replace(/[\s\u00a0]/g, "").replace(",", ".");
  return /^\d{0,10}(\.\d{0,2})?$/.test(raw) ? raw : null;
}
