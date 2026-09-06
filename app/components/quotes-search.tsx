"use client";

/**
 * 報價紀錄搜尋／檢視／確認訂房頁面
 *
 * 對應「客人先拿到報價，過一陣子才確認訂房」的實際流程：
 * 1. 用姓名／電話／報價單編號找出之前存的報價（calculateAndSaveQuoteAction
 *    在 quote-form.tsx 那邊已經把每次算出來的報價存進 quotes 表）
 * 2. 點開來看，畫面會用「訂房確認單」的樣式呈現（跟 quote-form.tsx
 *    的報價收據視覺語彙一致，色彩/字體/排版共用同一套設計）
 * 3. 按「確認訂房」，會呼叫 confirmReservationFromQuoteAction 把這張
 *    報價轉成正式的 reservations 記錄（含房型明細、加購項目、訂金
 *    應收款），金額一律用當初報價的凍結快照，不重新計算
 * 4. 確認後一樣可以複製文字／轉圖片分享給客人
 *
 * 這裡的 Row/InfoRow/ReceiptSectionHeader 是從 quote-form.tsx
 * 抄一份小的過來，不是抽成共用元件——兩邊各自獨立維護，如果之後想
 * 讓外觀完全同步，可以再抽成 app/components/receipt-document.tsx
 * 共用元件。
 */

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import Link from "next/link";
import { Fraunces, Work_Sans } from "next/font/google";
import {
  calculateQuoteAction,
  clearOldQuotesAction,
  deleteQuoteAction,
  getQuoteCheckInDatesInRangeAction,
  getReservationForQuoteAction,
  getSavedQuoteAction,
  searchQuotesAction,
  saveNewQuoteSnapshot,
  updateQuoteSnapshotAction,
} from "@/app/actions/quote";
import { buildReservationConfirmationMessageAction, getReservationDetailAction } from "@/app/actions/reservation";
import {
  addOnFeeBreakdown,
  addOnSummaryItems,
  BANK_TRANSFER_NOTE,
  BASE_GUESTS_ICON,
  baseGuestsReminderItems,
  BOOKING_POLICY_ICONS,
  BOOKING_POLICY_NOTES,
  buildQuoteMessage,
  consolidatedAccommodationGroups,
  daysNightsLabel,
  extraBedTempLineItem,
  formatDateWithWeekday,
  guestSummary,
  INFANT_NOTE,
} from "@/lib/pricing/quote-message";
import type { QuoteSummary, ReservationDetail } from "@/lib/pricing/queries";
import type { PackageQuote, PropertyCode, StayRequest } from "@/lib/pricing/types";

const display = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  variable: "--font-display",
});
const body = Work_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
});

const colors = {
  canvas: "#FAF8F4",
  surface: "#FFFFFF",
  ink: "#221F1B",
  muted: "#57514A",
  line: "#D9D1C4",
  pine: "#33422E",
  pineSoft: "#E7EAE1",
  pineText: "#FFFFFF",
  alert: "#A23E2D",
  blue: "#2455A4",
};

const PROPERTY_OPTIONS: { value: PropertyCode; label: string }[] = [
  { value: "zhici", label: "只此清綠" },
  { value: "moyin", label: "陌隱" },
  { value: "shuijing", label: "水景璞堤" },
];

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  sent: "已送出",
  accepted: "已確認訂房",
  expired: "已過期",
  rejected: "已婉拒",
  cancelled: "已取消",
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span>{label}</span>
      <span className="text-right" style={{ color: "inherit" }}>
        {value}
      </span>
    </div>
  );
}

/** 跟 quote-form.tsx 用的是同一種寫法：type="text" + inputMode="numeric"，
 * 內部自己維護一份原始字串狀態（raw），不是讓 <input type="number">
 * 直接綁定數字——要把 0 改成別的數字，不用先在 0 後面打字、再手動
 * 刪掉 0。編輯報價內容表單的人數／房型欄位跟一開始製作報價單用
 * 同一套元件，維持輸入體驗一致。 */
function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const [raw, setRaw] = useState(() => String(value));

  useEffect(() => {
    setRaw(String(value));
  }, [value]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    if (next === "" || /^\d*$/.test(next)) {
      setRaw(next);
      onChange(next === "" ? 0 : Number(next));
    }
  }

  function handleBlur() {
    if (raw === "") setRaw("0");
  }

  return (
    <label className="flex flex-col gap-1">
      <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
        {label}
      </span>
      <input
        type="text"
        inputMode="numeric"
        value={raw}
        onChange={handleChange}
        onBlur={handleBlur}
        className="w-full border-b bg-transparent py-1 text-center text-sm outline-none"
        style={{ borderColor: colors.line, color: colors.ink }}
      />
    </label>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="shrink-0" style={{ width: "4.5em", color: colors.muted }}>
        {label}
      </span>
      <span style={{ color: colors.ink }}>{value}</span>
    </div>
  );
}

/** 兩個欄位並排顯示，取代兩行各自獨立的 InfoRow——用在報價單圖片，
 * 讓卡片整體高度短一點。標籤在上、內容在下（不是 InfoRow 那種
 * 標籤在左），因為並排之後每欄的寬度只剩一半，標籤放旁邊會太擠。 */
function PairedInfoRow({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="flex gap-4">
      {items.map((item, i) => (
        <div key={i} className="flex-1">
          <p className="text-[10px]" style={{ color: colors.muted }}>
            {item.label}
          </p>
          <p style={{ color: colors.ink }}>{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function ReceiptSectionHeader({
  icon,
  title,
  note,
  noBorder,
}: {
  icon: string;
  title: string;
  /** 選填，跟著標題同一行、用括號附註——例如「匯款帳號」後面直接
   * 接「⚠️ 匯款後請告知...」提醒，不用另外佔一行 */
  note?: string;
  noBorder?: boolean;
}) {
  return (
    <div className={`mt-3 mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 ${noBorder ? "" : "border-t pt-3"}`} style={{ borderColor: colors.line }}>
      <span className="flex items-center gap-2">
        <span className="text-base leading-none">{icon}</span>
        <span className="text-sm font-bold tracking-wide" style={{ color: colors.ink }}>
          {title}
        </span>
      </span>
      {note && (
        <span className="text-[11px] font-semibold" style={{ color: colors.alert }}>
          （{note}）
        </span>
      )}
    </div>
  );
}

/** 'YYYY-MM-DD' → '2026/08/29'——確認單圖片用比 formatDateWithWeekday
 * （帶星期幾文字）更精簡的格式，跟 ConfirmationImageCard 共用 */
function formatSlashDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${y}/${m}/${d}`;
}

function nightsLabel(checkIn: string, checkOut: string): string {
  const nights = Math.round(
    (new Date(`${checkOut}T00:00:00`).getTime() - new Date(`${checkIn}T00:00:00`).getTime()) / (1000 * 60 * 60 * 24)
  );
  return `${nights + 1}天${nights}夜`;
}

/** 報價有效期限——套用一般 hotel 業界慣例，報價日期起算 14 天
 * （兩週）。isoTimestamp 是資料庫 created_at 那種帶時間的完整
 * 時間戳記，這裡只取日期部分往後推算。用本地時區的年/月/日組
 * 字串，不要用 toISOString()（那是 UTC，台灣時間換算回 UTC
 * 可能往前跨一天，算出來的日期會早一天，跟畫面上其他地方一貫的
 * 本地時區日期處理方式不一致）。 */
function addDaysToIsoDate(isoTimestamp: string, days: number): string {
  const d = new Date(`${isoTimestamp.slice(0, 10)}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const QUOTE_VALIDITY_DAYS = 14;

/**
 * 訂房確認單截圖用的隱藏卡片——抽成獨立元件，因為詳情頁面本身的
 * 「轉成圖片」按鈕，跟搜尋結果列表新增的「圖片」按鈕，都需要同一份
 * 卡片內容，只是驅動的資料來源不同（前者用目前選取的報價，後者用
 * 使用者點的那一列報價）。抽成元件、各自傳自己的 ref 進來，避免
 * 同一份 100 多行的 JSX 複製兩份，以後要改內容才不用改兩個地方。
 */
/** 訂房確認單專用的咖啡色系——跟報價單的深綠(colors.pine)區分開來，
 * 讓「已經確認的訂房」在視覺上跟「還在報價階段」的文件有明顯區別。
 * 深焙咖啡色（標題）+ 淺焦糖／拿鐵色（金額强調框），走內斂沉穩、
 * 不搶眼的路線，跟民宿本身溫暖但不張揚的調性也搭。只用在這張卡片，
 * 不影響其他地方（報價單、頁面其他元素）原本的綠色系。 */
const CONFIRM_DARK = "#3E2B23";
const CONFIRM_LIGHT = "#F1E4D3";
const CONFIRM_ACCENT = "#8A6A4F";

function ConfirmationImageCard({
  detail,
  quote,
  cardRef,
}: {
  detail: ReservationDetail;
  quote: PackageQuote | null;
  cardRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div style={{ height: 0, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: "-9999px", top: 0 }}>
        <div ref={cardRef} className={body.className} style={{ width: "375px", backgroundColor: colors.canvas }}>
          {/* 標題格式改成跟報價單一致：民宿名稱大字在上，「訂房確認單」
              字距展開的小標在下，「預訂日期」疊在右邊——結構、間距、
              防溢出的 min-height 安全邊界都跟報價單同一套做法，唯一
              差異是背景色換成咖啡色系、副標籤從「包棟報價單」換成
              「訂房確認單」、右邊只有一行「預訂日期」沒有「有效期限」
              （確認單沒有報價那種期限概念）。min-height/padding 這次
              跟著報價單最新的版本一起調整（32px + pb-7/pt-8），理由
              一致：中文字元實際行高在不同裝置上算出來會有落差，抓
              比較寬鬆的安全值比較不容易再出現文字疊出標題外面的
              問題。 */}
          <div className="relative px-6 pb-7 pt-8 text-center" style={{ backgroundColor: CONFIRM_DARK }}>
            <p className={`${display.className} text-2xl italic`} style={{ color: "#FFFFFF" }}>
              {detail.propertyName}私人會所
            </p>
            <div className="relative mt-1" style={{ minHeight: "32px" }}>
              <p className="tracking-[0.3em]" style={{ color: CONFIRM_LIGHT, fontSize: "16px" }}>
                訂房確認單
              </p>
              <div className="absolute right-0 bottom-0 text-right text-[8px] leading-tight" style={{ color: CONFIRM_LIGHT }}>
                <p>預訂日期：{formatSlashDate(detail.createdAt.slice(0, 10))}</p>
              </div>
            </div>
          </div>
          {/* 內容格式改成跟報價單一致：入住/退房日期並排、預訂天數/
              入住人數並排、房型配置改成「使用房數」摘要（詳細房型
              在下面費用明細裡看得到，不用兩個地方都列一次）。上方
              padding 也比照報價單縮小（pt-1），理由一致：上面接的是
              深色標題區塊，兩個 padding 疊加會讓這裡上方空白感覺
              太大。 */}
          <div className="px-6 pb-5 pt-1 text-xs leading-relaxed" style={{ color: colors.ink }}>
            <p className="mt-1 font-bold">📅 預訂資訊</p>
            <div className="mt-1 flex flex-col gap-1.5">
              <PairedInfoRow
                items={[
                  { label: "入住日期", value: formatDateWithWeekday(detail.checkIn) },
                  { label: "退房日期", value: formatDateWithWeekday(detail.checkOut) },
                ]}
              />
              <PairedInfoRow
                items={[
                  { label: "預訂天數", value: nightsLabel(detail.checkIn, detail.checkOut) },
                  {
                    label: "入住人數",
                    value: `${detail.adults}大${detail.children ? ` ${detail.children}小` : ""}${
                      detail.infants ? ` ${detail.infants}幼` : ""
                    }${detail.pets ? ` ${detail.pets}寵` : ""}`,
                  },
                ]}
              />
              <InfoRow
                label="使用房數"
                value={`${
                  detail.roomAllocation.fourPersonSuiteCount +
                  detail.roomAllocation.fourPersonDowngradeCount +
                  detail.roomAllocation.doubleSuiteCount +
                  detail.roomAllocation.doublePlainCount
                } 間房（詳見下方費用明細）`}
              />
            </div>
            <p className="mt-2" style={{ color: colors.muted }}>
              ━━━━━━━━━━━━━━
            </p>
            <p className="mt-2 font-bold">💰 費用明細</p>
            {quote ? (
              <div className="mt-1 grid grid-cols-[1fr_auto_auto_auto] gap-x-2 gap-y-1.5" style={{ color: colors.muted }}>
                {consolidatedAccommodationGroups(quote).map((group, gi) => (
                  <div key={`day-${gi}`} className="contents">
                    {group.dateRangeLabel && (
                      <p className="col-span-4 mt-1 first:mt-0" style={{ color: colors.ink }}>
                        {group.dateRangeLabel}
                      </p>
                    )}
                    {group.items.map((item, i) => (
                      <div key={i} className="contents">
                        <span className={group.dateRangeLabel ? "pl-3" : undefined}>{item.roomLabel}</span>
                        <span className="text-right tabular-nums">
                          NT${item.unitPrice.toLocaleString()}×{item.qty}
                          {group.nights > 1 ? `×${group.nights}晚` : ""}
                        </span>
                        <span>=</span>
                        <span className="text-right tabular-nums">NT${item.lineTotal.toLocaleString()}</span>
                        {item.subLabel && (
                          <p className={`col-span-4 -mt-0.5 text-[10px] ${group.dateRangeLabel ? "pl-3" : ""}`}>{item.subLabel}</p>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
                {(() => {
                  const extraBedTemp = extraBedTempLineItem(quote);
                  if (!extraBedTemp) return null;
                  return (
                    <div className="contents">
                      <span>{extraBedTemp.roomLabel}</span>
                      <span className="text-right tabular-nums">
                        NT${extraBedTemp.unitPrice.toLocaleString()}×{extraBedTemp.qty}
                        {extraBedTemp.nights > 1 ? `×${extraBedTemp.nights}晚` : ""}
                      </span>
                      <span>=</span>
                      <span className="text-right tabular-nums">NT${extraBedTemp.lineTotal.toLocaleString()}</span>
                    </div>
                  );
                })()}
                {addOnFeeBreakdown(quote).map((item, i) => (
                  <div key={`fee-${i}`} className="contents">
                    <span className="col-span-3">{item.label}</span>
                    <span className="text-right tabular-nums">NT${item.amount.toLocaleString()}</span>
                  </div>
                ))}
                {quote.discountAmount > 0 && (
                  <div className="contents">
                    <span className="col-span-3">優惠折扣</span>
                    <span className="text-right tabular-nums">－NT${quote.discountAmount.toLocaleString()}</span>
                  </div>
                )}
                {quote.invoiceTaxAmount > 0 && (
                  <div className="contents">
                    <span className="col-span-3">發票稅金(8%)</span>
                    <span className="text-right tabular-nums">NT${quote.invoiceTaxAmount.toLocaleString()}</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-1">• 住宿總額：${detail.finalTotal.toLocaleString()}元</p>
            )}
            {/* 包棟總費用——標籤/金額改成同一列（原本是標籤一行、大字
                金額另外一行），跟報價單最新的版本一致，省一點垂直
                空間。背景換成淺焦糖／拿鐵色（CONFIRM_LIGHT），跟上面
                標題的深咖啡色（CONFIRM_DARK）同一個色系、深淺搭配，
                取代原本文字版的訂金/尾款條列 */}
            <div className="mt-3 rounded-sm px-4 py-3" style={{ backgroundColor: CONFIRM_LIGHT }}>
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] tracking-wide" style={{ color: CONFIRM_ACCENT }}>
                  包棟總費用
                </span>
                <span className={`${display.className} text-2xl italic`} style={{ color: CONFIRM_DARK }}>
                  NT$ {detail.finalTotal.toLocaleString()}
                </span>
              </div>
              {(() => {
                const depositPayment = detail.payments.find((p) => p.paymentKind === "deposit");
                const balancePayment = detail.payments.find((p) => p.paymentKind === "balance");
                return (
                  <div className="mt-2 flex flex-col gap-1 border-t pt-2" style={{ borderColor: CONFIRM_ACCENT }}>
                    <div className="flex items-baseline justify-between">
                      <span style={{ color: CONFIRM_ACCENT }}>
                        訂金已付
                        {depositPayment?.paidAt ? `（收到日期：${depositPayment.paidAt.slice(5, 10).replace("-", "/")}）` : ""}
                      </span>
                      <span className="font-bold" style={{ color: CONFIRM_DARK }}>
                        ${(depositPayment?.amount ?? 0).toLocaleString()}
                      </span>
                    </div>
                    {balancePayment && (
                      <div className="flex items-baseline justify-between">
                        <span style={{ color: CONFIRM_ACCENT }}>剩餘尾款</span>
                        <span className="font-bold" style={{ color: CONFIRM_DARK }}>
                          ${balancePayment.amount.toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
            {(() => {
              const balancePayment = detail.payments.find((p) => p.paymentKind === "balance");
              return balancePayment ? (
                <p className="mt-2">⚠️ 尾款請於入住前一星期匯款。</p>
              ) : null;
            })()}
            <p className="mt-2" style={{ color: colors.muted }}>
              ━━━━━━━━━━━━━━
            </p>
            <p className="font-bold">【重要提醒】</p>
            <p className="mt-1">1. 退改政策：如需延期或取消，需於入住日前 30 天通知，以保障雙方權益。</p>
            <p>2. 人數變更：在入住前 1 周根據最終入住人數結算尾款（未達基本人數仍以低消計費），我們將為您們配置合適的備品與床位。</p>
            <p>3. 在入住前一週收到尾款後會發送【入住提醒】；入住當天會發送【入住須知】及【設備使用說明】。</p>
            <p className="mt-2" style={{ color: colors.muted }}>
              ━━━━━━━━━━━━━━
            </p>
            {detail.propertyAddress && <p className="mt-2">📍 民宿地址：{detail.propertyAddress}</p>}
            {detail.parkingInfo && <p>🅿️ 停車資訊：{detail.parkingInfo}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 完整報價收據卡片——抽成獨立元件，理由跟 ConfirmationImageCard 一樣：
 * 報價詳情頁面「顯示完整報價內容」的區塊，跟搜尋結果列表新增的
 * 「報價圖片」按鈕，需要同一份卡片內容，只是驅動的資料來源不同。
 * cardRef 是選填的——詳情頁面原本的用法只是單純顯示在畫面上，不需要
 * 截圖，只有列表的隱藏卡片才需要傳 ref 進來。
 */
export function QuoteReceiptCard({
  quote,
  createdAt,
  isConfirmed,
  cardRef,
  preview,
}: {
  quote: PackageQuote;
  createdAt: string | null;
  isConfirmed: boolean;
  cardRef?: RefObject<HTMLDivElement | null>;
  /** 職員核對用的精簡版面（報價記錄查詢的詳情畫面）：標題只留一行
   * （民宿名 + 「包棟報價單」，不要深綠大標／私人會所／報價日期），
   * 內距收緊，且不顯示「匯款帳號」「預訂須知」——那幾段是給客人看
   * 的。存成圖片傳給客人的那份不傳這個 prop，維持完整版面。 */
  preview?: boolean;
}) {
  if (!quote.messageContext || !quote.roomAllocation) return null;
  return (
    <>
                    <div ref={cardRef} className="overflow-hidden" style={{ backgroundColor: colors.surface, border: `1px solid ${colors.line}` }}>
                      {preview ? (
                        <div className="border-b px-4 py-2" style={{ borderColor: colors.line }}>
                          <span className="text-sm font-bold" style={{ color: colors.ink }}>
                            {quote.messageContext.propertyName}
                          </span>
                          <span className="ml-2 text-[11px]" style={{ color: colors.muted }}>
                            {isConfirmed ? "訂房確認單" : "包棟報價單"}
                          </span>
                        </div>
                      ) : (
                      <div className="relative px-6 pb-7 pt-8 text-center" style={{ backgroundColor: colors.pine }}>
                        <p className={`${display.className} text-2xl italic`} style={{ color: colors.pineText }}>
                          {`${quote.messageContext.propertyName}私人會所`}
                        </p>
                        {/* 「包棟報價單/訂房確認單」外面包一層 relative 容器——
                            報價日期/有效期限用 absolute + top:50%/
                            translateY(-50%) 對齊這個容器的垂直中心。
                            ⚠️ 這裡的 min-height 很關鍵：absolute 定位的
                            子元素不會影響父層的高度計算，如果只給父層
                            一行文字的自然高度，兩行的日期資訊會超出
                            父層範圍，變成疊到父層外面——如果父層外面
                            剛好是標題區塊自己的下邊界以外，日期資訊就
                            會跑到深綠色背景外面、疊在下面米色的內容
                            區塊上，變得幾乎看不見（之前發生過的
                            「有效期限看不到」就是這樣來的）。這裡明確
                            給 min-height，確保父層的高度一定容得下兩行
                            文字，不管視覺上這行標題文字本身多高。 */}
                        {/* ⚠️ min-height 這裡故意給比視覺上兩行文字實際
                            需要的高度更多一些餘裕（32px，不是精算後
                            剛好夠用的 20-24px）——中文字元的實際行高，
                            在不同瀏覽器/裝置上算出來的數字會有落差
                            （尤其中文字型的預設行高通常比純英數字更
                            高），精算剛好夠用的數字曾經在實機上還是
                            不夠、導致文字疊出標題區塊外面。這裡故意
                            抓比較寬鬆的安全值，同時外層標題區塊自己
                            的下方 padding 也從 pb-6 加到 pb-8，兩層都
                            留一點餘裕，比只精算單一個數字更不容易再
                            次出問題。 */}
                        <div className="relative mt-1" style={{ minHeight: "32px" }}>
                          <p className="tracking-[0.3em]" style={{ color: colors.pineSoft, fontSize: "16px" }}>
                            {isConfirmed ? "訂房確認單" : "包棟報價單"}
                          </p>
                          {!isConfirmed && createdAt && (
                            <div
                              className="absolute right-0 top-1/2 text-right text-[8px] leading-tight"
                              style={{ color: colors.pineSoft, transform: "translateY(-50%)" }}
                            >
                              <p>報價日期：{formatSlashDate(createdAt.slice(0, 10))}</p>
                              <p>有效期限：{formatSlashDate(addDaysToIsoDate(createdAt, QUOTE_VALIDITY_DAYS))}</p>
                            </div>
                          )}
                        </div>
                      </div>
                      )}

                      {/* 上方 padding 特意比其他方向小很多——上面接的是
                          深色標題區塊，已經有自己的 padding，兩個疊加
                          會讓「預訂資訊」上方空白感覺太大。preview（職員
                          核對版）標題只是一行淺色小字，內距整個收緊。 */}
                      <div className={preview ? "px-4 pb-4 pt-2" : "px-6 pb-12 pt-1"} style={{ color: colors.ink }}>
                        <ReceiptSectionHeader icon="📅" title="預訂資訊" noBorder />
                        <div className="flex flex-col gap-1.5 text-xs">
                          <PairedInfoRow
                            items={[
                              { label: "入住日期", value: formatDateWithWeekday(quote.request.checkIn) },
                              { label: "退房日期", value: formatDateWithWeekday(quote.request.checkOut) },
                            ]}
                          />
                          <PairedInfoRow
                            items={[
                              { label: "預訂天數", value: daysNightsLabel(quote.nights) },
                              { label: "入住人數", value: guestSummary(quote) },
                            ]}
                          />
                          <InfoRow
                            label="使用房數"
                            value={`${
                              quote.roomAllocation.fourPersonSuiteCount +
                              quote.roomAllocation.fourPersonDowngradeCount +
                              quote.roomAllocation.doubleSuiteCount +
                              quote.roomAllocation.doublePlainCount
                            } 間房（詳見下方費用明細）`}
                          />
                          {addOnSummaryItems(quote).map((item, i) => (
                            <InfoRow key={`addon-${i}`} label={i === 0 ? "額外項目" : ""} value={item} />
                          ))}
                        </div>

                        <ReceiptSectionHeader icon="💰" title="費用明細" />
                        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 gap-y-1.5 text-xs" style={{ color: colors.muted }}>
                          {consolidatedAccommodationGroups(quote).map((group, gi) => (
                            <div key={`day-${gi}`} className="contents">
                              {group.dateRangeLabel && (
                                <p className="col-span-4 mt-1 first:mt-0" style={{ color: colors.ink }}>
                                  {group.dateRangeLabel}
                                </p>
                              )}
                              {group.items.map((item, i) => (
                                <div key={i} className="contents">
                                  <span className={group.dateRangeLabel ? "pl-3" : undefined}>{item.roomLabel}</span>
                                  <span className="text-right tabular-nums">
                                    NT${item.unitPrice.toLocaleString()}×{item.qty}
                                    {group.nights > 1 ? `×${group.nights}晚` : ""}
                                  </span>
                                  <span>=</span>
                                  <span className="text-right tabular-nums">NT${item.lineTotal.toLocaleString()}</span>
                                  {item.subLabel && (
                                    <p
                                      className={`col-span-4 -mt-0.5 text-[10px] ${group.dateRangeLabel ? "pl-3" : ""}`}
                                      style={{ color: colors.muted }}
                                    >
                                      {item.subLabel}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          ))}
                          {/* 加臨時床用跟房型一樣的格式（單價×間數×晚數＝
                              小計），不是跟其他加購項目一樣塞進下面那個
                              只有「標籤/金額」兩欄的列表——這是唯一一項
                              金額會隨晚數變動的加購項目，格式跟房型一致
                              比較看得出來怎麼算的。 */}
                          {(() => {
                            const item = extraBedTempLineItem(quote);
                            if (!item) return null;
                            return (
                              <div className="contents">
                                <span>{item.roomLabel}</span>
                                <span className="text-right tabular-nums">
                                  NT${item.unitPrice.toLocaleString()}×{item.qty}
                                  {item.nights > 1 ? `×${item.nights}晚` : ""}
                                </span>
                                <span>=</span>
                                <span className="text-right tabular-nums">NT${item.lineTotal.toLocaleString()}</span>
                              </div>
                            );
                          })()}
                          {addOnFeeBreakdown(quote).map((item, i) => (
                            <div key={`fee-${i}`} className="contents">
                              <span>{item.label}</span>
                              <span />
                              <span />
                              <span className="text-right tabular-nums">NT${item.amount.toLocaleString()}</span>
                            </div>
                          ))}
                          {quote.discountAmount > 0 && (
                            <div className="contents">
                              <span>優惠折扣</span>
                              <span />
                              <span />
                              <span className="text-right tabular-nums">－NT${quote.discountAmount.toLocaleString()}</span>
                            </div>
                          )}
                          {quote.invoiceTaxAmount > 0 && (
                            <div className="contents">
                              <span>發票稅金(8%)</span>
                              <span />
                              <span />
                              <span className="text-right tabular-nums">NT${quote.invoiceTaxAmount.toLocaleString()}</span>
                            </div>
                          )}
                        </div>

                        <div className="mt-3 rounded-sm px-4 py-3" style={{ backgroundColor: colors.pineSoft }}>
                          <div className="flex items-baseline justify-between">
                            <span className="text-[11px] tracking-wide" style={{ color: colors.muted }}>
                              包棟總費用
                            </span>
                            <span className={`${display.className} text-2xl italic`} style={{ color: colors.pine }}>
                              NT$ {quote.packageTotal.toLocaleString()}
                            </span>
                          </div>
                          <div className="mt-2 flex items-baseline justify-between border-t pt-2" style={{ borderColor: colors.line }}>
                            <span style={{ color: colors.muted }} className="text-xs tracking-wide">
                              訂金
                            </span>
                            <span style={{ color: colors.ink }} className="text-sm font-semibold">
                              NT$ {quote.deposit.toLocaleString()}
                            </span>
                          </div>
                          <div className="mt-1 flex items-baseline justify-between">
                            <span style={{ color: colors.muted }} className="text-xs tracking-wide">
                              尾款<span style={{ color: colors.alert }}>(入住前 1 週匯款)</span>
                            </span>
                            <span style={{ color: colors.ink }} className="text-sm font-semibold">
                              NT$ {quote.balanceDue.toLocaleString()}
                            </span>
                          </div>
                        </div>

                        {!preview && (
                          <>
                            {quote.messageContext.bank && (
                              <>
                                <ReceiptSectionHeader icon="🏦" title="匯款帳號" note={`⚠️ ${BANK_TRANSFER_NOTE}`} />
                                <div className="flex gap-3 text-sm font-semibold">
                                  <div className="flex-[3]">
                                    <p className="text-[10px]" style={{ color: colors.muted }}>
                                      銀行
                                    </p>
                                    <p style={{ color: colors.ink }}>
                                      {quote.messageContext.bank.name}（{quote.messageContext.bank.branch}）
                                    </p>
                                  </div>
                                  <div className="flex-[2]">
                                    <p className="text-[10px]" style={{ color: colors.muted }}>
                                      帳號
                                    </p>
                                    <p className="text-base tracking-wide" style={{ color: colors.ink }}>
                                      {quote.messageContext.bank.accountNumber}
                                    </p>
                                  </div>
                                </div>
                              </>
                            )}

                            <ReceiptSectionHeader icon="📝" title="預訂須知" />
                            <div className="flex flex-col gap-3 text-[11px] leading-relaxed" style={{ color: colors.muted }}>
                              {baseGuestsReminderItems(quote).length > 0 && (
                                <div>
                                  <p>
                                    {BASE_GUESTS_ICON} 包棟基本人數(未達以低消計，{INFANT_NOTE})：
                                  </p>
                                  {baseGuestsReminderItems(quote).map((item, i) => (
                                    <p key={i}>
                                      ・{item.label}({item.note})：{item.required} 人
                                    </p>
                                  ))}
                                </div>
                              )}
                              {BOOKING_POLICY_NOTES.map((note, i) => {
                                const highlight = "入住前 30 天";
                                const parts = note.split(highlight);
                                return (
                                  <p key={i}>
                                    {BOOKING_POLICY_ICONS[i]}
                                    {parts.length === 2 ? (
                                      <>
                                        {parts[0]}
                                        <strong style={{ color: colors.alert }}>{highlight}</strong>
                                        {parts[1]}
                                      </>
                                    ) : (
                                      note
                                    )}
                                  </p>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    </div>

    </>
  );
}

export function QuotesSearch() {
  const now = new Date();
  const [calendarYear, setCalendarYear] = useState(now.getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(now.getMonth() + 1);
  /** 這個月哪些日期已經有報價單，月曆格子要填色標示 */
  const [quoteDates, setQuoteDates] = useState<Set<string>>(new Set());
  const [checkInDate, setCheckInDate] = useState("");
  const [results, setResults] = useState<QuoteSummary[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [selectedQuoteCreatedAt, setSelectedQuoteCreatedAt] = useState<string | null>(null);
  const [selectedQuote, setSelectedQuote] = useState<PackageQuote | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // 確認訂房前臨時修改報價內容（最常見是入住人數變動）——不用逼客人
  // 整個報價流程重跑一次，改完在這裡重新試算，通過後直接覆蓋這張
  // 報價單的快照
  const [isEditingQuote, setIsEditingQuote] = useState(false);
  const [editRequest, setEditRequest] = useState<StayRequest | null>(null);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [recalculateError, setRecalculateError] = useState<string | null>(null);

  // 「轉成訂單」現在是獨立頁面（/quotes/[id]/convert），報價詳情這裡
  // 不再內嵌確認訂房表單。這幾個 state 只保留給「已經轉過訂單」的
  // 報價：詳情頁要顯示訂房編號、複製訂單內容、儲存訂單圖片。
  const [confirmedReservationNo, setConfirmedReservationNo] = useState<string | null>(null);
  const [confirmedReservationId, setConfirmedReservationId] = useState<string | null>(null);
  const [confirmedDetail, setConfirmedDetail] = useState<ReservationDetail | null>(null);
  const [imageWorking, setImageWorking] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageNote, setImageNote] = useState<string | null>(null);
  const confirmationCardRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  // 清除舊報價記錄用
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [clearResultMessage, setClearResultMessage] = useState<string | null>(null);
  const [clearError, setClearError] = useState<string | null>(null);

  // 刪除單一報價單用（詳情頁面右上角的「刪除」）
  const [isDeletingQuote, setIsDeletingQuote] = useState(false);
  const [deleteQuoteError, setDeleteQuoteError] = useState<string | null>(null);
  const [showDetailDeleteConfirm, setShowDetailDeleteConfirm] = useState(false);

  // 詳情頁面「儲存報價單圖片」用——隱藏的 QuoteReceiptCard 截圖
  const [quoteImageWorking, setQuoteImageWorking] = useState(false);
  const [quoteImageError, setQuoteImageError] = useState<string | null>(null);
  const [quoteImageNote, setQuoteImageNote] = useState<string | null>(null);
  const quoteImageCardRef = useRef<HTMLDivElement>(null);

  // 這個月哪些日期有報價單，換月份時重新查一次，月曆格子要填色標示
  useEffect(() => {
    let cancelled = false;
    const monthStart = `${calendarYear}-${String(calendarMonth).padStart(2, "0")}-01`;
    const nextMonthDate = new Date(calendarYear, calendarMonth, 1);
    const nextMonthStart = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, "0")}-01`;

    getQuoteCheckInDatesInRangeAction(monthStart, nextMonthStart)
      .then((dates) => {
        if (!cancelled) setQuoteDates(new Set(dates));
      })
      .catch(() => {
        // 填色只是輔助顯示，查詢失敗不影響月曆其他功能，安靜失敗就好，
        // 不用額外跳錯誤訊息干擾使用者
      });

    return () => {
      cancelled = true;
    };
  }, [calendarYear, calendarMonth]);

  async function handleClearOldQuotes() {
    setIsClearing(true);
    setClearError(null);
    setClearResultMessage(null);

    try {
      const { deletedCount } = await clearOldQuotesAction();
      setClearResultMessage(`已清除 ${deletedCount} 筆入住日期已過的報價記錄`);
      setShowClearConfirm(false);
      // 如果目前畫面上有查詢結果，順便重新查一次，避免列表裡還顯示
      // 剛剛已經被刪掉的記錄
      if (results) {
        const rows = await searchQuotesAction({
          checkInDate: checkInDate || undefined,
        });
        setResults(rows);
      }
      // 清除掉的報價單，月曆填色也要跟著更新，不然會顯示已經不存在
      // 的報價單日期
      const monthStart = `${calendarYear}-${String(calendarMonth).padStart(2, "0")}-01`;
      const nextMonthDate = new Date(calendarYear, calendarMonth, 1);
      const nextMonthStart = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, "0")}-01`;
      const dates = await getQuoteCheckInDatesInRangeAction(monthStart, nextMonthStart);
      setQuoteDates(new Set(dates));
    } catch (err) {
      setClearError(err instanceof Error ? err.message : "清除失敗，請稍後再試");
    } finally {
      setIsClearing(false);
    }
  }

  /** 詳情頁面「儲存報價單圖片」——把隱藏的 QuoteReceiptCard 截圖，
   * 內容來源是 selectedQuote / selectedQuoteCreatedAt。跟已確認訂房的
   * 「儲存訂單圖片」（handleShareConfirmationImage）是兩種不同版型。 */
  async function handleSaveQuoteImage() {
    if (!selectedQuote || !selectedQuote.messageContext || !selectedQuote.roomAllocation) return;
    setQuoteImageWorking(true);
    setQuoteImageError(null);
    setQuoteImageNote(null);
    try {
      // 等 React 把 QuoteReceiptCard 畫進 DOM、字型載入完成再截圖
      // （中文字寬度才會抓對）——兩次 rAF 是可靠的「等畫面更新」寫法
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (typeof document !== "undefined" && document.fonts?.ready) {
        await document.fonts.ready;
      }
      const node = quoteImageCardRef.current;
      if (!node) throw new Error("圖片產生失敗，請再試一次");
      const { toBlob } = await import("html-to-image");
      const blob = await toBlob(node, {
        pixelRatio: 2,
        backgroundColor: colors.canvas,
        width: node.scrollWidth,
        height: node.scrollHeight,
      });
      if (!blob) throw new Error("圖片產生失敗，請再試一次");

      const propertyName = selectedQuote.messageContext.propertyName;
      const file = new File([blob], `${propertyName}-報價單.png`, { type: "image/png" });
      const canShareFiles =
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] });

      if (canShareFiles) {
        await navigator.share({ files: [file], title: `${propertyName} 報價單` });
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = file.name;
        link.click();
        URL.revokeObjectURL(url);
        setQuoteImageNote("已下載圖片，請自行傳給客人（這個瀏覽器不支援直接分享）");
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setQuoteImageError(err instanceof Error ? err.message : "圖片產生失敗，請稍後再試");
    } finally {
      setQuoteImageWorking(false);
    }
  }

  /** 刪除目前選取的這一張報價單（詳情頁面右上角的「刪除」），避免
   * 類似/重複的報價單越積越多 */
  async function handleDeleteQuote() {
    if (!selectedId) return;
    setIsDeletingQuote(true);
    setDeleteQuoteError(null);

    try {
      const result = await deleteQuoteAction(selectedId);
      if (!result.success) {
        setDeleteQuoteError(result.message);
        return;
      }
      // 刪除成功，回到搜尋結果列表，重新查一次確保這筆記錄不會再顯示
      setSelectedId(null);
      setSelectedQuote(null);
      setShowDetailDeleteConfirm(false);
      if (results) {
        const rows = await searchQuotesAction({
          checkInDate: checkInDate || undefined,
        });
        setResults(rows);
      }
      // 月曆填色也要跟著更新，理由跟 handleClearOldQuotes 一樣
      const monthStart = `${calendarYear}-${String(calendarMonth).padStart(2, "0")}-01`;
      const nextMonthDate = new Date(calendarYear, calendarMonth, 1);
      const nextMonthStart = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, "0")}-01`;
      const dates = await getQuoteCheckInDatesInRangeAction(monthStart, nextMonthStart);
      setQuoteDates(new Set(dates));
    } catch (err) {
      setDeleteQuoteError(err instanceof Error ? err.message : "刪除失敗，請稍後再試");
    } finally {
      setIsDeletingQuote(false);
    }
  }

  function firstWeekdayOfMonth(year: number, month: number): number {
    return new Date(year, month - 1, 1).getDay();
  }
  function daysInCalendarMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate();
  }
  function formatYMD(year: number, month: number, day: number): string {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  function goToPrevMonth() {
    if (calendarMonth === 1) {
      setCalendarYear((y) => y - 1);
      setCalendarMonth(12);
    } else {
      setCalendarMonth((m) => m - 1);
    }
  }
  function goToNextMonth() {
    if (calendarMonth === 12) {
      setCalendarYear((y) => y + 1);
      setCalendarMonth(1);
    } else {
      setCalendarMonth((m) => m + 1);
    }
  }

  /** 點月曆上的日期直接查詢，不用再另外按確定 */
  async function handleSelectDate(dateStr: string) {
    setCheckInDate(dateStr);
    setIsSearching(true);
    setSearchError(null);
    setResults(null);
    setSelectedId(null);
    setSelectedQuote(null);

    try {
      const rows = await searchQuotesAction({ checkInDate: dateStr });
      setResults(rows);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "查詢失敗，請稍後再試");
    } finally {
      setIsSearching(false);
    }
  }

  async function handleSelect(row: QuoteSummary) {
    setSelectedId(row.id);
    setSelectedStatus(row.status);
    setSelectedQuote(null);
    setSelectedQuoteCreatedAt(null);
    setDetailError(null);
    setConfirmedReservationNo(null);
    setConfirmedDetail(null);
    setCopied(false);
    setDeleteQuoteError(null);
    setShowDetailDeleteConfirm(false);
    setQuoteImageError(null);
    setQuoteImageNote(null);
    // ⚠️「編輯報價內容」表單自己的狀態——選新的報價單時一律強制退出
    // 編輯模式、清空編輯表單，不然會帶著上一筆還沒存檔的欄位變動疊在
    // 這筆新選到的報價單上面顯示，變成編輯表單資料對不上目前這筆。
    setIsEditingQuote(false);
    setEditRequest(null);
    setRecalculateError(null);
    setIsLoadingDetail(true);

    try {
      const saved = await getSavedQuoteAction(row.id);
      if (!saved) {
        setDetailError("找不到這張報價單的完整內容，可能是舊資料沒有存快照");
        return;
      }
      setSelectedQuote(saved.quote);
      setSelectedStatus(saved.status);
      setSelectedQuoteCreatedAt(saved.createdAt);

      if (saved.status === "accepted") {
        // 已經確認過訂房了，查出實際的訂房編號＋完整訂單詳情顯示給
        // 使用者看——訂單詳情是複製訂房確認內容/轉圖片要用的
        const reservation = await getReservationForQuoteAction(row.id);
        if (reservation) {
          setConfirmedReservationNo(reservation.reservationNo);
          setConfirmedReservationId(reservation.id);
          const detailResult = await getReservationDetailAction(reservation.id);
          if (detailResult) setConfirmedDetail(detailResult);
        }
      }
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "讀取報價單失敗，請稍後再試");
    } finally {
      setIsLoadingDetail(false);
    }
  }

  /** 「編輯報價內容」按鈕用——用目前 state 中的 selectedQuote 當表單
   * 初始值。房型數量帶「目前實際的房型配置」（selectedQuote.roomAllocation），
   * 不是只帶 request.roomOverride——大多數報價都是系統自動分配、從來
   * 沒填過 roomOverride，只帶那個的話編輯表單一打開房型數量會全部
   * 變成 0，跟這張報價單實際用到的房型對不起來。 */
  function startEditQuote() {
    if (!selectedQuote) return;
    const allocation = selectedQuote.roomAllocation;
    setEditRequest({
      ...selectedQuote.request,
      roomOverride: allocation
        ? {
            fourPersonSuiteCount: allocation.fourPersonSuiteCount,
            fourPersonDowngradeCount: allocation.fourPersonDowngradeCount,
            doubleSuiteCount: allocation.doubleSuiteCount,
            doublePlainCount: allocation.doublePlainCount,
          }
        : selectedQuote.request.roomOverride,
    });
    setRecalculateError(null);
    setIsEditingQuote(true);
  }

  function cancelEditQuote() {
    setIsEditingQuote(false);
    setEditRequest(null);
    setRecalculateError(null);
  }

  function updateEditRequestField<K extends keyof StayRequest>(key: K, value: StayRequest[K]) {
    setEditRequest((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  /**
   * 換民宿時保留原本填的房型數量——客人可能就是想比較「同樣的房型
   * 組合」在兩間民宿的價格差異，所以不清空 roomOverride，讓使用者
   * 換民宿後還看得到原本填的數字。
   *
   * ⚠️ 這代表換完民宿後，這組數字對新民宿來說有可能已經不合理
   * （例如超過新民宿實際的房間數、或床位數不夠住這麼多人）——這裡
   * 故意不主動檢查或清空，而是交給「重新試算並更新」按下去時，
   * handleRecalculate() 裡本來就有的 roomConfigWarning（有沒有超過
   * 這間民宿實際房間數）跟 capacityWarning（床位數夠不夠住）這兩個
   * 檢查去把關——兩個檢查都已經是各自民宿實際的房間/床位數字去驗證，
   * 不用另外寫一次。如果數字對新民宿不合理，重新試算時就會被擋下來、
   * 顯示對應的錯誤訊息，使用者自己決定要調整房型數量還是換回原本
   * 的民宿。
   */
  function handleEditPropertyChange(propertyCode: PropertyCode) {
    setEditRequest((prev) => (prev ? { ...prev, propertyCode } : prev));
  }

  function updateEditRoomOverride(field: keyof NonNullable<StayRequest["roomOverride"]>, value: number) {
    setEditRequest((prev) => (prev ? { ...prev, roomOverride: { ...prev.roomOverride, [field]: value } } : prev));
  }

  function updateEditAddOn(field: keyof NonNullable<StayRequest["addOns"]>, value: boolean) {
    setEditRequest((prev) => (prev ? { ...prev, addOns: { ...prev.addOns, [field]: value } } : prev));
  }

  /**
   * 重新試算並直接覆蓋這張報價單的快照。金額一律用重新算出來的結果，
   * 不是「先顯示、按確認訂房才存」——這樣不管客人是現在就確認訂房、
   * 還是又過幾天才來確認，都是用改過的最新內容，不會因為忘記存檔
   * 而確認到舊的報價。
   */
  async function handleRecalculate() {
    if (!selectedId || !editRequest || !selectedQuote) return;
    setIsRecalculating(true);
    setRecalculateError(null);
    try {
      // ⚠️ 第二個參數 true 是關鍵：不這樣做的話，只要人數低於基本
      // 入住人數，calculateQuoteAction() 內部會直接短路回傳一個「金額
      // 全部強制歸零、roomAllocation 也不完整」的結果，跟下面「不擋
      // minimumGuestsWarning」這個註解講的意圖完全對不起來——不傳這個
      // 參數的話，就算後面不去檢查 minimumGuestsWarning，算出來的
      // newQuote 本身金額就已經是 0 了，之前就是因為漏了這一步，
      // 才會在單純調整人數（沒有換民宿）時也誤判成「算出來是 0」被
      // 擋下來。
      const newQuote = await calculateQuoteAction(editRequest, true);
      // ⚠️ 這裡故意不擋 minimumGuestsWarning（基本入住人數不足的
      // 提醒）——編輯已經存在的報價單，常見情境是客人人數變少了
      // （原本訂 10 人、後來只剩 6 人要來），這種狀況下應該要能正常
      // 更新報價反映實際情況，不該被「未達最低人數」這個檢查擋下來，
      // 這個檢查比較適合用在一開始製作報價的時候。roomConfigWarning
      // （房型配置有問題）跟 capacityWarning（超過可容納人數）這兩個
      // 還是繼續擋，這兩個是真正會讓算出來的報價不合理的錯誤，不能
      // 略過。
      if (newQuote.roomConfigWarning || newQuote.capacityWarning) {
        setRecalculateError(newQuote.roomConfigWarning || newQuote.capacityWarning || "重新試算失敗");
        return;
      }

      // 客人有時候會想比較兩間民宿的價格——如果編輯時把民宿換掉了，
      // 不能直接覆蓋原本這張報價單（原本那張可能還要留著給客人比較），
      // 改成另外存一張新的報價單，原本那張維持不變。民宿沒有變的話，
      // 維持原本「就地更新」的行為。
      if (editRequest.propertyCode !== selectedQuote.request.propertyCode) {
        const { quoteId: newQuoteId } = await saveNewQuoteSnapshot(editRequest, newQuote);
        if (!newQuoteId) {
          setRecalculateError("儲存新報價單失敗，請稍後再試");
          return;
        }
        setIsEditingQuote(false);
        setEditRequest(null);
        // 直接切換去看剛存好的新報價單，讓使用者看得到換民宿後的結果，
        // 原本那張報價單不受影響、還在搜尋結果裡找得到
        await handleSelect({ id: newQuoteId, status: "sent" } as QuoteSummary);
        return;
      }

      const result = await updateQuoteSnapshotAction(selectedId, editRequest, newQuote);
      if (!result.success) {
        setRecalculateError(result.message ?? "更新報價內容失敗，請稍後再試");
        return;
      }
      setSelectedQuote(newQuote);
      setIsEditingQuote(false);
      setEditRequest(null);
    } catch (err) {
      setRecalculateError(err instanceof Error ? err.message : "重新試算失敗，請稍後再試");
    } finally {
      setIsRecalculating(false);
    }
  }

  async function handleCopy() {
    if (!selectedQuote || !selectedQuote.messageContext || !selectedQuote.roomAllocation) return;
    const text = buildQuoteMessage(selectedQuote);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setDetailError("複製失敗，請手動選取文字複製");
    }
  }

  /** 已確認訂房後複製「真正的訂房確認內容」（用實際訂單/收款資料
   * 產生）——跟上面 handleCopy() 複製的報價文字是不同內容，之前
   * isConfirmed 時也共用同一個按鈕跟 handleCopy()，複製出來的其實
   * 還是報價當時的文字，內容跟按鈕文字「複製訂房確認內容」對不上，
   * 這裡分開成獨立的函式/按鈕。 */
  async function handleCopyConfirmation() {
    if (!confirmedReservationId) return;
    // 同一個 async function 包起來，理由跟 handleCopyForRow 上面的
    // buildCopyTextForRow 一致：讓 clipboard.write() 可以立刻同步
    // 呼叫，實際查詢在背景進行
    async function buildText(): Promise<string> {
      const result = await buildReservationConfirmationMessageAction(confirmedReservationId!);
      if (!result.success) throw new Error(result.message);
      return result.text;
    }
    try {
      const canCopyToClipboard = typeof navigator.clipboard?.write === "function" && typeof ClipboardItem !== "undefined";
      if (canCopyToClipboard) {
        const textPromise = buildText();
        await navigator.clipboard.write([
          new ClipboardItem({ "text/plain": textPromise.then((text) => new Blob([text], { type: "text/plain" })) }),
        ]);
      } else {
        await navigator.clipboard.writeText(await buildText());
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "複製失敗，請稍後再試");
    }
  }

  async function handleShareConfirmationImage() {
    if (!confirmationCardRef.current || !confirmedDetail) return;
    setImageWorking(true);
    setImageError(null);
    setImageNote(null);

    try {
      if (typeof document !== "undefined" && document.fonts?.ready) {
        await document.fonts.ready;
      }
      const node = confirmationCardRef.current;
      const { toBlob } = await import("html-to-image");
      const blob = await toBlob(node, {
        pixelRatio: 2,
        backgroundColor: colors.canvas,
        width: node.scrollWidth,
        height: node.scrollHeight,
      });
      if (!blob) throw new Error("圖片產生失敗，請再試一次");

      const file = new File([blob], `${confirmedDetail.propertyName}-訂房確認單.png`, { type: "image/png" });
      const canShareFiles =
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] });

      if (canShareFiles) {
        await navigator.share({ files: [file], title: `${confirmedDetail.propertyName} 訂房確認單` });
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = file.name;
        link.click();
        URL.revokeObjectURL(url);
        setImageNote("已下載圖片，請自行傳給客人（這個瀏覽器不支援直接分享）");
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setImageError(err instanceof Error ? err.message : "圖片產生失敗，請稍後再試");
    } finally {
      setImageWorking(false);
    }
  }

  const isConfirmed = selectedStatus === "accepted" || Boolean(confirmedReservationNo);

  return (
    <div className={`${body.className} flex min-h-screen w-full justify-center px-5 py-8`} style={{ backgroundColor: colors.canvas }}>
      <div className="w-full" style={{ maxWidth: "40rem", color: colors.ink }}>
        <Link href="/" className="text-xs" style={{ color: colors.blue }}>
          ← 返回首頁
        </Link>
        <header className="mb-6 text-center">
          <p style={{ color: colors.muted }} className="text-[11px] tracking-[0.2em]">
            宜蘭・包棟民宿
          </p>
          <h1 className={`${display.className} text-4xl italic`} style={{ color: colors.ink }}>
            報價記錄查詢
          </h1>
        </header>

        {!selectedId && (
          <div className="mb-4">
            {!showClearConfirm ? (
              <button type="button" onClick={() => setShowClearConfirm(true)} className="text-xs" style={{ color: colors.alert }}>
                清除報價記錄
              </button>
            ) : (
              <div className="border-l-2 pl-3" style={{ borderColor: colors.alert }}>
                <p className="text-xs leading-relaxed" style={{ color: colors.alert }}>
                  確定要刪除入住日期已經過去的所有報價記錄嗎？（不是看報價單建立日期，是看入住日期）不管有沒有確認訂房都會刪除（已確認訂房的正式記錄本身不受影響，只是報價單本身查不到了），此動作無法復原。
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowClearConfirm(false)}
                    className="border px-3 py-1 text-xs"
                    style={{ borderColor: colors.line, color: colors.ink }}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={handleClearOldQuotes}
                    disabled={isClearing}
                    className="px-3 py-1 text-xs disabled:opacity-50"
                    style={{ backgroundColor: colors.alert, color: "#FFFFFF" }}
                  >
                    {isClearing ? "清除中…" : "確定清除"}
                  </button>
                </div>
              </div>
            )}
            {clearResultMessage && (
              <p className="mt-2 text-xs" style={{ color: colors.pine }}>
                ✓ {clearResultMessage}
              </p>
            )}
            {clearError && (
              <p className="mt-2 text-xs" style={{ color: colors.alert }}>
                {clearError}
              </p>
            )}
          </div>
        )}

        <div className="mb-2 flex items-center justify-between">
          <button type="button" onClick={goToPrevMonth} className="px-3 py-1 text-sm" style={{ color: colors.blue }}>
            ← 上個月
          </button>
          <span className="text-sm font-semibold">
            {calendarYear} 年 {calendarMonth} 月
          </span>
          <button type="button" onClick={goToNextMonth} className="px-3 py-1 text-sm" style={{ color: colors.blue }}>
            下個月 →
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-[10px]" style={{ color: colors.muted }}>
          {["日", "一", "二", "三", "四", "五", "六"].map((w) => (
            <div key={w} className="py-1">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: firstWeekdayOfMonth(calendarYear, calendarMonth) }).map((_, i) => (
            <div key={`blank-${i}`} />
          ))}
          {Array.from({ length: daysInCalendarMonth(calendarYear, calendarMonth) }, (_, i) => i + 1).map((day) => {
            const dateStr = formatYMD(calendarYear, calendarMonth, day);
            const isSelected = checkInDate === dateStr;
            const hasQuote = quoteDates.has(dateStr);
            return (
              <button
                key={day}
                type="button"
                onClick={() => handleSelectDate(dateStr)}
                disabled={isSearching}
                className="flex aspect-square items-center justify-center rounded-sm border text-xs transition-colors disabled:opacity-50"
                style={
                  isSelected
                    ? { backgroundColor: colors.pine, borderColor: colors.pine, color: colors.pineText }
                    : hasQuote
                      ? { backgroundColor: colors.pineSoft, borderColor: colors.pineSoft, color: colors.ink }
                      : { borderColor: colors.line, color: colors.ink, backgroundColor: "transparent" }
                }
              >
                {day}
              </button>
            );
          })}
        </div>
        {isSearching && (
          <p className="mt-2 text-center text-xs" style={{ color: colors.muted }}>
            查詢中…
          </p>
        )}

        {searchError && (
          <p role="alert" className="mt-4 border-l-2 pl-3 text-xs leading-relaxed" style={{ borderColor: colors.alert, color: colors.alert }}>
            {searchError}
          </p>
        )}

        {results && results.length === 0 && (
          <p className="mt-6 text-xs" style={{ color: colors.muted }}>
            沒有找到符合的報價紀錄。日期跟關鍵字都留空查詢會顯示最近 100 筆。
          </p>
        )}

        {results && results.length > 0 && !selectedId && (
          <div className="mt-6 flex flex-col gap-3">
            {results.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => handleSelect(row)}
                className="w-full border p-3 text-left text-xs"
                style={{ borderColor: colors.line, color: colors.ink }}
              >
                <>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold">{row.propertyName}</span>
                    <span style={{ color: colors.muted }}>{STATUS_LABEL[row.status] ?? row.status}</span>
                  </div>
                  <p className="mt-1" style={{ color: colors.muted }}>
                    {formatDateWithWeekday(row.checkIn)} ～ {formatDateWithWeekday(row.checkOut)}
                  </p>
                  <div className="mt-1 flex items-baseline justify-between" style={{ color: colors.muted }}>
                    <span>
                      {row.adults}大{row.children > 0 ? ` ${row.children}小` : ""}
                    </span>
                    <span>{row.quoteNo}</span>
                  </div>
                  {row.roomSummary ? (
                    (() => {
                      const items = row.roomSummary.split("、");
                      // 降規四人套房後面會帶一段「(提供1床，以雙人套房
                      // 計費)」的說明文字，原本整段接在房型名稱後面
                      // 同一行——這裡拆開成兩行顯示，房型名稱後面的
                      // 說明文字太長時容易跟旁邊金額擠在一起不好讀。
                      const splitSuffix = (text: string): { main: string; suffix: string | null } => {
                        const idx = text.indexOf(" (");
                        if (idx === -1) return { main: text, suffix: null };
                        return { main: text.slice(0, idx), suffix: text.slice(idx + 1) };
                      };
                      return (
                        <div className="mt-1 flex flex-col" style={{ color: colors.muted }}>
                          {items.map((item, i) => {
                            const { main, suffix } = splitSuffix(item);
                            if (i === items.length - 1) {
                              return (
                                <div key={i} className="flex flex-col">
                                  <div className="flex items-baseline justify-between">
                                    <span>{main}</span>
                                    <span className="text-base font-semibold" style={{ color: colors.ink }}>
                                      NT$ {row.totalAmount.toLocaleString()}
                                    </span>
                                  </div>
                                  {suffix && <p className="text-[11px]">{suffix}</p>}
                                </div>
                              );
                            }
                            return (
                              <div key={i}>
                                <p>{main}</p>
                                {suffix && <p className="text-[11px]">{suffix}</p>}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()
                  ) : (
                    // 極少數情況房型摘要是空字串（理論上不該發生，但保守
                    // 起見還是處理一下）——這種狀況下還是要顯示金額，不能
                    // 讓金額整個消失不見
                    <div className="mt-1 text-right">
                      <span className="text-base font-semibold">NT$ {row.totalAmount.toLocaleString()}</span>
                    </div>
                  )}
                </>
              </button>
            ))}
          </div>
        )}

        {selectedId && (
          <div className="mt-6">
            <button
              type="button"
              onClick={() => {
                setSelectedId(null);
                setSelectedQuote(null);
              }}
              className="text-xs"
              style={{ color: colors.blue }}
            >
              ← 回到搜尋結果
            </button>

            {isLoadingDetail && (
              <p className="mt-4 text-xs" style={{ color: colors.muted }}>
                讀取中…
              </p>
            )}

            {detailError && (
              <p role="alert" className="mt-4 border-l-2 pl-3 text-xs leading-relaxed" style={{ borderColor: colors.alert, color: colors.alert }}>
                {detailError}
              </p>
            )}

            {selectedQuote && selectedQuote.messageContext && selectedQuote.roomAllocation && (
              <>
                {/* 報價內容——用同一張報價收據卡片（QuoteReceiptCard），
                    傳 preview：標題收成一行小字、內距收緊、不顯示「匯款
                    帳號」「預訂須知」（那幾段是給客人看的，職員核對報價
                    時不需要）。存成圖片傳給客人的那份不傳 preview，維持
                    完整版面。所有針對這張報價的操作（編輯／刪除／複製／
                    儲存圖片／轉為訂房記錄）都只在詳情這一個地方，列表列
                    本身只是點擊入口。 */}
                <p className="mt-3 text-[11px]" style={{ color: colors.muted }}>
                  狀態：{STATUS_LABEL[selectedStatus ?? ""] ?? selectedStatus}
                </p>
                <div className="mx-auto mt-1 w-full" style={{ maxWidth: "480px" }}>
                  <QuoteReceiptCard
                    quote={selectedQuote}
                    createdAt={selectedQuoteCreatedAt}
                    isConfirmed={isConfirmed}
                    preview
                  />
                </div>

                {!isConfirmed && !isEditingQuote && (
                  <div className="mt-3 flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <button type="button" onClick={startEditQuote} className="text-xs" style={{ color: colors.blue }}>
                        編輯報價內容（例如入住人數有變動）
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowDetailDeleteConfirm(true);
                          setDeleteQuoteError(null);
                        }}
                        className="text-xs"
                        style={{ color: colors.alert }}
                      >
                        刪除
                      </button>
                    </div>

                    {showDetailDeleteConfirm && (
                      <div className="border-l-2 pl-3" style={{ borderColor: colors.alert }}>
                        <p className="text-[11px] leading-relaxed" style={{ color: colors.alert }}>
                          確定要刪除這張報價單嗎？無法復原。
                          {selectedStatus === "accepted" && (
                            <>
                              <br />
                              這張報價已經確認轉為正式訂單——刪除報價單本身不會影響訂單，訂單記錄會繼續保留，只是之後沒辦法再從這裡查回當初的報價內容。
                            </>
                          )}
                        </p>
                        {deleteQuoteError && (
                          <p role="alert" className="mt-1 text-[11px]" style={{ color: colors.alert }}>
                            {deleteQuoteError}
                          </p>
                        )}
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => setShowDetailDeleteConfirm(false)}
                            disabled={isDeletingQuote}
                            className="border px-3 py-1 text-[11px] disabled:opacity-50"
                            style={{ borderColor: colors.line, color: colors.ink }}
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            onClick={handleDeleteQuote}
                            disabled={isDeletingQuote}
                            className="px-3 py-1 text-[11px] disabled:opacity-50"
                            style={{ backgroundColor: colors.alert, color: "#FFFFFF" }}
                          >
                            {isDeletingQuote ? "刪除中…" : "確定刪除"}
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleCopy}
                        className="flex-1 py-2.5 text-xs tracking-wide transition-opacity"
                        style={{ backgroundColor: colors.pine, color: colors.pineText }}
                      >
                        {copied ? "已複製 ✓" : "📋 複製報價內容"}
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveQuoteImage}
                        disabled={quoteImageWorking}
                        className="flex-1 py-2.5 text-xs tracking-wide transition-opacity disabled:opacity-50"
                        style={{ backgroundColor: colors.pine, color: colors.pineText }}
                      >
                        {quoteImageWorking ? "圖片產生中…" : "🖼️ 儲存報價單圖片"}
                      </button>
                    </div>
                    {quoteImageError && (
                      <p className="text-[11px]" style={{ color: colors.alert }}>
                        {quoteImageError}
                      </p>
                    )}
                    {quoteImageNote && (
                      <p className="text-[11px]" style={{ color: colors.pine }}>
                        {quoteImageNote}
                      </p>
                    )}
                  </div>
                )}

                {!isConfirmed && isEditingQuote && editRequest && (
                  <div className="mt-2 flex flex-col gap-3 border p-4 text-xs" style={{ borderColor: colors.line }}>
                    <p className="text-[11px] leading-relaxed" style={{ color: colors.muted }}>
                      改完欄位後按「重新試算」，會用新的內容重新計算金額並直接更新這張報價單，不用重新走一次完整報價流程。
                    </p>

                    <div>
                      <p style={{ color: colors.muted }} className="mb-1 text-[11px]">
                        民宿（客人有時候會想比較兩間民宿的價格，這裡可以直接改——房型數量會保留原本填的數字，重新試算時會依新民宿檢查是否合理）
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {PROPERTY_OPTIONS.map((p) => {
                          const active = editRequest.propertyCode === p.value;
                          return (
                            <button
                              key={p.value}
                              type="button"
                              onClick={() => handleEditPropertyChange(p.value)}
                              className="rounded-full border px-3 py-1.5 text-xs transition-colors"
                              style={
                                active
                                  ? { borderColor: colors.pine, backgroundColor: colors.pine, color: colors.pineText }
                                  : { borderColor: colors.line, backgroundColor: "transparent", color: colors.ink }
                              }
                            >
                              {p.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <label className="flex flex-col gap-1">
                        <span style={{ color: colors.muted }} className="text-[11px]">
                          入住日期
                        </span>
                        <input
                          type="date"
                          value={editRequest.checkIn}
                          onChange={(e) => updateEditRequestField("checkIn", e.target.value)}
                          className="w-full border-b bg-transparent py-1 text-sm outline-none"
                          style={{ borderColor: colors.line, color: colors.ink }}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span style={{ color: colors.muted }} className="text-[11px]">
                          退房日期
                        </span>
                        <input
                          type="date"
                          value={editRequest.checkOut}
                          onChange={(e) => updateEditRequestField("checkOut", e.target.value)}
                          className="w-full border-b bg-transparent py-1 text-sm outline-none"
                          style={{ borderColor: colors.line, color: colors.ink }}
                        />
                      </label>
                      <NumberField
                        label="大人"
                        value={editRequest.adults}
                        onChange={(v) => updateEditRequestField("adults", v)}
                      />
                      <NumberField
                        label="小孩"
                        value={editRequest.children}
                        onChange={(v) => updateEditRequestField("children", v)}
                      />
                      <NumberField
                        label="嬰幼兒"
                        value={editRequest.infants ?? 0}
                        onChange={(v) => updateEditRequestField("infants", v)}
                      />
                      <NumberField
                        label="寵物"
                        value={editRequest.pets ?? 0}
                        onChange={(v) => updateEditRequestField("pets", v)}
                      />
                    </div>

                    <div>
                      <p style={{ color: colors.muted }} className="mb-1 text-[11px] tracking-wide">
                        房型數量（留空或 0 表示系統自動依人數分配，只此清綠沒有雙人套房／雅房，陌隱/水景璞堤沒有降規四人套房）
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <NumberField
                          label="四人套房"
                          value={editRequest.roomOverride?.fourPersonSuiteCount ?? 0}
                          onChange={(v) => updateEditRoomOverride("fourPersonSuiteCount", v)}
                        />
                        <NumberField
                          label="降規四人套房"
                          value={editRequest.roomOverride?.fourPersonDowngradeCount ?? 0}
                          onChange={(v) => updateEditRoomOverride("fourPersonDowngradeCount", v)}
                        />
                        <NumberField
                          label="雙人套房"
                          value={editRequest.roomOverride?.doubleSuiteCount ?? 0}
                          onChange={(v) => updateEditRoomOverride("doubleSuiteCount", v)}
                        />
                        <NumberField
                          label="雙人雅房"
                          value={editRequest.roomOverride?.doublePlainCount ?? 0}
                          onChange={(v) => updateEditRoomOverride("doublePlainCount", v)}
                        />
                      </div>
                    </div>

                    <div>
                      <p style={{ color: colors.muted }} className="mb-1 text-[11px] tracking-wide">
                        額外服務
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <NumberField
                          label="加固定床"
                          value={editRequest.extraBedFixedQty ?? 0}
                          onChange={(v) => updateEditRequestField("extraBedFixedQty", v)}
                        />
                        <NumberField
                          label="加臨時床"
                          value={editRequest.extraBedTempQty ?? 0}
                          onChange={(v) => updateEditRequestField("extraBedTempQty", v)}
                        />
                        <NumberField
                          label="加開房間"
                          value={editRequest.extraRoomQty ?? 0}
                          onChange={(v) => updateEditRequestField("extraRoomQty", v)}
                        />
                        <NumberField
                          label="訪客人數"
                          value={editRequest.visitorQty ?? 0}
                          onChange={(v) => updateEditRequestField("visitorQty", v)}
                        />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-4">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={editRequest.addOns?.bbq ?? false}
                            onChange={(e) => updateEditAddOn("bbq", e.target.checked)}
                            className="h-3.5 w-3.5"
                            style={{ accentColor: colors.pine }}
                          />
                          <span className="text-xs">烤肉</span>
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={editRequest.addOns?.foodTruck ?? false}
                            onChange={(e) => updateEditAddOn("foodTruck", e.target.checked)}
                            className="h-3.5 w-3.5"
                            style={{ accentColor: colors.pine }}
                          />
                          <span className="text-xs">餐車</span>
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={editRequest.addOns?.earlyCheckin ?? false}
                            onChange={(e) => updateEditAddOn("earlyCheckin", e.target.checked)}
                            className="h-3.5 w-3.5"
                            style={{ accentColor: colors.pine }}
                          />
                          <span className="text-xs">提前入住</span>
                        </label>
                      </div>
                    </div>

                    <NumberField
                      label="優惠折扣（金額，直接從總費用扣除）"
                      value={editRequest.discountAmount ?? 0}
                      onChange={(v) => updateEditRequestField("discountAmount", v)}
                    />

                    {/* 編輯時先看目前這張報價單的訂金/包棟總費用當
                        參考——這是還沒按「重新試算並更新」之前的
                        數字，改完欄位、按下按鈕後才會用新的內容重新
                        計算並覆蓋 */}
                    {selectedQuote && (
                      <div className="flex gap-4 border-t pt-3" style={{ borderColor: colors.line }}>
                        <div className="flex-1">
                          <p className="text-[11px]" style={{ color: colors.muted }}>
                            目前訂金
                          </p>
                          <p className="font-semibold" style={{ color: colors.ink }}>
                            NT$ {selectedQuote.deposit.toLocaleString()}
                          </p>
                        </div>
                        <div className="flex-1">
                          <p className="text-[11px]" style={{ color: colors.muted }}>
                            目前包棟總費用
                          </p>
                          <p className="font-semibold" style={{ color: colors.ink }}>
                            NT$ {selectedQuote.packageTotal.toLocaleString()}
                          </p>
                        </div>
                      </div>
                    )}

                    {recalculateError && (
                      <p role="alert" className="text-[11px] leading-relaxed" style={{ color: colors.alert }}>
                        {recalculateError}
                      </p>
                    )}

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={cancelEditQuote}
                        disabled={isRecalculating}
                        className="flex-1 border py-2 text-xs tracking-wide disabled:opacity-50"
                        style={{ borderColor: colors.line, color: colors.ink }}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={handleRecalculate}
                        disabled={isRecalculating}
                        className="flex-1 py-2 text-xs tracking-wide disabled:opacity-50"
                        style={{ backgroundColor: colors.pine, color: colors.pineText }}
                      >
                        {isRecalculating ? "試算中…" : "重新試算並更新"}
                      </button>
                    </div>
                  </div>
                )}

                {isConfirmed && confirmedReservationNo && (
                  <p
                    className="mt-4 border-l-2 pl-3 text-xs leading-relaxed"
                    style={{ borderColor: colors.pine, color: colors.pine }}
                  >
                    ✓ 已確認訂房，訂房編號：{confirmedReservationNo}
                  </p>
                )}

                {/* 「轉成訂單」是獨立頁面——確認訂房要填的資料（姓名／
                    來源／付款狀況／發票／加臨時床房號）都在那一頁收集，
                    這裡只留一個明顯的入口連結。 */}
                {!isConfirmed && !isEditingQuote && (
                  <Link
                    href={`/quotes/${selectedId}/convert`}
                    className="mt-5 block w-full py-2.5 text-center text-xs tracking-wide transition-opacity"
                    style={{ backgroundColor: colors.pine, color: colors.pineText }}
                  >
                    轉為訂房記錄 →
                  </Link>
                )}

                {/* 已確認訂房才會有這兩個按鈕：複製真正的訂房確認內容、
                    轉成圖片分享給客人——放在「顯示完整報價內容」上面，
                    不用先展開那一大串內容才找得到。並排＋實心背景色，
                    跟上方「編輯報價內容」下面的「複製報價內容」按鈕
                    是同一套深綠實心的樣式語彙。 */}
                {isConfirmed && confirmedDetail && (
                  <div className="mt-5 flex flex-col gap-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleCopyConfirmation}
                        className="flex-1 py-2.5 text-xs tracking-wide transition-opacity"
                        style={{ backgroundColor: colors.pine, color: colors.pineText }}
                      >
                        {copied ? "已複製 ✓" : "📋 複製訂單內容"}
                      </button>
                      <button
                        type="button"
                        onClick={handleShareConfirmationImage}
                        disabled={imageWorking}
                        className="flex-1 py-2.5 text-xs tracking-wide transition-opacity disabled:opacity-50"
                        style={{ backgroundColor: colors.pine, color: colors.pineText }}
                      >
                        {imageWorking ? "圖片產生中…" : "🖼️ 儲存訂單圖片"}
                      </button>
                    </div>
                    {imageError && (
                      <p className="text-[11px]" style={{ color: colors.alert }}>
                        {imageError}
                      </p>
                    )}
                    {imageNote && (
                      <p className="text-[11px]" style={{ color: colors.pine }}>
                        {imageNote}
                      </p>
                    )}

                    {/* 隱藏的訂房確認單卡片，只用來截圖產生分享用的圖片。
                        ⚠️ 這裡刻意不用 position: fixed——iOS Safari
                        對於「螢幕外的 fixed 元素」的版面計算/渲染有
                        很多已知的相容性問題（WebKit 的 bug tracker 上
                        有大量相關回報），實際發生過的症狀就是截出來的
                        圖片最上方的標題不見了。改用 position: absolute
                        放在一個高度是 0、overflow:hidden 的外層容器
                        裡——這樣元素還是留在正常的版面配置流程中（量
                        測尺寸才會準確），但視覺上完全不會影響頁面、
                        使用者也看不到，同時避開 fixed 定位在 iOS 上的
                        已知問題。 */}
                    <ConfirmationImageCard detail={confirmedDetail} quote={selectedQuote} cardRef={confirmationCardRef} />
                  </div>
                )}

                {/* 隱藏的報價收據卡片——詳情頁「儲存報價單圖片」按鈕
                    截圖用（只有還沒轉單、非編輯狀態才需要）。包一層高度
                    0 / overflow hidden + position:absolute（不用 fixed，
                    iOS Safari 對螢幕外 fixed 元素有已知渲染問題），量測
                    尺寸準確、又不影響畫面。 */}
                {!isConfirmed && !isEditingQuote && (
                  <div style={{ height: 0, overflow: "hidden" }}>
                    <div style={{ position: "absolute", left: "-9999px", top: 0 }}>
                      <div className={body.className} style={{ width: "480px", backgroundColor: colors.canvas }}>
                        <QuoteReceiptCard
                          quote={selectedQuote}
                          createdAt={selectedQuoteCreatedAt}
                          isConfirmed={false}
                          cardRef={quoteImageCardRef}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
