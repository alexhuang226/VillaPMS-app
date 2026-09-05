import { RevenueStats } from "@/app/components/revenue-stats";
import { getCurrentEmployeePosition } from "@/lib/auth/current-employee";

export default async function RevenuePage() {
  const position = await getCurrentEmployeePosition();
  const isHousekeepingManager = position === "管家";
  return <RevenueStats isHousekeepingManager={isHousekeepingManager} />;
}
