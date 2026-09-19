/**
 * Printed-date helpers for the scan screen. Labels print dates in whatever form
 * the packer likes ("Sep 5", "09/05/26", "2026-09-05"), and OCR keeps that text
 * verbatim, so parsing is best-effort: anything unrecognised returns null and
 * the user picks the date by hand.
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function monthIndex(name: string): number {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase());
}

function fullYear(year: string | undefined, fallback: number): number {
  if (!year) return fallback;
  const value = Number(year);
  return year.length <= 2 ? 2000 + value : value;
}

function build(year: number, month: number, day: number, time: RegExpMatchArray | null): Date | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const hours = time ? Number(time[1]) : 0;
  const minutes = time ? Number(time[2]) : 0;
  const date = new Date(year, month, day, hours, minutes);
  // Rejects rollovers such as Feb 31 becoming Mar 3.
  return date.getMonth() === month && date.getDate() === day ? date : null;
}

export function parsePrintedDate(text: string | null | undefined): Date | null {
  if (!text) return null;
  const currentYear = new Date().getFullYear();
  const time = text.match(/\b(\d{1,2}):(\d{2})\b/);

  const iso = text.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) return build(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), time);

  // US order, matching the label formats the OCR date pattern targets.
  const numeric = text.match(/\b(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?\b/);
  if (numeric) {
    return build(fullYear(numeric[3], currentYear), Number(numeric[1]) - 1, Number(numeric[2]), time);
  }

  const monthFirst = text.match(/\b([A-Za-z]{3,9})\.?\s*(\d{1,2})(?!\d)(?:,?\s+(\d{4}|\d{2}))?\b/);
  if (monthFirst && monthIndex(monthFirst[1]) >= 0) {
    return build(
      fullYear(monthFirst[3], currentYear),
      monthIndex(monthFirst[1]),
      Number(monthFirst[2]),
      time,
    );
  }

  const dayFirst = text.match(/\b(\d{1,2})\s*([A-Za-z]{3,9})\.?,?\s*(\d{4}|\d{2})?\b/);
  if (dayFirst && monthIndex(dayFirst[2]) >= 0) {
    return build(
      fullYear(dayFirst[3], currentYear),
      monthIndex(dayFirst[2]),
      Number(dayFirst[1]),
      time,
    );
  }

  return null;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Local "YYYY-MM-DD HH:mm" -- what the API stores as the item's printed date. */
export function formatPrintedDate(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
