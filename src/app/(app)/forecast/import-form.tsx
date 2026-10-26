"use client";

import { useActionState } from "react";
import { Button, Field, inputClass } from "@/components/ui";
import { importDemand } from "./actions";

export function ImportForm() {
  const [state, action, pending] = useActionState(importDemand, undefined);
  return (
    <form action={action} className="space-y-3">
      <Field label="CSV file" hint="Columns: date (YYYY-MM-DD), hour (0–23), volume. A header row is fine.">
        <input type="file" name="file" accept=".csv,text/csv,text/plain" className="text-sm" />
      </Field>
      <Field label="…or paste rows">
        <textarea name="csv" rows={4} placeholder={"2026-10-19,9,24\n2026-10-19,10,31"} className={`${inputClass} font-mono`} />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Importing…" : "Import"}</Button>
        {state?.error && <span role="alert" className="text-sm text-rose-600">{state.error}</span>}
        {state?.ok && <span className="text-sm text-emerald-700">{state.ok}</span>}
      </div>
    </form>
  );
}
