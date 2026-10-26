// Time accounts: worked time from clock entries, statutory minimum breaks, the
// daily target from contract hours, and the running overtime balance.
// Target per working day = weekly contract hours / 5 (Mon–Fri); public holidays
// and approved leave days have no target, so they neither cost nor earn time.

import { eachDay, IsoDate, isWeekend } from "./dates";

export interface TimeEntryLike {
  startAt: Date;
  endAt: Date | null;    // null = still clocked in (counted up to `now`)
  breakMinutes: number;
}

// Statutory minimum break for a working time span (German ArbZG §4, a common
// reference: > 6 h → 30 min, > 9 h → 45 min). Recorded breaks count if longer.
export function statutoryBreak(spanMinutes: number): number {
  if (spanMinutes > 9 * 60) return 45;
  if (spanMinutes > 6 * 60) return 30;
  return 0;
}

export function workedMinutes(entry: TimeEntryLike, now: Date = new Date()): number {
  const end = entry.endAt ?? now;
  const span = Math.max(0, Math.round((end.getTime() - entry.startAt.getTime()) / 60_000));
  const pause = Math.max(entry.breakMinutes, statutoryBreak(span));
  return Math.max(0, span - pause);
}

export function dailyTargetMinutes(contractHoursWeek: number): number {
  return Math.round((contractHoursWeek * 60) / 5);
}

export interface DayAccount {
  date: IsoDate;
  workedMinutes: number;
  targetMinutes: number;
  balanceMinutes: number; // worked − target
  note: "" | "holiday" | "leave" | "weekend" | "upcoming";
}

export interface AccountPeriod {
  days: DayAccount[];
  workedMinutes: number;
  targetMinutes: number;
  balanceMinutes: number;
}

// `dayOf` maps an entry to its calendar day in the location's time zone.
export function computeAccount(params: {
  from: IsoDate;
  to: IsoDate;
  contractHoursWeek: number;
  entries: TimeEntryLike[];
  dayOf: (at: Date) => IsoDate;
  holidays: Set<IsoDate>;
  leaveDates: Set<IsoDate>;
  // Last day that counts towards the target (normally today): a week in
  // progress shouldn't show Friday's hours as missing on Monday.
  until?: IsoDate;
  now?: Date;
}): AccountPeriod {
  const worked = new Map<IsoDate, number>();
  for (const e of params.entries) {
    const d = params.dayOf(e.startAt);
    worked.set(d, (worked.get(d) ?? 0) + workedMinutes(e, params.now));
  }
  const dailyTarget = dailyTargetMinutes(params.contractHoursWeek);
  const days = eachDay(params.from, params.to).map((date): DayAccount => {
    const note: DayAccount["note"] = params.holidays.has(date) ? "holiday"
      : params.leaveDates.has(date) ? "leave" : isWeekend(date) ? "weekend"
      : params.until && date > params.until ? "upcoming" : "";
    const targetMinutes = note === "" ? dailyTarget : 0;
    const w = worked.get(date) ?? 0;
    return { date, workedMinutes: w, targetMinutes, balanceMinutes: w - targetMinutes, note };
  });
  const sum = (k: "workedMinutes" | "targetMinutes" | "balanceMinutes") => days.reduce((s, d) => s + d[k], 0);
  return { days, workedMinutes: sum("workedMinutes"), targetMinutes: sum("targetMinutes"), balanceMinutes: sum("balanceMinutes") };
}
