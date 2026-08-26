/**
 * 客人版報價訊息文字產生器 + 畫面顯示共用的結構化資料
 *
 * 這個檔案提供兩層 API：
 * 1. 結構化的純函式（roomAllocationSummaryItems / accommodationDayGroups /
 *    addOnFeeBreakdown / baseGuestsReminderItems / ...
 *    ...）回傳 { label, amount } 這種簡單物件陣列，quote-form.tsx 拿去
 *    畫成 JSX（螢幕顯示、轉圖片用）。
 * 2. buildQuoteMessage() 用同一批結構化函式組成一段純文字，給「複製報價
 *    內容」按鈕使用。
 *
 * 這樣畫面上看到的內容跟複製出去的文字，保證是同一份資料源，不會兩邊
 * 各寫一套邏輯之後慢慢兜不起來。
 *
 * 呼叫前務必先確認 quote.messageContext 跟 quote.roomAllocation
 * 都不是 null（三個警告 minimumGuestsWarning／capacityWarning／
 * roomConfigWarning 任一存在時，這兩個欄位都會是 null）。
 */

import type {
  DayType,
  NightlyRateTable,
  PackageQuote,
  PriceCategory,
  QuoteRoomAllocation,
} from "./types";

const SEPARATOR = "━".repeat(14);
const BOX_TOP = "┌────────────┐";
const BOX_BOTTOM = "└────────────┘";

/** 這三行政策文字畫面版（quote-form.tsx）跟複製文字版共用，避免兩邊各寫一次、之後改一邊忘記改另一邊 */
export const BOOKING_POLICY_NOTES = [
  "房型調整：如需增開床位或變更房型，請再告知以方便重新報價。",
  "人數結算：入住前 1 週根據最終人數結算尾款。",
  "退改政策：如需延期或取消，請於入住前 30 天通知。住宿當天因颱風、地震等天災因素，宜蘭縣政府宣佈停班時，全數退還住宿費用。",
];
/** 跟 BOOKING_POLICY_NOTES 一一對應的 icon，畫面顯示（quote-form.tsx）
 * 跟複製文字版（buildQuoteMessage 下面）都從這裡取用，確保兩邊一致 */
export const BOOKING_POLICY_ICONS = ["🛏️", "👥", "🗺️"];
/** 「包棟基本人數」提醒區塊標題前面的 icon */
export const BASE_GUESTS_ICON = "🧑‍🤝‍🧑";
/** 已經含符號跟句號，直接顯示，不用再另外包 "(*...)" */
export const INFANT_NOTE = "・3歲以下幼童不算佔床。";
export const BANK_TRANSFER_NOTE = "匯款後請告知，以便核對並保留房期！";

const WEEKDAY_LABELS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

// 用於「包棟基本人數」提醒區塊：只顯示這次入住實際會用到的 day_type
const DAY_TYPE_INFO: Record<DayType, { label: string; note: string }> = {
  weekday: { label: "平日", note: "週一至週四" },
  peak: { label: "旺日", note: "週五/日/假日前" },
  holiday: { label: "假日", note: "週六" },
  festival: { label: "節日", note: "國定連假" },
  lunar_new_year: { label: "春節", note: "春節期間" },
  new_year_eve: { label: "跨年", note: "跨年夜" },
};

// 用於「房型訂價」參考區塊——weekday/peak 現在各自獨立顯示，跟
// DAY_TYPE_INFO 內容一致，兩份分開維護是因為使用情境不同（一個是
// 入住人數提醒、一個是房型訂價明細），但標籤文字統一
const PRICE_CATEGORY_INFO: Record<PriceCategory, { label: string; note: string }> = {
  weekday: { label: "平日", note: "週一至週四" },
  peak: { label: "旺日", note: "週五/日/假日前" },
  holiday: { label: "假日", note: "週六" },
  festival: { label: "節日", note: "國定連假" },
  lunar_new_year: { label: "春節", note: "春節期間" },
  new_year_eve: { label: "跨年", note: "跨年夜" },
};

/**
 * 'YYYY-MM-DD' → '2026/09/20 (週日)'
 *
 * 用不帶時區的字串建構 Date（沒有結尾 Z），代表用「執行這段程式的
 * 環境」當地時區去解析日期，對台灣的員工在台灣時區操作是正確的。
 * 如果之後這個函式會被部署在台灣以外時區的伺服器上執行，要改用
 * 明確指定時區的日期解析方式，否則星期幾可能會算錯一天。
 */
export function formatDateWithWeekday(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00`);
  const slash = dateStr.replaceAll("-", "/");
  return `${slash} (${WEEKDAY_LABELS[date.getDay()]})`;
}

/** 'YYYY-MM-DD' → '09/20(週日)'，逐晚住宿費用列表用的短格式 */
function formatMonthDayWeekday(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00`);
  const [, month, day] = dateStr.split("-");
  return `${month}/${day}(${WEEKDAY_LABELS[date.getDay()]})`;
}

/** 2 晚 → '3天2夜' */
export function daysNightsLabel(nights: number): string {
  return `${nights + 1}天${nights}夜`;
}

/** StayRequest 的人數 → '10大 1小 2幼 1寵'（0 的欄位省略，大人一律顯示） */
export function guestSummary(quote: PackageQuote): string {
  const { adults, children, infants, pets } = quote.request;
  const parts = [`${adults}大`];
  if (children) parts.push(`${children}小`);
  if (infants) parts.push(`${infants}幼`);
  if (pets) parts.push(`${pets}寵`);
  return parts.join(" ");
}

/** 房型配置的一個項目，降規說明直接接在房型名稱後面，不再另起一行 */
export interface RoomAllocationLine {
  text: string;
}

/** 房型配置明細，只列出數量 > 0 的項目。順序：雙人雅房→雙人套房→四人套房(全額)→四人套房(降規/提供1床) */
export function roomAllocationSummaryItems(allocation: QuoteRoomAllocation): RoomAllocationLine[] {
  const lines: RoomAllocationLine[] = [];
  if (allocation.doublePlainCount > 0) {
    lines.push({ text: `${allocation.doublePlainCount} 間雙人雅房` });
  }
  if (allocation.doubleSuiteCount > 0) {
    lines.push({ text: `${allocation.doubleSuiteCount} 間雙人套房` });
  }
  if (allocation.fourPersonSuiteCount > 0) {
    lines.push({ text: `${allocation.fourPersonSuiteCount} 間四人套房` });
  }
  if (allocation.fourPersonDowngradeCount > 0) {
    lines.push({
      text: `${allocation.fourPersonDowngradeCount} 間降規四人套房 (提供1床，以雙人套房計費)`,
    });
  }
  return lines;
}

/** 純文字版（複製訊息用）：每行前面補 "  └ " */
function roomAllocationLines(allocation: QuoteRoomAllocation): string[] {
  return roomAllocationSummaryItems(allocation).map((line) => `  └ ${line.text}`);
}

/**
 * 加購項目摘要（訪客／加固定床／加臨時床／加開房間／額外服務），
 * 只列出實際有勾選/填數量的項目，純文字描述（不含金額，金額另見
 * addOnFeeBreakdown）。項目名稱對齊 services 表裡的服務名稱。
 */
export function addOnSummaryItems(quote: PackageQuote): string[] {
  const { request } = quote;
  const items: string[] = [];

  const visitorQty = request.visitorQty ?? 0;
  if (visitorQty > 0) items.push(`訪客費用（${visitorQty} 人）`);

  const extraBedFixedQty = request.extraBedFixedQty ?? 0;
  if (extraBedFixedQty > 0) items.push(`加固定床（${extraBedFixedQty} 床）`);

  const extraBedTempQty = request.extraBedTempQty ?? 0;
  if (extraBedTempQty > 0) items.push(`加臨時床（${extraBedTempQty} 床）`);

  const extraRoomQty = request.extraRoomQty ?? 0;
  if (extraRoomQty > 0) items.push(`加開房間（${extraRoomQty} 間）`);

  if (request.addOns?.bbq) items.push("烤肉");
  if (request.addOns?.foodTruck) items.push("餐車場地費");
  if (request.addOns?.earlyCheckin) items.push("提前入住");

  return items;
}

/** 純文字版（複製訊息用）：每行前面補上 "  └ " */
function addOnLines(quote: PackageQuote): string[] {
  return addOnSummaryItems(quote).map((item) => `  └ ${item}`);
}

/**
 * 住宿費用逐項明細，以「天」為一組：每一組是一晚，裡面列出當晚每個
 * 房型的「單價 × 間數 = 小計」。房型數量（roomAllocation）整個訂房
 * 期間是固定的，只有單價會因為每晚的價格分類不同而變動，所以要逐晚
 * 重算單價；只有 1 晚時 dateLabel 是 null（不用另外標日期分組）。
 *
 * 因為這裡已經把每個房型的單價都攤開來了，「預訂須知」裡原本另外
 * 列的「房型訂價」參考區塊變得多餘，所以 buildQuoteMessage 跟畫面
 * 顯示都已經不再使用 priceReferenceSections。
 */
export interface AccommodationLineItem {
  roomLabel: string;
  unitPrice: number;
  qty: number;
  lineTotal: number;
}

export interface AccommodationDayGroup {
  dateLabel: string | null;
  items: AccommodationLineItem[];
}

export function accommodationDayGroups(quote: PackageQuote): AccommodationDayGroup[] {
  const { roomAllocation, messageContext, nightlyBreakdown } = quote;
  if (!roomAllocation || !messageContext) return [];

  const showDate = quote.nights > 1;

  return nightlyBreakdown.map((night) => {
    const rates = messageContext.rateTableByCategory[night.priceCategory];
    // 只此清綠沒有獨立雙人套房，降規價格記在 downgradeDoubleSuite；
    // 陌隱/水景璞堤把降規跟獨立雙人套房視為同一組價格，fallback 到
    // doubleSuite（跟 calculateNightlyBreakdown 的計價邏輯一致）。
    const downgradePrice = rates.doubleSuite > 0 ? rates.doubleSuite : rates.downgradeDoubleSuite;
    const items: AccommodationLineItem[] = [];

    if (roomAllocation.doublePlainCount > 0) {
      items.push({
        roomLabel: "雙人雅房",
        unitPrice: rates.doublePlain,
        qty: roomAllocation.doublePlainCount,
        lineTotal: rates.doublePlain * roomAllocation.doublePlainCount,
      });
    }
    if (roomAllocation.doubleSuiteCount > 0) {
      items.push({
        roomLabel: "雙人套房",
        unitPrice: rates.doubleSuite,
        qty: roomAllocation.doubleSuiteCount,
        lineTotal: rates.doubleSuite * roomAllocation.doubleSuiteCount,
      });
    }
    if (roomAllocation.fourPersonSuiteCount > 0) {
      items.push({
        roomLabel: "四人套房",
        unitPrice: rates.fourPersonSuite,
        qty: roomAllocation.fourPersonSuiteCount,
        lineTotal: rates.fourPersonSuite * roomAllocation.fourPersonSuiteCount,
      });
    }
    if (roomAllocation.fourPersonDowngradeCount > 0) {
      items.push({
        roomLabel: "降規四人套房",
        unitPrice: downgradePrice,
        qty: roomAllocation.fourPersonDowngradeCount,
        lineTotal: downgradePrice * roomAllocation.fourPersonDowngradeCount,
      });
    }

    return {
      dateLabel: showDate ? formatMonthDayWeekday(night.date) : null,
      items,
    };
  });
}

/**
 * 加購項目的金額明細（訪客／加床／加房／寵物清潔／額外服務各自的
 * 金額），給「費用明細」逐項列出用。需要 messageContext.servicePrices
 * 才能算出單價，quote.messageContext 是 null 時回傳空陣列。
 */
export function addOnFeeBreakdown(quote: PackageQuote): { label: string; amount: number }[] {
  const { request, messageContext } = quote;
  if (!messageContext) return [];
  const prices = messageContext.servicePrices;
  const items: { label: string; amount: number }[] = [];

  const visitorQty = request.visitorQty ?? 0;
  if (visitorQty > 0) items.push({ label: "訪客費用", amount: visitorQty * prices.visitor });

  const extraBedFixedQty = request.extraBedFixedQty ?? 0;
  if (extraBedFixedQty > 0) {
    items.push({ label: "加固定床", amount: extraBedFixedQty * prices.extraBedFixed });
  }

  const extraBedTempQty = request.extraBedTempQty ?? 0;
  if (extraBedTempQty > 0) {
    items.push({ label: "加臨時床", amount: extraBedTempQty * prices.extraBedTemp });
  }

  const extraRoomQty = request.extraRoomQty ?? 0;
  if (extraRoomQty > 0) items.push({ label: "加開房間", amount: extraRoomQty * prices.extraRoom });

  if (quote.petCleaningFee > 0) items.push({ label: "寵物清潔費", amount: quote.petCleaningFee });

  if (request.addOns?.bbq) items.push({ label: "烤肉", amount: prices.bbq });
  if (request.addOns?.foodTruck) items.push({ label: "餐車場地費", amount: prices.foodTruck });
  if (request.addOns?.earlyCheckin) items.push({ label: "提前入住", amount: prices.earlyCheckin });

  return items;
}

/** 「包棟基本人數」提醒區塊的項目，只列出這次入住實際出現過的 day_type */
export function baseGuestsReminderItems(
  quote: PackageQuote
): { label: string; note: string; required: number }[] {
  if (!quote.messageContext) return [];
  const distinctDayTypes = Array.from(new Set(quote.nightlyBreakdown.map((n) => n.dayType)));
  return distinctDayTypes
    .map((dayType) => ({
      dayType,
      required: quote.messageContext!.baseGuestsByDayType[dayType] ?? 0,
    }))
    .filter((x) => x.required > 0)
    .map((x) => ({
      label: DAY_TYPE_INFO[x.dayType].label,
      note: DAY_TYPE_INFO[x.dayType].note,
      required: x.required,
    }));
}

/**
 * 「房型訂價」參考區塊——已經不再使用（accommodationDayGroups 已經把
 * 每個房型的單價直接攤開在費用明細裡，這個參考區塊變得多餘），
 * 保留函式本身以防之後想拿回來用，但 buildQuoteMessage 跟畫面顯示
 * 都已經不呼叫它了。
 */
function ratePriceItems(rates: NightlyRateTable): { label: string; amount: number }[] {
  const items: { label: string; amount: number }[] = [];
  if (rates.doublePlain > 0) items.push({ label: "雙人雅房", amount: rates.doublePlain });
  const doubleSuitePrice = rates.doubleSuite > 0 ? rates.doubleSuite : rates.downgradeDoubleSuite;
  if (doubleSuitePrice > 0) items.push({ label: "雙人套房", amount: doubleSuitePrice });
  if (rates.fourPersonSuite > 0) items.push({ label: "四人套房", amount: rates.fourPersonSuite });
  return items;
}

export function priceReferenceSections(
  quote: PackageQuote
): { label: string; note: string; items: { label: string; amount: number }[] }[] {
  if (!quote.messageContext) return [];
  const distinctCategories = Array.from(new Set(quote.nightlyBreakdown.map((n) => n.priceCategory)));
  return distinctCategories
    .map((category) => {
      const info = PRICE_CATEGORY_INFO[category];
      const items = ratePriceItems(quote.messageContext!.rateTableByCategory[category]);
      return { label: info.label, note: info.note, items };
    })
    .filter((section) => section.items.length > 0);
}

export function buildQuoteMessage(quote: PackageQuote): string {
  const { messageContext, roomAllocation, request } = quote;
  if (!messageContext || !roomAllocation) {
    throw new Error("buildQuoteMessage 只能用在沒有任何警告、成功算出報價的 PackageQuote");
  }

  const lines: string[] = [];

  lines.push(`以下是根據您的需求，為您整理的 ${messageContext.propertyName} 專屬包棟方案：`);
  lines.push("");
  lines.push(`🏨 【${messageContext.propertyName}包棟報價單】`);
  lines.push(SEPARATOR);
  lines.push("📅 預訂資訊");
  lines.push(`• 入住日期：${formatDateWithWeekday(request.checkIn)}`);
  lines.push(`• 退房日期：${formatDateWithWeekday(request.checkOut)}`);
  lines.push(`• 預訂天數：${daysNightsLabel(quote.nights)}`);
  lines.push(`• 入住人數：${guestSummary(quote)}`);
  lines.push("• 房型配置：");
  lines.push(...roomAllocationLines(roomAllocation));
  const addOns = addOnLines(quote);
  if (addOns.length > 0) {
    lines.push("• 額外項目：");
    lines.push(...addOns);
  }
  lines.push(SEPARATOR);

  lines.push("💰 費用明細");
  lines.push(BOX_TOP);

  for (const group of accommodationDayGroups(quote)) {
    if (group.dateLabel) lines.push(` 💰 ${group.dateLabel}`);
    for (const item of group.items) {
      const prefix = group.dateLabel ? "   " : " 💰 ";
      lines.push(
        `${prefix}${item.roomLabel} $${item.unitPrice.toLocaleString()} × ${item.qty}間 = $${item.lineTotal.toLocaleString()} 元`
      );
    }
  }

  for (const item of addOnFeeBreakdown(quote)) {
    lines.push(` 🔹 ${item.label}：$${item.amount.toLocaleString()} 元`);
  }
  if (quote.discountAmount > 0) {
    lines.push(` 🔻 優惠折扣：－$${quote.discountAmount.toLocaleString()} 元`);
  }
  if (quote.invoiceTaxAmount > 0) {
    lines.push(` 🧾 發票稅金(8%)：$${quote.invoiceTaxAmount.toLocaleString()} 元`);
  }

  lines.push(" ────────────");
  lines.push(` 💰 包棟總費用：$${quote.packageTotal.toLocaleString()} 元`);
  lines.push(` 🔹 訂金(${messageContext.depositRatePercent}成)：$${quote.deposit.toLocaleString()} 元`);
  lines.push(` 🔥 剩餘尾款(入住前 1 週匯款)：$${quote.balanceDue.toLocaleString()} 元`);
  lines.push(` ⏰ 請於入住前${messageContext.balanceDueDaysBeforeCheckIn}天匯尾款。`);
  lines.push(BOX_BOTTOM);
  lines.push(SEPARATOR);

  if (messageContext.bank) {
    lines.push("🏦 匯款帳號");
    lines.push(`• 銀行：${messageContext.bank.name}`);
    lines.push(`• 分行：${messageContext.bank.branch}`);
    lines.push(`• 帳號：${messageContext.bank.accountNumber}`);
    lines.push(`• 戶名：${messageContext.bank.accountName}`);
    lines.push(`⚠️ ${BANK_TRANSFER_NOTE}`);
    lines.push(SEPARATOR);
  }

  lines.push("📝 預訂須知");

  lines.push(`${BASE_GUESTS_ICON} 包棟基本人數(未達以低消計)：`);
  for (const item of baseGuestsReminderItems(quote)) {
    lines.push(` • ${item.label}(${item.note})：${item.required} 人`);
  }
  lines.push(` ${INFANT_NOTE}`);

  BOOKING_POLICY_NOTES.forEach((note, i) => {
    lines.push(`${BOOKING_POLICY_ICONS[i]}${note}`);
  });

  return lines.join("\n");
}
