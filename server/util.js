export function trim(value) {
  return String(value || "").trim();
}

export function toNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}
