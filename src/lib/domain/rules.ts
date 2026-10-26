// Labour-rule checks for planned shifts: overlaps, minimum rest between shifts,
// daily and weekly maximum hours, consecutive working days, qualifications and
// approved absence. Pure functions: the schedule page, the auto-scheduler and
// the save action all use the same checks.

import { addDays, daysBetween, IsoDate, weekStart } from "./dates";

export interface RuleConfig {
  minRestHours: number;
  maxDailyHours: number;
  maxWeeklyHours: number;
  maxConsecutiveDays: number;
}

export const DEFAULT_RULES: RuleConfig = { minRestHours: 11, maxDailyHours: 10, maxWeeklyHours: 48, maxConsecutiveDays: 6 };

export interface PlannedShift {
  id: number | string;
  employeeId: number | null;
  date: IsoDate;
  startMinute: number;
  endMinute: number;          // > startMinute; may pass 1440 for overnight shifts
  breakMinutes: number;
  qualificationId: number | null;
}

export interface EmployeeContext {
  id: number;
  qualificationIds: number[];
  contractHoursWeek: number;
  absentDates: Set<IsoDate>;  // approved leave
}

export type ViolationCode =
  | "overlap" | "rest" | "daily_max" | "weekly_max" | "consecutive_days"
  | "qualification" | "absent" | "over_contract";

export interface Violation {
  shiftId: PlannedShift["id"];
  code: ViolationCode;
  severity: "error" | "warning";
  message: string;
}

// ── Shift arithmetic ─────────────────────────────────────────────────────────
export function paidMinutes(s: Pick<PlannedShift, "startMinute" | "endMinute" | "breakMinutes">): number {
  return Math.max(0, s.endMinute - s.startMinute - s.breakMinutes);
}

// Absolute minutes relative to an epoch date, so shifts on different days compare.
function absStart(s: PlannedShift, epoch: IsoDate): number {
  return daysBetween(epoch, s.date) * 1440 + s.startMinute;
}
function absEnd(s: PlannedShift, epoch: IsoDate): number {
  return daysBetween(epoch, s.date) * 1440 + s.endMinute;
}

const hours = (m: number) => Math.round((m / 60) * 10) / 10;

// ── Checks ───────────────────────────────────────────────────────────────────
// Checks every shift of one employee. Pass all of that employee's shifts in a
// window wide enough for the rules (the planned week plus a week either side).
export function checkEmployeeShifts(
  employee: EmployeeContext,
  employeeShifts: PlannedShift[],
  rules: RuleConfig = DEFAULT_RULES,
): Violation[] {
  const violations: Violation[] = [];
  if (employeeShifts.length === 0) return violations;
  const sorted = [...employeeShifts].sort((a, b) => (a.date === b.date ? a.startMinute - b.startMinute : a.date < b.date ? -1 : 1));
  const epoch = sorted[0].date;

  for (const s of sorted) {
    if (s.qualificationId != null && !employee.qualificationIds.includes(s.qualificationId)) {
      violations.push({ shiftId: s.id, code: "qualification", severity: "error", message: "Employee lacks the qualification this shift needs" });
    }
    if (employee.absentDates.has(s.date)) {
      violations.push({ shiftId: s.id, code: "absent", severity: "error", message: "Employee has approved leave on this day" });
    }
  }

  // Overlap and rest time between consecutive shifts.
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const gap = absStart(cur, epoch) - absEnd(prev, epoch);
    if (gap < 0) {
      violations.push({ shiftId: cur.id, code: "overlap", severity: "error", message: "Overlaps another shift" });
    } else if (gap < rules.minRestHours * 60 && cur.date !== prev.date) {
      violations.push({
        shiftId: cur.id, code: "rest", severity: "error",
        message: `Only ${hours(gap)} h rest since the previous shift (minimum ${rules.minRestHours} h)`,
      });
    }
  }

  // Daily maximum (all shifts starting that day, e.g. split shifts).
  const byDate = new Map<IsoDate, PlannedShift[]>();
  for (const s of sorted) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  for (const [, dayShifts] of byDate) {
    const total = dayShifts.reduce((sum, s) => sum + paidMinutes(s), 0);
    if (total > rules.maxDailyHours * 60) {
      const last = dayShifts[dayShifts.length - 1];
      violations.push({
        shiftId: last.id, code: "daily_max", severity: "error",
        message: `${hours(total)} h on one day (maximum ${rules.maxDailyHours} h)`,
      });
    }
  }

  // Weekly maximum (legal) and contract hours (a planning hint).
  const byWeek = new Map<IsoDate, PlannedShift[]>();
  for (const s of sorted) byWeek.set(weekStart(s.date), [...(byWeek.get(weekStart(s.date)) ?? []), s]);
  for (const [, weekShifts] of byWeek) {
    const total = weekShifts.reduce((sum, s) => sum + paidMinutes(s), 0);
    const last = weekShifts[weekShifts.length - 1];
    if (total > rules.maxWeeklyHours * 60) {
      violations.push({
        shiftId: last.id, code: "weekly_max", severity: "error",
        message: `${hours(total)} h this week (maximum ${rules.maxWeeklyHours} h)`,
      });
    } else if (total > employee.contractHoursWeek * 60 * 1.1) {
      violations.push({
        shiftId: last.id, code: "over_contract", severity: "warning",
        message: `${hours(total)} h planned this week vs ${employee.contractHoursWeek} h contract`,
      });
    }
  }

  // Consecutive working days.
  const workDates = [...byDate.keys()].sort();
  let run = 1;
  for (let i = 1; i < workDates.length; i++) {
    run = workDates[i] === addDays(workDates[i - 1], 1) ? run + 1 : 1;
    if (run === rules.maxConsecutiveDays + 1) {
      const shift = byDate.get(workDates[i])![0];
      violations.push({
        shiftId: shift.id, code: "consecutive_days", severity: "warning",
        message: `${run} working days in a row (maximum ${rules.maxConsecutiveDays})`,
      });
    }
  }
  return violations;
}

// Would adding `candidate` create an error for this employee? Used by the
// auto-scheduler and by the save action to block illegal assignments.
export function candidateErrors(
  employee: EmployeeContext,
  existing: PlannedShift[],
  candidate: PlannedShift,
  rules: RuleConfig = DEFAULT_RULES,
): Violation[] {
  const before = new Set(checkEmployeeShifts(employee, existing, rules).map((v) => `${v.shiftId}:${v.code}`));
  return checkEmployeeShifts(employee, [...existing, candidate], rules)
    .filter((v) => v.severity === "error" && !before.has(`${v.shiftId}:${v.code}`));
}
