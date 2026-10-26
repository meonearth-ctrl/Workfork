"use server";
// Settings (managers): the location's opening hours, forecasting parameters
// and labour rules; shift templates; qualifications; public holidays.

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireManager } from "@/lib/auth/session";
import { isValidIsoDate, parseMinute } from "@/lib/domain/dates";

export type SettingsState = { error?: string; ok?: string } | undefined;

function refreshAll() {
  for (const p of ["/settings", "/schedule", "/forecast", "/"]) revalidatePath(p);
}

const locationSchema = z.object({
  name: z.string().trim().min(1).max(100),
  timezone: z.string().trim().min(1).max(64),
  openHour: z.coerce.number().int().min(0).max(23),
  closeHour: z.coerce.number().int().min(1).max(24),
  productivity: z.coerce.number().positive().max(10_000),
  minStaff: z.coerce.number().int().min(0).max(100),
  minRestHours: z.coerce.number().min(0).max(24),
  maxDailyHours: z.coerce.number().min(1).max(24),
  maxWeeklyHours: z.coerce.number().min(1).max(100),
  maxConsecutiveDays: z.coerce.number().int().min(1).max(14),
});

export async function saveLocation(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireManager();
  const parsed = locationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Please check the values (hours 0–24, positive numbers)." };
  if (parsed.data.closeHour <= parsed.data.openHour) return { error: "Closing must be after opening." };
  try {
    new Intl.DateTimeFormat("en", { timeZone: parsed.data.timezone });
  } catch {
    return { error: "Unknown time zone. Use a name like Europe/Berlin." };
  }
  await db.update(schema.locations).set(parsed.data).where(eq(schema.locations.id, user.locationId));
  refreshAll();
  return { ok: "Saved." };
}

const templateSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  name: z.string().trim().min(1).max(40),
  start: z.string(),
  end: z.string(),
  breakMinutes: z.coerce.number().int().min(0).max(240),
  qualificationId: z.string().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export async function saveTemplate(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireManager();
  const parsed = templateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Name, times and break are required." };
  const start = parseMinute(parsed.data.start);
  let end = parseMinute(parsed.data.end);
  if (start === null || end === null) return { error: "Times must look like 08:30." };
  if (end <= start) end += 1440;
  const values = {
    locationId: user.locationId, name: parsed.data.name, startMinute: start, endMinute: end,
    breakMinutes: parsed.data.breakMinutes, color: parsed.data.color,
    qualificationId: parsed.data.qualificationId ? Number(parsed.data.qualificationId) : null,
  };
  if (parsed.data.id) {
    await db.update(schema.shiftTemplates).set(values)
      .where(and(eq(schema.shiftTemplates.id, parsed.data.id), eq(schema.shiftTemplates.locationId, user.locationId)));
  } else {
    await db.insert(schema.shiftTemplates).values(values);
  }
  refreshAll();
  return { ok: "Template saved." };
}

export async function deleteTemplate(formData: FormData) {
  const user = await requireManager();
  await db.delete(schema.shiftTemplates).where(and(
    eq(schema.shiftTemplates.id, Number(formData.get("id"))), eq(schema.shiftTemplates.locationId, user.locationId),
  ));
  refreshAll();
}

export async function addQualification(formData: FormData) {
  await requireManager();
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  if (name) await db.insert(schema.qualifications).values({ name }).onConflictDoNothing();
  refreshAll();
}

export async function deleteQualification(formData: FormData) {
  const user = await requireManager();
  if (user.role !== "admin") return;   // shared across locations
  await db.delete(schema.qualifications).where(eq(schema.qualifications.id, Number(formData.get("id"))));
  refreshAll();
}

export async function addHoliday(formData: FormData) {
  const user = await requireManager();
  const date = String(formData.get("date") ?? "");
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (!isValidIsoDate(date) || !name) return;
  await db.insert(schema.holidays).values({ date, name, locationId: user.locationId });
  refreshAll();
}

export async function deleteHoliday(formData: FormData) {
  const user = await requireManager();
  const id = Number(formData.get("id"));
  const [h] = await db.select().from(schema.holidays).where(eq(schema.holidays.id, id));
  // Nationwide holidays (no location) can only be removed by an admin.
  if (!h || (h.locationId === null ? user.role !== "admin" : h.locationId !== user.locationId)) return;
  await db.delete(schema.holidays).where(eq(schema.holidays.id, id));
  refreshAll();
}
