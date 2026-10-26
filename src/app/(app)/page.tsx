// Dashboard. Managers: today's coverage, who is working, what needs approval.
// Employees (and managers with an employee record): time clock, next shifts,
// vacation and overtime balances.

import Link from "next/link";
import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { CoverageChart } from "@/components/coverage-chart";
import { Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { formatDay } from "@/components/week-nav";
import { isManager, requireUser } from "@/lib/auth/session";
import { addDays, formatHours, formatMinute, localDate, localMinute, weekStart } from "@/lib/domain/dates";
import { vacationBalance } from "@/lib/domain/leave";
import { getEmployees, getHolidays, getLocation, getWeekPlan } from "@/lib/data/planning";
import { getOpenEntry, getWeekAccounts } from "@/lib/data/time";
import { ClockCard } from "./time/clock-card";

export default async function DashboardPage() {
  const user = await requireUser();
  const loc = await getLocation(user.locationId);
  const now = new Date();
  const today = localDate(now, loc.timezone);
  const manager = isManager(user);
  const firstName = user.name.split(" ")[0];

  return (
    <>
      <PageHeader title={`Hello, ${firstName}`} subtitle={`${formatDay(today, { weekday: "long", day: "numeric", month: "long" })} · ${loc.name}`} />
      {user.employeeId && <MySection employeeId={user.employeeId} locationId={loc.id} today={today} />}
      {manager && <ManagerSection locationId={loc.id} today={today} nowMinute={localMinute(now, loc.timezone)} />}
    </>
  );
}

async function MySection({ employeeId, locationId, today }: { employeeId: number; locationId: number; today: string }) {
  const loc = await getLocation(locationId);
  const employees = await getEmployees(locationId);
  const me = employees.find((e) => e.id === employeeId);
  if (!me) return null;
  const year = Number(today.slice(0, 4));
  const [open, [week], nextShifts, myLeave, holidays] = await Promise.all([
    getOpenEntry(employeeId),
    getWeekAccounts(loc, [me], weekStart(today)),
    db.select().from(schema.shifts).where(and(eq(schema.shifts.employeeId, employeeId), eq(schema.shifts.published, true),
      gte(schema.shifts.date, today), lte(schema.shifts.date, addDays(today, 13)))).orderBy(schema.shifts.date, schema.shifts.startMinute),
    db.select().from(schema.leaveRequests).where(eq(schema.leaveRequests.employeeId, employeeId)),
    getHolidays(locationId, `${year}-01-01`, `${year}-12-31`),
  ]);
  const vacation = vacationBalance(me.annualLeaveDays, myLeave, year, new Set(holidays.map((h) => h.date)));
  const balance = week.account.balanceMinutes;
  return (
    <div className="mb-6 grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-1">
        <ClockCard open={open} timeZone={loc.timezone} />
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Vacation left" value={`${vacation.remaining} d`} hint={`${vacation.pending} d pending`} />
          <Stat label="Balance this week" value={`${balance > 0 ? "+" : ""}${formatHours(balance)}`}
            tone={balance < -60 ? "bad" : balance > 60 ? "warn" : "good"} hint={`${formatHours(week.account.workedMinutes)} worked`} />
        </div>
      </div>
      <Card title="My next shifts" className="lg:col-span-2" actions={<Link className="text-sm text-brand hover:underline" href="/schedule">Full schedule →</Link>}>
        {nextShifts.length === 0 ? <EmptyState>No published shifts in the next two weeks.</EmptyState> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {nextShifts.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2">
                <span className="font-medium">{s.date === today ? "Today" : formatDay(s.date, { weekday: "long", day: "numeric", month: "short" })}</span>
                <span className="tabular-nums text-slate-700">{formatMinute(s.startMinute)}–{formatMinute(s.endMinute)}{s.breakMinutes ? <span className="text-xs text-slate-500"> · {s.breakMinutes} min break</span> : null}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

async function ManagerSection({ locationId, today, nowMinute }: { locationId: number; today: string; nowMinute: number }) {
  const plan = await getWeekPlan(locationId, weekStart(today));
  const ids = plan.employees.map((e) => e.id);
  const [pendingLeave, unapproved, openNow] = await Promise.all([
    ids.length ? db.select({ id: schema.leaveRequests.id }).from(schema.leaveRequests)
      .where(and(inArray(schema.leaveRequests.employeeId, ids), eq(schema.leaveRequests.status, "pending"))) : [],
    ids.length ? db.select({ id: schema.timeEntries.id, endAt: schema.timeEntries.endAt }).from(schema.timeEntries)
      .where(and(inArray(schema.timeEntries.employeeId, ids), eq(schema.timeEntries.approved, false))) : [],
    ids.length ? db.select({ employeeId: schema.timeEntries.employeeId, endAt: schema.timeEntries.endAt }).from(schema.timeEntries)
      .where(and(inArray(schema.timeEntries.employeeId, ids), isNull(schema.timeEntries.endAt))) : [],
  ]);
  const clockedIn = new Set(openNow.filter((e) => e.endAt === null).map((e) => e.employeeId));
  const summary = plan.summary.get(today)!;
  const todays = plan.shifts.filter((s) => s.date === today && s.employeeId !== null).sort((a, b) => a.startMinute - b.startMinute);
  const onShiftNow = todays.filter((s) => s.startMinute <= nowMinute && nowMinute < s.endMinute);
  const name = (id: number | null) => { const e = plan.employees.find((x) => x.id === id); return e ? `${e.firstName} ${e.lastName}` : "Open"; };
  const errors = [...plan.violations.values()].flat().filter((v) => v.severity === "error").length;

  return (
    <>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Team today</h2>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="On shift now" value={onShiftNow.length} hint={`${clockedIn.size} clocked in`} />
        <Stat label="Short today" value={`${summary.shortHours} h`} tone={summary.shortHours > 0.5 ? "bad" : "good"} hint={`${summary.plannedHours} of ${summary.neededHours} staff-hours planned`} />
        <Link href="/leave"><Stat label="Leave to approve" value={pendingLeave.length} tone={pendingLeave.length ? "warn" : "default"} /></Link>
        <Link href="/time"><Stat label="Time entries to approve" value={unapproved.filter((e) => e.endAt).length} hint={errors ? `⚠ ${errors} rule violation(s) this week` : "No rule violations this week"} /></Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Coverage today" className="lg:col-span-2" actions={<Link className="text-sm text-brand hover:underline" href={`/forecast?date=${today}`}>Forecast →</Link>}>
          {summary.neededHours === 0 && summary.plannedHours === 0 ? <EmptyState>Closed today.</EmptyState> : (
            <CoverageChart need={plan.need.get(today)!} planned={plan.coverage.get(today)!}
              fromHour={Math.max(0, plan.location.openHour - 1)} toHour={Math.min(24, plan.location.closeHour + 1)} label="Planned staff versus need today" />
          )}
        </Card>
        <Card title="Working today" actions={<Link className="text-sm text-brand hover:underline" href="/schedule">Schedule →</Link>}>
          {todays.length === 0 ? <EmptyState>No shifts today.</EmptyState> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {todays.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-1.5">
                  <span>{name(s.employeeId)}</span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums text-slate-600">{formatMinute(s.startMinute)}–{formatMinute(s.endMinute)}</span>
                    {s.employeeId !== null && clockedIn.has(s.employeeId) && <Badge tone="good">in</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
