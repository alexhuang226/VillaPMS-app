import { QuotesSearch } from "@/app/components/quotes-search";

/**
 * 報價紀錄搜尋頁面。跟 /quote 一樣，<QuotesSearch /> 自己內部處理
 * 版面（滿版背景＋置中窄欄），這裡不另外包容器，避免跟內部版面
 * 邏輯衝突（原因見 quote-form.tsx 的說明）。
 */
export default function QuotesPage() {
  return <QuotesSearch />;
}
