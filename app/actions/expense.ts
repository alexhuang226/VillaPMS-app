"use server";

import {
  createExpense,
  deleteExpense,
  getMonthlyExpensesByProperty,
  getYearlyExpensesByProperty,
  getYearlyUnassignedExpenses,
  listExpenses,
} from "@/lib/expenses/queries";
import type {
  ExpenseDetail,
  ExpenseFields,
  MonthlyExpensesByProperty,
  MonthlyPropertyExpense,
  YearlyUnassignedExpenses,
} from "@/lib/expenses/queries";
import { getCurrentEmployeePosition } from "@/lib/auth/current-employee";

/** 管家不該看到薪資／房租這些跟人事、租約有關的費用記錄——用分類
 * 名稱過濾，不用另外加欄位或改資料庫結構。之後如果還想多藏別的
 * 分類，這裡加一個字串就好。這個過濾一定要放在伺服器端（在把資料
 * 回傳給前端「之前」就先擋掉），不能只在畫面上不顯示，不然管家
 * 打開瀏覽器開發工具還是看得到這些資料。 */
const CATEGORIES_HIDDEN_FROM_HOUSEKEEPING_MANAGER = ["房租", "薪資"];

export async function listExpensesAction(limit?: number): Promise<ExpenseDetail[]> {
  const rows = await listExpenses(limit);
  const position = await getCurrentEmployeePosition();
  if (position === "管家") {
    return rows.filter((r) => !CATEGORIES_HIDDEN_FROM_HOUSEKEEPING_MANAGER.includes(r.category));
  }
  return rows;
}

/**
 * 回傳值刻意用「結果物件」不是 throw，理由見 app/actions/quote.ts 的
 * ConfirmReservationResult 說明（Next.js 正式環境下 Server Action
 * 用 throw 拋出的錯誤訊息會被抹除）。
 */
export type CreateExpenseResult = { success: true } | { success: false; message: string };

export async function createExpenseAction(fields: ExpenseFields): Promise<CreateExpenseResult> {
  try {
    await createExpense(fields);
    return { success: true };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "新增費用記錄失敗，請稍後再試" };
  }
}

export type DeleteExpenseResult = { success: true } | { success: false; message: string };

export async function deleteExpenseAction(id: string): Promise<DeleteExpenseResult> {
  try {
    await deleteExpense(id);
    return { success: true };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "刪除失敗，請稍後再試" };
  }
}

export async function getMonthlyExpensesByPropertyAction(year: number, month: number): Promise<MonthlyExpensesByProperty[]> {
  return getMonthlyExpensesByProperty(year, month);
}

export async function getYearlyExpensesByPropertyAction(year: number): Promise<MonthlyPropertyExpense[]> {
  return getYearlyExpensesByProperty(year);
}

export async function getYearlyUnassignedExpensesAction(year: number): Promise<YearlyUnassignedExpenses> {
  return getYearlyUnassignedExpenses(year);
}
