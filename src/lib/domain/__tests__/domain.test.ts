// Unit tests for the scheduling, forecasting, time-account and leave logic.

import { describe, expect, it } from "vitest";
import { addDays, eachDay, formatMinute, isoWeekday, isValidIsoDate, localDate, parseMinute, weekStart } from "../dates";
import { candidateErrors, checkEmployeeShifts, DEFAULT_RULES, EmployeeContext, PlannedShift } from "../rules";
import { forecastDemand, plannedCoverage, staffNeeded, summarizeCoverage, trendFactor, DemandPoint } from "../forecast";
import { autoSchedule } from "../autoschedule";
import { computeAccount, statutoryBreak, workedMinutes } from "../timeaccount";
import { approvedLeaveDates, concurrentAbsence, leaveWorkingDays, vacationBalance, LeaveLike } from "../leave";

const shift = (id: number, date: string, start: string, end: string, extra: Partial<PlannedShift> = {}): PlannedShift => {
  const s = parseMinute(start)!;
  let e = parseMinute(end)!;
  if (e <= s) e += 1440;
  return { id, employeeId: 1, date, startMinute: s, endMinute: e, breakMinutes: 0, qualificationId: null, ...extra };
};
const emp = (extra: Partial<EmployeeContext> = {}): EmployeeContext =>
  ({ id: 1, qualificationIds: [], contractHoursWeek: 40, absentDates: new Set(), ...extra });

describe("dates", () => {
  it("handles weeks, ranges and formatting", () => {
    expect(weekStart("2026-10-29")).toBe("2026-10-26");     // Thursday -> Monday
    expect(isoWeekday("2026-11-01")).toBe(7);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(eachDay("2026-02-27", "2026-03-02")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
    expect(formatMinute(1530)).toBe("01:30");
    expect(parseMinute("25:00")).toBeNull();
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    // 23:30 UTC on 25 Oct is already 26 Oct in Berlin? No: CET = UTC+1 -> 00:30 on the 26th.
    expect(localDate(new Date("2026-10-25T23:30:00Z"), "Europe/Berlin")).toBe("2026-10-26");
  });
});

describe("labour rules", () => {
  it("accepts a normal week", () => {
    const week = eachDay("2026-10-26", "2026-10-30").map((d, i) => shift(i, d, "09:00", "17:30", { breakMinutes: 30 }));
    expect(checkEmployeeShifts(emp(), week)).toEqual([]);
  });

  it("flags overlap, short rest and long days", () => {
    const v = checkEmployeeShifts(emp(), [
      shift(1, "2026-10-26", "14:00", "23:00"),
      shift(2, "2026-10-27", "06:00", "12:00"),          // 7 h rest
      shift(3, "2026-10-28", "08:00", "20:00"),          // 12 h day
      shift(4, "2026-10-28", "19:00", "21:00"),          // overlaps #3
    ]);
    expect(v.map((x) => x.code).sort()).toEqual(["daily_max", "overlap", "rest"]);
    expect(v.find((x) => x.code === "rest")!.shiftId).toBe(2);
  });

  it("handles overnight shifts for rest time", () => {
    const v = checkEmployeeShifts(emp(), [shift(1, "2026-10-26", "22:00", "06:00"), shift(2, "2026-10-27", "14:00", "22:00")]);
    expect(v.map((x) => x.code)).toEqual(["rest"]);         // 8 h after a night shift
  });

  it("checks qualification, absence, weekly maximum, contract and consecutive days", () => {
    const days = eachDay("2026-10-26", "2026-11-01");       // 7 days Mon–Sun
    const v = checkEmployeeShifts(
      emp({ qualificationIds: [], absentDates: new Set(["2026-10-27"]) }),
      days.map((d, i) => shift(i, d, "08:00", "15:30", { qualificationId: i === 0 ? 5 : null })),
    );
    const codes = v.map((x) => x.code);
    expect(codes).toContain("qualification");
    expect(codes).toContain("absent");
    expect(codes).toContain("weekly_max");                   // 7 × 7.5 h = 52.5 h
    expect(codes).toContain("consecutive_days");
  });

  it("candidateErrors only reports problems the new shift causes", () => {
    const existing = [shift(1, "2026-10-26", "09:00", "17:00")];
    expect(candidateErrors(emp(), existing, shift(9, "2026-10-27", "09:00", "17:00"))).toEqual([]);
    expect(candidateErrors(emp(), existing, shift(9, "2026-10-27", "02:00", "08:00"))[0].code).toBe("rest");
  });
});

describe("forecast", () => {
  // 8 weeks of history: Mondays busier than other days; steady growth.
  const history: DemandPoint[] = [];
  for (const d of eachDay("2026-08-31", "2026-10-25")) {
    const weekIndex = Math.floor((Date.parse(d) - Date.parse("2026-08-31")) / (7 * 86400000));
    for (let h = 8; h < 20; h++) history.push({ date: d, hour: h, volume: (isoWeekday(d) === 1 ? 60 : 30) + weekIndex });
  }

  it("follows the weekday pattern", () => {
    const f = forecastDemand(history, ["2026-10-26", "2026-10-27"]);
    expect(f.get("2026-10-26")![10]).toBeGreaterThan(f.get("2026-10-27")![10] * 1.5);
    expect(f.get("2026-10-26")![3]).toBe(0);
  });

  it("applies a damped trend and closes holidays", () => {
    const t = trendFactor(history, "2026-10-26");
    expect(t).toBeGreaterThan(1);
    expect(t).toBeLessThanOrEqual(1.25);
    const f = forecastDemand(history, ["2026-10-26"], { closedDates: new Set(["2026-10-26"]) });
    expect(f.get("2026-10-26")!.every((v) => v === 0)).toBe(true);
  });

  it("turns volume into staff need and compares with the plan", () => {
    const volume = Array.from({ length: 24 }, (_, h) => (h >= 8 && h < 20 ? 45 : 0));
    const need = staffNeeded(volume, { productivity: 20, minStaff: 1, openHour: 8, closeHour: 20 });
    expect(need[8]).toBe(3);
    expect(need[20]).toBe(0);
    expect(staffNeeded(Array(24).fill(0), { productivity: 20, minStaff: 2, openHour: 8, closeHour: 20 })[10]).toBe(0);
    const planned = plannedCoverage([shift(1, "2026-10-26", "08:00", "14:30"), shift(2, "2026-10-25", "22:00", "09:00")], "2026-10-26");
    expect(planned[8]).toBe(2);         // day shift + end of the night shift
    expect(planned[14]).toBe(0.5);
    const s = summarizeCoverage(need, planned);
    expect(s.neededHours).toBe(36);
    expect(s.shortHours).toBeGreaterThan(25);
  });
});

describe("auto-scheduler", () => {
  const need = Array.from({ length: 24 }, (_, h) => (h >= 8 && h < 20 ? 2 : 0));
  const templates = [
    { id: 1, startMinute: 8 * 60, endMinute: 14 * 60 + 30, breakMinutes: 30, qualificationId: null },
    { id: 2, startMinute: 13 * 60 + 30, endMinute: 20 * 60, breakMinutes: 30, qualificationId: null },
  ];
  const people = [1, 2, 3, 4].map((id) => emp({ id, contractHoursWeek: 30 }));

  it("covers the need without breaking rules and spreads hours", () => {
    const dates = eachDay("2026-10-26", "2026-10-30");
    const result = autoSchedule({
      dates, need: new Map(dates.map((d) => [d, need])), templates, employees: people, existing: [], rules: DEFAULT_RULES,
    });
    expect(result.unfilledStaffHours).toBe(0);
    for (const d of dates) {
      const cover = plannedCoverage(result.shifts, d);
      for (let h = 8; h < 20; h++) expect(cover[h]).toBeGreaterThanOrEqual(2);
    }
    for (const p of people) {
      const mine = result.shifts.filter((s) => s.employeeId === p.id);
      expect(checkEmployeeShifts(p, mine).filter((v) => v.severity === "error")).toEqual([]);
      expect(mine.length).toBeGreaterThanOrEqual(4);       // fair spread: 20 shifts over 4 people
    }
  });

  it("doesn't add a whole shift for a one-hour peak, and respects contracts first", () => {
    const peaky = need.map((n, h) => (h === 12 ? 3 : n));
    const dates = eachDay("2026-10-26", "2026-10-30");
    const staff = [emp({ id: 1, contractHoursWeek: 15 }), ...[2, 3, 4, 5].map((id) => emp({ id, contractHoursWeek: 40 }))];
    const result = autoSchedule({
      dates, need: new Map(dates.map((d) => [d, peaky])), templates, employees: staff, existing: [], rules: DEFAULT_RULES,
    });
    for (const d of dates) expect(result.shifts.filter((s) => s.date === d)).toHaveLength(4);   // not 5
    expect(result.unfilledStaffHours).toBe(5);                                                    // the peaks stay visible
    const lucaMinutes = result.shifts.filter((s) => s.employeeId === 1).reduce((m, s) => m + s.endMinute - s.startMinute - s.breakMinutes, 0);
    expect(lucaMinutes).toBeLessThanOrEqual(15 * 60);
  });

  it("leaves an open shift when nobody may work", () => {
    const result = autoSchedule({
      dates: ["2026-10-26"], need: new Map([["2026-10-26", need]]), templates,
      employees: [emp({ id: 1, absentDates: new Set(["2026-10-26"]) })], existing: [], rules: DEFAULT_RULES,
    });
    expect(result.shifts.length).toBeGreaterThan(0);
    expect(result.shifts.every((s) => s.employeeId === null)).toBe(true);
    expect(result.unfilledStaffHours).toBe(24);
  });
});

describe("time accounts", () => {
  it("applies statutory breaks", () => {
    expect(statutoryBreak(6 * 60)).toBe(0);
    expect(statutoryBreak(8 * 60)).toBe(30);
    expect(statutoryBreak(10 * 60)).toBe(45);
    const e = { startAt: new Date("2026-10-26T07:00:00Z"), endAt: new Date("2026-10-26T15:30:00Z"), breakMinutes: 15 };
    expect(workedMinutes(e)).toBe(8 * 60);                  // 8.5 h − 30 min (not 15)
  });

  it("computes balance with holidays and leave", () => {
    const entry = (d: string) => ({ startAt: new Date(`${d}T07:00:00Z`), endAt: new Date(`${d}T16:00:00Z`), breakMinutes: 30 });
    const acc = computeAccount({
      from: "2026-10-26", to: "2026-11-01", contractHoursWeek: 40,
      entries: ["2026-10-26", "2026-10-27", "2026-10-28"].map(entry),
      dayOf: (at) => at.toISOString().slice(0, 10),
      holidays: new Set(["2026-10-29"]), leaveDates: new Set(["2026-10-30"]),
    });
    expect(acc.targetMinutes).toBe(3 * 480);
    expect(acc.workedMinutes).toBe(3 * 510);
    expect(acc.balanceMinutes).toBe(90);
    expect(acc.days.find((d) => d.date === "2026-10-29")!.note).toBe("holiday");
  });

  it("only counts target hours up to today in a running week", () => {
    const acc = computeAccount({
      from: "2026-10-26", to: "2026-11-01", contractHoursWeek: 40, entries: [],
      dayOf: (at) => at.toISOString().slice(0, 10), holidays: new Set(), leaveDates: new Set(), until: "2026-10-27",
    });
    expect(acc.targetMinutes).toBe(2 * 480);
    expect(acc.days.find((d) => d.date === "2026-10-30")!.note).toBe("upcoming");
  });
});

describe("leave", () => {
  const holidays = new Set(["2026-12-25", "2026-12-26"]);
  const req = (id: number, employeeId: number, s: string, e: string, status: LeaveLike["status"], type: LeaveLike["type"] = "vacation"): LeaveLike =>
    ({ id, employeeId, type, startDate: s, endDate: e, status });

  it("counts working days and balances per year", () => {
    // 10 weekdays, minus Christmas Day (26 Dec 2026 is a Saturday); 8 fall in 2026.
    expect(leaveWorkingDays("2026-12-21", "2027-01-03", holidays)).toHaveLength(9);
    const b = vacationBalance(25, [
      req(1, 1, "2026-12-21", "2027-01-03", "approved"),
      req(2, 1, "2026-11-02", "2026-11-03", "pending"),
      req(3, 1, "2026-10-05", "2026-10-09", "approved", "sick"),
    ], 2026, holidays);
    expect(b).toEqual({ entitlement: 25, taken: 8, pending: 2, remaining: 15 });
  });

  it("finds approved dates and concurrent absence", () => {
    const all = [req(1, 1, "2026-11-02", "2026-11-04", "approved"), req(2, 2, "2026-11-03", "2026-11-05", "pending"), req(3, 3, "2026-11-04", "2026-11-04", "approved")];
    expect([...approvedLeaveDates(all).get(1)!]).toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
    const c = concurrentAbsence(all[1], all);
    expect(Object.fromEntries(c)).toEqual({ "2026-11-03": 1, "2026-11-04": 2, "2026-11-05": 0 });
  });
});
