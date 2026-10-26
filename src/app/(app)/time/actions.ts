"use server";
// Time & attendance actions. Employees clock themselves in/out and may add or
// delete their own unapproved entries; managers can do this for anyone at
// their location and approve entries. Every action re-checks the session.

import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { isManager, requireManager, requireUser, CurrentUser } from "@/lib/auth/session";
import { isValidIsoDate, parseMinute } from "@/lib/domain/dates";
import { getLocation } from "@/lib/data/planning";
import { zonedInstant } from "@/lib/data/time";

function refresh() {
  revalidatePath("/time");
  revalidatePath("/");
}

// May `user` touch time data of `employeeId`? Own data, or a manager at the
// same location.
async function canEdit(user: CurrentUser, employeeId: number): Promise<boolean> {
  if (user.employeeId === employeeId) return true;
  if (!isManager(user)) return false;
  const [emp] = await db.select({ locationId: schema.employees.locationId }).from(schema.employees).where(eq(schema.employees.id, employeeId));
  return !!emp && (user.role === "admin" || emp.locationId === user.locationId);
}

export async function clockIn() {
  const user = await requireUser();
  if (!user.employeeId) return;
  const open = await db.select({ id: schema.timeEntries.id }).from(schema.timeEntries)
    .where(and(eq(schema.timeEntries.employeeId, user.employeeId), isNull(schema.timeEntries.endAt)));
  if (open.length === 0) await db.insert(schema.timeEntries).values({ employeeId: user.employeeId, startAt: new Date() });
  refresh();
}

export async function clockOut() {
  const user = await requireUser();
  if (!user.employeeId) return;
  await db.update(schema.timeEntries).set({ endAt: new Date() })
    .where(and(eq(schema.timeEntries.employeeId, user.employeeId), isNull(schema.timeEntries.endAt)));
  refresh();
}

const manualEntry = z.object({
  employeeId: z.coerce.number().int().positive(),
  date: z.string().refine(isValidIsoDate, "Invalid date"),
  start: z.string(),
  end: z.string(),
  breakMinutes: z.coerce.number().int().min(0).max(600),
  note: z.string().max(500).default(""),
});

export interface EntryFormState { error?: string; ok?: boolean; values?: Record<string, string> }

export async function addEntry(_prev: EntryFormState | undefined, formData: FormData): Promise<EntryFormState> {
  const user = await requireUser();
  // Echo the input back on errors so the form refills (React resets forms on submit).
  const values = Object.fromEntries([...formData].map(([k, v]) => [k, String(v)]));
  const fail = (error: string) => ({ error, values });
  const parsed = manualEntry.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Please fill in date, start and end.");
  const { employeeId, date, breakMinutes, note } = parsed.data;
  const start = parseMinute(parsed.data.start);
  let end = parseMinute(parsed.data.end);
  if (start === null || end === null) return fail("Times must look like 08:30.");
  if (end <= start) end += 1440;                          // past midnight
  if (end - start > 16 * 60) return fail("An entry can be at most 16 hours.");
  if (!(await canEdit(user, employeeId))) return fail("You can't add time for this person.");
  const [emp] = await db.select().from(schema.employees).where(eq(schema.employees.id, employeeId));
  const loc = await getLocation(emp.locationId);
  await db.insert(schema.timeEntries).values({
    employeeId, breakMinutes, note,
    startAt: zonedInstant(date, start, loc.timezone), endAt: zonedInstant(date, end, loc.timezone),
    // Manager entries for someone else are approved at once.
    approved: isManager(user) && user.employeeId !== employeeId,
  });
  refresh();
  return { ok: true };
}

export async function deleteEntry(formData: FormData) {
  const user = await requireUser();
  const id = Number(formData.get("id"));
  const [entry] = await db.select().from(schema.timeEntries).where(eq(schema.timeEntries.id, id));
  if (!entry || !(await canEdit(user, entry.employeeId))) return;
  // Approved time is locked for employees; only managers may remove it.
  if (entry.approved && !isManager(user)) return;
  await db.delete(schema.timeEntries).where(eq(schema.timeEntries.id, id));
  refresh();
}

export async function approveEntries(formData: FormData) {
  const user = await requireManager();
  const ids = formData.getAll("id").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return;
  const rows = await db.select({ id: schema.timeEntries.id, locationId: schema.employees.locationId })
    .from(schema.timeEntries).innerJoin(schema.employees, eq(schema.employees.id, schema.timeEntries.employeeId))
    .where(inArray(schema.timeEntries.id, ids));
  const allowed = rows.filter((r) => user.role === "admin" || r.locationId === user.locationId).map((r) => r.id);
  if (allowed.length) await db.update(schema.timeEntries).set({ approved: true }).where(inArray(schema.timeEntries.id, allowed));
  refresh();
}
