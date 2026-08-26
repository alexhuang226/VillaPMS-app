import { MonthlySchedule } from "@/app/components/monthly-schedule";
import { getCurrentEmployeePosition } from "@/lib/auth/current-employee";

export default async function MonthlySchedulePage() {
  const position = await getCurrentEmployeePosition();
  const isHousekeepingStaff = position === "房務員";
  return <MonthlySchedule isHousekeepingStaff={isHousekeepingStaff} />;
}
