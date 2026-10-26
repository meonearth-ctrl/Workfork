"use server";
// Schedule actions (managers only): create/edit/delete shifts with labour-rule
// checks, auto-plan a week from the demand forecast, publish a week, and
// clear its drafts. Shifts are created as drafts; employees only see
// published shifts.

import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireManager } from "@/lib/auth/session";
import { addDays, eachDay, isValidIsoDate, parseMinute, weekStart } from "@/lib/domain/dates";
import { autoSchedule } from "@/lib/domain/autoschedule";
import { checkEmployeeShifts, PlannedShift } from "@/lib/domain/rules";
import {
  employeeContexts, getDemandPlan, getEmployees, getLeaveOverlapping, getLocation, getShifts, getTemplates, rulesOf, toPlanned,
} from "@/lib/data/planning";

export interface ShiftFormState { error?: string; violations?: string[] }

const shiftSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  employeeId: z.string(),
  date: z.string().refine(isValidIsoDate, "Invalid date"),
  start: z.string(),
  end: z.string(),
  breakMinutes: z.coerce.number().int().min(0).max(240),
  qualificationId: z.string().optional(),
  templateId: z.string().optional(),
  note: z.string().max(300).default(""),
  override: z.string().optional(),
});

export async function saveShift(_prev: ShiftFormState | undefined, formData: FormData): Promise<ShiftFormState> {
  const user = await requireManager();
  const parsed = shiftSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Please check the date, times and break." };
  const f = parsed.data;
  const startMinute = parseMinute(f.start);
  let endMinute = parseMinute(f.end);
  if (startMinute === null || endMinute === null) return { error: "Times must look like 08:30." };
  if (endMinute <= startMinute) endMinute += 1440;       // overnight
  if (endMinute - startMinute > 16 * 60) return { error: "A shift can be at most 16 hours." };
  if (f.breakMinutes >= endMinute - startMinute) return { error: "The break is longer than the shift." };

  const employeeId = f.employeeId === "open" || f.employeeId === "" ? null : Number(f.employeeId);
  const qualificationId = f.qualificationId ? Number(f.qualificationId) : null;
  const templateId = f.templateId ? Number(f.templateId) : null;
  const loc = await getLocation(user.locationId);

  if (f.id) {
    const [existing] = await db.select().from(schema.shifts).where(eq(schema.shifts.id, f.id));
    if (!existing || existing.locationId !== loc.id) return { error: "Shift not found." };
  }

  // Rule check for the assigned person, unless the manager overrides it.
  if (employeeId !== null) {
    const employees = await getEmployees(loc.id);
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp) return { error: "Unknown employee." };
    const window = await getShifts(loc.id, addDays(f.date, -8), addDays(f.date, 8));
    const leave = await getLeaveOverlapping([employeeId], addDays(f.date, -8), addDays(f.date, 8));
    const [ctx] = employeeContexts([emp], leave);
    const candidate: PlannedShift = { id: f.id ?? "new", employeeId, date: f.date, startMinute, endMinute, breakMinutes: f.breakMinutes, qualificationId };
    const others = window.filter((s) => s.employeeId === employeeId && s.id !== f.id).map(toPlanned);
    const problems = checkEmployeeShifts(ctx, [...others, candidate], rulesOf(loc))
      .filter((v) => v.shiftId === candidate.id && v.severity === "error");
    if (problems.length > 0 && !f.override) {
      return { error: "This shift breaks a rule. Tick “Save anyway” to override.", violations: problems.map((p) => p.message) };
    }
  }

  const values = {
    locationId: loc.id, employeeId, date: f.date, startMinute, endMinute, breakMinutes: f.breakMinutes,
    qualificationId, templateId, note: f.note,
  };
  if (f.id) await db.update(schema.shifts).set(values).where(eq(schema.shifts.id, f.id));
  else await db.insert(schema.shifts).values({ ...values, published: false });
  revalidatePath("/schedule");
  redirect(`/schedule?week=${weekStart(f.date)}`);
}

export async function deleteShift(formData: FormData) {
  const user = await requireManager();
  const id = Number(formData.get("id"));
  const [shift] = await db.select().from(schema.shifts).where(eq(schema.shifts.id, id));
  if (!shift || shift.locationId !== user.locationId) return;
  await db.delete(schema.shifts).where(eq(schema.shifts.id, id));
  revalidatePath("/schedule");
  redirect(`/schedule?week=${weekStart(shift.date)}`);
}

function weekFrom(formData: FormData) {
  const week = String(formData.get("week") ?? "");
  if (!isValidIsoDate(week)) throw new Error("Invalid week");
  return weekStart(week);
}

// Fill the week's forecast need with templates and available people, keeping
// every shift already planned. New shifts are drafts.
export async function autoPlanWeek(formData: FormData) {
  const user = await requireManager();
  const monday = weekFrom(formData);
  const loc = await getLocation(user.locationId);
  const dates = eachDay(monday, addDays(monday, 6));
  const [employees, templates, existing] = await Promise.all([
    getEmployees(loc.id), getTemplates(loc.id), getShifts(loc.id, addDays(monday, -7), addDays(monday, 13)),
  ]);
  const leave = await getLeaveOverlapping(employees.map((e) => e.id), addDays(monday, -7), addDays(monday, 13));
  const contexts = employeeContexts(employees, leave);
  const { need } = await getDemandPlan(loc, dates);
  const planned = existing.map(toPlanned);

  // Templates that need a qualification (e.g. supervisor) are planned first,
  // one per open day during their hours, then general templates fill the rest.
  const qualified = templates.filter((t) => t.qualificationId);
  const general = templates.filter((t) => !t.qualificationId);
  const created: PlannedShift[] = [];
  for (const t of qualified) {
    const tNeed = new Map(dates.map((d) => [d, need.get(d)!.map((n, h) =>
      n > 0 && h * 60 >= t.startMinute && (h + 1) * 60 <= t.endMinute ? 1 : 0)]));
    // Skip days where someone already covers this template's qualification.
    for (const d of dates) {
      if (planned.some((s) => s.date === d && s.qualificationId === t.qualificationId && s.employeeId !== null)) tNeed.set(d, Array(24).fill(0));
    }
    const r = autoSchedule({ dates, need: tNeed, templates: [t], employees: contexts, existing: [...planned, ...created], rules: rulesOf(loc), createOpenShifts: false });
    created.push(...r.shifts);
  }
  const r = autoSchedule({ dates, need, templates: general, employees: contexts, existing: [...planned, ...created], rules: rulesOf(loc) });
  created.push(...r.shifts);

  if (created.length > 0) {
    await db.insert(schema.shifts).values(created.map((s) => ({
      locationId: loc.id, employeeId: s.employeeId, date: s.date, startMinute: s.startMinute, endMinute: s.endMinute,
      breakMinutes: s.breakMinutes, qualificationId: s.qualificationId,
      templateId: (s as { templateId?: number }).templateId ?? null, published: false,
    })));
  }
  revalidatePath("/schedule");
  redirect(`/schedule?week=${monday}&planned=${created.length}`);
}

export async function publishWeek(formData: FormData) {
  const user = await requireManager();
  const monday = weekFrom(formData);
  await db.update(schema.shifts).set({ published: true }).where(and(
    eq(schema.shifts.locationId, user.locationId), gte(schema.shifts.date, monday), lte(schema.shifts.date, addDays(monday, 6)),
  ));
  revalidatePath("/schedule");
  revalidatePath("/");
  redirect(`/schedule?week=${monday}&published=1`);
}

export async function clearDrafts(formData: FormData) {
  const user = await requireManager();
  const monday = weekFrom(formData);
  const drafts = await db.select({ id: schema.shifts.id }).from(schema.shifts).where(and(
    eq(schema.shifts.locationId, user.locationId), eq(schema.shifts.published, false),
    gte(schema.shifts.date, monday), lte(schema.shifts.date, addDays(monday, 6)),
  ));
  if (drafts.length) await db.delete(schema.shifts).where(inArray(schema.shifts.id, drafts.map((d) => d.id)));
  revalidatePath("/schedule");
  redirect(`/schedule?week=${monday}`);
}
