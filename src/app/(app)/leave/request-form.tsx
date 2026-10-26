"use client";

import { useActionState } from "react";
import { Button, Field, inputClass } from "@/components/ui";
import { requestLeave } from "./actions";

export function RequestForm({ employees, defaultEmployeeId }: { employees: { id: number; name: string }[]; defaultEmployeeId: number }) {
  const [state, action, pending] = useActionState(requestLeave, undefined);
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {employees.length > 1 ? (
        <Field label="Employee">
          <select name="employeeId" defaultValue={state?.values?.employeeId ?? defaultEmployeeId} className={inputClass}>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
      ) : <input type="hidden" name="employeeId" value={defaultEmployeeId} />}
      <Field label="Type">
        <select name="type" className={inputClass} defaultValue={state?.values?.type ?? "vacation"}>
          <option value="vacation">Vacation</option>
          <option value="sick">Sick leave</option>
          <option value="unpaid">Unpaid leave</option>
          <option value="other">Other</option>
        </select>
      </Field>
      <Field label="From"><input type="date" name="startDate" defaultValue={state?.values?.startDate} required className={inputClass} /></Field>
      <Field label="To"><input type="date" name="endDate" defaultValue={state?.values?.endDate} required className={inputClass} /></Field>
      <div className="sm:col-span-2"><Field label="Note (optional)"><input name="reason" defaultValue={state?.values?.reason} maxLength={500} className={inputClass} /></Field></div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Submit request"}</Button>
        {state?.error && <span role="alert" className="text-sm text-rose-600">{state.error}</span>}
        {state?.ok && <span className="text-sm text-emerald-700">Request saved.</span>}
      </div>
    </form>
  );
}
