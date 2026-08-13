/**
 * 日期 → 價格類別 (DayType) 判斷邏輯
 *
 * 業主提供的完整定義：
 * - 平日：除了節日／跨年／春節期間之外的星期一到四
 * - 旺日：星期五、星期日，以及「連續假期」的前一天與最後一天
 * - 節日／跨年／春節：完全依 holidays 表（節日清單）認定的日期為準，
 *   優先權最高（蓋過星期幾的判斷）
 *
 * ⚠️ 星期六目前業主沒有明確說明算平日還是旺日。星期五、日都是旺日，
 * 星期六夾在中間如果算平日會很奇怪，所以先預設「星期六比照星期五、日
 * 算旺日」，但這只是我的假設，麻煩實際確認後再讓我知道要不要調整
 * （見 isPeakDayOfWeek）。
 *
 * 「連續假期」的判定方式：把 holidays 表裡日期相鄰（前一天+1＝下一天）
 * 的紀錄視為同一個連續假期區間。只有「長度 >= 2 天」的區間，才會套用
 * 「前一天」「最後一天」旺日的規則；單獨一天的節日，就單純以該節日
 * 分類計價（沒有「最後一天」與「其餘天」的區別可言）。
 */

import type { DayType } from "./types";

export type HolidayCategory = "holiday" | "festival" | "lunar_new_year" | "new_year_eve";

/** 從資料庫 holidays 表撈出的節日對照表：日期字串 → 分類 */
export type HolidayMap = Map<string, HolidayCategory>;

/** 套用「連續假期前一天/最後一天算旺日」規則之後的最終日期分類對照表 */
export type EffectiveDayTypeMap = Map<string, DayType>;

function addDaysToDateStr(dateStr: string, delta: number): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/**
 * 星期五、星期六、星期日視為旺日（星期六為假設，見檔案頂部說明），
 * 星期一到四視為平日。
 */
function isPeakDayOfWeek(dateStr: string): boolean {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0=日 1=一 ... 5=五 6=六
  return day === 0 || day === 5 || day === 6;
}

/** 把日期陣列依「相鄰日期」分組成一段一段的連續區間 */
function groupConsecutiveDates(sortedDates: string[]): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];

  for (const date of sortedDates) {
    if (current.length === 0) {
      current = [date];
      continue;
    }
    const expectedNext = addDaysToDateStr(current[current.length - 1], 1);
    if (date === expectedNext) {
      current.push(date);
    } else {
      groups.push(current);
      current = [date];
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/**
 * 把原始節日清單（單純的「日期→節日分類」）轉換成套用旺日規則之後的
 * 「最終日期分類」對照表：
 * - 連續 2 天以上的假期，最後一天改標記為 peak（旺日價，不是節日價）
 * - 假期第一天的前一天，也標記為 peak
 * - 單獨一天的節日則維持原分類不變
 *
 * 建議在單次報價計算的最開始呼叫一次，結果重複用在每一晚的判斷上，
 * 不需要每晚重新計算。
 */
export function buildEffectiveDayTypeMap(holidayMap: HolidayMap): EffectiveDayTypeMap {
  const sortedDates = Array.from(holidayMap.keys()).sort();
  const runs = groupConsecutiveDates(sortedDates);
  const effective: EffectiveDayTypeMap = new Map();

  for (const run of runs) {
    if (run.length === 1) {
      effective.set(run[0], holidayMap.get(run[0])!);
      continue;
    }

    // 中間天數（不含最後一天）維持原本的節日/跨年/春節分類
    for (let i = 0; i < run.length - 1; i++) {
      effective.set(run[i], holidayMap.get(run[i])!);
    }
    // 最後一天降為旺日
    effective.set(run[run.length - 1], "peak");

    // 假期開始前一天，若本身不是另一段假期的一部分，標記為旺日
    const dayBefore = addDaysToDateStr(run[0], -1);
    if (!holidayMap.has(dayBefore)) {
      effective.set(dayBefore, "peak");
    }
  }

  return effective;
}

/**
 * 判斷單一日期的最終價格分類。
 * @param dateStr 'YYYY-MM-DD'
 * @param effectiveMap 由 buildEffectiveDayTypeMap() 算好的對照表
 */
export function resolveDayType(dateStr: string, effectiveMap: EffectiveDayTypeMap): DayType {
  const forced = effectiveMap.get(dateStr);
  if (forced) return forced;
  return isPeakDayOfWeek(dateStr) ? "peak" : "weekday";
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
