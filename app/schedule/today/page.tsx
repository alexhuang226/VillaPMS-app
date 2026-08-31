import { TodaySchedule } from "@/app/components/today-schedule";
import { getCurrentEmployeeInfo } from "@/lib/auth/current-employee";

export default async function TodaySchedulePage() {
  const { id, position, allowedPropertyIds } = await getCurrentEmployeeInfo();
  const isHousekeepingStaff = position === "房務員";
  const isPropertyRestricted = position === "清潔員" || position === "洗衣公司";
  return (
    <TodaySchedule
      isHousekeepingStaff={isHousekeepingStaff}
      currentEmployeeId={id}
      isPropertyRestricted={isPropertyRestricted}
      allowedPropertyIds={allowedPropertyIds}
    />
  );
}
