// app/quote/QuoteCopyView.tsx
"use client";

import { useState } from "react";
import { generateQuoteTextMessage } from "@/lib/pricing/formatters";
import type { PackageQuote } from "@/lib/pricing/types";

export default function QuoteCopyView({ quote }: { quote: PackageQuote }) {
  const [copied, setCopied] = useState(false);
  const textMessage = generateQuoteTextMessage(quote);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(textMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      alert("複製失敗，請手動複製");
    }
  };

  return (
    <div style={{ maxWidth: "600px", marginTop: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
        <h3>📱 LINE 報價單文字預覽</h3>
        <button
          onClick={handleCopy}
          style={{
            backgroundColor: copied ? "#28a745" : "#0070f3",
            color: "#fff",
            border: "none",
            padding: "8px 16px",
            borderRadius: "5px",
            cursor: "pointer",
            fontWeight: "bold",
            transition: "background-color 0.2s"
          }}
        >
          {copied ? "✓ 已複製到剪貼簿！" : "📋 複製報價單文字"}
        </button>
      </div>

      <textarea
        readOnly
        value={textMessage}
        rows={22}
        style={{
          width: "100%",
          padding: "15px",
          fontFamily: "monospace",
          fontSize: "14px",
          lineHeight: "1.5",
          backgroundColor: "#1e1e1e",
          color: "#00ff66",
          border: "1px solid #333",
          borderRadius: "8px",
          boxSizing: "border-box"
        }}
      />
    </div>
  );
}