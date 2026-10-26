"use server";
// Import historical demand (customers, orders, calls… per hour) as CSV:
// "date,hour,volume" per line. Existing values for the same hour are replaced.

import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireManager } from "@/lib/auth/session";
import { isValidIsoDate } from "@/lib/domain/dates";

const MAX_ROWS = 50_000;

export async function importDemand(_prev: { error?: string; ok?: string } | undefined, formData: FormData) {
  const user = await requireManager();
  const file = formData.get("file");
  let text = String(formData.get("csv") ?? "");
  if (file instanceof File && file.size > 0) {
    if (file.size > 5_000_000) return { error: "The file is larger than 5 MB." };
    text = await file.text();
  }
  const rows: { locationId: number; date: string; hour: number; volume: number }[] = [];
  const bad: number[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || /^date\b/i.test(trimmed)) return;   // blank or header
    const [date, hour, volume] = trimmed.split(/[,;\t]/).map((x) => x.trim());
    const h = Number(hour);
    const v = Number(volume);
    if (!isValidIsoDate(date) || !Number.isInteger(h) || h < 0 || h > 23 || !Number.isFinite(v) || v < 0) bad.push(i + 1);
    else rows.push({ locationId: user.locationId, date, hour: h, volume: v });
  });
  if (rows.length === 0) return { error: bad.length ? `No valid rows (problem on line ${bad[0]}).` : "Paste or upload some rows first." };
  if (rows.length > MAX_ROWS) return { error: `At most ${MAX_ROWS} rows per import.` };

  for (let i = 0; i < rows.length; i += 1000) {
    await db.insert(schema.demandHistory).values(rows.slice(i, i + 1000))
      .onConflictDoUpdate({
        target: [schema.demandHistory.locationId, schema.demandHistory.date, schema.demandHistory.hour],
        set: { volume: sql`excluded.volume` },
      });
  }
  revalidatePath("/forecast");
  revalidatePath("/schedule");
  return { ok: `Imported ${rows.length} rows${bad.length ? `; skipped ${bad.length} invalid line(s) (first: line ${bad[0]})` : ""}.` };
}
