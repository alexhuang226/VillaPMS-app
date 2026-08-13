import { createClient } from '@/lib/supabase/server'
import { allocateMonthlyRevenue } from '@/lib/pricing/monthly-revenue'

export default async function HomePage() {
  const supabase = await createClient()

  // 1. 從 Supabase 撈取您的資料表 (請將 'quotes' 替換為您 Supabase 的真實資料表名稱)
  const { data: quotes, error } = await supabase.from('quotes').select('*')

  if (error) {
    return 資料讀取失敗：{error.message}
  }

  // 2. 將 Supabase 的資料帶入算價邏輯
  const revenueData = quotes ? allocateMonthlyRevenue(quotes as any) : null

  return (
    
      Villa PMS 營收報表（即時連線 Supabase）
              {JSON.stringify(revenueData, null, 2)}
      
    
  )
}