// app/quote/QuoteCalculator.tsx
"use client";

import { useState } from "react";
import { calculateQuoteAction } from "@/app/actions/quote";
import type { PackageQuote, StayRequest, PropertyCode} from "@/lib/pricing/types";
import QuoteCopyView from "./QuoteCopyView";

// 預設今日與明日日期
const getTodayStr = () => new Date().toISOString().slice(0, 10);
const getTomorrowStr = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
};

export default function QuoteCalculator() {
  // 表單狀態
  const [propertyCode, setPropertyCode] = useState<PropertyCode>("zhici");  const [checkIn, setCheckIn] = useState(getTodayStr());
  const [checkOut, setCheckOut] = useState(getTomorrowStr());
  const [adults, setAdults] = useState(10);
  const [children, setChildren] = useState(0);
  const [pets, setPets] = useState(0);
  const [extraBedFixedQty, setExtraBedFixedQty] = useState(0);
  const [bbq, setBbq] = useState(false);

  // 試算結果與狀態
  const [quoteResult, setQuoteResult] = useState<PackageQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  // 處理按下「計算報價」按鈕
  const handleCalculate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMessage("");

    try {
      const request: StayRequest = {
        propertyCode,
        checkIn,
        checkOut,
        adults: Number(adults),
        children: Number(children),
        pets: Number(pets),
        extraBedFixedQty: Number(extraBedFixedQty),
        addOns: { bbq },
      };

      const result = await calculateQuoteAction(request);
      setQuoteResult(result);
    } catch (err: any) {
      setErrorMessage(err?.message || "計算報價時發生錯誤");
      setQuoteResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: "500px", margin: "0 auto", fontFamily: "sans-serif" }}>
      {/* 📱 手機優化表單區塊 */}
      <form
        onSubmit={handleCalculate}
        style={{
          background: "#ffffff",
          padding: "20px",
          borderRadius: "12px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          border: "1px solid #eaeaea",
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: "20px", color: "#333", textAlign: "center" }}>
          🏨 試算報價單
        </h2>

        {/* 1. 選擇民宿 */}
        <div style={{ marginBottom: "15px" }}>
          <label style={{ display: "block", fontWeight: "bold", marginBottom: "5px" }}>
            選擇民宿：
          </label>
          <select
            value={propertyCode}
            onChange={(e) => setPropertyCode(e.target.value as PropertyCode)}
            style={inputStyle}
          >
            <option value="zhici">只此清綠 (Turquoise)</option>
            <option value="moyin">陌隱 (Hermit)</option>
            <option value="waterviewputi">水景璞堤防 (Waterscape)</option>
          </select>
        </div>

        {/* 2. 入住與退房日期 */}
        <div style={{ display: "flex", gap: "10px", marginBottom: "15px" }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontWeight: "bold", marginBottom: "5px" }}>
              入住日期：
            </label>
            <input
              type="date"
              value={checkIn}
              onChange={(e) => setCheckIn(e.target.value)}
              style={inputStyle}
              required
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontWeight: "bold", marginBottom: "5px" }}>
              退房日期：
            </label>
            <input
              type="date"
              value={checkOut}
              onChange={(e) => setCheckOut(e.target.value)}
              style={inputStyle}
              required
            />
          </div>
        </div>

        {/* 3. 人數設定 */}
        <div style={{ display: "flex", gap: "10px", marginBottom: "15px" }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontWeight: "bold", marginBottom: "5px" }}>
              大人 (位)：
            </label>
            <input
              type="number"
              min="1"
              value={adults}
              onChange={(e) => setAdults(Number(e.target.value))}
              style={inputStyle}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontWeight: "bold", marginBottom: "5px" }}>
              小孩 (位)：
            </label>
            <input
              type="number"
              min="0"
              value={children}
              onChange={(e) => setChildren(Number(e.target.value))}
              style={inputStyle}
            />
          </div>
        </div>

        {/* 4. 加床與寵物 */}
        <div style={{ display: "flex", gap: "10px", marginBottom: "15px" }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontWeight: "bold", marginBottom: "5px" }}>
              加床數量 (床)：
            </label>
            <input
              type="number"
              min="0"
              value={extraBedFixedQty}
              onChange={(e) => setExtraBedFixedQty(Number(e.target.value))}
              style={inputStyle}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontWeight: "bold", marginBottom: "5px" }}>
              寵物數量 (隻)：
            </label>
            <input
              type="number"
              min="0"
              value={pets}
              onChange={(e) => setPets(Number(e.target.value))}
              style={inputStyle}
            />
          </div>
        </div>

        {/* 5. 加價服務勾選 */}
        <div style={{ marginBottom: "20px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontWeight: "bold" }}>
            <input
              type="checkbox"
              checked={bbq}
              onChange={(e) => setBbq(e.target.checked)}
              style={{ width: "20px", height: "20px" }}
            />
            🔥 需要烤肉服務 (BBQ)
          </label>
        </div>

        {/* 按鈕：送出試算 */}
        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            padding: "14px",
            fontSize: "16px",
            fontWeight: "bold",
            color: "#ffffff",
            backgroundColor: loading ? "#999" : "#0070f3",
            border: "none",
            borderRadius: "8px",
            cursor: loading ? "not-allowed" : "pointer",
            boxShadow: "0 2px 6px rgba(0,112,243,0.3)",
          }}
        >
          {loading ? "⌛ 計算金額中..." : "⚡ 立即計算報價"}
        </button>
      </form>

      {/* 錯誤訊息提示 */}
      {errorMessage && (
        <div style={{ color: "red", backgroundColor: "#ffe6e6", padding: "12px", borderRadius: "8px", marginTop: "15px", textAlign: "center" }}>
          ⚠️ {errorMessage}
        </div>
      )}

      {/* 📋 算價結果預覽與一鍵複製區 */}
      {quoteResult && (
        <div style={{ marginTop: "20px" }}>
          <QuoteCopyView quote={quoteResult} />
        </div>
      )}
    </div>
  );
}

// 通用輸入框樣式 (針對手機觸控優化大小)
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px",
  fontSize: "15px",
  borderRadius: "6px",
  border: "1px solid #ccc",
  boxSizing: "border-box",
};