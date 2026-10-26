// Sessions and the current user. The browser holds a random token in an
// HttpOnly cookie; the database holds only its SHA-256 hash, so a leaked
// database can't be used to log in. Every page and Server Action resolves the
// user through getCurrentUser()/requireUser(), never trusting client input.

import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "@/db";

export const SESSION_COOKIE = "wf_session";
const SESSION_DAYS = 7;

export type Role = "admin" | "manager" | "employee";

export interface CurrentUser {
  id: number;
  email: string;
  role: Role;
  employeeId: number | null;
  name: string;
  locationId: number;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(userId: number): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(schema.sessions).values({ tokenHash: hashToken(token), userId, expiresAt });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, hashToken(token)));
  jar.delete(SESSION_COOKIE);
}

// Cached per request, so many components can ask without extra queries.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const rows = await db
    .select({ user: schema.users, employee: schema.employees })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .leftJoin(schema.employees, eq(schema.employees.id, schema.users.employeeId))
    .where(and(eq(schema.sessions.tokenHash, hashToken(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // Admins without an employee record work on the first location.
  let locationId = row.employee?.locationId;
  if (!locationId) {
    const [first] = await db.select({ id: schema.locations.id }).from(schema.locations).orderBy(schema.locations.id).limit(1);
    locationId = first?.id ?? 0;
  }
  return {
    id: row.user.id, email: row.user.email, role: row.user.role, employeeId: row.user.employeeId,
    name: row.employee ? `${row.employee.firstName} ${row.employee.lastName}` : "Administrator", locationId,
  };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export const isManager = (user: CurrentUser) => user.role === "manager" || user.role === "admin";

// For manager-only pages and actions; employees are sent to their dashboard.
export async function requireManager(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!isManager(user)) redirect("/");
  return user;
}
