// Previous / this / next week links that keep the other query parameters.

import Link from "next/link";
import { addDays, IsoDate, parseIso } from "@/lib/domain/dates";

export function formatDay(date: IsoDate, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) {
  return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(parseIso(date));
}

export function WeekNav({ monday, basePath, params = {}, thisMonday }: {
  monday: IsoDate; basePath: string; params?: Record<string, string>; thisMonday: IsoDate;
}) {
  const href = (week: IsoDate) => `${basePath}?${new URLSearchParams({ ...params, week })}`;
  const link = "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50";
  return (
    <div className="flex items-center gap-2">
      <Link className={link} href={href(addDays(monday, -7))} aria-label="Previous week">←</Link>
      <Link className={link} href={href(thisMonday)}>This week</Link>
      <Link className={link} href={href(addDays(monday, 7))} aria-label="Next week">→</Link>
      <span className="ml-1 text-sm font-medium text-slate-700">
        {formatDay(monday, { day: "numeric", month: "short" })} – {formatDay(addDays(monday, 6), { day: "numeric", month: "short", year: "numeric" })}
      </span>
    </div>
  );
}
