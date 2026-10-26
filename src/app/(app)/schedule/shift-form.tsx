"use client";
// Add / edit a shift. Picking a template fills in its times, break and
// qualification; rule violations come back from the server and can be
// overridden explicitly.

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button, Field, inputClass } from "@/components/ui";
import { saveShift } from "./actions";

const hhmm = (m: number) => `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export interface ShiftFormProps {
  week: string;
  shift?: { id: number; employeeId: number | null; date: string; startMinute: number; endMinute: number; breakMinutes: number; qualificationId: number | null; templateId: number | null; note: string };
  defaults: { employeeId: number | null; date: string };
  employees: { id: number; name: string }[];
  templates: { id: number; name: string; startMinute: number; endMinute: number; breakMinutes: number; qualificationId: number | null }[];
  qualifications: { id: number; name: string }[];
}

export function ShiftForm({ week, shift, defaults, employees, templates, qualifications }: ShiftFormProps) {
  const [state, action, pending] = useActionState(saveShift, undefined);
  const first = templates[0];
  // Every field is controlled: React resets uncontrolled fields after each
  // submit, which would undo the user's choices when the server reports a rule
  // problem and they tick "Save anyway".
  const [values, setValues] = useState({
    employeeId: shift ? String(shift.employeeId ?? "open") : String(defaults.employeeId ?? "open"),
    date: shift?.date ?? defaults.date,
    note: shift?.note ?? "",
    start: shift ? hhmm(shift.startMinute) : first ? hhmm(first.startMinute) : "09:00",
    end: shift ? hhmm(shift.endMinute) : first ? hhmm(first.endMinute) : "17:00",
    breakMinutes: String(shift?.breakMinutes ?? first?.breakMinutes ?? 30),
    qualificationId: String(shift?.qualificationId ?? first?.qualificationId ?? ""),
    templateId: String(shift?.templateId ?? (shift ? "" : first?.id ?? "")),
  });

  const pickTemplate = (id: string) => {
    const t = templates.find((x) => String(x.id) === id);
    setValues(t ? { ...values, start: hhmm(t.startMinute), end: hhmm(t.endMinute), breakMinutes: String(t.breakMinutes), qualificationId: String(t.qualificationId ?? ""), templateId: id }
      : { ...values, templateId: "" });
  };

  return (
    <form action={action} className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {shift && <input type="hidden" name="id" value={shift.id} />}
      <Field label="Employee">
        <select name="employeeId" value={values.employeeId} onChange={(e) => setValues({ ...values, employeeId: e.target.value })} className={inputClass}>
          <option value="open">— Open shift —</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </Field>
      <Field label="Date"><input type="date" name="date" value={values.date} onChange={(e) => setValues({ ...values, date: e.target.value })} required className={inputClass} /></Field>
      <Field label="Template">
        <select name="templateId" value={values.templateId} onChange={(e) => pickTemplate(e.target.value)} className={inputClass}>
          <option value="">Custom</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({hhmm(t.startMinute)}–{hhmm(t.endMinute)})</option>)}
        </select>
      </Field>
      <Field label="Qualification">
        <select name="qualificationId" value={values.qualificationId} onChange={(e) => setValues({ ...values, qualificationId: e.target.value })} className={inputClass}>
          <option value="">None required</option>
          {qualifications.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
        </select>
      </Field>
      <Field label="Start"><input type="time" name="start" value={values.start} onChange={(e) => setValues({ ...values, start: e.target.value, templateId: "" })} required className={inputClass} /></Field>
      <Field label="End" hint="Earlier than start = next day"><input type="time" name="end" value={values.end} onChange={(e) => setValues({ ...values, end: e.target.value, templateId: "" })} required className={inputClass} /></Field>
      <Field label="Break (min)"><input type="number" name="breakMinutes" min={0} value={values.breakMinutes} onChange={(e) => setValues({ ...values, breakMinutes: e.target.value })} className={inputClass} /></Field>
      <Field label="Note"><input name="note" value={values.note} onChange={(e) => setValues({ ...values, note: e.target.value })} maxLength={300} className={inputClass} /></Field>
      {state?.error && (
        <div role="alert" className="col-span-full rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          {state.error}
          {state.violations && <ul className="mt-1 list-disc pl-5">{state.violations.map((v) => <li key={v}>{v}</li>)}</ul>}
          {state.violations && <label className="mt-2 flex items-center gap-2"><input type="checkbox" name="override" value="1" /> Save anyway</label>}
        </div>
      )}
      <div className="col-span-full flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : shift ? "Save shift" : "Add shift"}</Button>
        <Link href={`/schedule?week=${week}`} className="inline-flex items-center rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">Cancel</Link>
      </div>
    </form>
  );
}
