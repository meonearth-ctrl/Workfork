// Automatic shift planning: fill each day's forecast staffing need with shift
// templates, assigning people who are qualified, not absent, within the labour
// rules, and furthest below their contract hours (fair spread). Greedy: pick
// the template that covers the most unmet need, staff it, repeat. A template is
// only used when at least 40 % of its hours fill real shortfall, so small gaps
// stay visible instead of being buried under overstaffing. People whose
// contract hours are used up are only asked as a last resort; where nobody is
// allowed to work, an open shift is created.

import { IsoDate, weekStart } from "./dates";
import { HourlySeries, plannedCoverage } from "./forecast";
import { candidateErrors, EmployeeContext, paidMinutes, PlannedShift, RuleConfig } from "./rules";

// Share of a template's hours that must cover unmet need for it to be used.
// 0.4 measured best on the demo store (vs 0.25 / 0.35 / 0.5): ~6 % short and
// ~10 % over, against 45 % short-hours at 0.5 without short templates.
const MIN_USEFUL_SHARE = 0.4;

export interface TemplateLike {
  id: number;
  startMinute: number;
  endMinute: number;
  breakMinutes: number;
  qualificationId: number | null;
}

export interface AutoScheduleInput {
  dates: IsoDate[];
  need: Map<IsoDate, HourlySeries>;
  templates: TemplateLike[];
  employees: EmployeeContext[];
  existing: PlannedShift[];          // already planned (kept as is), incl. adjacent weeks
  rules: RuleConfig;
  createOpenShifts?: boolean;        // default true
}

export interface ProposedShift extends PlannedShift {
  templateId: number;
}

export interface AutoScheduleResult {
  shifts: ProposedShift[];
  unfilledStaffHours: number;        // need that remains after planning
}

// Staff-hours of unmet need a template would cover on a day.
function templateGain(t: TemplateLike, residual: HourlySeries): number {
  let gain = 0;
  for (let hour = Math.floor(t.startMinute / 60); hour < Math.ceil(Math.min(t.endMinute, 1440) / 60); hour++) {
    const overlap = (Math.min(t.endMinute, (hour + 1) * 60) - Math.max(t.startMinute, hour * 60)) / 60;
    if (overlap > 0) gain += Math.min(Math.max(residual[hour], 0), overlap);
  }
  return gain;
}

export function autoSchedule(input: AutoScheduleInput): AutoScheduleResult {
  const createOpen = input.createOpenShifts ?? true;
  const all: PlannedShift[] = [...input.existing];
  const proposed: ProposedShift[] = [];
  let nextId = 1;
  let unfilled = 0;

  const plannedMinutesInWeek = (employeeId: number, date: IsoDate) => {
    const week = weekStart(date);
    return all.filter((s) => s.employeeId === employeeId && weekStart(s.date) === week)
      .reduce((sum, s) => sum + paidMinutes(s), 0);
  };

  for (const date of input.dates) {
    const need = input.need.get(date);
    if (!need) continue;
    // Safety cap: never more shifts per day than staff-hours needed.
    for (let guard = 0; guard < 200; guard++) {
      const covered = plannedCoverage(all, date);
      const residual = need.map((n, h) => n - covered[h]);
      let best: TemplateLike | null = null;
      let bestScore = 0;
      for (const t of input.templates) {
        const length = (Math.min(t.endMinute, 1440) - t.startMinute) / 60;
        const gain = templateGain(t, residual);
        // Prefer templates that are mostly useful, not just long.
        const score = gain * (gain / Math.max(length, 0.5));
        if (gain >= length * MIN_USEFUL_SHARE && score > bestScore) {
          best = t;
          bestScore = score;
        }
      }
      if (!best) break;

      const candidateBase = {
        date, startMinute: best.startMinute, endMinute: best.endMinute,
        breakMinutes: best.breakMinutes, qualificationId: best.qualificationId,
      };
      // Fairness: the person with the most contract hours still unplanned this
      // week; people the shift would push over their contract come last.
      const shiftMinutes = paidMinutes(best);
      const ranked = input.employees
        .map((e) => ({ e, remaining: e.contractHoursWeek * 60 - plannedMinutesInWeek(e.id, date) }))
        .filter(({ e }) => e.contractHoursWeek > 0)
        .sort((a, b) => Number(b.remaining >= shiftMinutes) - Number(a.remaining >= shiftMinutes) || b.remaining - a.remaining);

      let assigned: EmployeeContext | null = null;
      for (const { e } of ranked) {
        const candidate: PlannedShift = { id: `new-${nextId}`, employeeId: e.id, ...candidateBase };
        const mine = all.filter((s) => s.employeeId === e.id);
        if (candidateErrors(e, mine, candidate, input.rules).length === 0) {
          assigned = e;
          break;
        }
      }
      // Nobody may work it: stop this day (the gap is counted below).
      if (!assigned && !createOpen) break;
      const shift: ProposedShift = {
        id: `new-${nextId++}`, employeeId: assigned ? assigned.id : null, templateId: best.id, ...candidateBase,
      };
      all.push(shift);
      proposed.push(shift);
    }
    const finalCovered = plannedCoverage(all.filter((s) => s.employeeId !== null), date);
    unfilled += need.reduce((sum, n, h) => sum + Math.max(0, n - finalCovered[h]), 0);
  }
  return { shifts: proposed, unfilledStaffHours: Math.round(unfilled * 10) / 10 };
}
