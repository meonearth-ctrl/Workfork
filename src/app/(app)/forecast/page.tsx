// Demand forecast and staffing need (managers). Week overview of forecast
// workload vs planned staff, an hourly chart for the chosen day, and CSV
// import of historical demand.

import Link from "next/link";
import { CoverageChart } from "@/components/coverage-chart";
import { Badge, Card, PageHeader, Stat } from "@/components/ui";
import { formatDay, WeekNav } from "@/components/week-nav";
import { requireManager } from "@/lib/auth/session";
import { isValidIsoDate, localDate, weekStart } from "@/lib/domain/dates";
import { getDemandPlan, getLocation, getWeekPlan } from "@/lib/data/planning";
import { ImportForm } from "./import-form";

export default async function ForecastPage({ searchParams }: PageProps<"/forecast">) {
  const user = await requireManager();
  const sp = await searchParams;
  const loc = await getLocation(user.locationId);
  const today = localDate(new Date(), loc.timezone);
  const date = typeof sp.date === "string" && isValidIsoDate(sp.date) ? sp.date
    : typeof sp.week === "string" && isValidIsoDate(sp.week) ? weekStart(sp.week) : today;
  const monday = weekStart(date);
  const plan = await getWeekPlan(loc.id, monday);
  const { volume } = await getDemandPlan(loc, plan.dates);

  const day = plan.summary.get(date)!;
  const dayVolume = volume.get(date)!.reduce((a, b) => a + b, 0);
  const totals = [...plan.summary.values()].reduce((t, s) => ({
    needed: t.needed + s.neededHours, planned: t.planned + s.plannedHours, short: t.short + s.shortHours,
  }), { needed: 0, planned: 0, short: 0 });
  const r1 = (x: number) => Math.round(x * 10) / 10;

  return (
    <>
      <PageHeader title="Demand forecast"
        subtitle={`${loc.name} · ${loc.productivity} units per person-hour · min. ${loc.minStaff} on duty while open (${loc.openHour}:00–${loc.closeHour}:00)`}
        actions={<WeekNav monday={monday} basePath="/forecast" thisMonday={weekStart(today)} />} />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Staff-hours needed (week)" value={r1(totals.needed)} />
        <Stat label="Staff-hours planned (week)" value={r1(totals.planned)} />
        <Stat label="Short (week)" value={r1(totals.short)} tone={totals.short > 4 ? "bad" : "good"} hint="Hours where fewer people are planned than needed" />
      </div>

      <Card title="Week overview" className="mb-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="py-2">Day</th><th>Forecast volume</th><th>Needed</th><th>Planned</th><th>Gap</th></tr>
            </thead>
            <tbody className="tabular-nums">
              {plan.dates.map((d) => {
                const s = plan.summary.get(d)!;
                const v = volume.get(d)!.reduce((a, b) => a + b, 0);
                return (
                  <tr key={d} className={`border-t border-slate-100 ${d === date ? "bg-indigo-50/50" : ""}`}>
                    <td className="py-2"><Link className="font-medium hover:underline" href={`/forecast?date=${d}`}>{formatDay(d)}</Link></td>
                    <td>{Math.round(v)}</td>
                    <td>{s.neededHours} h</td>
                    <td>{s.plannedHours} h</td>
                    <td>{s.neededHours === 0 ? <Badge>Closed</Badge> : s.shortHours > 0.5 ? <Badge tone="bad">▼ {s.shortHours} h short</Badge>
                      : s.overHours > s.neededHours * 0.25 ? <Badge tone="warn">▲ {s.overHours} h over</Badge> : <Badge tone="good">✓ Covered</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={`${formatDay(date, { weekday: "long", day: "numeric", month: "long" })} · people per hour`} className="mb-4"
        actions={<span className="text-xs text-slate-500">Forecast volume {Math.round(dayVolume)} · need {day.neededHours} h · planned {day.plannedHours} h</span>}>
        {day.neededHours === 0 && day.plannedHours === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">Closed or no demand expected on this day.</p>
        ) : (
          <CoverageChart need={plan.need.get(date)!} planned={plan.coverage.get(date)!}
            fromHour={Math.max(0, loc.openHour - 1)} toHour={Math.min(24, loc.closeHour + 1)} label={`Planned staff versus need on ${date}`} />
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="How the forecast works">
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>For each hour, the planner takes the same weekday and hour over the last 8 weeks, weighting recent weeks more.</li>
            <li>A recent-trend factor (last 4 weeks vs the 4 before, damped and capped at ±25 %) scales it.</li>
            <li>Public holidays are treated as closed and left out of history.</li>
            <li>Need = forecast volume ÷ productivity, rounded up, never below the minimum staffing while open.</li>
          </ul>
          <p className="mt-2 text-xs text-slate-500">History used: {plan.historyDays} days. Change productivity, opening hours and minimum staffing in Settings.</p>
        </Card>
        <Card title="Import demand history">
          <ImportForm />
        </Card>
      </div>
    </>
  );
}
