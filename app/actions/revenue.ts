"use server";

import { getYearlyRevenueStats } from "@/lib/revenue/queries";
import type { YearlyRevenueStats } from "@/lib/revenue/queries";

export async function getYearlyRevenueStatsAction(year: number): Promise<YearlyRevenueStats> {
  return getYearlyRevenueStats(year);
}
