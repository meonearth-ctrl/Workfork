// Server-side data access for time & attendance: open clock-ins, entries in a
// week, and week accounts (worked vs target, overtime balance).

import "server-only";
import { and, asc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDays, IsoDate, localDate, parseIso } from "@/lib/domain/dates";
import { approvedLeaveDates } from "@/lib/domain/leave";
import { AccountPeriod, computeAccount } from "@/lib/domain/timeaccount";
import { Employee, getHolidays, getLeaveOverlapping, Location } from "./planning";

export type TimeEntry = typeof schema.timeEntries.$inferSelect;

export async function getOpenEntry(employeeId: number): Promise<TimeEntry | null> {
  const [row] = await db.select().from(schema.timeEntries)
    .where(and(eq(schema.timeEntries.employeeId, employeeId), isNull(schema.timeEntries.endAt)))
    .orderBy(asc(schema.timeEntries.startAt)).limit(1);
  return row ?? null;
}

// Entries whose start falls on [from, to] in the location's time zone. The SQL
// range is padded a day either side, then filtered exactly in JS.
export async function getEntries(employeeIds: number[], from: IsoDate, to: IsoDate, timeZone: string): Promise<TimeEntry[]> {
  if (employeeIds.length === 0) return [];
  const rows = await db.select().from(schema.timeEntries).where(and(
    inArray(schema.timeEntries.employeeId, employeeIds),
    gte(schema.timeEntries.startAt, parseIso(addDays(from, -1))),
    lt(schema.timeEntries.startAt, parseIso(addDays(to, 2))),
  )).orderBy(asc(schema.timeEntries.startAt));
  return rows.filter((r) => {
    const d = localDate(r.startAt, timeZone);
    return d >= from && d <= to;
  });
}

export interface EmployeeWeek {
  employee: Employee;
  account: AccountPeriod;
  entries: TimeEntry[];
  unapproved: number;
}

export async function getWeekAccounts(loc: Location, employees: Employee[], monday: IsoDate): Promise<EmployeeWeek[]> {
  const today = localDate(new Date(), loc.timezone);
  const sunday = addDays(monday, 6);
  const ids = employees.map((e) => e.id);
  const [entries, holidays, leave] = await Promise.all([
    getEntries(ids, monday, sunday, loc.timezone),
    getHolidays(loc.id, monday, sunday),
    getLeaveOverlapping(ids, monday, sunday),
  ]);
  const holidaySet = new Set(holidays.map((h) => h.date));
  const leaveDates = approvedLeaveDates(leave);
  return employees.map((employee) => {
    const mine = entries.filter((e) => e.employeeId === employee.id);
    const account = computeAccount({
      from: monday, to: sunday, contractHoursWeek: employee.contractHoursWeek, entries: mine,
      dayOf: (at) => localDate(at, loc.timezone), holidays: holidaySet, leaveDates: leaveDates.get(employee.id) ?? new Set(),
      until: today,
    });
    return { employee, account, entries: mine, unapproved: mine.filter((e) => !e.approved && e.endAt).length };
  });
}

// Turn a local wall-clock date + "HH:MM" in a time zone into an instant.
// Tries the zone's offset at that moment (handles DST changes correctly
// except inside the skipped/repeated hour itself).
export function zonedInstant(date: IsoDate, minute: number, timeZone: string): Date {
  const guess = new Date(Date.parse(`${date}T00:00:00Z`) + minute * 60_000);
  const offsetAt = (at: Date) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(at);
    const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(tz);
    return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
  };
  const first = new Date(guess.getTime() - offsetAt(guess) * 60_000);
  return new Date(guess.getTime() - offsetAt(first) * 60_000);
}
