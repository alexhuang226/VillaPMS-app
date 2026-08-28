/**
 * 營收統計查詢層
 *
 * 跟其他查詢層一樣用 service role client（見
 * lib/supabase/service-role.ts 的說明）。
 *
 * 營收／住房天數的歸屬月份，都是照「實際晚數落在哪個月份」比例分配
 * ——這是沿用民宿原本 Google 試算表的做法（試算表裡本來就有「跨月
 * 歸屬A月天數／A月歸屬金額／B月歸屬年月／B月歸屬金額」這幾個欄位，
 * 就是做這件事）。例如一筆訂單兩晚在 12 月、一晚在 1 月，總金額會
 * 按 2:1 比例拆到兩個月份，不會整筆算進入住月份，避免入住月虛高、
 * 退房月看起來完全沒營業。
 *
 * 「已取消」訂單的營收/住房天數處理方式（重要）：
 * - 一般已取消的訂單：完全不計入營收、也不計入住房天數（客人沒有
 *   真的入住，房間這段期間也還是空的）。
 * - 已取消、但付款狀況是「沒收訂金」的訂單：訂金雖然客人沒入住，
 *   但民宿實際上收下了這筆錢當作取消費用，這筆錢還是要算進營收——
 *   金額用這筆訂單訂金的實收金額（從 payments 表查該訂單
 *   payment_kind='deposit' 的記錄加總），不是訂單的 final_total
 *   （客人根本沒付那麼多）。這筆錢刻意不比例分配到各月份、整筆算在
 *   入住月份——因為訂金是取消費用，跟「這幾晚各自值多少錢」沒有
 *   對應關係，沒有比例分配的意義。住房天數依然不計入（房間還是
 *   空的，沒有實際被佔用）。
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

/** 訂單整體總晚數（不分年月，純粹算 checkIn 到 checkOut 中間隔幾晚） */
function totalNights(checkIn: string, checkOut: string): number {
  const stayStart = new Date(`${checkIn}T00:00:00Z`).getTime();
  const stayEnd = new Date(`${checkOut}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((stayEnd - stayStart) / (1000 * 60 * 60 * 24)));
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

  // 撈這一年有重疊到的所有訂單——這次故意不排除「已取消」的訂單，
  // 因為已取消但「沒收訂金」的訂單，訂金金額還是要算進營收（見上面
  // 檔案開頭的說明），要先撈出來才能判斷。條件是「入住日在明年之前」
  // 且「退房日在今年開始之後」，涵蓋跨年度的訂房。
  const { data, error } = await supabase
    .from("reservations")
    .select("id, check_in, check_out, final_total, status, payment_status, property_id, properties(code)")
    .lt("check_in", yearEndExclusive)
    .gt("check_out", yearStart);

  if (error) {
    throw new Error(`查詢營收統計失敗：${error.message}`);
  }

  const rows = (data ?? []) as any[];

  // 已取消、且付款狀況是「沒收訂金」的訂單，要另外查它們各自訂金
  // 實收了多少錢（payments 表 payment_kind='deposit' 的金額加總）
  const forfeitedReservationIds = rows
    .filter((row) => row.status === "cancelled" && row.payment_status === "deposit_forfeited")
    .map((row) => row.id as string);

  const forfeitedDepositByReservation = new Map<string, number>();
  if (forfeitedReservationIds.length > 0) {
    const { data: depositRows, error: depositError } = await supabase
      .from("payments")
      .select("reservation_id, amount")
      .in("reservation_id", forfeitedReservationIds)
      .eq("payment_kind", "deposit");
    if (depositError) {
      throw new Error(`查詢沒收訂金金額失敗：${depositError.message}`);
    }
    for (const p of (depositRows ?? []) as any[]) {
      const reservationId = p.reservation_id as string;
      const amount = Number(p.amount ?? 0);
      forfeitedDepositByReservation.set(reservationId, (forfeitedDepositByReservation.get(reservationId) ?? 0) + amount);
    }
  }

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
    const isCancelled = row.status === "cancelled";
    const isForfeited = isCancelled && row.payment_status === "deposit_forfeited";

    if (isForfeited) {
      // 沒收訂金：整筆算在入住月份，不比例分配（見檔案開頭的說明）
      const depositAmount = forfeitedDepositByReservation.get(row.id as string) ?? 0;
      if (depositAmount > 0) {
        const checkInDate = new Date(`${checkIn}T00:00:00Z`);
        if (checkInDate.getUTCFullYear() === year) {
          const checkInMonth = checkInDate.getUTCMonth() + 1;
          const entry = statsMap.get(`${propertyCode}|${checkInMonth}`);
          if (entry) entry.revenue += depositAmount;
        }
      }
      continue;
    }

    if (isCancelled) {
      // 一般已取消：不計入營收、也不計入住房天數
      continue;
    }

    // 正常訂單：營收跟住房晚數都按「實際晚數落在哪個月份」比例分配
    const finalTotal = Number(row.final_total ?? 0);
    const nights = totalNights(checkIn, checkOut);
    for (let m = 1; m <= 12; m++) {
      const nightsThisMonth = nightsInMonth(checkIn, checkOut, year, m);
      if (nightsThisMonth <= 0) continue;
      const entry = statsMap.get(`${propertyCode}|${m}`);
      if (!entry) continue;
      entry.nightsBooked += nightsThisMonth;
      if (nights > 0) {
        entry.revenue += (finalTotal * nightsThisMonth) / nights;
      }
    }
  }

  // 每個月份的住房率 = 這個月訂房晚數 / 這個月總天數
  for (const entry of statsMap.values()) {
    const daysInThisMonth = new Date(year, entry.month, 0).getDate();
    entry.occupancyRate = daysInThisMonth > 0 ? entry.nightsBooked / daysInThisMonth : 0;
  }

  // 金額四捨五入到整數——比例分配算出來的小數（例如 $38,800 分3晚
  // 中的1晚 = $12,933.33...）沒有意義，畫面顯示整數比較乾淨
  for (const entry of statsMap.values()) {
    entry.revenue = Math.round(entry.revenue);
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
  const totalNightsBooked = monthlyByProperty.reduce((sum, e) => sum + e.nightsBooked, 0);
  const daysInYear = isLeapYear(year) ? 366 : 365;
  const totalAvailableNights = PROPERTIES.length * daysInYear;
  const totalOccupancyRate = totalAvailableNights > 0 ? totalNightsBooked / totalAvailableNights : 0;

  return { year, totalRevenue, totalOccupancyRate, monthlyTotalRevenue, monthlyByProperty };
}
