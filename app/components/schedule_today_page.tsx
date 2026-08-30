import { TodaySchedule } from "@/app/components/today-schedule";
import { getCurrentEmployeeInfo } from "@/lib/auth/current-employee";

export default async function TodaySchedulePage() {
  const { id, position } = await getCurrentEmployeeInfo();
  const isHousekeepingStaff = position === "房務員";
  return <TodaySchedule isHousekeepingStaff={isHousekeepingStaff} currentEmployeeId={id} />;
}
