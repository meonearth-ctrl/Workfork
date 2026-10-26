// Server-side data access for planning: loads a location's employees, shifts,
// leave, holidays and demand, and turns them into the inputs/outputs of the
// pure domain functions (forecast, coverage, rule checks). Pages call these
// after requireUser(), so every query is already scoped to a signed-in user.

import "server-only";
import { and, asc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDays, eachDay, IsoDate } from "@/lib/domain/dates";
import { forecastDemand, HourlySeries, plannedCoverage, staffNeeded, summarizeCoverage, CoverageSummary } from "@/lib/domain/forecast";
import { approvedLeaveDates, LeaveLike } from "@/lib/domain/leave";
import { checkEmployeeShifts, EmployeeContext, PlannedShift, RuleConfig, Violation } from "@/lib/domain/rules";

export type Location = typeof schema.locations.$inferSelect;
export type Employee = typeof schema.employees.$inferSelect & { qualificationIds: number[] };
export type Shift = typeof schema.shifts.$inferSelect;

export async function getLocation(id: number): Promise<Location> {
  const [loc] = await db.select().from(schema.locations).where(eq(schema.locations.id, id));
  if (!loc) throw new Error("Location not found");
  return loc;
}

export function rulesOf(loc: Location): RuleConfig {
  return {
    minRestHours: loc.minRestHours, maxDailyHours: loc.maxDailyHours,
    maxWeeklyHours: loc.maxWeeklyHours, maxConsecutiveDays: loc.maxConsecutiveDays,
  };
}

export async function getEmployees(locationId: number, includeInactive = false): Promise<Employee[]> {
  const rows = await db.select().from(schema.employees)
    .where(includeInactive ? eq(schema.employees.locationId, locationId)
      : and(eq(schema.employees.locationId, locationId), eq(schema.employees.active, true)))
    .orderBy(asc(schema.employees.lastName), asc(schema.employees.firstName));
  if (rows.length === 0) return [];
  const links = await db.select().from(schema.employeeQualifications)
    .where(inArray(schema.employeeQualifications.employeeId, rows.map((r) => r.id)));
  return rows.map((r) => ({ ...r, qualificationIds: links.filter((l) => l.employeeId === r.id).map((l) => l.qualificationId) }));
}

export async function getQualifications() {
  return db.select().from(schema.qualifications).orderBy(asc(schema.qualifications.name));
}

export async function getTemplates(locationId: number) {
  return db.select().from(schema.shiftTemplates).where(eq(schema.shiftTemplates.locationId, locationId))
    .orderBy(asc(schema.shiftTemplates.startMinute));
}

export async function getShifts(locationId: number, from: IsoDate, to: IsoDate): Promise<Shift[]> {
  return db.select().from(schema.shifts)
    .where(and(eq(schema.shifts.locationId, locationId), gte(schema.shifts.date, from), lte(schema.shifts.date, to)))
    .orderBy(asc(schema.shifts.date), asc(schema.shifts.startMinute));
}

export async function getHolidays(locationId: number, from: IsoDate, to: IsoDate) {
  return db.select().from(schema.holidays).where(and(
    or(isNull(schema.holidays.locationId), eq(schema.holidays.locationId, locationId)),
    gte(schema.holidays.date, from), lte(schema.holidays.date, to),
  )).orderBy(asc(schema.holidays.date));
}

export async function getLeaveOverlapping(employeeIds: number[], from: IsoDate, to: IsoDate): Promise<LeaveLike[]> {
  if (employeeIds.length === 0) return [];
  return db.select().from(schema.leaveRequests).where(and(
    inArray(schema.leaveRequests.employeeId, employeeIds),
    lte(schema.leaveRequests.startDate, to), gte(schema.leaveRequests.endDate, from),
  ));
}

export function toPlanned(s: Shift): PlannedShift {
  return {
    id: s.id, employeeId: s.employeeId, date: s.date, startMinute: s.startMinute, endMinute: s.endMinute,
    breakMinutes: s.breakMinutes, qualificationId: s.qualificationId,
  };
}

export function employeeContexts(employees: Employee[], leave: LeaveLike[]): EmployeeContext[] {
  const absent = approvedLeaveDates(leave);
  return employees.map((e) => ({
    id: e.id, qualificationIds: e.qualificationIds, contractHoursWeek: e.contractHoursWeek, absentDates: absent.get(e.id) ?? new Set(),
  }));
}

// Forecast volume and staff need for dates, from up to 12 weeks of history.
export async function getDemandPlan(loc: Location, dates: IsoDate[]) {
  const first = dates[0];
  const last = dates[dates.length - 1];
  const history = await db.select().from(schema.demandHistory).where(and(
    eq(schema.demandHistory.locationId, loc.id), gte(schema.demandHistory.date, addDays(first, -7 * 12)),
    lte(schema.demandHistory.date, addDays(first, -1)),
  ));
  const holidays = await getHolidays(loc.id, addDays(first, -7 * 12), last);
  const closed = new Set(holidays.map((h) => h.date));
  const volume = forecastDemand(history, dates, { closedDates: closed });
  const need = new Map<IsoDate, HourlySeries>(dates.map((d) => [d, staffNeeded(volume.get(d)!, loc)]));
  return { volume, need, historyDays: new Set(history.map((h) => h.date)).size, holidays: holidays.filter((h) => h.date >= first) };
}

export interface WeekPlan {
  location: Location;
  dates: IsoDate[];
  employees: Employee[];
  shifts: Shift[];                       // this week only
  violations: Map<number, Violation[]>;  // by shift id
  need: Map<IsoDate, HourlySeries>;
  coverage: Map<IsoDate, HourlySeries>;
  summary: Map<IsoDate, CoverageSummary>;
  leave: LeaveLike[];
  holidays: { date: string; name: string }[];
  historyDays: number;
}

// Everything the schedule grid needs for one week. Rule checks look one week
// either side so rest time and consecutive days across the boundary count.
export async function getWeekPlan(locationId: number, monday: IsoDate): Promise<WeekPlan> {
  const location = await getLocation(locationId);
  const dates = eachDay(monday, addDays(monday, 6));
  const [employees, windowShifts] = await Promise.all([
    getEmployees(locationId), getShifts(locationId, addDays(monday, -7), addDays(monday, 13)),
  ]);
  const leave = await getLeaveOverlapping(employees.map((e) => e.id), addDays(monday, -7), addDays(monday, 13));
  const contexts = employeeContexts(employees, leave);
  const rules = rulesOf(location);

  const violations = new Map<number, Violation[]>();
  for (const ctx of contexts) {
    const mine = windowShifts.filter((s) => s.employeeId === ctx.id).map(toPlanned);
    for (const v of checkEmployeeShifts(ctx, mine, rules)) {
      const id = v.shiftId as number;
      violations.set(id, [...(violations.get(id) ?? []), v]);
    }
  }
  const { need, historyDays, holidays } = await getDemandPlan(location, dates);
  const assigned = windowShifts.filter((s) => s.employeeId !== null).map(toPlanned);
  const coverage = new Map(dates.map((d) => [d, plannedCoverage(assigned, d)]));
  const summary = new Map(dates.map((d) => [d, summarizeCoverage(need.get(d)!, coverage.get(d)!)]));
  return {
    location, dates, employees, shifts: windowShifts.filter((s) => s.date >= monday && s.date <= dates[6]),
    violations, need, coverage, summary, leave, holidays, historyDays,
  };
}
