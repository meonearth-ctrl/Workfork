// Settings (managers): location & rules, shift templates, qualifications,
// holidays.

import { Button, Card, inputClass, PageHeader } from "@/components/ui";
import { formatDay } from "@/components/week-nav";
import { requireManager } from "@/lib/auth/session";
import { addDays, localDate } from "@/lib/domain/dates";
import { getHolidays, getLocation, getQualifications, getTemplates } from "@/lib/data/planning";
import { addHoliday, addQualification, deleteHoliday, deleteQualification, deleteTemplate } from "./actions";
import { LocationForm, TemplateForm } from "./forms";

export default async function SettingsPage() {
  const user = await requireManager();
  const loc = await getLocation(user.locationId);
  const today = localDate(new Date(), loc.timezone);
  const [templates, qualifications, holidays] = await Promise.all([
    getTemplates(loc.id), getQualifications(), getHolidays(loc.id, addDays(today, -30), addDays(today, 400)),
  ]);
  return (
    <>
      <PageHeader title="Settings" subtitle={loc.name} />
      <Card title="Location, forecasting & labour rules" className="mb-4">
        <LocationForm loc={loc} />
      </Card>
      <Card title="Shift templates" className="mb-4">
        <p className="mb-3 text-sm text-slate-500">Auto-planning builds the roster from these. Templates that need a qualification are staffed first, once per open day.</p>
        <div className="space-y-3">
          {templates.map((t) => (
            <div key={t.id} className="flex items-end gap-2 border-b border-slate-100 pb-3">
              <div className="flex-1"><TemplateForm template={t} qualifications={qualifications} /></div>
              <form action={deleteTemplate}><input type="hidden" name="id" value={t.id} /><Button variant="danger" type="submit">Delete</Button></form>
            </div>
          ))}
          <div className="pt-1"><TemplateForm qualifications={qualifications} /></div>
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Qualifications">
          <ul className="mb-3 divide-y divide-slate-100 text-sm">
            {qualifications.map((q) => (
              <li key={q.id} className="flex items-center justify-between py-1.5">
                {q.name}
                {user.role === "admin" && (
                  <form action={deleteQualification}><input type="hidden" name="id" value={q.id} /><button className="text-xs text-rose-600 underline">Delete</button></form>
                )}
              </li>
            ))}
          </ul>
          <form action={addQualification} className="flex gap-2">
            <input name="name" placeholder="e.g. First aid" required className={inputClass} />
            <Button type="submit">Add</Button>
          </form>
        </Card>
        <Card title="Public holidays (closed, no target hours)">
          <ul className="mb-3 max-h-64 divide-y divide-slate-100 overflow-y-auto text-sm">
            {holidays.map((h) => (
              <li key={h.id} className="flex items-center justify-between py-1.5">
                <span><span className="tabular-nums">{formatDay(h.date, { day: "numeric", month: "short", year: "numeric" })}</span> · {h.name}
                  {h.locationId === null && <span className="text-xs text-slate-400"> (all locations)</span>}</span>
                {(h.locationId !== null || user.role === "admin") && (
                  <form action={deleteHoliday}><input type="hidden" name="id" value={h.id} /><button className="text-xs text-rose-600 underline">Delete</button></form>
                )}
              </li>
            ))}
          </ul>
          <form action={addHoliday} className="flex gap-2">
            <input name="date" type="date" required className={inputClass} />
            <input name="name" placeholder="Name" required className={inputClass} />
            <Button type="submit">Add</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
