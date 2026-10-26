// Clock in / clock out for the signed-in employee (works without JavaScript).

import { Button, Card } from "@/components/ui";
import { formatHours } from "@/lib/domain/dates";
import { workedMinutes } from "@/lib/domain/timeaccount";
import type { TimeEntry } from "@/lib/data/time";
import { clockIn, clockOut } from "./actions";

export function ClockCard({ open, timeZone }: { open: TimeEntry | null; timeZone: string }) {
  const since = open ? new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(open.startAt) : null;
  return (
    <Card title="Time clock">
      {open ? (
        <form action={clockOut} className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-slate-600">Clocked in since <span className="font-medium text-slate-900">{since}</span></div>
            <div className="text-xs text-slate-500">{formatHours(workedMinutes(open))} so far (statutory breaks deducted)</div>
          </div>
          <Button type="submit" variant="danger">Clock out</Button>
        </form>
      ) : (
        <form action={clockIn} className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-600">You are not clocked in.</div>
          <Button type="submit">Clock in</Button>
        </form>
      )}
    </Card>
  );
}
