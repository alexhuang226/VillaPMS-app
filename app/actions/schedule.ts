"use server";

import {
  createStaffAssignment,
  deleteStaffAssignment,
  deleteStaffAssignmentsForPropertyDate,
  getCheckOutCoverage,
  getUpcomingPrepInfo,
  listActiveEmployees,
  listStaffAssignmentsForDate,
  listStaffAssignmentsForMonth,
  updateStaffAssignment,
} from "@/lib/schedule/queries";
import type { CheckOutCoverage, Employee, StaffAssignment, UpcomingPrepInfo } from "@/lib/schedule/queries";

export async function listActiveEmployeesAction(): Promise<Employee[]> {
  return listActiveEmployees();
}

export async function createStaffAssignmentAction(params: {
  employeeId: string;
  propertyId: string | null;
  workDate: string;
  notes: string | null;
}): Promise<void> {
  return createStaffAssignment(params);
}

export async function updateStaffAssignmentAction(
  id: string,
  params: {
    employeeId: string;
    propertyId: string | null;
    workDate: string;
    notes: string | null;
  }
): Promise<void> {
  return updateStaffAssignment(id, params);
}

export async function deleteStaffAssignmentAction(id: string): Promise<void> {
  return deleteStaffAssignment(id);
}

/** 訂單的退房日期被改掉時，清掉舊退房日對應的房務排班 */
export async function deleteStaffAssignmentsForPropertyDateAction(propertyId: string, workDate: string): Promise<void> {
  return deleteStaffAssignmentsForPropertyDate(propertyId, workDate);
}

export async function listStaffAssignmentsForDateAction(date: string): Promise<StaffAssignment[]> {
  return listStaffAssignmentsForDate(date);
}

/** month 是 1-12，回傳這個月的 [monthStart, monthEndExclusive) 兩個 'YYYY-MM-DD' 字串 */
function monthRange(year: number, month: number): { monthStart: string; monthEndExclusive: string } {
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonthDate = new Date(year, month, 1); // month 是 1-12，剛好等於下個月用 JS Date 的 0-11 表示
  const monthEndExclusive = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, "0")}-01`;
  return { monthStart, monthEndExclusive };
}

export async function listStaffAssignmentsForMonthAction(year: number, month: number): Promise<StaffAssignment[]> {
  const { monthStart, monthEndExclusive } = monthRange(year, month);
  return listStaffAssignmentsForMonth(monthStart, monthEndExclusive);
}

/** 這個月每一筆退房訂單，有沒有分配到房務人員（給月曆顯示警告用） */
export async function getCheckOutCoverageAction(year: number, month: number): Promise<CheckOutCoverage[]> {
  const { monthStart, monthEndExclusive } = monthRange(year, month);
  return getCheckOutCoverage(monthStart, monthEndExclusive);
}

/**
 * 跟上面兩個 xxxAction(year, month) 查的是同一批資料，差別是直接
 * 接受明確的日期區間，不是限定「一整個月」——月曆畫面補在跨月那
 * 一週前後、屬於上個月/下個月的格子，也要顯示真實的排班/退房狀況
 * （不是空白格），需要查的範圍比「這個月」再寬一點點（最多前後
 * 各 6 天）。呼叫端自己算好要查的起訖日期傳進來，理由/算法見
 * monthly-schedule.tsx 的 getGridDateRange()。
 */
export async function listStaffAssignmentsForRangeAction(
  startDate: string,
  endDateExclusive: string
): Promise<StaffAssignment[]> {
  return listStaffAssignmentsForMonth(startDate, endDateExclusive);
}

export async function getCheckOutCoverageForRangeAction(
  startDate: string,
  endDateExclusive: string
): Promise<CheckOutCoverage[]> {
  return getCheckOutCoverage(startDate, endDateExclusive);
}

export async function getUpcomingPrepInfoAction(
  propertyId: string,
  onOrAfterDate: string
): Promise<UpcomingPrepInfo | null> {
  return getUpcomingPrepInfo(propertyId, onOrAfterDate);
}

