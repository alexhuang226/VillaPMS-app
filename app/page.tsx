import { HomeNav } from "@/app/components/home-nav";
import { getCurrentEmployeeInfo } from "@/lib/auth/current-employee";

export default async function HomePage() {
  const { position, shortName } = await getCurrentEmployeeInfo();
  const isHousekeepingStaff = position === "房務員";
  const isHousekeepingManager = position === "管家";
  const isPropertyRestricted = position === "清潔員" || position === "洗衣公司";
  return (
    <HomeNav
      isHousekeepingStaff={isHousekeepingStaff}
      isHousekeepingManager={isHousekeepingManager}
      isPropertyRestricted={isPropertyRestricted}
      currentUserShortName={shortName}
    />
  );
}
