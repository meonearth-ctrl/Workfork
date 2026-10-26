// `npm run db:setup`: apply migrations, then set up an empty database:
//   * local development (no DATABASE_URL) or SEED_DEMO=1: a demo store with
//     employees, logins, templates, 10 weeks of demand history, a planned
//     schedule, clocked time and leave, so every screen has data;
//   * production (DATABASE_URL set): one location and an administrator from
//     ADMIN_EMAIL / ADMIN_PASSWORD (and optional LOCATION_NAME, TIMEZONE).
// Safe to run repeatedly: nothing is created once a location exists.

import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import { db, schema } from "../src/db";
import { hashPassword } from "../src/lib/auth/password";
import { addDays, eachDay, isoWeekday, toIso, weekStart } from "../src/lib/domain/dates";
import { autoSchedule } from "../src/lib/domain/autoschedule";
import { forecastDemand, staffNeeded } from "../src/lib/domain/forecast";
import { DEFAULT_RULES, PlannedShift } from "../src/lib/domain/rules";

const DEMO_PASSWORD = "demo1234";

async function main() {
  const migrate = process.env.DATABASE_URL ? migratePostgres : migratePglite;
  // Both migrators take the drizzle instance; the cast bridges their driver types.
  await migrate(db as never, { migrationsFolder: "./drizzle" });
  console.log("✓ migrations applied");

  const existing = await db.select().from(schema.locations).limit(1);
  if (existing.length > 0) {
    console.log("✓ database already has data (setup skipped)");
    return;
  }
  if (!process.env.DATABASE_URL || process.env.SEED_DEMO === "1") await seed();
  else await bootstrapProduction();
}

// First run against a real database: no demo people, just a way to sign in.
async function bootstrapProduction() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email || password.length < 12) {
    throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 12 characters) for the first setup.");
  }
  await db.insert(schema.locations).values({
    name: process.env.LOCATION_NAME ?? "Main location", timezone: process.env.TIMEZONE ?? "Europe/Berlin",
  });
  await db.insert(schema.users).values({ email, passwordHash: await hashPassword(password), role: "admin" });
  console.log(`✓ created location and administrator ${email}. Add employees and shift templates in the app.`);
}

// Deterministic pseudo-random numbers so the demo looks the same every time.
let state = 42;
const rand = () => ((state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

async function seed() {
  const today = toIso(new Date());
  const thisMonday = weekStart(today);

  const [store] = await db.insert(schema.locations).values({
    name: "Berlin Mitte Store", timezone: "Europe/Berlin", openHour: 8, closeHour: 20, productivity: 18, minStaff: 1,
  }).returning();

  const quals = await db.insert(schema.qualifications)
    .values([{ name: "Cashier" }, { name: "Supervisor" }, { name: "Forklift" }]).returning();
  const [cashier, supervisor, forklift] = quals;

  // ── Employees and logins ───────────────────────────────────────────────
  const people: [string, string, string, number, number[]][] = [
    ["Anna", "Schmidt", "Store supervisor", 40, [supervisor.id, cashier.id]],
    ["Ben", "Müller", "Sales associate", 40, [cashier.id]],
    ["Clara", "Weber", "Sales associate", 30, [cashier.id]],
    ["David", "Fischer", "Warehouse", 40, [forklift.id]],
    ["Elif", "Yılmaz", "Sales associate", 20, [cashier.id]],
    ["Felix", "Wagner", "Shift lead", 40, [supervisor.id, cashier.id]],
    ["Greta", "Becker", "Sales associate", 30, [cashier.id]],
    ["Hassan", "Khan", "Warehouse", 30, [forklift.id, cashier.id]],
    ["Ida", "Hoffmann", "Sales associate", 20, [cashier.id]],
    ["Jonas", "Schulz", "Sales associate", 40, [cashier.id]],
    ["Klara", "Koch", "Sales associate", 25, [cashier.id]],
    ["Luca", "Richter", "Student assistant", 15, []],
  ];
  const emps = await db.insert(schema.employees).values(people.map(([firstName, lastName, jobTitle, hours]) => ({
    firstName, lastName, jobTitle, contractHoursWeek: hours, locationId: store.id, annualLeaveDays: hours >= 30 ? 28 : 25,
    email: `${firstName.toLowerCase().replace("ı", "i")}.${lastName.toLowerCase().replace("ü", "ue")}@example.com`,
  }))).returning();
  await db.insert(schema.employeeQualifications).values(
    emps.flatMap((e, i) => people[i][4].map((qualificationId) => ({ employeeId: e.id, qualificationId }))),
  );

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  await db.insert(schema.users).values([
    { email: "admin@example.com", passwordHash, role: "admin" },
    { email: "manager@example.com", passwordHash, role: "manager", employeeId: emps[0].id },
    ...emps.slice(1).map((e) => ({ email: e.email, passwordHash, role: "employee" as const, employeeId: e.id })),
  ]);

  // ── Shift templates ─────────────────────────────────────────────────────
  const templates = await db.insert(schema.shiftTemplates).values([
    { locationId: store.id, name: "Early", startMinute: 8 * 60, endMinute: 14 * 60 + 30, breakMinutes: 30, color: "#0ea5e9" },
    { locationId: store.id, name: "Mid", startMinute: 11 * 60, endMinute: 17 * 60 + 30, breakMinutes: 30, color: "#8b5cf6" },
    { locationId: store.id, name: "Late", startMinute: 13 * 60 + 30, endMinute: 20 * 60, breakMinutes: 30, color: "#f59e0b" },
    // Short shift for the after-work peak (typical for part-timers).
    { locationId: store.id, name: "Evening", startMinute: 16 * 60, endMinute: 20 * 60, breakMinutes: 0, color: "#ec4899" },
    { locationId: store.id, name: "Supervisor", startMinute: 8 * 60, endMinute: 16 * 60 + 30, breakMinutes: 30,
      qualificationId: supervisor.id, color: "#10b981" },
  ]).returning();

  // ── Holidays (Germany, nationwide) ──────────────────────────────────────
  const holidayList: [string, string][] = [
    ["2026-01-01", "New Year"], ["2026-04-03", "Good Friday"], ["2026-04-06", "Easter Monday"], ["2026-05-01", "Labour Day"],
    ["2026-05-14", "Ascension Day"], ["2026-05-25", "Whit Monday"], ["2026-10-03", "German Unity Day"],
    ["2026-12-25", "Christmas Day"], ["2026-12-26", "Boxing Day"], ["2027-01-01", "New Year"], ["2027-03-26", "Good Friday"],
    ["2027-03-29", "Easter Monday"], ["2027-05-01", "Labour Day"], ["2027-05-06", "Ascension Day"], ["2027-05-17", "Whit Monday"],
    ["2027-10-03", "German Unity Day"], ["2027-12-25", "Christmas Day"], ["2027-12-26", "Boxing Day"],
  ];
  await db.insert(schema.holidays).values(holidayList.map(([date, name]) => ({ date, name })));
  const holidaySet = new Set(holidayList.map(([d]) => d));

  // ── Demand history: 10 weeks of customers per hour ──────────────────────
  // Lunch and after-work peaks, busier Fridays/Saturdays, closed Sundays and
  // holidays, slight growth over time, plus noise.
  const hourShape = [0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.7, 0.8, 1.0, 1.3, 1.1, 0.8, 0.8, 1.0, 1.4, 1.5, 1.1, 0, 0, 0, 0];
  const dayFactor = [1.0, 0.9, 0.95, 1.05, 1.3, 1.6, 0];
  const historyStart = addDays(thisMonday, -70);
  const demandRows: (typeof schema.demandHistory.$inferInsert)[] = [];
  eachDay(historyStart, addDays(today, -1)).forEach((date, i) => {
    if (holidaySet.has(date)) return;
    const growth = 1 + i * 0.002;
    for (let hour = 0; hour < 24; hour++) {
      const base = 40 * hourShape[hour] * dayFactor[isoWeekday(date) - 1] * growth;
      if (base > 0) demandRows.push({ locationId: store.id, date, hour, volume: Math.round(base * (0.85 + rand() * 0.3)) });
    }
  });
  await db.insert(schema.demandHistory).values(demandRows);

  // ── Leave ───────────────────────────────────────────────────────────────
  await db.insert(schema.leaveRequests).values([
    { employeeId: emps[2].id, type: "vacation", startDate: addDays(thisMonday, 2), endDate: addDays(thisMonday, 4), status: "approved", reason: "Family visit" },
    { employeeId: emps[6].id, type: "sick", startDate: addDays(thisMonday, -7), endDate: addDays(thisMonday, -6), status: "approved" },
    { employeeId: emps[9].id, type: "vacation", startDate: addDays(thisMonday, 14), endDate: addDays(thisMonday, 18), status: "pending", reason: "Holiday trip" },
    { employeeId: emps[4].id, type: "vacation", startDate: addDays(thisMonday, 15), endDate: addDays(thisMonday, 16), status: "pending", reason: "" },
  ]);
  const absent = new Map<number, Set<string>>([
    [emps[2].id, new Set(eachDay(addDays(thisMonday, 2), addDays(thisMonday, 4)))],
    [emps[6].id, new Set([addDays(thisMonday, -7), addDays(thisMonday, -6)])],
  ]);

  // ── Schedule: last 2 weeks, this week and next, planned automatically ──
  const history = demandRows.map((r) => ({ date: r.date, hour: r.hour, volume: r.volume }));
  const qualsOf = (employeeId: number) => emps.map((e, i) => (e.id === employeeId ? people[i][4] : null)).find(Boolean) ?? [];
  const contexts = emps.map((e) => ({
    id: e.id, contractHoursWeek: e.contractHoursWeek, qualificationIds: qualsOf(e.id), absentDates: absent.get(e.id) ?? new Set<string>(),
  }));
  const planned: PlannedShift[] = [];
  for (let w = -2; w <= 1; w++) {
    const dates = eachDay(addDays(thisMonday, 7 * w), addDays(thisMonday, 7 * w + 6));
    const forecast = forecastDemand(history.filter((h) => h.date < dates[0]), dates, { closedDates: holidaySet });
    const need = new Map(dates.map((d) => [d, staffNeeded(forecast.get(d)!, store)]));
    // One supervisor each open day first, then the rest by forecast.
    const supervisorNeed = new Map(dates.map((d) => [d, need.get(d)!.map((n, h) => (n > 0 && h >= 8 && h < 16 ? 1 : 0))]));
    const sup = autoSchedule({ dates, need: supervisorNeed, templates: templates.filter((t) => t.qualificationId),
      employees: contexts, existing: planned, rules: DEFAULT_RULES });
    planned.push(...sup.shifts);
    const rest = autoSchedule({ dates, need, templates: templates.filter((t) => !t.qualificationId),
      employees: contexts, existing: planned, rules: DEFAULT_RULES });
    planned.push(...rest.shifts);
  }
  const shiftRows = planned.map((s) => ({
    locationId: store.id, employeeId: s.employeeId, date: s.date, startMinute: s.startMinute, endMinute: s.endMinute,
    breakMinutes: s.breakMinutes, qualificationId: s.qualificationId,
    templateId: "templateId" in s ? (s as { templateId: number }).templateId : null,
    published: s.date < addDays(thisMonday, 7),     // next week is still a draft
  }));
  await db.insert(schema.shifts).values(shiftRows);

  // ── Clocked time for past shifts (a few minutes early/late) ─────────────
  // Shift minutes are Berlin local time; demo uses a fixed UTC+1/+2 offset guess
  // through Date parsing with an explicit offset per date.
  const offsetFor = (date: string) => {
    const probe = new Date(`${date}T12:00:00Z`);
    const local = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" }).format(probe);
    return Number(local) - 12;  // +1 or +2
  };
  const timeRows = planned.filter((s) => s.employeeId && s.date < today).map((s) => {
    const off = offsetFor(s.date) * 60;
    const start = new Date(Date.parse(`${s.date}T00:00:00Z`) + (s.startMinute - off + Math.round(rand() * 10 - 5)) * 60_000);
    const end = new Date(Date.parse(`${s.date}T00:00:00Z`) + (s.endMinute - off + Math.round(rand() * 20 - 5)) * 60_000);
    return { employeeId: s.employeeId!, startAt: start, endAt: end, breakMinutes: s.breakMinutes, approved: s.date < thisMonday };
  });
  await db.insert(schema.timeEntries).values(timeRows);

  console.log(`✓ demo data: ${emps.length} employees, ${shiftRows.length} shifts, ${demandRows.length} demand rows, ${timeRows.length} time entries`);
  console.log(`  logins (password "${DEMO_PASSWORD}"): admin@example.com · manager@example.com · ${emps[1].email}`);
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
