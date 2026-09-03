import { ReservationsSearch } from "@/app/components/reservations-search";
import { getCurrentEmployeePosition } from "@/lib/auth/current-employee";

/**
 * 支援用網址參數帶入要顯示哪個年/月——新增訂單頁面存檔成功後，會
 * 帶著新訂單入住日期所在的年/月導回這裡（見 reservation-create-
 * form.tsx 的 handleCreateSubmit），這樣使用者存檔後不用自己再手動
 * 切換月份，就能直接看到剛新增的那筆訂單。沒有帶參數（例如從首頁
 * 直接點進來）就維持原本的行為，交給 client component 自己用「今天」
 * 當預設值。
 */
export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const position = await getCurrentEmployeePosition();
  const isHousekeepingManager = position === "管家";

  const params = await searchParams;
  const parsedYear = params.year ? Number(params.year) : null;
  const parsedMonth = params.month ? Number(params.month) : null;
  const initialYear = parsedYear && Number.isInteger(parsedYear) ? parsedYear : null;
  const initialMonth = parsedMonth && Number.isInteger(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12 ? parsedMonth : null;

  return (
    <ReservationsSearch isHousekeepingManager={isHousekeepingManager} initialYear={initialYear} initialMonth={initialMonth} />
  );
}
