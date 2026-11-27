// Turns idealo price strings into numbers.
// "1.234,56 €" -> 1234.56   |   "£165.00" -> 165   |   "£1,165.00" -> 1165
// Returns null if there is no usable number (never guesses).
export function parsePrice(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const s = value.replace(/[^\d.,]/g, "");
  if (!s) return null;
  let normalized;
  if (value.includes("£")) {
    normalized = s.replace(/,/g, ""); // UK: comma = thousands, dot = decimals
  } else {
    normalized = s.replace(/\./g, "").replace(",", "."); // EU: dot = thousands, comma = decimals
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export const GBP_TO_EUR = 1.17;
