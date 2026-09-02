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

export async function listExpensesAction(limit?: number): Promise<ExpenseDetail[]> {
  return listExpenses(limit);
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
