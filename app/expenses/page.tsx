import { ExpenseManager } from "@/app/components/expense-manager";
import { getCurrentEmployeePosition } from "@/lib/auth/current-employee";

export default async function ExpensesPage() {
  const position = await getCurrentEmployeePosition();
  const isHousekeepingManager = position === "管家";
  return <ExpenseManager isHousekeepingManager={isHousekeepingManager} />;
}
