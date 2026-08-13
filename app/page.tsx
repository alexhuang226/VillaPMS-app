import { calculateQuoteAction } from '@/app/actions/quote'

export default async function QuotePage() {
  let quoteData = null
  let errorMessage = ''

  try {
    // ✅ 修正點：將結果直接賦值給外層宣告的 quoteData，而不是 const quote
    quoteData = await calculateQuoteAction({
      propertyCode: "zhici", // 知池
      checkIn: "2026-08-14",
      checkOut: "2026-08-16",
      adults: 12,
      children: 2,
      pets: 1,
      extraBedFixedQty: 1,
      addOns: { bbq: true },
    });
  } catch (error: any) {
    errorMessage = error?.message || '讀取報價時發生錯誤'
  }

  return (
    <main style={{ padding: '40px', fontFamily: 'sans-serif' }}>
      <h1>PMS 報價系統 (Quote)</h1>

      {errorMessage ? (
        <div style={{ color: 'red', marginTop: '20px' }}>{errorMessage}</div>
      ) : (
        <pre style={{ background: '#222', color: '#00ff00', padding: '15px', borderRadius: '8px', marginTop: '20px' }}>
          {/* 這裡才能順利讀到上方存入的 quoteData */}
          {JSON.stringify(quoteData, null, 2)}
        </pre>
      )}
    </main>
  )
}