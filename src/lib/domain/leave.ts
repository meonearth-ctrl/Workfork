// Leave: counting working days in a request, yearly vacation balances, and
// who else is away (for approval decisions).

import { eachDay, IsoDate, isWeekend } from "./dates";

export interface LeaveLike {
  id: number;
  employeeId: number;
  type: "vacation" | "sick" | "unpaid" | "other";
  startDate: IsoDate;
  endDate: IsoDate;
  status: "pending" | "approved" | "rejected" | "cancelled";
}

// Working days (Mon–Fri, not a public holiday) inside [start, end].
export function leaveWorkingDays(startDate: IsoDate, endDate: IsoDate, holidays: Set<IsoDate>): IsoDate[] {
  if (endDate < startDate) return [];
  return eachDay(startDate, endDate).filter((d) => !isWeekend(d) && !holidays.has(d));
}

export interface LeaveBalance {
  entitlement: number;
  taken: number;     // approved vacation days in the year
  pending: number;   // requested, not yet decided
  remaining: number; // entitlement − taken − pending
}

// Only vacation draws on the entitlement; a request spanning New Year counts
// each day in its own year.
export function vacationBalance(
  entitlement: number, requests: LeaveLike[], year: number, holidays: Set<IsoDate>,
): LeaveBalance {
  let taken = 0;
  let pending = 0;
  for (const r of requests) {
    if (r.type !== "vacation") continue;
    const days = leaveWorkingDays(r.startDate, r.endDate, holidays).filter((d) => d.startsWith(`${year}-`)).length;
    if (r.status === "approved") taken += days;
    if (r.status === "pending") pending += days;
  }
  return { entitlement, taken, pending, remaining: entitlement - taken - pending };
}

export function rangesOverlap(aStart: IsoDate, aEnd: IsoDate, bStart: IsoDate, bEnd: IsoDate): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

// Dates covered by approved leave, per employee.
export function approvedLeaveDates(requests: LeaveLike[]): Map<number, Set<IsoDate>> {
  const map = new Map<number, Set<IsoDate>>();
  for (const r of requests) {
    if (r.status !== "approved") continue;
    const set = map.get(r.employeeId) ?? new Set<IsoDate>();
    for (const d of eachDay(r.startDate, r.endDate)) set.add(d);
    map.set(r.employeeId, set);
  }
  return map;
}

// For each date of a request: how many other people are already off that day.
export function concurrentAbsence(request: LeaveLike, others: LeaveLike[]): Map<IsoDate, number> {
  const counts = new Map<IsoDate, number>();
  for (const d of eachDay(request.startDate, request.endDate)) counts.set(d, 0);
  for (const o of others) {
    if (o.id === request.id || o.employeeId === request.employeeId || o.status !== "approved") continue;
    if (!rangesOverlap(request.startDate, request.endDate, o.startDate, o.endDate)) continue;
    for (const d of eachDay(o.startDate, o.endDate)) if (counts.has(d)) counts.set(d, counts.get(d)! + 1);
  }
  return counts;
}
