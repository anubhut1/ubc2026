import type { Period } from "./types";

/** Start of the current calendar period in UTC (weeks start Monday). */
export function periodStart(period: Period, now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === "week") {
    const dow = (d.getUTCDay() + 6) % 7; // Mon=0
    d.setUTCDate(d.getUTCDate() - dow);
  } else if (period === "month") {
    d.setUTCDate(1);
  }
  return d;
}
