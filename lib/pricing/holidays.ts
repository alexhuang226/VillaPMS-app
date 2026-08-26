/**
 * 節日管理查詢層
 *
 * holidays 表的 organization_id 統一用 null（全平台共用清單，見
 * 001_pms_schema.sql 該欄位的註解，以及 db/019_fix_holidays_
 * organization_id.sql 修正過的說明：報價引擎固定查 organization_id
 * IS NULL 這份清單）。這裡所有查詢/寫入都直接寫死 null，不開放
 * 改成組織自訂清單——目前系統只有一個組織，沒有這個需求。
 */

import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type HolidayDayType = "holiday" | "festival" | "lunar_new_year" | "new_year_eve";

export interface HolidayEntry {
  id: string;
  holidayDate: string;
  name: string | null;
  dayType: HolidayDayType;
}

export async function getHolidaysForYear(year: number): Promise<HolidayEntry[]> {
  const supabase = createServiceRoleClient();
  const yearStart = `${year}-01-01`;
  const yearEndExclusive = `${year + 1}-01-01`;

  const { data, error } = await supabase
    .from("holidays")
    .select("id, holiday_date, name, day_type")
    .is("organization_id", null)
    .gte("holiday_date", yearStart)
    .lt("holiday_date", yearEndExclusive)
    .order("holiday_date");

  if (error) {
    throw new Error(`查詢節日資料失敗：${error.message}`);
  }

  return ((data ?? []) as any[]).map((row) => ({
    id: row.id as string,
    holidayDate: row.holiday_date as string,
    name: (row.name as string) ?? null,
    dayType: row.day_type as HolidayDayType,
  }));
}

export async function createHoliday(date: string, name: string, dayType: HolidayDayType): Promise<void> {
  const supabase = createServiceRoleClient();

  // 不用 upsert／on conflict：holidays 的 unique(organization_id,
  // holiday_date) 沒有加 NULLS NOT DISTINCT，PostgreSQL 預設會把每個
  // null 視為互不相同，這個唯一性限制對 organization_id 是 null 的
  // 資料列（我們這裡故意都是 null，見檔案開頭說明）實際上不會生效，
  // 用 on conflict 偵測不到「已經有這筆資料」，可能會一直新增出重複
  // 資料列，不會真的更新到既有那筆。改成自己手動查一次再決定新增
  // 還是更新，不依賴資料庫這層去重。
  const { data: existing, error: findError } = await supabase
    .from("holidays")
    .select("id")
    .is("organization_id", null)
    .eq("holiday_date", date)
    .maybeSingle();
  if (findError) {
    throw new Error(`查詢節日失敗：${findError.message}`);
  }

  if (existing) {
    const { error } = await (supabase.from("holidays") as any)
      .update({ name, day_type: dayType })
      .eq("id", (existing as any).id);
    if (error) throw new Error(`更新節日失敗：${error.message}`);
    return;
  }

  const { error } = await (supabase.from("holidays") as any).insert({
    organization_id: null,
    holiday_date: date,
    name,
    day_type: dayType,
  });
  if (error) {
    throw new Error(`新增節日失敗：${error.message}`);
  }
}

export async function updateHoliday(id: string, name: string, dayType: HolidayDayType): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await (supabase.from("holidays") as any).update({ name, day_type: dayType }).eq("id", id);
  if (error) {
    throw new Error(`更新節日失敗：${error.message}`);
  }
}

export async function deleteHoliday(id: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("holidays").delete().eq("id", id);
  if (error) {
    throw new Error(`刪除節日失敗：${error.message}`);
  }
}

export interface BulkHolidayEntry {
  date: string;
  name: string;
  dayType: HolidayDayType;
}

/**
 * 批次匯入節日——一次把一整年的節日資料寫進去，不用一筆一筆手動
 * 新增，也不用寫 SQL migration 檔案，這是「一鍵匯入」實際在做的事。
 *
 * 同一個日期重複匯入會直接覆蓋成最新的名稱／分類，不會產生重複
 * 資料——用「先查一次這批日期裡哪些已經存在、分成新增/更新兩批」
 * 的方式做，不透過資料庫 upsert／on conflict（原因見 createHoliday
 * 的說明：這張表的唯一性限制對 organization_id 是 null 的資料列
 * 實際上不會生效）。
 */
export async function bulkImportHolidays(entries: BulkHolidayEntry[]): Promise<{ imported: number }> {
  const supabase = createServiceRoleClient();
  if (entries.length === 0) return { imported: 0 };

  const dates = entries.map((e) => e.date);
  const { data: existingRows, error: findError } = await supabase
    .from("holidays")
    .select("id, holiday_date")
    .is("organization_id", null)
    .in("holiday_date", dates);
  if (findError) {
    throw new Error(`查詢既有節日資料失敗：${findError.message}`);
  }

  const existingIdByDate = new Map(((existingRows ?? []) as any[]).map((r) => [r.holiday_date as string, r.id as string]));

  const toInsert = entries
    .filter((e) => !existingIdByDate.has(e.date))
    .map((e) => ({ organization_id: null, holiday_date: e.date, name: e.name, day_type: e.dayType }));
  const toUpdate = entries.filter((e) => existingIdByDate.has(e.date));

  if (toInsert.length > 0) {
    const { error } = await (supabase.from("holidays") as any).insert(toInsert);
    if (error) throw new Error(`批次新增節日失敗：${error.message}`);
  }

  for (const e of toUpdate) {
    const id = existingIdByDate.get(e.date)!;
    const { error } = await (supabase.from("holidays") as any).update({ name: e.name, day_type: e.dayType }).eq("id", id);
    if (error) throw new Error(`批次更新節日失敗（${e.date}）：${error.message}`);
  }

  return { imported: entries.length };
}
