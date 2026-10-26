"use server";
// Employee administration (managers): personal data, contract, qualifications
// and the employee's login. Only admins may grant manager or admin rights.

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { hashPassword } from "@/lib/auth/password";
import { requireManager } from "@/lib/auth/session";

export interface EmployeeFormState { error?: string; values?: Record<string, string> }

const employeeSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email(),
  jobTitle: z.string().trim().max(80).default(""),
  contractHoursWeek: z.coerce.number().min(0).max(60),
  annualLeaveDays: z.coerce.number().int().min(0).max(60),
  role: z.enum(["employee", "manager", "admin"]),
  password: z.string().max(200).default(""),
  active: z.string().optional(),
});

export async function saveEmployee(_prev: EmployeeFormState | undefined, formData: FormData): Promise<EmployeeFormState> {
  const user = await requireManager();
  const values = Object.fromEntries([...formData].filter(([k]) => k !== "password").map(([k, v]) => [k, String(v)]));
  const fail = (error: string) => ({ error, values });
  const parsed = employeeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Check name, email, contract hours (0–60) and leave days.");
  const f = parsed.data;
  if (f.password && f.password.length < 8) return fail("Passwords need at least 8 characters.");
  const qualificationIds = formData.getAll("qualificationId").map(Number).filter((n) => Number.isInteger(n) && n > 0);

  const clash = await db.select({ id: schema.employees.id }).from(schema.employees)
    .where(f.id ? and(eq(schema.employees.email, f.email), ne(schema.employees.id, f.id)) : eq(schema.employees.email, f.email));
  if (clash.length) return fail("Another employee already uses this email.");

  // Access rights: only admins change them. Everyone else keeps the existing
  // role (or "employee" for a new login), whatever the form says.
  const [login] = f.id ? await db.select().from(schema.users).where(eq(schema.users.employeeId, f.id)) : [];
  if (login?.role === "admin" && user.role !== "admin") return fail("Only an administrator can change an administrator.");
  const role = user.role === "admin" ? f.role : login?.role ?? "employee";
  if (!login && f.password) {
    const taken = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, f.email));
    if (taken.length) return fail("A login with this email already exists.");
  }

  const data = {
    firstName: f.firstName, lastName: f.lastName, email: f.email, jobTitle: f.jobTitle,
    contractHoursWeek: f.contractHoursWeek, annualLeaveDays: f.annualLeaveDays, active: f.active === "on",
  };
  let employeeId = f.id;
  if (employeeId) {
    const [existing] = await db.select().from(schema.employees).where(eq(schema.employees.id, employeeId));
    if (!existing || (user.role !== "admin" && existing.locationId !== user.locationId)) return fail("Employee not found.");
    await db.update(schema.employees).set(data).where(eq(schema.employees.id, employeeId));
  } else {
    const [created] = await db.insert(schema.employees).values({ ...data, active: true, locationId: user.locationId }).returning();
    employeeId = created.id;
  }

  await db.delete(schema.employeeQualifications).where(eq(schema.employeeQualifications.employeeId, employeeId));
  if (qualificationIds.length) {
    await db.insert(schema.employeeQualifications).values(qualificationIds.map((qualificationId) => ({ employeeId: employeeId!, qualificationId })));
  }

  // Login: kept in step with the employee's email; created when a password is set.
  if (login) {
    await db.update(schema.users).set({
      email: f.email, role,
      ...(f.password ? { passwordHash: await hashPassword(f.password) } : {}),
    }).where(eq(schema.users.id, login.id));
  } else if (f.password) {
    await db.insert(schema.users).values({ email: f.email, passwordHash: await hashPassword(f.password), role, employeeId });
  }
  revalidatePath("/employees");
  redirect("/employees?saved=1");
}
