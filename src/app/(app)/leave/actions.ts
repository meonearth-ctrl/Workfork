"use server";
// Leave actions: employees request and cancel their own leave; managers
// approve or reject requests from their location. Vacation requests are
// checked against the remaining entitlement before they're accepted.

import { and, eq, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { isManager, requireManager, requireUser } from "@/lib/auth/session";
import { isValidIsoDate } from "@/lib/domain/dates";
import { leaveWorkingDays, rangesOverlap, vacationBalance } from "@/lib/domain/leave";
import { getHolidays } from "@/lib/data/planning";

function refresh() {
  revalidatePath("/leave");
  revalidatePath("/schedule");
  revalidatePath("/");
}

const requestSchema = z.object({
  employeeId: z.coerce.number().int().positive(),
  type: z.enum(["vacation", "sick", "unpaid", "other"]),
  startDate: z.string().refine(isValidIsoDate),
  endDate: z.string().refine(isValidIsoDate),
  reason: z.string().max(500).default(""),
});

export interface LeaveFormState { error?: string; ok?: boolean; values?: Record<string, string> }

export async function requestLeave(_prev: LeaveFormState | undefined, formData: FormData): Promise<LeaveFormState> {
  const user = await requireUser();
  // Echo the input back on errors so the form refills (React resets forms on submit).
  const values = Object.fromEntries([...formData].map(([k, v]) => [k, String(v)]));
  const fail = (error: string) => ({ error, values });
  const parsed = requestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Choose a type and valid dates.");
  const r = parsed.data;
  if (r.endDate < r.startDate) return fail("The end date is before the start date.");
  const [emp] = await db.select().from(schema.employees).where(eq(schema.employees.id, r.employeeId));
  if (!emp) return fail("Unknown employee.");
  const own = emp.id === user.employeeId;
  if (!own && !(isManager(user) && (user.role === "admin" || emp.locationId === user.locationId))) {
    return fail("You can only request leave for yourself.");
  }

  const existing = await db.select().from(schema.leaveRequests).where(and(
    eq(schema.leaveRequests.employeeId, emp.id), inArray(schema.leaveRequests.status, ["pending", "approved"]),
  ));
  if (existing.some((e) => rangesOverlap(e.startDate, e.endDate, r.startDate, r.endDate))) {
    return fail("This overlaps leave that is already requested or approved.");
  }
  const holidays = new Set((await getHolidays(emp.locationId, r.startDate, r.endDate)).map((h) => h.date));
  const days = leaveWorkingDays(r.startDate, r.endDate, holidays);
  if (days.length === 0) return fail("These dates contain no working days.");

  if (r.type === "vacation") {
    // Check each calendar year the request touches.
    const years = new Set(days.map((d) => Number(d.slice(0, 4))));
    for (const year of years) {
      const yearHolidays = new Set((await getHolidays(emp.locationId, `${year}-01-01`, `${year}-12-31`)).map((h) => h.date));
      const balance = vacationBalance(emp.annualLeaveDays, existing, year, yearHolidays);
      const wanted = days.filter((d) => d.startsWith(`${year}-`)).length;
      if (wanted > balance.remaining) {
        return fail(`Only ${balance.remaining} vacation day(s) left in ${year}; this request needs ${wanted}.`);
      }
    }
  }

  // Sick notes entered by a manager are recorded as approved straight away.
  const autoApprove = !own || (r.type === "sick" && isManager(user));
  await db.insert(schema.leaveRequests).values({
    employeeId: emp.id, type: r.type, startDate: r.startDate, endDate: r.endDate, reason: r.reason,
    status: autoApprove ? "approved" : "pending", decidedBy: autoApprove ? user.id : null, decidedAt: autoApprove ? new Date() : null,
  });
  refresh();
  return { ok: true };
}

export async function cancelLeave(formData: FormData) {
  const user = await requireUser();
  const id = Number(formData.get("id"));
  const [req] = await db.select().from(schema.leaveRequests).where(eq(schema.leaveRequests.id, id));
  if (!req || req.employeeId !== user.employeeId || req.status !== "pending") return;
  await db.update(schema.leaveRequests).set({ status: "cancelled" }).where(eq(schema.leaveRequests.id, id));
  refresh();
}

export async function decideLeave(formData: FormData) {
  const user = await requireManager();
  const id = Number(formData.get("id"));
  const decision = formData.get("decision") === "approve" ? "approved" : "rejected";
  const [row] = await db.select({ req: schema.leaveRequests, locationId: schema.employees.locationId })
    .from(schema.leaveRequests).innerJoin(schema.employees, eq(schema.employees.id, schema.leaveRequests.employeeId))
    .where(and(eq(schema.leaveRequests.id, id), ne(schema.leaveRequests.status, "cancelled")));
  if (!row || (user.role !== "admin" && row.locationId !== user.locationId)) return;
  // Managers don't approve their own leave.
  if (row.req.employeeId === user.employeeId && user.role !== "admin") return;
  await db.update(schema.leaveRequests).set({ status: decision, decidedBy: user.id, decidedAt: new Date() })
    .where(eq(schema.leaveRequests.id, id));
  refresh();
}
