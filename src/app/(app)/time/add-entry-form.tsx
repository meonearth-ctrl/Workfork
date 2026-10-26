"use client";
// Manual time entry (forgotten clock-in, work away from the terminal).

import { useActionState } from "react";
import { Button, Field, inputClass } from "@/components/ui";
import { addEntry } from "./actions";

export function AddEntryForm({ employees, defaultEmployeeId, defaultDate }: {
  employees: { id: number; name: string }[]; defaultEmployeeId: number; defaultDate: string;
}) {
  const [state, action, pending] = useActionState(addEntry, undefined);
  return (
    <form action={action} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 lg:items-end">
      {employees.length > 1 ? (
        <Field label="Employee">
          <select name="employeeId" defaultValue={state?.values?.employeeId ?? defaultEmployeeId} className={inputClass}>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
      ) : <input type="hidden" name="employeeId" value={defaultEmployeeId} />}
      <Field label="Date"><input type="date" name="date" defaultValue={state?.values?.date ?? defaultDate} required className={inputClass} /></Field>
      <Field label="Start"><input type="time" name="start" defaultValue={state?.values?.start} required className={inputClass} /></Field>
      <Field label="End"><input type="time" name="end" defaultValue={state?.values?.end} required className={inputClass} /></Field>
      <Field label="Break (min)"><input type="number" name="breakMinutes" min={0} defaultValue={state?.values?.breakMinutes ?? 30} className={inputClass} /></Field>
      <Field label="Note"><input name="note" defaultValue={state?.values?.note} maxLength={500} className={inputClass} /></Field>
      <div className="col-span-full flex items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Add entry"}</Button>
        {state?.error && <span role="alert" className="text-sm text-rose-600">{state.error}</span>}
        {state?.ok && <span className="text-sm text-emerald-700">Saved.</span>}
      </div>
    </form>
  );
}
