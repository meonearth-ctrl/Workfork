"use client";
// Settings forms that report validation errors inline.

import { useActionState } from "react";
import { Button, Field, inputClass } from "@/components/ui";
import { saveLocation, saveTemplate } from "./actions";

const hhmm = (m: number) => `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function Status({ state }: { state: { error?: string; ok?: string } | undefined }) {
  if (state?.error) return <span role="alert" className="text-sm text-rose-600">{state.error}</span>;
  if (state?.ok) return <span className="text-sm text-emerald-700">{state.ok}</span>;
  return null;
}

export function LocationForm({ loc }: {
  loc: { name: string; timezone: string; openHour: number; closeHour: number; productivity: number; minStaff: number;
    minRestHours: number; maxDailyHours: number; maxWeeklyHours: number; maxConsecutiveDays: number };
}) {
  const [state, action, pending] = useActionState(saveLocation, undefined);
  const num = (name: keyof typeof loc, label: string, hint?: string, step = "1") => (
    <Field label={label} hint={hint}><input name={name} type="number" step={step} defaultValue={String(loc[name])} className={inputClass} /></Field>
  );
  return (
    <form action={action} className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <div className="col-span-2"><Field label="Location name"><input name="name" defaultValue={loc.name} className={inputClass} /></Field></div>
      <div className="col-span-2"><Field label="Time zone" hint="IANA name, e.g. Europe/Berlin"><input name="timezone" defaultValue={loc.timezone} className={inputClass} /></Field></div>
      {num("openHour", "Opens (hour)")}
      {num("closeHour", "Closes (hour)")}
      {num("productivity", "Productivity", "Demand units one person handles per hour", "0.1")}
      {num("minStaff", "Minimum staff while open")}
      {num("minRestHours", "Min. rest between shifts (h)", undefined, "0.5")}
      {num("maxDailyHours", "Max. hours per day", undefined, "0.5")}
      {num("maxWeeklyHours", "Max. hours per week", undefined, "0.5")}
      {num("maxConsecutiveDays", "Max. days in a row")}
      <div className="col-span-full flex items-center gap-3">
        <Button type="submit" disabled={pending}>Save</Button><Status state={state} />
      </div>
    </form>
  );
}

export function TemplateForm({ template, qualifications }: {
  template?: { id: number; name: string; startMinute: number; endMinute: number; breakMinutes: number; qualificationId: number | null; color: string };
  qualifications: { id: number; name: string }[];
}) {
  const [state, action, pending] = useActionState(saveTemplate, undefined);
  return (
    <form action={action} className="grid grid-cols-2 items-end gap-2 md:grid-cols-7">
      {template && <input type="hidden" name="id" value={template.id} />}
      <Field label="Name"><input name="name" defaultValue={template?.name} required className={inputClass} /></Field>
      <Field label="Start"><input name="start" type="time" defaultValue={template ? hhmm(template.startMinute) : "08:00"} className={inputClass} /></Field>
      <Field label="End"><input name="end" type="time" defaultValue={template ? hhmm(template.endMinute) : "16:30"} className={inputClass} /></Field>
      <Field label="Break"><input name="breakMinutes" type="number" min={0} defaultValue={template?.breakMinutes ?? 30} className={inputClass} /></Field>
      <Field label="Needs">
        <select name="qualificationId" defaultValue={String(template?.qualificationId ?? "")} className={inputClass}>
          <option value="">—</option>
          {qualifications.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
        </select>
      </Field>
      <Field label="Colour"><input name="color" type="color" defaultValue={template?.color ?? "#3b82f6"} className="h-9 w-full rounded-lg border border-slate-300" /></Field>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending} variant={template ? "secondary" : "primary"}>{template ? "Save" : "Add"}</Button>
        <Status state={state} />
      </div>
    </form>
  );
}
