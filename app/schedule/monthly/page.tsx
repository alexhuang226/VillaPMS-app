import { MonthlySchedule } from "@/app/components/monthly-schedule";
import {
  getCheckOutCoverageForRangeAction,
  listActiveEmployeesAction,
  listStaffAssignmentsForRangeAction,
} from "@/app/actions/schedule";
import { getCurrentEmployeeInfo } from "@/lib/auth/current-employee";

/** 跟 monthly-schedule.tsx 的 getGridDateRange 是同一段邏輯，這裡是
 * 伺服器端要用，兩邊執行環境不同沒辦法直接共用同一個函式——理由見
 * app/reservations/page.tsx 對應函式的說明 */
function firstWeekdayOfMonth(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}
function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}
function getGridDateRange(year: number, month: number): { startDate: string; endDateExclusive: string } {
  const leadingBlanks = firstWeekdayOfMonth(year, month);
  const daysInMonth = getDaysInMonth(year, month);
  const weeksCount = Math.ceil((leadingBlanks + daysInMonth) / 7);
  const totalGridDays = weeksCount * 7;

  const gridStart = new Date(Date.UTC(year, month - 1, 1 - leadingBlanks));
  const gridEndExclusive = new Date(Date.UTC(year, month - 1, 1 - leadingBlanks + totalGridDays));

  return {
    startDate: gridStart.toISOString().slice(0, 10),
    endDateExclusive: gridEndExclusive.toISOString().slice(0, 10),
  };
}

export default async function MonthlySchedulePage() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const { startDate, endDateExclusive } = getGridDateRange(year, month);

  // 跟訂單管理頁面同一種優化：伺服器端先把「這個月月曆格子」實際
  // 涵蓋範圍（含跨月補的天數）的排班資料查好，跟角色查詢平行進行，
  // 一起當初始資料傳給 client component，避免點進頁面時的空白等待。
  const [{ id, position }, assignments, coverage, employees] = await Promise.all([
    getCurrentEmployeeInfo(),
    listStaffAssignmentsForRangeAction(startDate, endDateExclusive),
    getCheckOutCoverageForRangeAction(startDate, endDateExclusive),
    listActiveEmployeesAction(),
  ]);
  const isHousekeepingStaff = position === "房務員";

  return (
    <MonthlySchedule
      isHousekeepingStaff={isHousekeepingStaff}
      currentEmployeeId={id}
      initialAssignments={assignments}
      initialCoverage={coverage}
      initialEmployees={employees}
      initialYear={year}
      initialMonth={month}
    />
  );
}
