import { MonthlySchedule } from "@/app/components/monthly-schedule";
import { getCurrentEmployeeInfo } from "@/lib/auth/current-employee";

export default async function MonthlySchedulePage() {
  const { id, position } = await getCurrentEmployeeInfo();
  const isHousekeepingStaff = position === "房務員";
  return <MonthlySchedule isHousekeepingStaff={isHousekeepingStaff} currentEmployeeId={id} />;
}
