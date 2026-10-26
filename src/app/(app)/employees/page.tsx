// Employee list and editor (managers). ?edit=<id> or ?new=1 opens the form.

import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { Badge, Card, LinkButton, Notice, PageHeader } from "@/components/ui";
import { requireManager } from "@/lib/auth/session";
import { getEmployees, getQualifications } from "@/lib/data/planning";
import { EmployeeForm, EmployeeFormData } from "./employee-form";

export default async function EmployeesPage({ searchParams }: PageProps<"/employees">) {
  const user = await requireManager();
  const sp = await searchParams;
  const [employees, qualifications] = await Promise.all([getEmployees(user.locationId, true), getQualifications()]);
  const logins = employees.length
    ? await db.select().from(schema.users).where(inArray(schema.users.employeeId, employees.map((e) => e.id))) : [];
  const qualName = new Map(qualifications.map((q) => [q.id, q.name]));

  let editing: EmployeeFormData | null = null;
  if (sp.new) {
    editing = { firstName: "", lastName: "", email: "", jobTitle: "", contractHoursWeek: 40, annualLeaveDays: 25, active: true, qualificationIds: [], role: "employee", hasLogin: false };
  } else if (typeof sp.edit === "string") {
    const e = employees.find((x) => x.id === Number(sp.edit));
    if (e) {
      const [login] = await db.select().from(schema.users).where(eq(schema.users.employeeId, e.id));
      editing = { ...e, role: login?.role ?? "employee", hasLogin: !!login };
    }
  }

  return (
    <>
      <PageHeader title="Employees" subtitle={`${employees.filter((e) => e.active).length} active`}
        actions={<LinkButton variant="primary" href="/employees?new=1">+ Add employee</LinkButton>} />
      {sp.saved && <Notice tone="good">Employee saved.</Notice>}
      {editing && (
        <Card title={editing.id ? `Edit ${editing.firstName} ${editing.lastName}` : "New employee"} className="mb-4">
          <EmployeeForm key={editing.id ?? "new"} employee={editing} qualifications={qualifications} canGrantRoles={user.role === "admin"} />
        </Card>
      )}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="py-2">Name</th><th>Job title</th><th>Contract</th><th>Vacation</th><th>Qualifications</th><th>Login</th></tr>
          </thead>
          <tbody>
            {employees.map((e) => {
              const login = logins.find((l) => l.employeeId === e.id);
              return (
                <tr key={e.id} className={`border-t border-slate-100 ${e.active ? "" : "text-slate-400"}`}>
                  <td className="py-2">
                    <Link className="font-medium hover:underline" href={`/employees?edit=${e.id}`}>{e.firstName} {e.lastName}</Link>
                    <div className="text-xs text-slate-500">{e.email}</div>
                  </td>
                  <td>{e.jobTitle || "—"}</td>
                  <td className="tabular-nums">{e.contractHoursWeek} h/wk</td>
                  <td className="tabular-nums">{e.annualLeaveDays} d</td>
                  <td className="space-x-1">{e.qualificationIds.map((q) => <Badge key={q}>{qualName.get(q)}</Badge>)}</td>
                  <td>{!e.active ? <Badge>Inactive</Badge> : login ? <Badge tone={login.role === "employee" ? "default" : "info"}>{login.role}</Badge> : <span className="text-xs text-slate-400">none</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}
