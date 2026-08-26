"use server";

import {
  bulkImportHolidays,
  createHoliday,
  deleteHoliday,
  getHolidaysForYear,
  updateHoliday,
} from "@/lib/pricing/holidays";
import type { BulkHolidayEntry, HolidayDayType, HolidayEntry } from "@/lib/pricing/holidays";

export async function getHolidaysForYearAction(year: number): Promise<HolidayEntry[]> {
  return getHolidaysForYear(year);
}

export async function createHolidayAction(date: string, name: string, dayType: HolidayDayType): Promise<void> {
  return createHoliday(date, name, dayType);
}

export async function updateHolidayAction(id: string, name: string, dayType: HolidayDayType): Promise<void> {
  return updateHoliday(id, name, dayType);
}

export async function deleteHolidayAction(id: string): Promise<void> {
  return deleteHoliday(id);
}

export async function bulkImportHolidaysAction(entries: BulkHolidayEntry[]): Promise<{ imported: number }> {
  return bulkImportHolidays(entries);
}
