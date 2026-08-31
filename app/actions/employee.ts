"use server";

import { createEmployee, createEmployeeLoginAccount, listAllEmployees, resetEmployeePassword, updateEmployee } from "@/lib/schedule/queries";
import type { EmployeeDetail, EmployeeFields } from "@/lib/schedule/queries";

export async function listAllEmployeesAction(): Promise<EmployeeDetail[]> {
  return listAllEmployees();
}

export async function createEmployeeAction(fields: EmployeeFields): Promise<string> {
  return createEmployee(fields);
}

export async function updateEmployeeAction(id: string, fields: EmployeeFields): Promise<void> {
  return updateEmployee(id, fields);
}

export async function createEmployeeLoginAccountAction(employeeId: string, email: string, password: string): Promise<void> {
  return createEmployeeLoginAccount(employeeId, email, password);
}

/**
 * 重設員工登入密碼——回傳值刻意用「結果物件」不是 throw，理由見
 * app/actions/quote.ts 的 ConfirmReservationResult 說明（Next.js
 * 正式環境下 Server Action 用 throw 拋出的錯誤訊息會被抹除）。
 */
export type ResetPasswordResult = { success: true } | { success: false; message: string };

export async function resetEmployeePasswordAction(employeeId: string, newPassword: string): Promise<ResetPasswordResult> {
  try {
    await resetEmployeePassword(employeeId, newPassword);
    return { success: true };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "重設密碼失敗，請稍後再試" };
  }
}
