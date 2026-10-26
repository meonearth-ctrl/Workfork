"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, Field, inputClass } from "@/components/ui";
import { saveEmployee } from "./actions";

export interface EmployeeFormData {
  id?: number; firstName: string; lastName: string; email: string; jobTitle: string;
  contractHoursWeek: number; annualLeaveDays: number; active: boolean; qualificationIds: number[];
  role: "employee" | "manager" | "admin"; hasLogin: boolean;
}

export function EmployeeForm({ employee, qualifications, canGrantRoles }: {
  employee: EmployeeFormData; qualifications: { id: number; name: string }[]; canGrantRoles: boolean;
}) {
  const [state, action, pending] = useActionState(saveEmployee, undefined);
  const v = (key: keyof EmployeeFormData) => state?.values?.[key] ?? String(employee[key] ?? "");
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {employee.id && <input type="hidden" name="id" value={employee.id} />}
      <Field label="First name"><input name="firstName" defaultValue={v("firstName")} required className={inputClass} /></Field>
      <Field label="Last name"><input name="lastName" defaultValue={v("lastName")} required className={inputClass} /></Field>
      <Field label="Email"><input name="email" type="email" defaultValue={v("email")} required className={inputClass} /></Field>
      <Field label="Job title"><input name="jobTitle" defaultValue={v("jobTitle")} className={inputClass} /></Field>
      <Field label="Contract hours / week"><input name="contractHoursWeek" type="number" step="0.5" min={0} max={60} defaultValue={v("contractHoursWeek")} className={inputClass} /></Field>
      <Field label="Vacation days / year"><input name="annualLeaveDays" type="number" min={0} max={60} defaultValue={v("annualLeaveDays")} className={inputClass} /></Field>
      <Field label="Access">
        <select name="role" defaultValue={v("role")} disabled={!canGrantRoles} className={inputClass}>
          <option value="employee">Employee</option>
          <option value="manager">Manager</option>
          <option value="admin">Administrator</option>
        </select>
        {!canGrantRoles && <input type="hidden" name="role" value={employee.role === "admin" ? "employee" : employee.role} />}
      </Field>
      <Field label={employee.hasLogin ? "New password (optional)" : "Password (creates a login)"} hint="At least 8 characters">
        <input name="password" type="password" autoComplete="new-password" className={inputClass} />
      </Field>
      <fieldset className="sm:col-span-2 lg:col-span-4">
        <legend className="mb-1 text-sm font-medium text-slate-700">Qualifications</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {qualifications.map((q) => (
            <label key={q.id} className="flex items-center gap-1.5">
              <input type="checkbox" name="qualificationId" value={q.id} defaultChecked={employee.qualificationIds.includes(q.id)} /> {q.name}
            </label>
          ))}
          {employee.id && (
            <label className="ml-auto flex items-center gap-1.5"><input type="checkbox" name="active" defaultChecked={employee.active} /> Active (shown in plans)</label>
          )}
          {!employee.id && <input type="hidden" name="active" value="on" />}
        </div>
      </fieldset>
      <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save employee"}</Button>
        <Link href="/employees" className="text-sm text-slate-600 hover:underline">Cancel</Link>
        {state?.error && <span role="alert" className="text-sm text-rose-600">{state.error}</span>}
      </div>
    </form>
  );
}
