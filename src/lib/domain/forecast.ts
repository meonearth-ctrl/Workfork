// Demand forecasting and staffing need. The forecast for a future day and hour
// is a recency-weighted average of the same weekday and hour over the last N
// weeks, scaled by a damped recent trend. Simple, explainable, and robust with
// a few weeks of history. Need = workload / productivity, never below the
// minimum staffing while open.

import { addDays, IsoDate, isoWeekday } from "./dates";
import { PlannedShift } from "./rules";

export interface DemandPoint {
  date: IsoDate;
  hour: number;     // 0–23
  volume: number;
}

export interface ForecastOptions {
  weeks?: number;            // how much history to use (default 8)
  decay?: number;            // weight multiplier per week further back (default 0.8)
  closedDates?: Set<IsoDate>; // holidays: no demand
}

export type HourlySeries = number[]; // length 24

const emptyDay = (): HourlySeries => Array.from({ length: 24 }, () => 0);

// Ratio of the last 4 weeks' total to the 4 weeks before, damped (square root)
// and clamped, so one unusual month can't double the plan.
export function trendFactor(history: DemandPoint[], asOf: IsoDate): number {
  const sum = (from: IsoDate, to: IsoDate) =>
    history.filter((p) => p.date >= from && p.date < to).reduce((s, p) => s + p.volume, 0);
  const recent = sum(addDays(asOf, -28), asOf);
  const previous = sum(addDays(asOf, -56), addDays(asOf, -28));
  if (recent <= 0 || previous <= 0) return 1;
  return Math.min(1.25, Math.max(0.8, Math.sqrt(recent / previous)));
}

export function forecastDemand(
  history: DemandPoint[],
  targetDates: IsoDate[],
  options: ForecastOptions = {},
): Map<IsoDate, HourlySeries> {
  const weeks = options.weeks ?? 8;
  const decay = options.decay ?? 0.8;
  const byKey = new Map<string, number>();
  for (const p of history) byKey.set(`${p.date}|${p.hour}`, (byKey.get(`${p.date}|${p.hour}`) ?? 0) + p.volume);
  const hasDay = new Set(history.map((p) => p.date));

  const result = new Map<IsoDate, HourlySeries>();
  for (const target of targetDates) {
    const series = emptyDay();
    if (options.closedDates?.has(target)) {
      result.set(target, series);
      continue;
    }
    // Same weekday in earlier weeks that actually have data, newest first.
    const pastDays: IsoDate[] = [];
    for (let back = 1; pastDays.length < weeks && back <= weeks * 2; back++) {
      const d = addDays(target, -7 * back);
      if (hasDay.has(d) && !options.closedDates?.has(d)) pastDays.push(d);
    }
    if (pastDays.length > 0) {
      // Trend is measured from the newest day used, so a forecast several
      // weeks ahead doesn't need history up to the target date.
      const trend = trendFactor(history, addDays(pastDays[0], 1));
      for (let hour = 0; hour < 24; hour++) {
        let weighted = 0;
        let totalWeight = 0;
        pastDays.forEach((d, i) => {
          const w = Math.pow(decay, i);
          weighted += w * (byKey.get(`${d}|${hour}`) ?? 0);
          totalWeight += w;
        });
        series[hour] = Math.round((weighted / totalWeight) * trend * 10) / 10;
      }
    }
    result.set(target, series);
  }
  return result;
}

export interface StaffingParams {
  productivity: number;  // volume one person handles per hour
  minStaff: number;
  openHour: number;
  closeHour: number;     // exclusive
}

// A day with no forecast demand at all (closed: Sunday, holiday) needs nobody,
// not the minimum staffing.
export function staffNeeded(volume: HourlySeries, p: StaffingParams): HourlySeries {
  if (volume.every((v) => v <= 0)) return volume.map(() => 0);
  return volume.map((v, hour) => {
    if (hour < p.openHour || hour >= p.closeHour) return 0;
    return Math.max(p.minStaff, Math.ceil(v / Math.max(p.productivity, 0.0001)));
  });
}

// People on shift in each hour of `date` (fractional for partial hours).
// Overnight shifts from the previous day are counted too. Breaks are ignored
// here because their timing isn't planned.
export function plannedCoverage(shifts: PlannedShift[], date: IsoDate): HourlySeries {
  const series = emptyDay();
  const prev = addDays(date, -1);
  for (const s of shifts) {
    let start: number;
    let end: number;
    if (s.date === date) {
      start = s.startMinute;
      end = Math.min(s.endMinute, 1440);
    } else if (s.date === prev && s.endMinute > 1440) {
      start = 0;
      end = s.endMinute - 1440;
    } else continue;
    for (let hour = Math.floor(start / 60); hour < Math.ceil(end / 60) && hour < 24; hour++) {
      const overlap = Math.min(end, (hour + 1) * 60) - Math.max(start, hour * 60);
      if (overlap > 0) series[hour] += overlap / 60;
    }
  }
  return series.map((v) => Math.round(v * 100) / 100);
}

export interface CoverageSummary {
  neededHours: number;   // staff-hours
  plannedHours: number;
  shortHours: number;    // staff-hours below need
  overHours: number;     // staff-hours above need
}

export function summarizeCoverage(need: HourlySeries, planned: HourlySeries): CoverageSummary {
  let neededHours = 0, plannedHours = 0, shortHours = 0, overHours = 0;
  for (let h = 0; h < 24; h++) {
    neededHours += need[h];
    plannedHours += planned[h];
    shortHours += Math.max(0, need[h] - planned[h]);
    overHours += Math.max(0, planned[h] - need[h]);
  }
  const r = (x: number) => Math.round(x * 10) / 10;
  return { neededHours: r(neededHours), plannedHours: r(plannedHours), shortHours: r(shortHours), overHours: r(overHours) };
}

export const weekdayName = (d: IsoDate) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][isoWeekday(d) - 1];
