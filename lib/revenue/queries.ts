/**
 * 營收統計查詢層
 *
 * 跟其他查詢層一樣用 service role client（見
 * lib/supabase/service-role.ts 的說明）。
 *
 * 兩個統計指標的歸屬月份，刻意用不同規則，這裡先說清楚避免之後
 * 誤會成 bug：
 *
 * - 營收：整筆訂單的金額歸屬到「入住日期」所在的月份。這是最常見
 *   的做法（訂單成立、客人實際開始入住的那個月），不會把一筆訂單
 *   的金額拆到跨月份的好幾個月裡。
 * - 住房天數／住房率：用「晚數」實際落在哪個月份去算，跨月的訂房
 *   （例如 12/30 入住、1/2 退房）晚數會正確拆到 12 月跟 1 月——因為
 *   住房率描述的是「這個月裡，這間民宿有多少天實際被佔用」，一定
 *   要照實際晚數落在哪個月份算，不能整筆算進入住月份，不然入住月
 *   會虛高、退房那個月看起來完全沒營業。
 */

import { createServiceRoleClient } from "@/lib/supabase/service-role";

const PROPERTIES = [
  { code: "zhici", name: "只此清綠" },
  { code: "moyin", name: "陌隱" },
  { code: "shuijing", name: "水景璞堤" },
];

/** 某筆訂房區間（check_in ~ check_out）落在某年某月的晚數，兩者沒有重疊回傳 0 */
function nightsInMonth(checkIn: string, checkOut: string, year: number, month: number): number {
  const monthStart = Date.UTC(year, month - 1, 1);
  const monthEndExclusive = Date.UTC(year, month, 1);
  const stayStart = new Date(`${checkIn}T00:00:00Z`).getTime();
  const stayEnd = new Date(`${checkOut}T00:00:00Z`).getTime();

  const overlapStart = Math.max(monthStart, stayStart);
  const overlapEnd = Math.min(monthEndExclusive, stayEnd);

  const nights = Math.round((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24));
  return Math.max(0, nights);
}

/** 某年是不是閏年，用來算全年天數（366／365），二月沒有 29 號的話 JS Date 會自動進位到 3/1 */
function isLeapYear(year: number): boolean {
  return new Date(year, 1, 29).getMonth() === 1;
}

export interface MonthlyPropertyStats {
  month: number; // 1-12
  propertyCode: string;
  propertyName: string;
  revenue: number;
  nightsBooked: number;
  /** 0~1 之間，這個月這間民宿的住房率（訂房天數 / 這個月總天數） */
  occupancyRate: number;
}

export interface YearlyRevenueStats {
  year: number;
  totalRevenue: number;
  /** 0~1 之間，全年三間民宿合計的住房率（總訂房晚數 / (3 間 × 全年天數)） */
  totalOccupancyRate: number;
  /** 每月三間民宿合計營收，長條圖用 */
  monthlyTotalRevenue: { month: number; revenue: number }[];
  /** 每月、每間民宿各自的營收/訂房天數/住房率，明細表用 */
  monthlyByProperty: MonthlyPropertyStats[];
}

export async function getYearlyRevenueStats(year: number): Promise<YearlyRevenueStats> {
  const supabase = createServiceRoleClient();
  const yearStart = `${year}-01-01`;
  const yearEndExclusive = `${year + 1}-01-01`;

  // 撈這一年有重疊到的所有訂單（不含取消的）——條件是「入住日在明年
  // 之前」且「退房日在今年開始之後」，涵蓋跨年度的訂房
  const { data, error } = await supabase
    .from("reservations")
    .select("check_in, check_out, final_total, property_id, properties(code)")
    .lt("check_in", yearEndExclusive)
    .gt("check_out", yearStart)
    .neq("status", "cancelled");

  if (error) {
    throw new Error(`查詢營收統計失敗：${error.message}`);
  }

  const rows = (data ?? []) as any[];

  // 先把每間民宿、每個月的統計都初始化成 0，確保完全沒有訂單的
  // 月份/民宿也會出現在結果裡（不會漏掉，畫圖表/表格時也不用另外
  // 補空月份）
  const statsMap = new Map<string, MonthlyPropertyStats>();
  for (const p of PROPERTIES) {
    for (let m = 1; m <= 12; m++) {
      statsMap.set(`${p.code}|${m}`, {
        month: m,
        propertyCode: p.code,
        propertyName: p.name,
        revenue: 0,
        nightsBooked: 0,
        occupancyRate: 0,
      });
    }
  }

  for (const row of rows) {
    const propertyCode = (row.properties?.code as string) ?? "";
    const checkIn = row.check_in as string;
    const checkOut = row.check_out as string;
    const finalTotal = Number(row.final_total ?? 0);

    // 營收歸屬到入住月份（只有入住日期本身落在這一年才算，避免
    // 去年入住、今年退房的訂單把整筆金額也算進今年）
    const checkInDate = new Date(`${checkIn}T00:00:00Z`);
    if (checkInDate.getUTCFullYear() === year) {
      const checkInMonth = checkInDate.getUTCMonth() + 1;
      const entry = statsMap.get(`${propertyCode}|${checkInMonth}`);
      if (entry) entry.revenue += finalTotal;
    }

    // 住房晚數依實際落在哪個月份分別累加，跨月的訂房會正確拆開
    for (let m = 1; m <= 12; m++) {
      const nights = nightsInMonth(checkIn, checkOut, year, m);
      if (nights > 0) {
        const entry = statsMap.get(`${propertyCode}|${m}`);
        if (entry) entry.nightsBooked += nights;
      }
    }
  }

  // 每個月份的住房率 = 這個月訂房晚數 / 這個月總天數
  for (const entry of statsMap.values()) {
    const daysInThisMonth = new Date(year, entry.month, 0).getDate();
    entry.occupancyRate = daysInThisMonth > 0 ? entry.nightsBooked / daysInThisMonth : 0;
  }

  const monthlyByProperty = Array.from(statsMap.values()).sort(
    (a, b) => a.month - b.month || a.propertyCode.localeCompare(b.propertyCode)
  );

  const monthlyTotalRevenue = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const revenue = monthlyByProperty.filter((e) => e.month === month).reduce((sum, e) => sum + e.revenue, 0);
    return { month, revenue };
  });

  const totalRevenue = monthlyTotalRevenue.reduce((sum, m) => sum + m.revenue, 0);
  const totalNights = monthlyByProperty.reduce((sum, e) => sum + e.nightsBooked, 0);
  const daysInYear = isLeapYear(year) ? 366 : 365;
  const totalAvailableNights = PROPERTIES.length * daysInYear;
  const totalOccupancyRate = totalAvailableNights > 0 ? totalNights / totalAvailableNights : 0;

  return { year, totalRevenue, totalOccupancyRate, monthlyTotalRevenue, monthlyByProperty };
}
