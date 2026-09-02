"use client";

/**
 * 營收統計頁面
 *
 * 頁面最上方是年份下拉選單。往下依序是：
 * 1. 今年（選定年份）三間民宿合計的總營收＋總住房率
 * 2. 每月三間民宿合計營收的長條圖
 * 3. 每個月、每間民宿各自的營收/訂房天數/住房率明細表
 *
 * 營收／住房率的歸屬月份規則不一樣，詳細原因見
 * lib/revenue/queries.ts 開頭的說明：營收算在入住月份、住房天數按
 * 實際晚數落在哪個月份分別計算（跨月訂房會正確拆開，不會整筆算進
 * 入住月份）。
 *
 * 長條圖是純 CSS/HTML 畫的（div 高度比例），沒有另外裝圖表套件——
 * 這個專案目前沒有安裝任何圖表函式庫，為了不多一個依賴，用最簡單
 * 的方式做。
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Fraunces, Work_Sans } from "next/font/google";
import { getYearlyRevenueStatsAction } from "@/app/actions/revenue";
import { getYearlyExpensesByPropertyAction, getYearlyUnassignedExpensesAction } from "@/app/actions/expense";
import type { YearlyRevenueStats } from "@/lib/revenue/queries";
import type { MonthlyPropertyExpense, YearlyUnassignedExpenses } from "@/lib/expenses/queries";

const display = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  variable: "--font-display",
});
const body = Work_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
});

const colors = {
  canvas: "#FAF8F4",
  ink: "#221F1B",
  muted: "#57514A",
  line: "#D9D1C4",
  pine: "#33422E",
  pineSoft: "#E7EAE1",
  pineText: "#FFFFFF",
  alert: "#A23E2D",
  blue: "#2455A4",
};

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function formatMoney(amount: number): string {
  return Math.round(amount).toLocaleString();
}

export function RevenueStats() {
  const [year, setYear] = useState<number | null>(null);
  const [stats, setStats] = useState<YearlyRevenueStats | null>(null);
  const [expenses, setExpenses] = useState<MonthlyPropertyExpense[]>([]);
  const [unassignedExpenses, setUnassignedExpenses] = useState<YearlyUnassignedExpenses>({ totalAmount: 0, byMonth: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 年份選單的今年，mount 後才設定，避免 SSR/client 算出的「今年」
  // 不一致造成 hydration 警告（同樣的處理方式見其他頁面的日期預設值）
  useEffect(() => {
    setYear(new Date().getFullYear());
  }, []);

  useEffect(() => {
    if (year === null) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    // 費用統計是這次新加的功能，故意讓它「安全失敗」（查詢失敗的話
    // 就當作沒有費用資料，不影響營收數字本身）——營收統計原本就是
    // 已經在用的報表，不該因為新功能查詢失敗就整頁掛掉
    Promise.all([
      getYearlyExpensesByPropertyAction(year).catch(() => []),
      getYearlyUnassignedExpensesAction(year).catch(() => ({ totalAmount: 0, byMonth: [] })),
    ]).then(([expensesData, unassignedData]) => {
      if (!cancelled) {
        setExpenses(expensesData);
        setUnassignedExpenses(unassignedData);
      }
    });
    getYearlyRevenueStatsAction(year)
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "查詢失敗，請稍後再試");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [year]);

  const thisYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 7 }, (_, i) => thisYear + 1 - i); // 未來一年到過去五年

  const maxMonthlyRevenue = stats ? Math.max(1, ...stats.monthlyTotalRevenue.map((m) => m.revenue)) : 1;

  return (
    <div className={`${body.className} flex min-h-screen w-full justify-center px-5 py-8`} style={{ backgroundColor: colors.canvas }}>
      <div className="w-full" style={{ maxWidth: "24rem", color: colors.ink }}>
        <Link href="/" className="text-xs" style={{ color: colors.blue }}>
          ← 返回首頁
        </Link>
        <header className="mb-4 text-center">
          <p style={{ color: colors.muted }} className="text-[11px] tracking-[0.2em]">
            宜蘭・包棟民宿
          </p>
          <h1 className={`${display.className} text-4xl italic`} style={{ color: colors.ink }}>
            營收統計
          </h1>
        </header>

        {year !== null && (
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="mb-4 w-full border-b bg-transparent py-2 text-center text-sm outline-none"
            style={{ borderColor: colors.line, color: colors.ink }}
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y} 年
              </option>
            ))}
          </select>
        )}

        {isLoading && (
          <p className="text-xs" style={{ color: colors.muted }}>
            讀取中…
          </p>
        )}
        {error && (
          <p role="alert" className="border-l-2 pl-3 text-xs leading-relaxed" style={{ borderColor: colors.alert, color: colors.alert }}>
            {error}
          </p>
        )}

        {stats && !isLoading && (
          <>
            {/* 年度總覽 */}
            <div className="rounded-sm px-4 py-4" style={{ backgroundColor: colors.pineSoft }}>
              <p className="text-[11px] tracking-wide" style={{ color: colors.muted }}>
                {stats.year} 年三間民宿總營收
              </p>
              <p className={`${display.className} text-4xl italic`} style={{ color: colors.pine }}>
                {formatMoney(stats.totalRevenue)}
              </p>
              <div className="mt-2 flex items-baseline justify-between border-t pt-2" style={{ borderColor: colors.line }}>
                <span style={{ color: colors.muted }} className="text-xs tracking-wide">
                  總住房率
                </span>
                <span style={{ color: colors.ink }} className="text-sm font-semibold">
                  {formatPercent(stats.totalOccupancyRate)}
                </span>
              </div>
              <p className="mt-1 text-[10px]" style={{ color: colors.muted }}>
                住房率＝三間民宿全年訂房晚數合計／（3 間 × 全年天數）
              </p>
              {(() => {
                const totalExpense = expenses.reduce((sum, e) => sum + e.totalAmount, 0);
                const totalProfit = stats.totalRevenue - totalExpense - unassignedExpenses.totalAmount;
                return (
                  <>
                    <div className="mt-2 flex items-baseline justify-between border-t pt-2" style={{ borderColor: colors.line }}>
                      <span style={{ color: colors.muted }} className="text-xs tracking-wide">
                        總費用（含不指定民宿）
                      </span>
                      <span style={{ color: colors.ink }} className="text-sm font-semibold">
                        {formatMoney(totalExpense + unassignedExpenses.totalAmount)}
                      </span>
                    </div>
                    <div className="mt-2 flex items-baseline justify-between">
                      <span style={{ color: colors.muted }} className="text-xs tracking-wide">
                        總毛利（營收－費用）
                      </span>
                      <span
                        className="text-sm font-semibold"
                        style={{ color: totalProfit >= 0 ? colors.pine : colors.alert }}
                      >
                        {formatMoney(totalProfit)}
                      </span>
                    </div>
                    {unassignedExpenses.totalAmount > 0 && (
                      <p className="mt-1 text-[10px]" style={{ color: colors.muted }}>
                        其中 {formatMoney(unassignedExpenses.totalAmount)} 是不指定民宿的費用（例如同時涵蓋好幾間的薪資），沒有分攤到下方個別民宿的毛利明細裡
                      </p>
                    )}
                  </>
                );
              })()}
            </div>

            {/* 每月總營收長條圖 */}
            <div className="mt-6">
              <p className="text-xs font-bold" style={{ color: colors.ink }}>
                每月總營收
              </p>
              <div className="mt-3 flex items-end gap-1" style={{ height: "140px" }}>
                {stats.monthlyTotalRevenue.map((m) => {
                  const heightPct = m.revenue > 0 ? Math.max((m.revenue / maxMonthlyRevenue) * 100, 3) : 0;
                  return (
                    <div key={m.month} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                      <span className="text-[8px] leading-none" style={{ color: colors.muted }}>
                        {m.revenue > 0 ? Math.round(m.revenue / 1000) + "k" : ""}
                      </span>
                      <div className="w-full" style={{ height: `${heightPct}%`, backgroundColor: colors.pine, minHeight: m.revenue > 0 ? "2px" : "0" }} />
                      <span className="text-[9px] leading-none" style={{ color: colors.muted }}>
                        {m.month}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 每月總覽——營收/費用/毛利放在一起，一眼看完 12 個月，
                不用像下面「每月各民宿明細」那樣要分別展開每個月、
                每間民宿才看得到。這裡的費用是「這個月全部民宿加總
                ＋不指定民宿」的總額，不分民宿，跟下面明細表「單一
                民宿」層級的費用是不同層次的數字。 */}
            <div className="mt-6">
              <p className="text-xs font-bold" style={{ color: colors.ink }}>
                每月總覽
              </p>
              <table className="mt-2 w-full text-[11px]">
                <thead>
                  <tr style={{ color: colors.muted }}>
                    <th className="pb-1 text-center font-normal">月份</th>
                    <th className="pb-1 text-center font-normal">營收</th>
                    <th className="pb-1 text-center font-normal">費用</th>
                    <th className="pb-1 text-center font-normal">毛利</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((monthNum) => {
                    const monthRevenue = stats.monthlyTotalRevenue.find((m) => m.month === monthNum)?.revenue ?? 0;
                    const monthPropertyExpense = expenses
                      .filter((e) => e.month === monthNum)
                      .reduce((sum, e) => sum + e.totalAmount, 0);
                    const monthUnassignedExpense = unassignedExpenses.byMonth.find((m) => m.month === monthNum)?.amount ?? 0;
                    const monthExpense = monthPropertyExpense + monthUnassignedExpense;
                    const monthProfit = monthRevenue - monthExpense;
                    return (
                      <tr key={monthNum} className="border-t" style={{ borderColor: colors.line }}>
                        <td className="py-1">{monthNum} 月</td>
                        <td className="py-1 text-right tabular-nums">{formatMoney(monthRevenue)}</td>
                        <td className="py-1 text-right tabular-nums">{formatMoney(monthExpense)}</td>
                        <td className="py-1 text-right tabular-nums" style={{ color: monthProfit >= 0 ? colors.pine : colors.alert }}>
                          {formatMoney(monthProfit)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 每月各民宿明細 */}
            <div className="mt-6">
              <p className="text-xs font-bold" style={{ color: colors.ink }}>
                每月各民宿明細
              </p>
              <div className="mt-2 flex flex-col gap-3">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((monthNum) => {
                  const rows = stats.monthlyByProperty.filter((e) => e.month === monthNum);
                  const monthHasData = rows.some((r) => r.revenue > 0 || r.nightsBooked > 0);
                  // 這個月三間民宿合計——住房率不是三間直接加總，是
                  // 「三間合計訂房晚數 / (3 間 × 這個月天數)」，跟
                  // getYearlyRevenueStats() 算全年住房率的邏輯一致，
                  // 只是把範圍從全年縮小成這個月
                  const monthTotalRevenue = rows.reduce((sum, r) => sum + r.revenue, 0);
                  const monthTotalNights = rows.reduce((sum, r) => sum + r.nightsBooked, 0);
                  const daysInThisMonth = new Date(stats.year, monthNum, 0).getDate();
                  const monthOccupancyRate =
                    rows.length > 0 && daysInThisMonth > 0 ? monthTotalNights / (rows.length * daysInThisMonth) : 0;
                  // 費用/毛利——用 propertyCode 對照，找不到費用記錄的
                  // 民宿當作這個月費用是 0（沒記錄費用不代表沒有費用，
                  // 只是還沒記，不能假裝毛利＝營收）
                  const expenseByCode = new Map<string, number>(
                    expenses.filter((e) => e.month === monthNum).map((e) => [e.propertyCode, e.totalAmount])
                  );
                  const monthTotalExpense = rows.reduce((sum, r) => sum + (expenseByCode.get(r.propertyCode) ?? 0), 0);
                  // 累計——從 1 月一路加到這個月為止，讓職員不用自己
                  // 心算就能看出「到目前這個月為止，今年整體做了多少」，
                  // 不是只看單月的數字
                  const cumulativeRows = stats.monthlyByProperty.filter((e) => e.month <= monthNum);
                  const cumulativeRevenue = cumulativeRows.reduce((sum, r) => sum + r.revenue, 0);
                  const cumulativeNights = cumulativeRows.reduce((sum, r) => sum + r.nightsBooked, 0);
                  const cumulativeExpense = expenses
                    .filter((e) => e.month <= monthNum)
                    .reduce((sum, e) => sum + e.totalAmount, 0);
                  const cumulativeDays = Array.from({ length: monthNum }, (_, i) =>
                    new Date(stats.year, i + 1, 0).getDate()
                  ).reduce((sum, d) => sum + d, 0);
                  const cumulativeOccupancyRate =
                    rows.length > 0 && cumulativeDays > 0 ? cumulativeNights / (rows.length * cumulativeDays) : 0;
                  return (
                    <div key={monthNum} className="border p-3" style={{ borderColor: colors.line, opacity: monthHasData ? 1 : 0.5 }}>
                      <p className={`${display.className} text-base italic`}>{monthNum} 月</p>
                      <table className="mt-1 w-full text-[11px]">
                        <thead>
                          <tr style={{ color: colors.muted }}>
                            <th className="pb-1 text-center font-normal">民宿</th>
                            <th className="pb-1 text-center font-normal">營收</th>
                            <th className="pb-1 text-center font-normal">費用</th>
                            <th className="pb-1 text-center font-normal">毛利</th>
                            <th className="pb-1 text-center font-normal">訂房天數</th>
                            <th className="pb-1 text-center font-normal">住房率</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => {
                            const propertyExpense = expenseByCode.get(r.propertyCode) ?? 0;
                            const propertyProfit = r.revenue - propertyExpense;
                            return (
                              <tr key={r.propertyCode}>
                                <td className="py-0.5">{r.propertyName}</td>
                                <td className="py-0.5 text-right tabular-nums">{formatMoney(r.revenue)}</td>
                                <td className="py-0.5 text-right tabular-nums">{formatMoney(propertyExpense)}</td>
                                <td className="py-0.5 text-right tabular-nums" style={{ color: propertyProfit >= 0 ? colors.pine : colors.alert }}>
                                  {formatMoney(propertyProfit)}
                                </td>
                                <td className="py-0.5 text-right tabular-nums">{r.nightsBooked} 天</td>
                                <td className="py-0.5 text-right tabular-nums">{formatPercent(r.occupancyRate)}</td>
                              </tr>
                            );
                          })}
                          <tr className="border-t font-bold" style={{ borderColor: colors.line, color: colors.pine }}>
                            <td className="py-0.5">合計</td>
                            <td className="py-0.5 text-right tabular-nums">{formatMoney(monthTotalRevenue)}</td>
                            <td className="py-0.5 text-right tabular-nums">{formatMoney(monthTotalExpense)}</td>
                            <td
                              className="py-0.5 text-right tabular-nums"
                              style={{ color: monthTotalRevenue - monthTotalExpense >= 0 ? colors.pine : colors.alert }}
                            >
                              {formatMoney(monthTotalRevenue - monthTotalExpense)}
                            </td>
                            <td className="py-0.5 text-right tabular-nums">{monthTotalNights} 天</td>
                            <td className="py-0.5 text-right tabular-nums">{formatPercent(monthOccupancyRate)}</td>
                          </tr>
                          <tr style={{ color: colors.muted }}>
                            <td className="py-0.5">累計</td>
                            <td className="py-0.5 text-right tabular-nums">{formatMoney(cumulativeRevenue)}</td>
                            <td className="py-0.5 text-right tabular-nums">{formatMoney(cumulativeExpense)}</td>
                            <td
                              className="py-0.5 text-right tabular-nums"
                              style={{ color: cumulativeRevenue - cumulativeExpense >= 0 ? colors.pine : colors.alert }}
                            >
                              {formatMoney(cumulativeRevenue - cumulativeExpense)}
                            </td>
                            <td className="py-0.5 text-right tabular-nums">{cumulativeNights} 天</td>
                            <td className="py-0.5 text-right tabular-nums">{formatPercent(cumulativeOccupancyRate)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
