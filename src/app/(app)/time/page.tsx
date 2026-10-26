// Time & attendance. Employees: clock, own week account and entries.
// Managers: the team's week (worked vs target, overtime, approvals), and any
// employee's detail via ?employee=<id>.

import Link from "next/link";
import { Badge, Button, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { formatDay, WeekNav } from "@/components/week-nav";
import { isManager, requireUser } from "@/lib/auth/session";
import { formatHours, isValidIsoDate, localDate, weekStart } from "@/lib/domain/dates";
import { workedMinutes } from "@/lib/domain/timeaccount";
import { getEmployees, getLocation } from "@/lib/data/planning";
import { EmployeeWeek, getOpenEntry, getWeekAccounts } from "@/lib/data/time";
import { approveEntries, deleteEntry } from "./actions";
import { AddEntryForm } from "./add-entry-form";
import { ClockCard } from "./clock-card";

export default async function TimePage({ searchParams }: PageProps<"/time">) {
  const user = await requireUser();
  const sp = await searchParams;
  const loc = await getLocation(user.locationId);
  const today = localDate(new Date(), loc.timezone);
  const thisMonday = weekStart(today);
  const monday = typeof sp.week === "string" && isValidIsoDate(sp.week) ? weekStart(sp.week) : thisMonday;
  const manager = isManager(user);
  const employees = await getEmployees(loc.id);
  const requested = Number(sp.employee);
  const focusId = manager && employees.some((e) => e.id === requested) ? requested : user.employeeId;

  const open = user.employeeId ? await getOpenEntry(user.employeeId) : null;
  const params: Record<string, string> = focusId && focusId !== user.employeeId ? { employee: String(focusId) } : {};

  if (manager && !sp.employee) {
    const weeks = await getWeekAccounts(loc, employees, monday);
    return (
      <>
        <PageHeader title="Time & attendance" subtitle="Worked time against contract targets, overtime and approvals."
          actions={<WeekNav monday={monday} basePath="/time" thisMonday={thisMonday} />} />
        {user.employeeId && <div className="mb-4"><ClockCard open={open} timeZone={loc.timezone} /></div>}
        <TeamTable weeks={weeks} monday={monday} />
        <Card title="Add a time entry" className="mt-4">
          <AddEntryForm employees={employees.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}` }))}
            defaultEmployeeId={employees[0]?.id ?? 0} defaultDate={today} />
        </Card>
      </>
    );
  }

  const focus = employees.find((e) => e.id === focusId);
  if (!focus) {
    return <><PageHeader title="Time & attendance" /><EmptyState>Your account isn&apos;t linked to an employee record.</EmptyState></>;
  }
  const [week] = await getWeekAccounts(loc, [focus], monday);
  return (
    <>
      <PageHeader
        title={focus.id === user.employeeId ? "My time" : `${focus.firstName} ${focus.lastName}`}
        subtitle={manager && focus.id !== user.employeeId ? <Link className="underline" href={`/time?week=${monday}`}>← Team overview</Link> : `Contract: ${focus.contractHoursWeek} h/week`}
        actions={<WeekNav monday={monday} basePath="/time" params={params} thisMonday={thisMonday} />}
      />
      {focus.id === user.employeeId && <div className="mb-4"><ClockCard open={open} timeZone={loc.timezone} /></div>}
      <EmployeeWeekView week={week} timeZone={loc.timezone} canApprove={manager} />
      <Card title="Add a time entry" className="mt-4">
        <AddEntryForm employees={[{ id: focus.id, name: focus.firstName }]} defaultEmployeeId={focus.id} defaultDate={today} />
        {!manager && <p className="mt-2 text-xs text-slate-500">Entries you add are checked and approved by your manager.</p>}
      </Card>
    </>
  );
}

function balanceTone(minutes: number) {
  return minutes > 60 ? "warn" : minutes < -60 ? "bad" : "good";
}

function TeamTable({ weeks, monday }: { weeks: EmployeeWeek[]; monday: string }) {
  const pending = weeks.flatMap((w) => w.entries.filter((e) => !e.approved && e.endAt).map((e) => e.id));
  return (
    <Card title="Team this week" actions={pending.length > 0 && (
      <form action={approveEntries}>
        {pending.map((id) => <input key={id} type="hidden" name="id" value={id} />)}
        <Button type="submit">Approve all ({pending.length})</Button>
      </form>
    )}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="py-2">Employee</th><th>Worked</th><th>Target</th><th>Balance</th><th>To approve</th></tr>
          </thead>
          <tbody className="tabular-nums">
            {weeks.map(({ employee, account, unapproved }) => (
              <tr key={employee.id} className="border-t border-slate-100">
                <td className="py-2">
                  <Link className="font-medium text-slate-900 hover:underline" href={`/time?employee=${employee.id}&week=${monday}`}>
                    {employee.firstName} {employee.lastName}
                  </Link>
                </td>
                <td>{formatHours(account.workedMinutes)}</td>
                <td>{formatHours(account.targetMinutes)}</td>
                <td><Badge tone={balanceTone(account.balanceMinutes)}>{account.balanceMinutes > 0 ? "+" : ""}{formatHours(account.balanceMinutes)}</Badge></td>
                <td>{unapproved > 0 ? <Badge tone="info">{unapproved}</Badge> : <span className="text-slate-400">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function EmployeeWeekView({ week, timeZone, canApprove }: { week: EmployeeWeek; timeZone: string; canApprove: boolean }) {
  const time = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(d);
  const noteLabel = { holiday: "Public holiday", leave: "Leave", weekend: "", upcoming: "", "": "" };
  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Worked" value={formatHours(week.account.workedMinutes)} />
        <Stat label="Target" value={formatHours(week.account.targetMinutes)} hint="Contract hours ÷ 5 per working day, up to today" />
        <Stat label="Balance" value={`${week.account.balanceMinutes > 0 ? "+" : ""}${formatHours(week.account.balanceMinutes)}`}
          tone={balanceTone(week.account.balanceMinutes)} hint="Overtime (+) or minus hours (−)" />
      </div>
      <Card title="Days">
        <div className="divide-y divide-slate-100">
          {week.account.days.map((day) => {
            const entries = week.entries.filter((e) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(e.startAt) === day.date);
            return (
              <div key={day.date} className="flex flex-wrap items-start gap-x-6 gap-y-1 py-2 text-sm">
                <div className="w-28 font-medium">{formatDay(day.date)}</div>
                <div className="flex-1 space-y-1">
                  {entries.length === 0 && <span className="text-slate-400">{noteLabel[day.note] || "No time recorded"}</span>}
                  {entries.map((e) => (
                    <div key={e.id} className="flex flex-wrap items-center gap-2">
                      <span className="tabular-nums">{time(e.startAt)} – {e.endAt ? time(e.endAt) : "now"}</span>
                      <span className="text-xs text-slate-500">{formatHours(workedMinutes(e))}</span>
                      {e.endAt === null ? <Badge tone="info">Clocked in</Badge> : e.approved ? <Badge tone="good">Approved</Badge> : <Badge>Pending</Badge>}
                      {e.note && <span className="text-xs text-slate-500">“{e.note}”</span>}
                      {canApprove && !e.approved && e.endAt && (
                        <form action={approveEntries}><input type="hidden" name="id" value={e.id} /><button className="text-xs text-brand underline">Approve</button></form>
                      )}
                      {(canApprove || !e.approved) && (
                        <form action={deleteEntry}><input type="hidden" name="id" value={e.id} /><button className="text-xs text-rose-600 underline">Delete</button></form>
                      )}
                    </div>
                  ))}
                </div>
                <div className="w-40 text-right tabular-nums text-slate-600">
                  {formatHours(day.workedMinutes)} / {formatHours(day.targetMinutes)}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}
