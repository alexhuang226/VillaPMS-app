"use server";

import { createEmployee, createEmployeeLoginAccount, listAllEmployees, updateEmployee } from "@/lib/schedule/queries";
import type { EmployeeDetail, EmployeeFields } from "@/lib/schedule/queries";

export async function listAllEmployeesAction(): Promise<EmployeeDetail[]> {
  return listAllEmployees();
}

export async function createEmployeeAction(fields: EmployeeFields): Promise<void> {
  return createEmployee(fields);
}

export async function updateEmployeeAction(id: string, fields: EmployeeFields): Promise<void> {
  return updateEmployee(id, fields);
}

export async function createEmployeeLoginAccountAction(employeeId: string, email: string, password: string): Promise<void> {
  return createEmployeeLoginAccount(employeeId, email, password);
}
