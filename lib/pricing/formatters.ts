// lib/pricing/formatters.ts
import type { PackageQuote } from "./types";

// 星期對照表
const WEEKDAYS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

// 日期格式化：2026-08-14 -> 2026/08/14 (週五)
function formatDateWithDay(dateStr: string): string {
  const date = new Date(dateStr);
  const formattedDate = dateStr.replace(/-/g, "/");
  const dayName = WEEKDAYS[date.getDay()];
  return `${formattedDate} (${dayName})`;
}

// 金額格式化：17200 -> $17,200 元
function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString()} 元`;
}

export function generateQuoteTextMessage(quote: PackageQuote): string {
  const { request, nights, nightlyBreakdown, packageTotal, deposit, balanceDue } = quote;

  // 計算入住天數描述 (例如：2天1夜)
  const daysNightsText = `${nights + 1}天${nights}夜`;

  // 抓取第一晚的房型配置（假設多晚房型相同，或可依需求擴充）
  const firstNight = nightlyBreakdown[0];
  const roomLines: string[] = [];

  if (firstNight) {
    if (firstNight.fourPersonSuiteCount > 0) {
      roomLines.push(`  └ ${firstNight.fourPersonSuiteCount} 間四人套房`);
    }
    if (firstNight.fourPersonDowngradeCount > 0) {
      roomLines.push(
        `  └ ${firstNight.fourPersonDowngradeCount} 間四人套房(提供1床，以雙人套房計費)`
      );
    }
    if (firstNight.doubleSuiteCount > 0) {
      roomLines.push(`  └ ${firstNight.doubleSuiteCount} 間雙人套房`);
    }
  }

  // 人數文字組合
  const guestText = `${request.adults}大${request.children ? ` ${request.children}小` : ""}${
    request.pets ? ` ${request.pets}寵` : ""
  }`;

  // 組合整份文字範本
  return `以下是根據您的需求，為您整理的 只此清綠 專屬包棟方案：

🏨 【只此清綠包棟報價單】
━━━━━━━━━━━━━━
📅 預訂資訊
• 入住日期：${formatDateWithDay(request.checkIn)}
• 退房日期：${formatDateWithDay(request.checkOut)}
• 預訂天數：${daysNightsText}
• 入住人數：${guestText}
• 房型配置：
${roomLines.length > 0 ? roomLines.join("\n") : "  └ 依入住人數彈性安排房型"}
━━━━━━━━━━━━━━
💰 費用明細
┌────────────┐
 💰 住宿總金額：${formatCurrency(packageTotal)}
 🔹 訂金(3成)：${formatCurrency(deposit)}
 🔥 剩餘尾款：${formatCurrency(balanceDue)}
 ⏰ 請於入住前7天匯尾款。
└────────────┘
━━━━━━━━━━━━━━
🏦 匯款帳號
• 銀行：586 羅東農會
• 分行：本會
• 帳號：5860-11170-15325
• 戶名：黃祥峰
⚠️ 匯款後請告知，以便核對並保留房期！
━━━━━━━━━━━━━━
📝 預訂須知
👥 包棟基本人數(未達以低消計)：
 • 旺日(週五/日/假日前)：16 人
 (*3歲以下幼童不算佔床)
🏷️ 房型訂價：
    ▸ 平旺日(週日至週五)：
      • 雙人套房 $3,000 元
      • 四人套房 $5,200 元
🛏️ 房型調整：如需增開床位或變更房型，請再告知以方便重新報價。
🔄 人數結算：入住前 1 週根據最終人數結算尾款。
📌 退改政策：如需延期或取消，請於入住前 30 天通知。住宿當天因宜蘭颱風、地震等天災因素宜蘭縣政府宣佈停班時，全數退還住宿費用。`;
}