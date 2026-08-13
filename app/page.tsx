import { createClient } from '@/lib/supabase/server'
import { allocateMonthlyRevenue } from '@/lib/pricing/monthly-revenue'

export default async function HomePage() {
  const supabase = await createClient()

  // 1. 從 Supabase 撈取您的資料表 (請將 'quotes' 替換為您 Supabase 的真實資料表名稱)
  const { data: quotes, error } = await supabase.from('quotes').select('*')

   if (error) {
     return (
       <div style={{ padding: '20px', color: 'red' }}>
         資料讀取失敗：{error.message}
       </div>
     )
   }

  // 2. 將 Supabase 的資料帶入算價邏輯
  const revenueData = quotes ? allocateMonthlyRevenue(quotes as any) : null

return (
  <main style={{ padding: '40px', fontFamily: 'sans-serif' }}>
    <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '20px' }}>
      Villa PMS 營收報表（即時連線 Supabase）
    </h1>

    <div style={{ marginTop: '20px', padding: '15px', background: '#f5f5f5', borderRadius: '8px' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 'bold' }}>計算結果輸出：</h2>
      <pre style={{ background: '#222', color: '#00ff00', padding: '15px', borderRadius: '5px', overflowX: 'auto', marginTop: '10px' }}>
        {JSON.stringify(revenueData, null, 2)}
      </pre>
    </div>
  </main>
)
}