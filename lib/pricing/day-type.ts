/**
 * 日期 → 價格類別 (DayType) 判斷邏輯
 *
 * ⚠️ 假設說明（原始文件沒有明確定義，請依實際營運規則調整）：
 * - 預設「週五、週六」視為旺日 (peak)，其餘平日視為 weekday。
 *   這個假設目前不影響價格計算結果（平日與旺日共用「平旺日」價格），
 *   只影響 rate_rules.base_guests 這個目前尚未被公式使用的參考欄位。
 *   如果你們有明確的「平日/旺日」定義（例如寒暑假、特定星期），
 *   請直接修改 isPeakWeekday()。
 * - 假日／節日／春節／跨年 完全依 holidays 資料表（節日清單）判斷，
 *   優先權：春節 > 跨年 > 節日 > 假日 > 旺日 / 平日，
 *   對應原始 AppSheet IFS 公式的判斷順序。
 */

import type { DayType } from "./types";

export type HolidayCategory = "holiday" | "festival" | "lunar_new_year" | "new_year_eve";

/** 從資料庫 holidays 表撈出的節日對照表：日期字串 → 分類 */
export type HolidayMap = Map<string, HolidayCategory>;

function isPeakWeekday(date: Date): boolean {
  const day = date.getUTCDay(); // 0=日 1=一 ... 5=五 6=六
  return day === 5 || day === 6; // 週五、週六視為旺日，可依實際需求調整
}

/**
 * 判斷單一日期的價格類別。
 * @param dateStr 'YYYY-MM-DD'
 * @param holidayMap 節日清單對照表（見 queries.ts 的 getHolidayMap）
 */
export function resolveDayType(dateStr: string, holidayMap: HolidayMap): DayType {
  const holidayCategory = holidayMap.get(dateStr);
  if (holidayCategory) return holidayCategory;

  const date = new Date(`${dateStr}T00:00:00Z`);
  return isPeakWeekday(date) ? "peak" : "weekday";
}

/**
 * 把 6 種 day_type 收斂成「每日住宿費用明細」實際會用到的 5 種價格分類
 * （weekday 與 peak 共用「平旺日」價格）。
 */
export function toPriceCategory(
  dayType: DayType
): "regular" | "holiday" | "festival" | "lunar_new_year" | "new_year_eve" {
  if (dayType === "weekday" || dayType === "peak") return "regular";
  return dayType;
}

/** 列出 [checkIn, checkOut) 之間每一晚的日期字串（不含退房日） */
export function listStayDates(checkIn: string, checkOut: string): string[] {
  const dates: string[] = [];
  let cursor = new Date(`${checkIn}T00:00:00Z`);
  const end = new Date(`${checkOut}T00:00:00Z`);
  while (cursor < end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return dates;
}
