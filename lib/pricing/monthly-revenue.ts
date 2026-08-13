/**
 * 跨月歸屬金額
 *
 * 原始 Google Sheet 公式：
 *   ROUND(IF(N(AC)>0, V * N(AC) / T, V))
 * 意思是：訂單總金額 V，依「這個月的訂房天數 N」占「總訂房天數 T」
 * 的比例，估算這個月應該分攤到多少營收。
 *
 * 在這裡我們已經有「每一晚的實際住宿費用」(nightlyBreakdown)，
 * 不需要再用「天數比例」去估算金額 —— 直接把落在該月份的每晚金額
 * 加總即可，結果會比原本的比例估算更準確（尤其是平日/假日混合的
 * 訂單）。加購費用（加床、加房、寵物清潔、額外服務、訪客、折扣）
 * 因為不是按晚發生的一次性項目，預設整筆歸屬到「入住第一晚所在的
 * 月份」，如果你們的做法不同（例如攤提或歸屬到退房月份），
 * 調整 allocateOneTimeFeesTo 的邏輯即可。
 */

import type { NightlyBreakdownItem, PackageQuote } from "./types";

export interface MonthlyRevenueItem {
  yearMonth: string; // 'YYYY-MM'
  accommodationAmount: number; // 該月份住宿費用（不含加購項目）
  oneTimeFeesAmount: number; // 歸屬到該月份的加購/服務費用（見上方說明）
  totalAmount: number;
}

function yearMonthOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}

export function allocateMonthlyRevenue(quote: PackageQuote): MonthlyRevenueItem[] {
  const byMonth = new Map<string, MonthlyRevenueItem>();

  const ensure = (yearMonth: string): MonthlyRevenueItem => {
    let item = byMonth.get(yearMonth);
    if (!item) {
      item = { yearMonth, accommodationAmount: 0, oneTimeFeesAmount: 0, totalAmount: 0 };
      byMonth.set(yearMonth, item);
    }
    return item;
  };

  for (const night of quote.nightlyBreakdown as NightlyBreakdownItem[]) {
    const item = ensure(yearMonthOf(night.date));
    item.accommodationAmount += night.amount;
  }

  // 一次性費用（加床/加房/寵物清潔/額外服務/訪客-折扣）歸屬到入住第一晚所在月份
  const oneTimeFeesTotal =
    quote.extraBedFee +
    quote.extraRoomFee +
    quote.petCleaningFee +
    quote.addOnFee +
    quote.visitorFee -
    quote.discountAmount;

  if (quote.nightlyBreakdown.length > 0) {
    const firstMonth = ensure(yearMonthOf(quote.nightlyBreakdown[0].date));
    firstMonth.oneTimeFeesAmount += oneTimeFeesTotal;
  }

  const result = Array.from(byMonth.values());
  for (const item of result) {
    item.totalAmount = item.accommodationAmount + item.oneTimeFeesAmount;
  }
  result.sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  return result;
}
