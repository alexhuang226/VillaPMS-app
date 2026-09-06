import Link from "next/link";
import { getSavedQuoteAction } from "@/app/actions/quote";
import { QuoteConvertForm } from "@/app/components/quote-convert-form";

/**
 * 「報價 → 訂房記錄」的獨立確認頁面。
 *
 * 報價記錄查詢（/quotes）的列表每一列有一個「轉成訂單」連結指到這裡，
 * 帶著該張報價單的 id。這一頁上半部唯讀顯示報價內容（日期／人數／
 * 房型／加床／優惠／訂金／包棟總費用），下半部是確認訂房要收集的
 * 資料表單（客人姓名／來源／付款狀況／發票／加臨時床房號），最下方
 * 「確認轉為訂房記錄」。
 *
 * 這裡在 server component 直接 await getSavedQuoteAction（"use server"
 * 函式，從 server 端呼叫就只是個 async function），把報價快照先查好
 * 傳給 client component，避免畫面先閃一下 loading。
 */
export default async function QuoteConvertPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const saved = await getSavedQuoteAction(id);

  if (!saved) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 px-5 py-8 text-sm" style={{ color: "#221F1B" }}>
        <Link href="/quotes" className="text-xs" style={{ color: "#2455A4" }}>
          ← 回到報價記錄查詢
        </Link>
        <p className="border-l-2 pl-3 leading-relaxed" style={{ borderColor: "#A23E2D", color: "#A23E2D" }}>
          找不到這張報價單的完整內容，可能是舊資料沒有存快照，或報價單已被刪除。
        </p>
      </main>
    );
  }

  if (saved.status === "accepted") {
    const [year, month] = saved.request.checkIn.split("-");
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 px-5 py-8 text-sm" style={{ color: "#221F1B" }}>
        <Link href="/quotes" className="text-xs" style={{ color: "#2455A4" }}>
          ← 回到報價記錄查詢
        </Link>
        <p className="border-l-2 pl-3 leading-relaxed" style={{ borderColor: "#33422E", color: "#33422E" }}>
          這張報價單已經確認轉為訂房記錄了，不能重複轉單。
        </p>
        <Link
          href={`/reservations?year=${year}&month=${Number(month)}`}
          className="w-fit border px-3 py-1.5 text-xs"
          style={{ borderColor: "#D9D1C4", color: "#221F1B" }}
        >
          到訂單管理查看
        </Link>
      </main>
    );
  }

  return (
    <QuoteConvertForm
      quoteId={id}
      quote={saved.quote}
      request={saved.request}
      createdAt={saved.createdAt}
    />
  );
}
