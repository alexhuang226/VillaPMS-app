import { TodaySchedule } from "@/app/components/today-schedule";
import { getCurrentEmployeePosition } from "@/lib/auth/current-employee";

export default async function TodaySchedulePage() {
  const position = await getCurrentEmployeePosition();
  const isHousekeepingStaff = position === "房務員";
  return <TodaySchedule isHousekeepingStaff={isHousekeepingStaff} />;
}
