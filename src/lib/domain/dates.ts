// Calendar helpers on plain "YYYY-MM-DD" strings. All math runs in UTC so a
// date never shifts because of the server's own time zone or DST.

export type IsoDate = string;

const DAY_MS = 86_400_000;

export function parseIso(date: IsoDate): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function toIso(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return toIso(new Date(parseIso(date).getTime() + days * DAY_MS));
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((parseIso(to).getTime() - parseIso(from).getTime()) / DAY_MS);
}

// 1 = Monday … 7 = Sunday (ISO 8601).
export function isoWeekday(date: IsoDate): number {
  const d = parseIso(date).getUTCDay();
  return d === 0 ? 7 : d;
}

export function isWeekend(date: IsoDate): boolean {
  return isoWeekday(date) >= 6;
}

// Monday of the week containing `date`.
export function weekStart(date: IsoDate): IsoDate {
  return addDays(date, 1 - isoWeekday(date));
}

// Inclusive range of dates.
export function eachDay(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function weekDays(monday: IsoDate): IsoDate[] {
  return eachDay(monday, addDays(monday, 6));
}

export function isValidIsoDate(value: unknown): value is IsoDate {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && toIso(parseIso(value)) === value;
}

// "YYYY-MM-DD" of an instant as seen in a time zone (e.g. "Europe/Berlin").
export function localDate(at: Date, timeZone: string): IsoDate {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  return parts;
}

// Minutes since local midnight of an instant in a time zone.
export function localMinute(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

// "07:30" for minute 450; minutes past midnight wrap (1500 -> "01:00").
export function formatMinute(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// "07:30" -> 450. Returns null for anything that isn't HH:MM.
export function parseMinute(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h < 24 && m < 60 ? h * 60 + m : null;
}

export function formatHours(minutes: number): string {
  const sign = minutes < 0 ? "−" : "";
  const abs = Math.abs(Math.round(minutes));
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")} h`;
}
