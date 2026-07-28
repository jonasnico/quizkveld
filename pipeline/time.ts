/**
 * Start-time normalization.
 *
 * The source writes times as "19:00", "19.00", "19", "kl 19", "19:00-ish" and sometimes
 * just "?" or nothing at all. Anything we cannot read confidently becomes null rather
 * than a made-up time.
 */

const TIME_RE = /(\d{1,2})\s*[:.]\s*(\d{2})/;
const HOUR_ONLY_RE = /^(?:kl\.?\s*)?(\d{1,2})$/;

export function normalizeTime(raw: string): string | null {
  const text = raw
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text || text === "?" || text === "-" || /^ukjent$/i.test(text)) return null;

  const match = TIME_RE.exec(text);
  if (match) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (Number.isInteger(hour) && Number.isInteger(minute) && hour < 24 && minute < 60) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
    return null;
  }

  const hourOnly = HOUR_ONLY_RE.exec(text);
  if (hourOnly) {
    const hour = Number(hourOnly[1]);
    if (Number.isInteger(hour) && hour < 24) return `${String(hour).padStart(2, "0")}:00`;
  }

  return null;
}
