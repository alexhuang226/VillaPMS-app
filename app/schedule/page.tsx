import { redirect } from "next/navigation";

/**
 * 「安排排班」跟「每月班表」已經合併成一頁（見
 * app/components/monthly-schedule.tsx），這裡保留 /schedule 這個
 * 路徑做重新導向，避免舊的書籤/連結失效。
 */
export default function SchedulePage() {
  redirect("/schedule/monthly");
}
