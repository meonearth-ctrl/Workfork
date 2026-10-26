// Weekly roster. Managers: plan, edit, auto-plan from the forecast, check
// rules and coverage, publish. Employees: the published plan, read-only, with
// their own row first.
// Query: ?week=<date>  &add=<employeeId|open>:<date>  &edit=<shiftId>

import Link from "next/link";
import { Badge, Button, Card, LinkButton, Notice, PageHeader } from "@/components/ui";
import { formatDay, WeekNav } from "@/components/week-nav";
import { isManager, requireUser } from "@/lib/auth/session";
import { formatHours, formatMinute, isValidIsoDate, localDate, weekStart } from "@/lib/domain/dates";
import { approvedLeaveDates } from "@/lib/domain/leave";
import { paidMinutes, Violation } from "@/lib/domain/rules";
import { getLocation, getQualifications, getTemplates, getWeekPlan, Shift } from "@/lib/data/planning";
import { autoPlanWeek, clearDrafts, deleteShift, publishWeek } from "./actions";
import { ShiftForm } from "./shift-form";

export default async function SchedulePage({ searchParams }: PageProps<"/schedule">) {
  const user = await requireUser();
  const sp = await searchParams;
  const manager = isManager(user);
  const location = await getLocation(user.locationId);
  const today = localDate(new Date(), location.timezone);
  const thisMonday = weekStart(today);
  const monday = typeof sp.week === "string" && isValidIsoDate(sp.week) ? weekStart(sp.week) : thisMonday;
  const plan = await getWeekPlan(user.locationId, monday);
  const [templates, qualifications] = await Promise.all([getTemplates(user.locationId), getQualifications()]);

  // Employees only ever see published shifts.
  const visible = manager ? plan.shifts : plan.shifts.filter((s) => s.published);
  const absent = approvedLeaveDates(plan.leave);
  const holidayName = new Map(plan.holidays.map((h) => [h.date, h.name]));
  const templateById = new Map(templates.map((t) => [t.id, t]));
  const drafts = plan.shifts.filter((s) => !s.published).length;
  const errorCount = [...plan.violations.values()].flat().filter((v) => v.severity === "error").length;
  const employees = manager ? plan.employees
    : [...plan.employees].sort((a, b) => (a.id === user.employeeId ? -1 : b.id === user.employeeId ? 1 : 0));

  // Editor panel state from the URL.
  const editShift = manager && typeof sp.edit === "string" ? plan.shifts.find((s) => s.id === Number(sp.edit)) : undefined;
  const add = manager && typeof sp.add === "string" ? /^(open|\d+):(\d{4}-\d{2}-\d{2})$/.exec(sp.add) : null;

  return (
    <>
      <PageHeader
        title="Schedule"
        subtitle={manager ? `${plan.location.name} · drafts are only visible to managers until published` : `${plan.location.name} · published shifts`}
        actions={<WeekNav monday={monday} basePath="/schedule" thisMonday={thisMonday} />}
      />
      {sp.planned && <Notice tone="good">Auto-planning added {String(sp.planned)} draft shift(s). Review them, then publish.</Notice>}
      {sp.published && <Notice tone="good">Week published — employees can now see their shifts.</Notice>}

      {manager && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <form action={autoPlanWeek}><input type="hidden" name="week" value={monday} /><Button type="submit">Auto-plan from forecast</Button></form>
          <form action={publishWeek}><input type="hidden" name="week" value={monday} />
            <Button type="submit" variant="secondary" disabled={drafts === 0}>Publish week{drafts ? ` (${drafts} drafts)` : ""}</Button></form>
          <form action={clearDrafts}><input type="hidden" name="week" value={monday} />
            <Button type="submit" variant="danger" disabled={drafts === 0}>Clear drafts</Button></form>
          <LinkButton href={`/schedule?week=${monday}&add=open:${monday}`}>+ Shift</LinkButton>
          {errorCount > 0 ? <Badge tone="bad">⚠ {errorCount} rule violation(s)</Badge> : <Badge tone="good">✓ No rule violations</Badge>}
          {plan.historyDays < 14 && <Badge tone="warn">Forecast has only {plan.historyDays} days of history</Badge>}
        </div>
      )}

      {(editShift || add) && (
        <Card title={editShift ? "Edit shift" : "New shift"} className="mb-4" actions={editShift && (
          <form action={deleteShift}><input type="hidden" name="id" value={editShift.id} /><Button variant="danger" type="submit">Delete</Button></form>
        )}>
          <ShiftForm
            key={editShift ? `e${editShift.id}` : sp.add as string}
            week={monday}
            shift={editShift}
            defaults={{ employeeId: add && add[1] !== "open" ? Number(add[1]) : null, date: add ? add[2] : monday }}
            employees={plan.employees.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}` }))}
            templates={templates}
            qualifications={qualifications}
          />
          {editShift && plan.violations.get(editShift.id) && (
            <ul className="mt-3 list-disc pl-5 text-sm text-rose-700">
              {plan.violations.get(editShift.id)!.map((v) => <li key={v.code}>{v.message}</li>)}
            </ul>
          )}
        </Card>
      )}

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[960px] table-fixed border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left">
              <th className="w-48 px-3 py-2 font-medium text-slate-600">Employee</th>
              {plan.dates.map((d) => (
                <th key={d} className={`px-2 py-2 font-medium ${d === today ? "text-brand" : "text-slate-600"}`}>
                  {formatDay(d)}
                  {holidayName.has(d) && <div className="truncate text-xs font-normal text-amber-700">{holidayName.get(d)}</div>}
                </th>
              ))}
            </tr>
            {manager && (
              <tr className="border-b border-slate-200 text-xs">
                <th className="px-3 py-1.5 text-left font-normal text-slate-500">Coverage (staff-hours)</th>
                {plan.dates.map((d) => {
                  const s = plan.summary.get(d)!;
                  return (
                    <th key={d} className="px-2 py-1.5 text-left font-normal">
                      <Link href={`/forecast?date=${d}`} className="block hover:underline">
                        <span className="tabular-nums text-slate-700">{s.plannedHours} / {s.neededHours}</span>{" "}
                        {s.neededHours === 0 ? <span className="text-slate-400">closed</span>
                          : s.shortHours > 0.5 ? <span className="text-rose-700">▼ {s.shortHours} short</span>
                          : <span className="text-emerald-700">✓</span>}
                      </Link>
                    </th>
                  );
                })}
              </tr>
            )}
          </thead>
          <tbody>
            {employees.map((e) => {
              const mine = visible.filter((s) => s.employeeId === e.id);
              const minutes = mine.reduce((sum, s) => sum + paidMinutes(s), 0);
              return (
                <tr key={e.id} className={`border-b border-slate-100 align-top ${e.id === user.employeeId ? "bg-indigo-50/40" : ""}`}>
                  <td className="px-3 py-2">
                    <div className="truncate font-medium">{e.firstName} {e.lastName}</div>
                    <div className="text-xs text-slate-500">{formatHours(minutes)} / {e.contractHoursWeek} h</div>
                  </td>
                  {plan.dates.map((d) => (
                    <td key={d} className="px-1.5 py-1.5">
                      {absent.get(e.id)?.has(d) && (
                        <div className="mb-1 rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-800">
                          {manager ? leaveLabel(plan.leave, e.id, d) : "Away"}
                        </div>
                      )}
                      {mine.filter((s) => s.date === d).map((s) => (
                        <ShiftChip key={s.id} shift={s} manager={manager} monday={monday}
                          color={s.templateId ? templateById.get(s.templateId)?.color : undefined}
                          name={s.templateId ? templateById.get(s.templateId)?.name : undefined}
                          violations={manager ? plan.violations.get(s.id) : undefined} />
                      ))}
                      {manager && (
                        <Link href={`/schedule?week=${monday}&add=${e.id}:${d}`} aria-label={`Add shift for ${e.firstName} on ${d}`}
                          className="block rounded px-1.5 text-xs text-slate-300 hover:bg-slate-100 hover:text-slate-600">+</Link>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
            {manager && (
              <tr className="bg-amber-50/40 align-top">
                <td className="px-3 py-2"><div className="font-medium">Open shifts</div><div className="text-xs text-slate-500">Nobody available yet</div></td>
                {plan.dates.map((d) => (
                  <td key={d} className="px-1.5 py-1.5">
                    {visible.filter((s) => s.employeeId === null && s.date === d).map((s) => (
                      <ShiftChip key={s.id} shift={s} manager monday={monday}
                        color={s.templateId ? templateById.get(s.templateId)?.color : undefined}
                        name={s.templateId ? templateById.get(s.templateId)?.name : undefined} />
                    ))}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function leaveLabel(leave: { employeeId: number; type: string; startDate: string; endDate: string; status: string }[], employeeId: number, d: string) {
  const l = leave.find((x) => x.employeeId === employeeId && x.status === "approved" && x.startDate <= d && d <= x.endDate);
  return l ? { vacation: "Vacation", sick: "Sick", unpaid: "Unpaid leave", other: "Absent" }[l.type] ?? "Absent" : "Absent";
}

function ShiftChip({ shift, manager, monday, color = "#94a3b8", name, violations }: {
  shift: Shift; manager: boolean; monday: string; color?: string; name?: string; violations?: Violation[];
}) {
  const errors = violations?.filter((v) => v.severity === "error") ?? [];
  const warnings = violations?.filter((v) => v.severity === "warning") ?? [];
  const body = (
    <div
      className={`mb-1 rounded-md border-l-4 px-1.5 py-1 text-xs shadow-sm ${shift.published ? "bg-white" : "border-dashed bg-slate-50"} ${errors.length ? "ring-1 ring-rose-300" : ""}`}
      style={{ borderLeftColor: color }}
      title={[...errors, ...warnings].map((v) => v.message).join("\n") || undefined}
    >
      <div className="font-medium tabular-nums text-slate-800">{formatMinute(shift.startMinute)}–{formatMinute(shift.endMinute)}</div>
      <div className="flex items-center gap-1 text-slate-500">
        <span className="truncate">{name ?? "Custom"}</span>
        {!shift.published && manager && <span className="text-slate-400">· draft</span>}
      </div>
      {errors.length > 0 && <div className="text-rose-700">⚠ {errors[0].message}{errors.length > 1 ? ` (+${errors.length - 1})` : ""}</div>}
      {errors.length === 0 && warnings.length > 0 && <div className="text-amber-700">! {warnings[0].message}</div>}
    </div>
  );
  return manager ? <Link href={`/schedule?week=${monday}&edit=${shift.id}`} className="block hover:opacity-80">{body}</Link> : body;
}
