import { ReservationsSearch } from "@/app/components/reservations-search";
import { getCalendarReservationsForRangeAction } from "@/app/actions/reservation";
import { getCurrentEmployeePosition } from "@/lib/auth/current-employee";

/** 跟 reservations-search.tsx 的 getGridDateRange 是同一段邏輯，這裡
 * 是伺服器端要用，兩邊執行環境不同沒辦法直接共用同一個函式，但拿掉
 * import 複雜度換來的是這個檔案不用額外依賴 client component 的內部
 * 實作——這個函式很單純、不容易改壞，重複這幾行比硬要共用簡單。 */
function firstWeekdayOfMonth(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}
function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}
function getGridDateRange(year: number, month: number): { startDate: string; endDateExclusive: string } {
  const leadingBlanks = firstWeekdayOfMonth(year, month);
  const daysInMonth = getDaysInMonth(year, month);
  const weeksCount = Math.ceil((leadingBlanks + daysInMonth) / 7);
  const totalGridDays = weeksCount * 7;

  const gridStart = new Date(Date.UTC(year, month - 1, 1 - leadingBlanks));
  const gridEndExclusive = new Date(Date.UTC(year, month - 1, 1 - leadingBlanks + totalGridDays));

  return {
    startDate: gridStart.toISOString().slice(0, 10),
    endDateExclusive: gridEndExclusive.toISOString().slice(0, 10),
  };
}

export default async function ReservationsPage() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const { startDate, endDateExclusive } = getGridDateRange(year, month);

  // 在伺服器端把「這個月月曆格子」實際涵蓋範圍（含跨月補的天數）的
  // 資料先查好，跟角色權限查詢平行進行（Promise.all），一起傳給
  // client component 當初始資料——避免使用者從首頁點進這個頁面時，
  // 還要等 client component 先掛載、再另外發一次請求才看得到內容，
  // 中間會有明顯的空白等待。
  const [position, reservations] = await Promise.all([
    getCurrentEmployeePosition(),
    getCalendarReservationsForRangeAction(startDate, endDateExclusive),
  ]);
  const isHousekeepingManager = position === "管家";

  return (
    <ReservationsSearch
      isHousekeepingManager={isHousekeepingManager}
      initialReservations={reservations}
      initialYear={year}
      initialMonth={month}
    />
  );
}
