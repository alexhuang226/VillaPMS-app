import { ReservationsSearch } from "@/app/components/reservations-search";
import { getCurrentEmployeePosition } from "@/lib/auth/current-employee";

export default async function ReservationsPage() {
  const position = await getCurrentEmployeePosition();
  const isHousekeepingManager = position === "管家";
  return <ReservationsSearch isHousekeepingManager={isHousekeepingManager} />;
}
