// Leave & absence. Everyone: vacation balance, request form, own requests.
// Managers also see pending approvals (with who else is away and the
// staffing forecast for those days) and a month calendar of the team.

import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { Badge, Button, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { formatDay } from "@/components/week-nav";
import { isManager, requireUser } from "@/lib/auth/session";
import { addDays, eachDay, isWeekend, localDate } from "@/lib/domain/dates";
import { concurrentAbsence, LeaveLike, leaveWorkingDays, vacationBalance } from "@/lib/domain/leave";
import { Employee, getEmployees, getHolidays, getLeaveOverlapping, getLocation } from "@/lib/data/planning";
import { cancelLeave, decideLeave } from "./actions";
import { RequestForm } from "./request-form";

const TYPE_LABEL = { vacation: "Vacation", sick: "Sick", unpaid: "Unpaid", other: "Other" } as const;
const STATUS_TONE = { pending: "info", approved: "good", rejected: "bad", cancelled: "default" } as const;

export default async function LeavePage({ searchParams }: PageProps<"/leave">) {
  const user = await requireUser();
  const sp = await searchParams;
  const loc = await getLocation(user.locationId);
  const today = localDate(new Date(), loc.timezone);
  const year = Number(today.slice(0, 4));
  const manager = isManager(user);
  const employees = await getEmployees(loc.id);
  const me = employees.find((e) => e.id === user.employeeId);

  const yearHolidays = new Set((await getHolidays(loc.id, `${year}-01-01`, `${year}-12-31`)).map((h) => h.date));
  const myRequests = me ? await db.select().from(schema.leaveRequests)
    .where(eq(schema.leaveRequests.employeeId, me.id)).orderBy(desc(schema.leaveRequests.startDate)) : [];
  const balance = me ? vacationBalance(me.annualLeaveDays, myRequests, year, yearHolidays) : null;

  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today.slice(0, 7);

  return (
    <>
      <PageHeader title="Leave & absence" subtitle="Request time off, see your balance and who is away." />
      {balance && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={`Entitlement ${year}`} value={`${balance.entitlement} d`} />
          <Stat label="Taken" value={`${balance.taken} d`} />
          <Stat label="Pending" value={`${balance.pending} d`} />
          <Stat label="Remaining" value={`${balance.remaining} d`} tone={balance.remaining < 3 ? "warn" : "good"} />
        </div>
      )}
      {manager && <PendingApprovals employees={employees} userEmployeeId={user.employeeId} locationId={loc.id} />}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="New request">
          <RequestForm
            employees={manager ? employees.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}` })) : me ? [{ id: me.id, name: me.firstName }] : []}
            defaultEmployeeId={me?.id ?? employees[0]?.id ?? 0}
          />
          {manager && <p className="mt-2 text-xs text-slate-500">Leave you enter for someone else is recorded as approved.</p>}
        </Card>
        <Card title="My requests">
          {myRequests.length === 0 ? <EmptyState>No requests yet.</EmptyState> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {myRequests.slice(0, 12).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">{TYPE_LABEL[r.type]}</span>{" "}
                    {formatDay(r.startDate)} – {formatDay(r.endDate)}{" "}
                    <span className="text-xs text-slate-500">({leaveWorkingDays(r.startDate, r.endDate, yearHolidays).length} d)</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                    {r.status === "pending" && (
                      <form action={cancelLeave}><input type="hidden" name="id" value={r.id} /><button className="text-xs text-rose-600 underline">Cancel</button></form>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <TeamCalendar employees={employees} month={month} locationId={loc.id} showTypes={manager} />
    </>
  );
}

async function PendingApprovals({ employees, userEmployeeId, locationId }: { employees: Employee[]; userEmployeeId: number | null; locationId: number }) {
  const ids = employees.map((e) => e.id);
  if (ids.length === 0) return null;
  const pending = await db.select().from(schema.leaveRequests)
    .where(and(inArray(schema.leaveRequests.employeeId, ids), eq(schema.leaveRequests.status, "pending")))
    .orderBy(schema.leaveRequests.startDate);
  if (pending.length === 0) return <Card title="Pending approvals" className="mb-4"><EmptyState>Nothing waiting for approval.</EmptyState></Card>;
  const from = pending.reduce((m, r) => (r.startDate < m ? r.startDate : m), pending[0].startDate);
  const to = pending.reduce((m, r) => (r.endDate > m ? r.endDate : m), pending[0].endDate);
  const others = await getLeaveOverlapping(ids, from, to);
  const holidays = new Set((await getHolidays(locationId, from, to)).map((h) => h.date));
  const name = (id: number) => { const e = employees.find((x) => x.id === id); return e ? `${e.firstName} ${e.lastName}` : "?"; };

  return (
    <Card title={`Pending approvals (${pending.length})`} className="mb-4">
      <ul className="divide-y divide-slate-100">
        {pending.map((r) => {
          const overlap = concurrentAbsence(r as LeaveLike, others);
          const peak = Math.max(0, ...overlap.values());
          const overlapping = (status: string) => [...new Set(others.filter((o) => o.status === status && o.employeeId !== r.employeeId
            && o.startDate <= r.endDate && r.startDate <= o.endDate).map((o) => name(o.employeeId)))];
          const awayNames = overlapping("approved");
          const alsoRequested = overlapping("pending");
          return (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div>
                <div className="font-medium">{name(r.employeeId)} · {TYPE_LABEL[r.type]}</div>
                <div className="text-slate-600">
                  {formatDay(r.startDate)} – {formatDay(r.endDate)} · {leaveWorkingDays(r.startDate, r.endDate, holidays).length} working days
                  {r.reason && <> · “{r.reason}”</>}
                </div>
                <div className="mt-1 text-xs">
                  {peak === 0 ? <span className="text-emerald-700">✓ Nobody else is away then</span>
                    : <span className="text-amber-700">⚠ Also away: {awayNames.join(", ")} (up to {peak} at once)</span>}
                  {alsoRequested.length > 0 && <span className="text-amber-700"> · ⚠ Also requested for these days: {alsoRequested.join(", ")}</span>}
                  {" · "}<Link className="text-brand underline" href={`/schedule?week=${r.startDate}`}>See schedule</Link>
                </div>
              </div>
              {r.employeeId === userEmployeeId ? <Badge>Your own request</Badge> : (
                <form action={decideLeave} className="flex gap-2">
                  <input type="hidden" name="id" value={r.id} />
                  <Button name="decision" value="reject" variant="danger" type="submit">Reject</Button>
                  <Button name="decision" value="approve" type="submit">Approve</Button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// Colleagues see only that someone is away; the reason (e.g. sickness) is
// health data and shown to managers only.
async function TeamCalendar({ employees, month, locationId, showTypes }: { employees: Employee[]; month: string; locationId: number; showTypes: boolean }) {
  const first = `${month}-01`;
  const last = addDays(`${(Number(month.slice(5)) === 12 ? `${Number(month.slice(0, 4)) + 1}-01` : `${month.slice(0, 4)}-${String(Number(month.slice(5)) + 1).padStart(2, "0")}`)}-01`, -1);
  const days = eachDay(first, last);
  const leave = await getLeaveOverlapping(employees.map((e) => e.id), first, last);
  const holidays = new Set((await getHolidays(locationId, first, last)).map((h) => h.date));
  const prev = addDays(first, -1).slice(0, 7);
  const next = addDays(last, 1).slice(0, 7);
  const cell = (employeeId: number, d: string) => leave.find((l) => l.employeeId === employeeId && l.startDate <= d && d <= l.endDate
    && (l.status === "approved" || l.status === "pending"));
  const style = (l: LeaveLike | undefined) => !l ? "" : l.status === "pending" ? "bg-indigo-100 text-indigo-800"
    : showTypes && l.type === "sick" ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800";
  const letter = (l: LeaveLike) => (l.status === "pending" ? "?" : !showTypes ? "A" : l.type === "sick" ? "S" : "V");

  return (
    <Card title={`Team calendar · ${new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${first}T00:00:00Z`))}`}
      className="mt-4" actions={
        <div className="flex gap-2 text-sm">
          <Link className="rounded border border-slate-300 px-2 py-0.5" href={`/leave?month=${prev}`}>←</Link>
          <Link className="rounded border border-slate-300 px-2 py-0.5" href={`/leave?month=${next}`}>→</Link>
        </div>
      }>
      <div className="mb-2 flex flex-wrap gap-3 text-xs text-slate-600">
        {showTypes ? <>
          <span className="inline-flex items-center gap-1"><span className="rounded bg-emerald-100 px-1 text-emerald-800">V</span> Vacation / other (approved)</span>
          <span className="inline-flex items-center gap-1"><span className="rounded bg-rose-100 px-1 text-rose-800">S</span> Sick</span>
        </> : <span className="inline-flex items-center gap-1"><span className="rounded bg-emerald-100 px-1 text-emerald-800">A</span> Away</span>}
        <span className="inline-flex items-center gap-1"><span className="rounded bg-indigo-100 px-1 text-indigo-800">?</span> Pending</span>
        <span className="inline-flex items-center gap-1"><span className="rounded bg-slate-200 px-1">·</span> Weekend / holiday</span>
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white pr-2 text-left font-medium text-slate-500">Employee</th>
              {days.map((d) => <th key={d} className={`w-6 min-w-6 text-center font-normal ${isWeekend(d) || holidays.has(d) ? "text-slate-400" : "text-slate-600"}`}>{Number(d.slice(8))}</th>)}
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id}>
                <td className="sticky left-0 whitespace-nowrap bg-white py-0.5 pr-2">{e.firstName} {e.lastName[0]}.</td>
                {days.map((d) => {
                  const l = cell(e.id, d);
                  const off = isWeekend(d) || holidays.has(d);
                  return (
                    <td key={d} className="p-px text-center">
                      <div title={l ? `${showTypes ? TYPE_LABEL[l.type] : "Away"} (${l.status})` : undefined}
                        className={`h-5 rounded-sm leading-5 ${l ? style(l) : off ? "bg-slate-100" : ""}`}>
                        {l ? letter(l) : ""}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
