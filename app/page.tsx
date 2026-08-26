import { HomeNav } from "@/app/components/home-nav";
import { getCurrentEmployeePosition } from "@/lib/auth/current-employee";

export default async function HomePage() {
  const position = await getCurrentEmployeePosition();
  const isHousekeepingStaff = position === "房務員";
  return <HomeNav isHousekeepingStaff={isHousekeepingStaff} />;
}
