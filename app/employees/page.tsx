import { EmployeeManager } from "@/app/components/employee-manager";
import { getCurrentEmployeePosition } from "@/lib/auth/current-employee";

export default async function EmployeesPage() {
  const position = await getCurrentEmployeePosition();
  const isHousekeepingManager = position === "管家";
  return <EmployeeManager isHousekeepingManager={isHousekeepingManager} />;
}
