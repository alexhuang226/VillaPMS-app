/**
 * 訂房確認單文字產生器
 *
 * 跟 quote-message.ts 的 buildQuoteMessage 是姊妹函式，但服務不同
 * 階段：buildQuoteMessage 是「報價階段」給客人看的內容（含匯款帳號、
 * 預訂須知等），這個檔案是「客人已經付訂金、訂房確認之後」要傳給
 * 客人核對的內容（房型配置、已收訂金、剩餘尾款、民宿地址/停車/
 * 導航），格式跟報價單刻意不同（沒有 emoji 開頭的段落標題、房型
 * 配置順序、人數格式都不一樣），照實際要傳給客人的範例格式寫的，
 * 不是憑空套用報價單的格式。
 *
 * 呼叫前必須確認 detail.payments 裡有一筆 paymentKind='deposit' 且
 * status='paid' 的記錄——這個函式假設訂金已經收到，如果實際上還沒收
 * 到，呼叫端應該先擋下來，不要讓這個函式產生「已收到訂金匯款」這種
 * 跟事實不符的內容。
 */

import type { ReservationDetail } from "./queries";

const SEPARATOR = "━".repeat(14);
const BOX_TOP = "┌────────────┐";
const BOX_BOTTOM = "└────────────┘";

const WEEKDAY_LABELS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

/** 'YYYY-MM-DD' → '2026/12/05 (週六)'，跟 quote-message.ts 的
 * formatDateWithWeekday 邏輯一致（本地時區解析，見那邊的說明） */
function formatDateWithWeekday(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00`);
  const slash = dateStr.replaceAll("-", "/");
  return `${slash} (${WEEKDAY_LABELS[date.getDay()]})`;
}

/** ISO 時間字串 → 'MM/DD'（本地時區），訂金收到日期用 */
function formatMonthDay(isoString: string): string {
  const date = new Date(isoString);
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${m}/${d}`;
}

/** 2 晚 → '3天2夜' */
function daysNightsLabel(nights: number): string {
  return `${nights + 1}天${nights}夜`;
}

/** 兩個 'YYYY-MM-DD' 之間差幾天 */
function daysBetween(fromDateStr: string, toDateStr: string): number {
  const from = new Date(`${fromDateStr}T00:00:00`);
  const to = new Date(`${toDateStr}T00:00:00`);
  return Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * 入住人數摘要，注意格式跟報價單的 guestSummary 不一樣：這裡
 * 「不含空格」（例如 '18大1寵'），報價單版本是 '18大 1小 1寵' 有
 * 空格分隔——是照實際要傳給客人的範例格式寫的，不是筆誤。
 */
function compactGuestSummary(detail: ReservationDetail): string {
  const { adults, children, infants, pets } = detail;
  let text = `${adults}大`;
  if (children) text += `${children}小`;
  if (infants) text += `${infants}幼`;
  if (pets) text += `${pets}寵`;
  return text;
}

/**
 * 房型配置文字，注意跟報價單的 roomAllocationSummaryItems 格式不
 * 一樣：順序是「雙人套房→雙人雅房→四人套房→四人套房降規」（報價單
 * 是雙人雅房在前），降規那行也沒有「降規」兩個字、括號前也沒有
 * 空格（報價單是「降規四人套房 (提供1床...)」）。這是照實際要傳給
 * 客人的範例格式寫的一個獨立函式，不是共用報價單那份、故意讓兩邊
 * 不一致——如果之後想統一成同一種格式，要跟兩邊格式的原始需求
 * 重新確認一次要用哪一種。
 */
function confirmationRoomAllocationLines(allocation: ReservationDetail["roomAllocation"]): string[] {
  const lines: string[] = [];
  if (allocation.doubleSuiteCount > 0) lines.push(`${allocation.doubleSuiteCount} 間雙人套房`);
  if (allocation.doublePlainCount > 0) lines.push(`${allocation.doublePlainCount} 間雙人雅房`);
  if (allocation.fourPersonSuiteCount > 0) lines.push(`${allocation.fourPersonSuiteCount} 間四人套房`);
  if (allocation.fourPersonDowngradeCount > 0) {
    lines.push(`${allocation.fourPersonDowngradeCount} 間四人套房(提供1床，以雙人套房計費)`);
  }
  return lines;
}

export function buildReservationConfirmationMessage(detail: ReservationDetail): string {
  const depositPayment = detail.payments.find((p) => p.paymentKind === "deposit" && p.status === "paid");
  if (!depositPayment || !depositPayment.paidAt) {
    throw new Error("這筆訂單的訂金還沒標記為已收款，不能產生訂房確認單內容");
  }
  const balancePayment = detail.payments.find((p) => p.paymentKind === "balance");

  const nights = daysBetween(detail.checkIn, detail.checkOut);
  const balanceDueDays = balancePayment?.dueDate ? daysBetween(balancePayment.dueDate, detail.checkIn) : 7;

  const lines: string[] = [];

  lines.push(" 您好，已收到訂金匯款，訂房已確認，期待您的光臨！請查看下方訂房資料是否正確哦~");
  lines.push("");
  lines.push(` 【${detail.propertyName}訂房確認單】`);
  lines.push(SEPARATOR);
  lines.push(" 預訂資訊");
  lines.push(`• 入住日期：${formatDateWithWeekday(detail.checkIn)}`);
  lines.push(`• 退房日期：${formatDateWithWeekday(detail.checkOut)}`);
  lines.push(`• 預訂天數：${daysNightsLabel(nights)}`);
  lines.push(`• 入住人數：${compactGuestSummary(detail)}`);
  lines.push("• 房型配置：");
  for (const line of confirmationRoomAllocationLines(detail.roomAllocation)) {
    lines.push(`  └ ${line}`);
  }
  if (detail.pets > 0) {
    lines.push(`• 寵物數量：${detail.pets} 隻`);
  }
  lines.push(SEPARATOR);

  lines.push(" 帳務明細");
  lines.push(BOX_TOP);
  lines.push(`  住宿總金額：$${detail.finalTotal.toLocaleString()} 元`);
  lines.push(`• 訂金已付：$${depositPayment.amount.toLocaleString()} 元 (收到日期：${formatMonthDay(depositPayment.paidAt)})`);
  if (balancePayment) {
    lines.push(`• 剩餘尾款：$${balancePayment.amount.toLocaleString()} 元`);
    lines.push(`  請於入住前${balanceDueDays}天匯尾款。`);
  }
  lines.push(BOX_BOTTOM);
  lines.push(SEPARATOR);

  if (detail.propertyAddress) lines.push(` 民宿地址：${detail.propertyAddress}`);
  if (detail.parkingInfo) lines.push(` 停車資訊：${detail.parkingInfo}`);
  if (detail.mapUrl) lines.push(` 導航連結：${detail.mapUrl}`);

  return lines.join("\n");
}
