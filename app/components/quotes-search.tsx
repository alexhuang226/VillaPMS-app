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
  confirmReservationFromQuoteAction,
  deleteQuoteAction,
  getExtraBedRoomOptionsAction,
  getQuoteCheckInDatesInRangeAction,
  getReservationForQuoteAction,
  getSavedQuoteAction,
  searchQuotesAction,
  updateQuoteSnapshotAction,
} from "@/app/actions/quote";
import type { BookingSource } from "@/app/actions/quote";
import { buildReservationConfirmationMessageAction, getReservationDetailAction } from "@/app/actions/reservation";
import {
  accommodationDayGroups,
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
  formatDateWithWeekday,
  guestSummary,
  INFANT_NOTE,
  roomAllocationSummaryItems,
} from "@/lib/pricing/quote-message";
import type { ExtraBedRoomOption, QuoteSummary, ReservationDetail } from "@/lib/pricing/queries";
import type { PackageQuote, StayRequest } from "@/lib/pricing/types";

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

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  sent: "已送出",
  accepted: "已確認訂房",
  expired: "已過期",
  rejected: "已婉拒",
  cancelled: "已取消",
};

/** 確認訂房時的付款狀況選項——預設「已收訂金」，實務上職員按這個
 * 按鈕的當下，客人通常都已經付了訂金（不然不會走到這一步確認）*/
const CONFIRM_PAYMENT_STATUS_LABEL: Record<string, string> = {
  deposit_paid: "已收訂金",
  balance_paid: "已收全額（含尾款）",
  pending_deposit: "尚未收款",
};

const BOOKING_SOURCE_OPTIONS: { value: BookingSource; label: string }[] = [
  { value: "line_official", label: "LINE官方" },
  { value: "airbnb", label: "Airbnb" },
  { value: "walk_in", label: "現場" },
  { value: "phone", label: "電話" },
  { value: "other_ota", label: "其他OTA" },
  { value: "other", label: "其他" },
];

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
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  return (
    <div style={{ height: 0, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: "-9999px", top: 0 }}>
        <div ref={cardRef} className={body.className} style={{ width: "375px", backgroundColor: colors.canvas }}>
          {/* 標題格式改成跟報價單一致：民宿名稱大字在上，「訂房確認單」
              字距展開的小標在下，「預訂日期」疊在右邊——結構、間距、
              防溢出的 min-height 安全邊界都跟報價單同一套做法，唯一
              差異是背景色換成咖啡色系、副標籤從「包棟報價單」換成
              「訂房確認單」、右邊只有一行「預訂日期」沒有「有效期限」
              （確認單沒有報價那種期限概念）。 */}
          <div className="relative px-6 pb-6 pt-8 text-center" style={{ backgroundColor: CONFIRM_DARK }}>
            <p className={`${display.className} text-2xl italic`} style={{ color: "#FFFFFF" }}>
              {detail.propertyName}私人會所
            </p>
            <div className="relative mt-1" style={{ minHeight: "24px" }}>
              <p className="tracking-[0.3em]" style={{ color: CONFIRM_LIGHT, fontSize: "16px" }}>
                訂房確認單
              </p>
              <div className="absolute right-0 bottom-0 text-right text-[8px] leading-tight" style={{ color: CONFIRM_LIGHT }}>
                <p>預訂日期：{formatSlashDate(todayStr)}</p>
              </div>
            </div>
          </div>
          <div className="px-6 py-5 text-xs leading-relaxed" style={{ color: colors.ink }}>
            <p className="mt-1 font-bold">📅 預訂資訊</p>
            <p className="mt-1">• 入住日期：{formatDateWithWeekday(detail.checkIn)}</p>
            <p>• 退房日期：{formatDateWithWeekday(detail.checkOut)}</p>
            <p>• 預訂天數：{nightsLabel(detail.checkIn, detail.checkOut)}</p>
            <p>
              • 入住人數：{detail.adults}大
              {detail.children ? ` ${detail.children}小` : ""}
              {detail.infants ? ` ${detail.infants}幼` : ""}
              {detail.pets ? ` ${detail.pets}寵` : ""}
            </p>
            <p>• 房型配置：</p>
            {roomAllocationSummaryItems(detail.roomAllocation).map((item, i) => (
              <p key={i} className="pl-3">
                └ {item.text}
              </p>
            ))}
            <p className="mt-2" style={{ color: colors.muted }}>
              ━━━━━━━━━━━━━━
            </p>
            <p className="mt-2 font-bold">💰 費用明細</p>
            {quote ? (
              <>
                {accommodationDayGroups(quote).map((group, gi) => (
                  <div key={`day-${gi}`}>
                    {group.dateLabel && (
                      <p className="mt-1" style={{ color: colors.ink }}>
                        {group.dateLabel}
                      </p>
                    )}
                    {group.items.map((item, i) => (
                      <p key={i} className={group.dateLabel ? "pl-3" : undefined}>
                        • {item.roomLabel}：${item.unitPrice.toLocaleString()}×{item.qty} = $
                        {item.lineTotal.toLocaleString()}
                      </p>
                    ))}
                  </div>
                ))}
                {addOnFeeBreakdown(quote).map((item, i) => (
                  <p key={`fee-${i}`}>
                    • {item.label}：${item.amount.toLocaleString()}
                  </p>
                ))}
                {quote.discountAmount > 0 && <p>• 優惠折扣：－${quote.discountAmount.toLocaleString()}</p>}
                {quote.invoiceTaxAmount > 0 && <p>• 發票稅金(8%)：${quote.invoiceTaxAmount.toLocaleString()}</p>}
              </>
            ) : (
              <p className="mt-1">• 住宿總額：${detail.finalTotal.toLocaleString()}元</p>
            )}
            {/* 包棟總費用——改成跟報價單一樣的強調框，背景換成淺焦糖／
                拿鐵色（CONFIRM_LIGHT），跟上面標題的深咖啡色（CONFIRM_DARK）
                同一個色系、深淺搭配，取代原本文字版的訂金/尾款條列 */}
            <div className="mt-3 rounded-sm px-4 py-3" style={{ backgroundColor: CONFIRM_LIGHT }}>
              <p className="text-[11px] tracking-wide" style={{ color: CONFIRM_ACCENT }}>
                包棟總費用
              </p>
              <p className={`${display.className} text-2xl italic`} style={{ color: CONFIRM_DARK }}>
                NT$ {detail.finalTotal.toLocaleString()}
              </p>
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
function QuoteReceiptCard({
  quote,
  createdAt,
  isConfirmed,
  cardRef,
}: {
  quote: PackageQuote;
  createdAt: string | null;
  isConfirmed: boolean;
  cardRef?: RefObject<HTMLDivElement | null>;
}) {
  if (!quote.messageContext || !quote.roomAllocation) return null;
  return (
    <>
                    <div ref={cardRef} className="mt-4 overflow-hidden" style={{ backgroundColor: colors.surface, border: `1px solid ${colors.line}` }}>
                      <div className="relative px-6 pb-4 pt-5 text-center" style={{ backgroundColor: colors.pine }}>
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

                      {/* 上方 padding 特意比其他方向小很多——上面接的是
                          深色標題區塊，已經有自己的 padding，兩個疊加
                          會讓「預訂資訊」上方空白感覺太大 */}
                      <div className="px-6 pb-5 pt-1" style={{ color: colors.ink }}>
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
                                <p style={{ color: colors.ink }}>{quote.messageContext.bank.accountNumber}</p>
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

  // 這些都是「確認訂房」這個階段才收集的資料，報價階段沒有問過
  const [confirmGuestName, setConfirmGuestName] = useState("");
  const [confirmBookingSource, setConfirmBookingSource] = useState<BookingSource>("line_official");
  const [confirmPaymentStatus, setConfirmPaymentStatus] = useState("deposit_paid");
  const [confirmDepositAmount, setConfirmDepositAmount] = useState("");
  const [confirmInvoiceTitle, setConfirmInvoiceTitle] = useState("");
  const [confirmInvoiceTaxId, setConfirmInvoiceTaxId] = useState("");
  const [extraBedRoomOptions, setExtraBedRoomOptions] = useState<ExtraBedRoomOption[]>([]);
  const [selectedExtraBedRoomIds, setSelectedExtraBedRoomIds] = useState<string[]>([]);

  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmedReservationNo, setConfirmedReservationNo] = useState<string | null>(null);
  const [confirmedReservationId, setConfirmedReservationId] = useState<string | null>(null);
  const [confirmedDetail, setConfirmedDetail] = useState<ReservationDetail | null>(null);
  const [imageWorking, setImageWorking] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageNote, setImageNote] = useState<string | null>(null);
  const confirmationCardRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  // 展開查看完整報價內容（複製/轉圖片用）——預設不顯示，避免每次
  // 點一筆報價都要滑過一大串內容才看得到確認訂房的按鈕
  const [showFullReceipt, setShowFullReceipt] = useState(false);

  // 清除舊報價記錄用
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [clearResultMessage, setClearResultMessage] = useState<string | null>(null);
  const [clearError, setClearError] = useState<string | null>(null);

  // 刪除單一報價單用
  const [showDeleteQuoteConfirm, setShowDeleteQuoteConfirm] = useState(false);
  const [isDeletingQuote, setIsDeletingQuote] = useState(false);
  const [deleteQuoteError, setDeleteQuoteError] = useState<string | null>(null);
  /** 搜尋結果列表直接刪除用——不用先點進詳細內容。存的是目前正在
   * 顯示刪除確認的那一列報價單 id，null 代表沒有任何一列在確認中 */
  const [deletingRowId, setDeletingRowId] = useState<string | null>(null);

  // 搜尋結果列表直接複製內容/轉圖片用——一樣不用先點進詳細內容
  const [copyingRowId, setCopyingRowId] = useState<string | null>(null);
  const [copiedRowId, setCopiedRowId] = useState<string | null>(null);
  const [rowCopyError, setRowCopyError] = useState<string | null>(null);
  /** 錯誤訊息屬於哪一列，避免一列複製失敗，錯誤卻顯示在其他列下面 */
  const [rowCopyErrorId, setRowCopyErrorId] = useState<string | null>(null);
  const [imagingRowId, setImagingRowId] = useState<string | null>(null);
  const [rowImageError, setRowImageError] = useState<string | null>(null);
  const [rowImageNote, setRowImageNote] = useState<string | null>(null);
  const [rowImageMessageId, setRowImageMessageId] = useState<string | null>(null);
  /** 目前正在轉圖片的那一列的訂單詳情/報價內容——驅動下面單獨的
   * ConfirmationImageCard 隱藏卡片。跟詳情頁面自己的 confirmedDetail/
   * selectedQuote 是分開的兩組狀態，故意不共用，避免使用者同時在
   * 詳情頁面操作、又點列表的轉圖片按鈕時，兩邊的圖片內容互相干擾。 */
  const [rowImageDetail, setRowImageDetail] = useState<ReservationDetail | null>(null);
  const [rowImageQuote, setRowImageQuote] = useState<PackageQuote | null>(null);
  const rowImageCardRef = useRef<HTMLDivElement>(null);
  // 搜尋結果列表「報價圖片」用（還沒確認訂房的報價，圖片內容是完整
  // 報價收據，不是訂房確認單）——跟上面的訂房確認單圖片是分開的兩組
  // 狀態，因為卡片內容/版型完全不同（QuoteReceiptCard vs
  // ConfirmationImageCard）
  const [imagingQuoteRowId, setImagingQuoteRowId] = useState<string | null>(null);
  const [rowQuoteImageError, setRowQuoteImageError] = useState<string | null>(null);
  const [rowQuoteImageNote, setRowQuoteImageNote] = useState<string | null>(null);
  const [rowQuoteImageMessageId, setRowQuoteImageMessageId] = useState<string | null>(null);
  const [rowQuoteImageData, setRowQuoteImageData] = useState<{ quote: PackageQuote; createdAt: string } | null>(null);
  const rowQuoteImageCardRef = useRef<HTMLDivElement>(null);

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

  /** 搜尋結果列表直接複製內容——不用先點進詳細內容。已確認訂房的
   * 報價複製真正的訂房確認內容，還沒確認的複製報價內容，邏輯跟
   * handleSelect() 載入詳細內容時判斷 saved.status 是否為 accepted
   * 一致。 */
  async function handleCopyForRow(row: QuoteSummary) {
    setCopyingRowId(row.id);
    setRowCopyError(null);
    setRowCopyErrorId(null);
    try {
      let text: string;
      if (row.status === "accepted") {
        const reservation = await getReservationForQuoteAction(row.id);
        if (!reservation) {
          setRowCopyError("找不到對應的訂房記錄");
          setRowCopyErrorId(row.id);
          return;
        }
        const result = await buildReservationConfirmationMessageAction(reservation.id);
        if (!result.success) {
          setRowCopyError(result.message);
          setRowCopyErrorId(row.id);
          return;
        }
        text = result.text;
      } else {
        const saved = await getSavedQuoteAction(row.id);
        if (!saved || !saved.quote.messageContext || !saved.quote.roomAllocation) {
          setRowCopyError("找不到這張報價單的完整內容");
          setRowCopyErrorId(row.id);
          return;
        }
        text = buildQuoteMessage(saved.quote);
      }
      await navigator.clipboard.writeText(text);
      setCopiedRowId(row.id);
      setTimeout(() => setCopiedRowId(null), 2000);
    } catch (err) {
      setRowCopyError(err instanceof Error ? err.message : "複製失敗，請稍後再試");
      setRowCopyErrorId(row.id);
    } finally {
      setCopyingRowId(null);
    }
  }

  /** 搜尋結果列表直接產生「報價圖片」——給還沒確認訂房的報價用，
   * 圖片內容是完整報價收據（QuoteReceiptCard），跟已確認訂房的
   * 「訂房確認單」圖片（handleImageForRow）是兩種不同版型，各自
   * 對應各自的按鈕。 */
  async function handleQuoteImageForRow(row: QuoteSummary) {
    setImagingQuoteRowId(row.id);
    setRowQuoteImageError(null);
    setRowQuoteImageNote(null);
    setRowQuoteImageMessageId(null);
    try {
      const saved = await getSavedQuoteAction(row.id);
      if (!saved || !saved.quote.messageContext || !saved.quote.roomAllocation) {
        setRowQuoteImageError("找不到這張報價單的完整內容");
        setRowQuoteImageMessageId(row.id);
        return;
      }
      setRowQuoteImageData({ quote: saved.quote, createdAt: saved.createdAt });

      // 等 React 把上面的 state 實際畫進 DOM，理由跟 handleImageForRow
      // 的說明一致
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (typeof document !== "undefined" && document.fonts?.ready) {
        await document.fonts.ready;
      }

      const node = rowQuoteImageCardRef.current;
      if (!node) throw new Error("圖片產生失敗，請再試一次");
      const { toBlob } = await import("html-to-image");
      const blob = await toBlob(node, {
        pixelRatio: 2,
        backgroundColor: colors.canvas,
        width: node.scrollWidth,
        height: node.scrollHeight,
      });
      if (!blob) throw new Error("圖片產生失敗，請再試一次");

      const file = new File([blob], `${row.propertyName}-報價單.png`, { type: "image/png" });
      const canShareFiles =
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] });

      if (canShareFiles) {
        await navigator.share({ files: [file], title: `${row.propertyName} 報價單` });
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = file.name;
        link.click();
        URL.revokeObjectURL(url);
        setRowQuoteImageNote("已下載圖片，請自行傳給客人（這個瀏覽器不支援直接分享）");
        setRowQuoteImageMessageId(row.id);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setRowQuoteImageError(err instanceof Error ? err.message : "圖片產生失敗，請稍後再試");
      setRowQuoteImageMessageId(row.id);
    } finally {
      setImagingQuoteRowId(null);
      setRowQuoteImageData(null);
    }
  }

  /** 搜尋結果列表直接轉圖片——只有已確認訂房的報價才有這個按鈕
   * （理由跟詳情頁面的「轉成圖片」按鈕一致：圖片內容是訂房確認單，
   * 需要實際收款資料，還沒確認訂房的報價沒有這些資料）。 */
  async function handleImageForRow(row: QuoteSummary) {
    setImagingRowId(row.id);
    setRowImageError(null);
    setRowImageNote(null);
    setRowImageMessageId(null);
    try {
      const reservation = await getReservationForQuoteAction(row.id);
      if (!reservation) {
        setRowImageError("找不到對應的訂房記錄");
        setRowImageMessageId(row.id);
        return;
      }
      const [detail, saved] = await Promise.all([getReservationDetailAction(reservation.id), getSavedQuoteAction(row.id)]);
      if (!detail) {
        setRowImageError("找不到訂單詳情");
        setRowImageMessageId(row.id);
        return;
      }
      setRowImageDetail(detail);
      setRowImageQuote(saved?.quote ?? null);

      // 等 React 把上面兩個 state 實際畫進 DOM，隱藏卡片才會顯示這一列
      // 的內容，不是舊資料——用兩次 requestAnimationFrame 確保瀏覽器
      // 已經完成一次繪製，這是常見、可靠的「等 state 更新反映到畫面上」
      // 寫法，比用固定的 setTimeout 延遲更準確。
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (typeof document !== "undefined" && document.fonts?.ready) {
        await document.fonts.ready;
      }

      const node = rowImageCardRef.current;
      if (!node) throw new Error("圖片產生失敗，請再試一次");
      const { toBlob } = await import("html-to-image");
      const blob = await toBlob(node, {
        pixelRatio: 2,
        backgroundColor: colors.canvas,
        width: node.scrollWidth,
        height: node.scrollHeight,
      });
      if (!blob) throw new Error("圖片產生失敗，請再試一次");

      const file = new File([blob], `${detail.propertyName}-訂房確認單.png`, { type: "image/png" });
      const canShareFiles =
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] });

      if (canShareFiles) {
        await navigator.share({ files: [file], title: `${detail.propertyName} 訂房確認單` });
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = file.name;
        link.click();
        URL.revokeObjectURL(url);
        setRowImageNote("已下載圖片，請自行傳給客人（這個瀏覽器不支援直接分享）");
        setRowImageMessageId(row.id);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setRowImageError(err instanceof Error ? err.message : "圖片產生失敗，請稍後再試");
      setRowImageMessageId(row.id);
    } finally {
      setImagingRowId(null);
      setRowImageDetail(null);
      setRowImageQuote(null);
    }
  }

  /** 刪除目前選取的這一張報價單，避免類似/重複的報價單越積越多 */
  async function handleDeleteQuote(quoteId?: string) {
    const targetId = quoteId ?? selectedId;
    if (!targetId) return;
    setIsDeletingQuote(true);
    setDeleteQuoteError(null);

    try {
      const result = await deleteQuoteAction(targetId);
      if (!result.success) {
        setDeleteQuoteError(result.message);
        return;
      }
      // 刪除成功，回到搜尋結果列表，重新查一次確保這筆記錄不會再
      // 顯示出來
      if (targetId === selectedId) {
        setSelectedId(null);
        setSelectedQuote(null);
      }
      setShowDeleteQuoteConfirm(false);
      setDeletingRowId(null);
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
    setCopied(false);
    setShowFullReceipt(false);
    setConfirmGuestName("");
    setConfirmBookingSource("line_official");
    setConfirmInvoiceTitle("");
    setConfirmInvoiceTaxId("");
    setExtraBedRoomOptions([]);
    setSelectedExtraBedRoomIds([]);
    setShowDeleteQuoteConfirm(false);
    setDeleteQuoteError(null);
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
      setConfirmPaymentStatus("deposit_paid");
      setConfirmDepositAmount(String(saved.quote.deposit));

      if (saved.status === "accepted") {
        // 已經確認過訂房了，查出實際的訂房編號＋完整訂單詳情顯示給
        // 使用者看，不用再走一次確認流程——訂單詳情是複製訂房確認
        // 內容/轉圖片要用的
        const reservation = await getReservationForQuoteAction(row.id);
        if (reservation) {
          setConfirmedReservationNo(reservation.reservationNo);
          setConfirmedReservationId(reservation.id);
          const detailResult = await getReservationDetailAction(reservation.id);
          if (detailResult) setConfirmedDetail(detailResult);
        }
      } else if ((saved.request.extraBedTempQty ?? 0) > 0) {
        // 如果這張報價有加臨時床，先把這間民宿「可以加床」的房號選項
        // 查出來，確認訂房時要指定放在哪個房號
        const options = await getExtraBedRoomOptionsAction(saved.request.propertyCode);
        setExtraBedRoomOptions(options);
      }
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "讀取報價單失敗，請稍後再試");
    } finally {
      setIsLoadingDetail(false);
    }
  }

  function toggleExtraBedRoom(roomId: string) {
    setSelectedExtraBedRoomIds((prev) =>
      prev.includes(roomId) ? prev.filter((id) => id !== roomId) : [...prev, roomId]
    );
  }

  async function handleConfirmReservation() {
    if (!selectedId || !selectedQuote) return;

    if (!confirmGuestName.trim()) {
      setDetailError("請先填寫客人姓名再確認訂房");
      return;
    }
    const depositAmountNum = Number(confirmDepositAmount);
    if (confirmPaymentStatus !== "pending_deposit" && (!confirmDepositAmount.trim() || Number.isNaN(depositAmountNum))) {
      setDetailError("請填寫實際收到的訂金金額");
      return;
    }
    const extraBedTempQty = selectedQuote.request.extraBedTempQty ?? 0;
    if (extraBedTempQty > 0 && selectedExtraBedRoomIds.length === 0) {
      setDetailError("這張報價有加臨時床，請先勾選要放在哪個房號");
      return;
    }

    setIsConfirming(true);
    setDetailError(null);

    try {
      const extraBedTempRoomCodes = selectedExtraBedRoomIds
        .map((id) => extraBedRoomOptions.find((opt) => opt.id === id)?.code)
        .filter((code): code is string => Boolean(code));

      const result = await confirmReservationFromQuoteAction(selectedId, {
        guestName: confirmGuestName.trim(),
        bookingSource: confirmBookingSource,
        paymentStatus: confirmPaymentStatus,
        depositAmount: confirmPaymentStatus === "pending_deposit" ? 0 : depositAmountNum,
        invoiceTitle: selectedQuote.request.invoice?.required ? confirmInvoiceTitle.trim() : undefined,
        invoiceTaxId: selectedQuote.request.invoice?.required ? confirmInvoiceTaxId.trim() : undefined,
        extraBedTempRoomCodes: extraBedTempRoomCodes.length > 0 ? extraBedTempRoomCodes : undefined,
      });
      if (!result.success) {
        setDetailError(result.message);
        return;
      }
      setConfirmedReservationNo(result.reservationNo);
      setConfirmedReservationId(result.reservationId);
      setSelectedStatus("accepted");
      // 順便把完整訂單詳情查出來，複製確認內容/轉圖片要用到（訂金
      // 收款日期、地址等資料在 PackageQuote 裡沒有，要另外查）
      const detailResult = await getReservationDetailAction(result.reservationId);
      if (detailResult) setConfirmedDetail(detailResult);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "確認訂房失敗，請稍後再試");
    } finally {
      setIsConfirming(false);
    }
  }

  /** 開始編輯報價內容——用目前已存的報價當初的輸入條件當表單初始值 */
  function startEditQuote() {
    if (!selectedQuote) return;
    // 房型數量要帶「目前實際的房型配置」（selectedQuote.roomAllocation，
    // 不管當初是系統依人數自動分配、還是報價時手動指定），不能只帶
    // request.roomOverride——大多數報價都是系統自動分配、從來沒填過
    // roomOverride，那個欄位平常就是 undefined，如果只帶這個，編輯
    // 表單一打開房型數量全部都會變成 0，跟這張報價單實際用到的房型
    // 完全對不起來。
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
    if (!selectedId || !editRequest) return;
    setIsRecalculating(true);
    setRecalculateError(null);
    try {
      const newQuote = await calculateQuoteAction(editRequest);
      if (newQuote.minimumGuestsWarning || newQuote.roomConfigWarning || newQuote.capacityWarning) {
        setRecalculateError(
          newQuote.minimumGuestsWarning || newQuote.roomConfigWarning || newQuote.capacityWarning || "重新試算失敗"
        );
        return;
      }
      const result = await updateQuoteSnapshotAction(selectedId, editRequest, newQuote);
      if (!result.success) {
        setRecalculateError(result.message ?? "更新報價內容失敗，請稍後再試");
        return;
      }
      setSelectedQuote(newQuote);
      setConfirmDepositAmount(String(newQuote.deposit));
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
    try {
      const result = await buildReservationConfirmationMessageAction(confirmedReservationId);
      if (!result.success) {
        setDetailError(result.message);
        return;
      }
      await navigator.clipboard.writeText(result.text);
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
              <div key={row.id} className="border text-xs" style={{ borderColor: colors.line, color: colors.ink }}>
                <button type="button" onClick={() => handleSelect(row)} className="w-full p-3 text-left">
                  <div className="flex items-baseline justify-between">
                    <span className="font-semibold">{row.propertyName}</span>
                    <span style={{ color: colors.muted }}>{STATUS_LABEL[row.status] ?? row.status}</span>
                  </div>
                  <p className="mt-1" style={{ color: colors.muted }}>
                    {row.checkIn} ～ {row.checkOut}
                  </p>
                  {row.roomSummary && (
                    <p className="mt-1" style={{ color: colors.muted }}>
                      {row.roomSummary}
                    </p>
                  )}
                  <div className="mt-1 flex items-baseline justify-between">
                    <span>
                      {row.adults}大 {row.children}小
                    </span>
                    <span className="font-semibold">NT$ {row.totalAmount.toLocaleString()}</span>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between" style={{ color: colors.muted }}>
                    <span>
                      {row.guestName || "（未填姓名）"}
                      {row.guestPhone ? `　${row.guestPhone}` : ""}
                    </span>
                    <span>{row.quoteNo}</span>
                  </div>
                </button>

                {/* 直接在列表這裡就能複製內容/轉圖片/刪除，不用先點進
                    詳細內容——複製/轉圖片跟刪除一樣，用回傳值表達失敗，
                    不用 throw（見 deleteQuoteAction 的說明） */}
                <div className="flex gap-3 border-t px-3 py-2" style={{ borderColor: colors.line }}>
                  <button
                    type="button"
                    onClick={() => handleCopyForRow(row)}
                    disabled={copyingRowId === row.id}
                    className="text-[11px] disabled:opacity-50"
                    style={{ color: colors.blue }}
                  >
                    {copyingRowId === row.id ? "複製中…" : copiedRowId === row.id ? "已複製 ✓" : "複製內容"}
                  </button>
                  {row.status === "accepted" ? (
                    <button
                      type="button"
                      onClick={() => handleImageForRow(row)}
                      disabled={imagingRowId === row.id}
                      className="text-[11px] disabled:opacity-50"
                      style={{ color: colors.blue }}
                    >
                      {imagingRowId === row.id ? "圖片產生中…" : "🖼️ 訂單圖片"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleQuoteImageForRow(row)}
                      disabled={imagingQuoteRowId === row.id}
                      className="text-[11px] disabled:opacity-50"
                      style={{ color: colors.blue }}
                    >
                      {imagingQuoteRowId === row.id ? "圖片產生中…" : "🖼️ 報價圖片"}
                    </button>
                  )}
                </div>
                {rowCopyError && rowCopyErrorId === row.id && (
                  <p role="alert" className="px-3 pb-2 text-[11px]" style={{ color: colors.alert }}>
                    {rowCopyError}
                  </p>
                )}
                {(rowImageError || rowImageNote) && rowImageMessageId === row.id && (
                  <p className="px-3 pb-2 text-[11px]" style={{ color: rowImageError ? colors.alert : colors.pine }}>
                    {rowImageError || rowImageNote}
                  </p>
                )}
                {(rowQuoteImageError || rowQuoteImageNote) && rowQuoteImageMessageId === row.id && (
                  <p className="px-3 pb-2 text-[11px]" style={{ color: rowQuoteImageError ? colors.alert : colors.pine }}>
                    {rowQuoteImageError || rowQuoteImageNote}
                  </p>
                )}

                <div className="border-t px-3 py-2" style={{ borderColor: colors.line }}>
                  {deletingRowId === row.id ? (
                    <div>
                      <p className="text-[11px] leading-relaxed" style={{ color: colors.alert }}>
                        確定要刪除這張報價單嗎？無法復原。
                        {row.status === "accepted" && (
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
                          onClick={() => {
                            setDeletingRowId(null);
                            setDeleteQuoteError(null);
                          }}
                          disabled={isDeletingQuote}
                          className="border px-3 py-1 text-[11px] disabled:opacity-50"
                          style={{ borderColor: colors.line, color: colors.ink }}
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteQuote(row.id)}
                          disabled={isDeletingQuote}
                          className="px-3 py-1 text-[11px] disabled:opacity-50"
                          style={{ backgroundColor: colors.alert, color: "#FFFFFF" }}
                        >
                          {isDeletingQuote ? "刪除中…" : "確定刪除"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setDeletingRowId(row.id);
                        setDeleteQuoteError(null);
                      }}
                      className="text-[11px]"
                      style={{ color: colors.alert }}
                    >
                      刪除這張報價單
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 隱藏的訂房確認單卡片，給搜尋結果列表的「圖片」按鈕用——
            只有 rowImageDetail 有值（正在處理某一列的轉圖片）時才會
            實際渲染內容，平常是空的。跟詳情頁面自己的
            ConfirmationImageCard（用 confirmedDetail/confirmationCardRef）
            是兩個獨立的實例，互不干擾。 */}
        {rowImageDetail && (
          <ConfirmationImageCard detail={rowImageDetail} quote={rowImageQuote} cardRef={rowImageCardRef} />
        )}

        {/* 隱藏的報價收據卡片，給搜尋結果列表的「報價圖片」按鈕用——
            QuoteReceiptCard 本身沒有內建隱藏定位（它是從畫面上原本
            就會顯示的「完整報價內容」抽出來的元件，那個用法本來就是
            要讓使用者看到），這裡額外包一層跟 ConfirmationImageCard
            一樣的隱藏定位處理，避免 iOS Safari 對 position:fixed 的
            已知問題（見上面 quote-form.tsx 同款截圖卡片的說明）。 */}
        {rowQuoteImageData && (
          <div style={{ height: 0, overflow: "hidden" }}>
            <div style={{ position: "absolute", left: "-9999px", top: 0 }}>
              <div className={body.className} style={{ width: "414px", backgroundColor: colors.canvas }}>
                <QuoteReceiptCard
                  quote={rowQuoteImageData.quote}
                  createdAt={rowQuoteImageData.createdAt}
                  isConfirmed={false}
                  cardRef={rowQuoteImageCardRef}
                />
              </div>
            </div>
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
                {/* 精簡摘要卡片：只用來核對是不是這一筆，不是完整報價內容 */}
                <div className="mt-4 border p-4 text-xs" style={{ borderColor: colors.line, color: colors.ink }}>
                  <div className="flex items-baseline justify-between">
                    <span className={`${display.className} text-xl italic`}>
                      {selectedQuote.messageContext.propertyName}
                    </span>
                    <span style={{ color: colors.muted }}>
                      {STATUS_LABEL[selectedStatus ?? ""] ?? selectedStatus}
                    </span>
                  </div>
                  <p className="mt-2" style={{ color: colors.muted }}>
                    {formatDateWithWeekday(selectedQuote.request.checkIn)} ～{" "}
                    {formatDateWithWeekday(selectedQuote.request.checkOut)}（{daysNightsLabel(selectedQuote.nights)}）
                  </p>
                  <p className="mt-1">{guestSummary(selectedQuote)}</p>
                  <div className="mt-1 flex flex-col gap-0.5" style={{ color: colors.muted }}>
                    {roomAllocationSummaryItems(selectedQuote.roomAllocation).map((item, i) => (
                      <p key={i}>{item.text}</p>
                    ))}
                  </div>
                  <p className={`${display.className} mt-2 text-3xl italic`} style={{ color: colors.pine }}>
                    NT$ {selectedQuote.packageTotal.toLocaleString()}
                  </p>
                </div>

                {!isConfirmed && !isEditingQuote && (
                  <button
                    type="button"
                    onClick={startEditQuote}
                    className="mt-2 text-xs"
                    style={{ color: colors.blue }}
                  >
                    編輯報價內容（例如入住人數有變動）
                  </button>
                )}

                {!isEditingQuote && !showDeleteQuoteConfirm && (
                  <button
                    type="button"
                    onClick={() => setShowDeleteQuoteConfirm(true)}
                    className="mt-2 block text-xs"
                    style={{ color: colors.alert }}
                  >
                    刪除這張報價單
                  </button>
                )}

                {showDeleteQuoteConfirm && (
                  <div className="mt-2 border-l-2 pl-3" style={{ borderColor: colors.alert }}>
                    <p className="text-xs leading-relaxed" style={{ color: colors.alert }}>
                      確定要刪除這張報價單嗎？無法復原。
                      {isConfirmed && (
                        <>
                          <br />
                          這張報價已經確認轉為正式訂單——刪除報價單本身不會影響訂單，訂單記錄會繼續保留，只是之後沒辦法再從這裡查回當初的報價內容。
                        </>
                      )}
                    </p>
                    {deleteQuoteError && (
                      <p role="alert" className="mt-2 text-xs" style={{ color: colors.alert }}>
                        {deleteQuoteError}
                      </p>
                    )}
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setShowDeleteQuoteConfirm(false)}
                        disabled={isDeletingQuote}
                        className="border px-3 py-1.5 text-xs disabled:opacity-50"
                        style={{ borderColor: colors.line, color: colors.ink }}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteQuote()}
                        disabled={isDeletingQuote}
                        className="px-3 py-1.5 text-xs disabled:opacity-50"
                        style={{ backgroundColor: colors.alert, color: "#FFFFFF" }}
                      >
                        {isDeletingQuote ? "刪除中…" : "確定刪除"}
                      </button>
                    </div>
                  </div>
                )}

                {!isConfirmed && isEditingQuote && editRequest && (
                  <div className="mt-2 flex flex-col gap-3 border p-4 text-xs" style={{ borderColor: colors.line }}>
                    <p className="text-[11px] leading-relaxed" style={{ color: colors.muted }}>
                      改完欄位後按「重新試算」，會用新的內容重新計算金額並直接更新這張報價單，不用重新走一次完整報價流程。
                    </p>
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
                      <label className="flex flex-col gap-1">
                        <span style={{ color: colors.muted }} className="text-[11px]">
                          大人
                        </span>
                        <input
                          type="number"
                          min={0}
                          value={editRequest.adults}
                          onChange={(e) => updateEditRequestField("adults", Number(e.target.value))}
                          className="w-full border-b bg-transparent py-1 text-sm outline-none"
                          style={{ borderColor: colors.line, color: colors.ink }}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span style={{ color: colors.muted }} className="text-[11px]">
                          小孩
                        </span>
                        <input
                          type="number"
                          min={0}
                          value={editRequest.children}
                          onChange={(e) => updateEditRequestField("children", Number(e.target.value))}
                          className="w-full border-b bg-transparent py-1 text-sm outline-none"
                          style={{ borderColor: colors.line, color: colors.ink }}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span style={{ color: colors.muted }} className="text-[11px]">
                          嬰幼兒
                        </span>
                        <input
                          type="number"
                          min={0}
                          value={editRequest.infants ?? 0}
                          onChange={(e) => updateEditRequestField("infants", Number(e.target.value))}
                          className="w-full border-b bg-transparent py-1 text-sm outline-none"
                          style={{ borderColor: colors.line, color: colors.ink }}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span style={{ color: colors.muted }} className="text-[11px]">
                          寵物
                        </span>
                        <input
                          type="number"
                          min={0}
                          value={editRequest.pets ?? 0}
                          onChange={(e) => updateEditRequestField("pets", Number(e.target.value))}
                          className="w-full border-b bg-transparent py-1 text-sm outline-none"
                          style={{ borderColor: colors.line, color: colors.ink }}
                        />
                      </label>
                    </div>

                    <div>
                      <p style={{ color: colors.muted }} className="mb-1 text-[11px] tracking-wide">
                        房型數量（留空或 0 表示系統自動依人數分配，只此清綠沒有雙人套房／雅房，陌隱/水景璞堤沒有降規四人套房）
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="flex flex-col gap-1">
                          <span style={{ color: colors.muted }} className="text-[11px]">
                            四人套房
                          </span>
                          <input
                            type="number"
                            min={0}
                            value={editRequest.roomOverride?.fourPersonSuiteCount ?? 0}
                            onChange={(e) => updateEditRoomOverride("fourPersonSuiteCount", Number(e.target.value))}
                            className="w-full border-b bg-transparent py-1 text-sm outline-none"
                            style={{ borderColor: colors.line, color: colors.ink }}
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span style={{ color: colors.muted }} className="text-[11px]">
                            降規四人套房
                          </span>
                          <input
                            type="number"
                            min={0}
                            value={editRequest.roomOverride?.fourPersonDowngradeCount ?? 0}
                            onChange={(e) => updateEditRoomOverride("fourPersonDowngradeCount", Number(e.target.value))}
                            className="w-full border-b bg-transparent py-1 text-sm outline-none"
                            style={{ borderColor: colors.line, color: colors.ink }}
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span style={{ color: colors.muted }} className="text-[11px]">
                            雙人套房
                          </span>
                          <input
                            type="number"
                            min={0}
                            value={editRequest.roomOverride?.doubleSuiteCount ?? 0}
                            onChange={(e) => updateEditRoomOverride("doubleSuiteCount", Number(e.target.value))}
                            className="w-full border-b bg-transparent py-1 text-sm outline-none"
                            style={{ borderColor: colors.line, color: colors.ink }}
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span style={{ color: colors.muted }} className="text-[11px]">
                            雙人雅房
                          </span>
                          <input
                            type="number"
                            min={0}
                            value={editRequest.roomOverride?.doublePlainCount ?? 0}
                            onChange={(e) => updateEditRoomOverride("doublePlainCount", Number(e.target.value))}
                            className="w-full border-b bg-transparent py-1 text-sm outline-none"
                            style={{ borderColor: colors.line, color: colors.ink }}
                          />
                        </label>
                      </div>
                    </div>

                    <div>
                      <p style={{ color: colors.muted }} className="mb-1 text-[11px] tracking-wide">
                        額外服務
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="flex flex-col gap-1">
                          <span style={{ color: colors.muted }} className="text-[11px]">
                            加固定床
                          </span>
                          <input
                            type="number"
                            min={0}
                            value={editRequest.extraBedFixedQty ?? 0}
                            onChange={(e) => updateEditRequestField("extraBedFixedQty", Number(e.target.value))}
                            className="w-full border-b bg-transparent py-1 text-sm outline-none"
                            style={{ borderColor: colors.line, color: colors.ink }}
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span style={{ color: colors.muted }} className="text-[11px]">
                            加臨時床
                          </span>
                          <input
                            type="number"
                            min={0}
                            value={editRequest.extraBedTempQty ?? 0}
                            onChange={(e) => updateEditRequestField("extraBedTempQty", Number(e.target.value))}
                            className="w-full border-b bg-transparent py-1 text-sm outline-none"
                            style={{ borderColor: colors.line, color: colors.ink }}
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span style={{ color: colors.muted }} className="text-[11px]">
                            加開房間
                          </span>
                          <input
                            type="number"
                            min={0}
                            value={editRequest.extraRoomQty ?? 0}
                            onChange={(e) => updateEditRequestField("extraRoomQty", Number(e.target.value))}
                            className="w-full border-b bg-transparent py-1 text-sm outline-none"
                            style={{ borderColor: colors.line, color: colors.ink }}
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span style={{ color: colors.muted }} className="text-[11px]">
                            訪客人數
                          </span>
                          <input
                            type="number"
                            min={0}
                            value={editRequest.visitorQty ?? 0}
                            onChange={(e) => updateEditRequestField("visitorQty", Number(e.target.value))}
                            className="w-full border-b bg-transparent py-1 text-sm outline-none"
                            style={{ borderColor: colors.line, color: colors.ink }}
                          />
                        </label>
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

                    <label className="flex flex-col gap-1">
                      <span style={{ color: colors.muted }} className="text-[11px]">
                        優惠折扣（金額，直接從總費用扣除）
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={editRequest.discountAmount ?? 0}
                        onChange={(e) => updateEditRequestField("discountAmount", Number(e.target.value))}
                        className="w-full border-b bg-transparent py-1 text-sm outline-none"
                        style={{ borderColor: colors.line, color: colors.ink }}
                      />
                    </label>

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

                {isConfirmed ? (
                  confirmedReservationNo && (
                    <p
                      className="mt-4 border-l-2 pl-3 text-xs leading-relaxed"
                      style={{ borderColor: colors.pine, color: colors.pine }}
                    >
                      ✓ 已確認訂房，訂房編號：{confirmedReservationNo}
                    </p>
                  )
                ) : (
                  <>
                    {/* 確認訂房前才收集的資料：姓名/訂房來源/付款狀況/發票/
                        加臨時床房號，直接接在摘要卡片下面，不用先滑過
                        一整份完整報價內容才看得到。電話欄位拿掉了——
                        實務上都是用 LINE 官方帳號聯絡客人，不特別留
                        電話號碼。 */}
                    <div className="mt-5 flex flex-col gap-4">
                      <p className="text-xs font-bold" style={{ color: colors.blue }}>
                        客人確認訂房後填寫
                      </p>

                      <label className="flex flex-col gap-1">
                        <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                          客人姓名
                        </span>
                        <input
                          type="text"
                          value={confirmGuestName}
                          onChange={(e) => setConfirmGuestName(e.target.value)}
                          className="w-full border-b bg-transparent py-1 text-sm outline-none"
                          style={{ borderColor: colors.line, color: colors.ink }}
                        />
                      </label>

                      <label className="flex flex-col gap-1">
                        <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                          客戶來源
                        </span>
                        <select
                          value={confirmBookingSource}
                          onChange={(e) => setConfirmBookingSource(e.target.value as BookingSource)}
                          className="w-full border-b bg-transparent py-1 text-sm outline-none"
                          style={{ borderColor: colors.line, color: colors.ink }}
                        >
                          {BOOKING_SOURCE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <div className="grid grid-cols-2 gap-4">
                        <label className="flex flex-col gap-1">
                          <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                            付款狀況
                          </span>
                          <select
                            value={confirmPaymentStatus}
                            onChange={(e) => setConfirmPaymentStatus(e.target.value)}
                            className="w-full border-b bg-transparent py-1 text-sm outline-none"
                            style={{ borderColor: colors.line, color: colors.ink }}
                          >
                            {Object.entries(CONFIRM_PAYMENT_STATUS_LABEL).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                        {confirmPaymentStatus !== "pending_deposit" && (
                          <label className="flex flex-col gap-1">
                            <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                              實收訂金金額
                            </span>
                            <input
                              type="number"
                              min={0}
                              value={confirmDepositAmount}
                              onChange={(e) => setConfirmDepositAmount(e.target.value)}
                              className="w-full border-b bg-transparent py-1 text-sm outline-none"
                              style={{ borderColor: colors.line, color: colors.ink }}
                            />
                          </label>
                        )}
                      </div>

                      {selectedQuote.request.invoice?.required && (
                        <div className="grid grid-cols-2 gap-4">
                          <label className="flex flex-col gap-1">
                            <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                              發票抬頭
                            </span>
                            <input
                              type="text"
                              value={confirmInvoiceTitle}
                              onChange={(e) => setConfirmInvoiceTitle(e.target.value)}
                              className="w-full border-b bg-transparent py-1 text-sm outline-none"
                              style={{ borderColor: colors.line, color: colors.ink }}
                            />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                              統一編號
                            </span>
                            <input
                              type="text"
                              value={confirmInvoiceTaxId}
                              onChange={(e) => setConfirmInvoiceTaxId(e.target.value)}
                              className="w-full border-b bg-transparent py-1 text-sm outline-none"
                              style={{ borderColor: colors.line, color: colors.ink }}
                            />
                          </label>
                        </div>
                      )}

                      {(selectedQuote.request.extraBedTempQty ?? 0) > 0 && (
                        <div>
                          <p style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                            加臨時床房號（請勾選 {selectedQuote.request.extraBedTempQty} 間）
                          </p>
                          {extraBedRoomOptions.length === 0 ? (
                            <p className="mt-1 text-[11px]" style={{ color: colors.alert }}>
                              這間民宿沒有設定可加床的房號，請直接跟房務確認
                            </p>
                          ) : (
                            <div className="mt-1 flex flex-wrap gap-2">
                              {extraBedRoomOptions.map((room) => {
                                const active = selectedExtraBedRoomIds.includes(room.id);
                                return (
                                  <button
                                    key={room.id}
                                    type="button"
                                    onClick={() => toggleExtraBedRoom(room.id)}
                                    className="rounded-full border px-3 py-1.5 text-xs transition-colors"
                                    style={
                                      active
                                        ? { borderColor: colors.pine, backgroundColor: colors.pine, color: colors.pineText }
                                        : { borderColor: colors.line, backgroundColor: "transparent", color: colors.ink }
                                    }
                                  >
                                    {room.code}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={handleConfirmReservation}
                        disabled={isConfirming}
                        className="w-full py-2.5 text-xs tracking-wide transition-opacity disabled:opacity-50"
                        style={{ backgroundColor: colors.pine, color: colors.pineText }}
                      >
                        {isConfirming ? "確認中…" : "確認轉為訂房記錄"}
                      </button>
                    </div>
                  </>
                )}

                {/* 已確認訂房才會有這兩個按鈕：複製真正的訂房確認內容、
                    轉成圖片分享給客人——放在「顯示完整報價內容」上面，
                    不用先展開那一大串內容才找得到 */}
                {isConfirmed && confirmedDetail && (
                  <div className="mt-5 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={handleCopyConfirmation}
                      className="w-full border py-2.5 text-xs tracking-wide transition-colors"
                      style={
                        copied
                          ? { borderColor: colors.pine, backgroundColor: colors.pine, color: colors.pineText }
                          : { borderColor: colors.line, backgroundColor: "transparent", color: colors.ink }
                      }
                    >
                      {copied ? "已複製 ✓" : "複製訂房確認內容"}
                    </button>
                    <button
                      type="button"
                      onClick={handleShareConfirmationImage}
                      disabled={imageWorking}
                      className="w-full border py-2.5 text-xs tracking-wide transition-colors disabled:opacity-50"
                      style={{ borderColor: colors.line, backgroundColor: "transparent", color: colors.ink }}
                    >
                      {imageWorking ? "圖片產生中…" : "🖼️ 訂單圖片"}
                    </button>
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

                {/* 完整報價內容預設收起來，只有要複製文字/轉圖片分享給
                    客人的時候才需要展開 */}
                <button
                  type="button"
                  onClick={() => setShowFullReceipt((v) => !v)}
                  className="mt-5 text-xs"
                  style={{ color: colors.blue }}
                >
                  {showFullReceipt ? "收起完整報價內容 ▲" : "顯示完整報價內容（可複製文字）▼"}
                </button>

                {showFullReceipt && (
                  <>
                    <QuoteReceiptCard quote={selectedQuote} createdAt={selectedQuoteCreatedAt} isConfirmed={isConfirmed} />

                    {!isConfirmed && (
                      <button
                        type="button"
                        onClick={handleCopy}
                        className="mt-5 w-full border py-2.5 text-xs tracking-wide transition-colors"
                        style={
                          copied
                            ? { borderColor: colors.pine, backgroundColor: colors.pine, color: colors.pineText }
                            : { borderColor: colors.line, backgroundColor: "transparent", color: colors.ink }
                        }
                      >
                        {copied ? "已複製 ✓" : "複製報價內容"}
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
