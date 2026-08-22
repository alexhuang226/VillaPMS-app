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

import { useState } from "react";
import Link from "next/link";
import { Fraunces, Work_Sans } from "next/font/google";
import {
  clearOldQuotesAction,
  confirmReservationFromQuoteAction,
  getExtraBedRoomOptionsAction,
  getReservationNoForQuoteAction,
  getSavedQuoteAction,
  searchQuotesAction,
} from "@/app/actions/quote";
import type { BookingSource } from "@/app/actions/quote";
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
  daysNightsLabel,
  formatDateWithWeekday,
  guestSummary,
  INFANT_NOTE,
  roomAllocationSummaryItems,
} from "@/lib/pricing/quote-message";
import type { ExtraBedRoomOption, QuoteSummary } from "@/lib/pricing/queries";
import type { PackageQuote } from "@/lib/pricing/types";

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

function ReceiptSectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="mt-5 mb-2 flex items-center gap-2 border-t pt-4" style={{ borderColor: colors.line }}>
      <span className="text-base leading-none">{icon}</span>
      <span className="text-sm font-bold tracking-wide" style={{ color: colors.ink }}>
        {title}
      </span>
    </div>
  );
}

export function QuotesSearch() {
  const [checkInDate, setCheckInDate] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState<QuoteSummary[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [selectedQuote, setSelectedQuote] = useState<PackageQuote | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // 這些都是「確認訂房」這個階段才收集的資料，報價階段沒有問過
  const [confirmGuestName, setConfirmGuestName] = useState("");
  const [confirmGuestPhone, setConfirmGuestPhone] = useState("");
  const [confirmBookingSource, setConfirmBookingSource] = useState<BookingSource>("line_official");
  const [confirmInvoiceTitle, setConfirmInvoiceTitle] = useState("");
  const [confirmInvoiceTaxId, setConfirmInvoiceTaxId] = useState("");
  const [extraBedRoomOptions, setExtraBedRoomOptions] = useState<ExtraBedRoomOption[]>([]);
  const [selectedExtraBedRoomIds, setSelectedExtraBedRoomIds] = useState<string[]>([]);

  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmedReservationNo, setConfirmedReservationNo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // 展開查看完整報價內容（複製/轉圖片用）——預設不顯示，避免每次
  // 點一筆報價都要滑過一大串內容才看得到確認訂房的按鈕
  const [showFullReceipt, setShowFullReceipt] = useState(false);

  // 清除舊報價記錄用
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [clearResultMessage, setClearResultMessage] = useState<string | null>(null);
  const [clearError, setClearError] = useState<string | null>(null);

  async function handleClearOldQuotes() {
    setIsClearing(true);
    setClearError(null);
    setClearResultMessage(null);

    try {
      const { deletedCount } = await clearOldQuotesAction();
      setClearResultMessage(`已清除 ${deletedCount} 筆今天以前的報價記錄`);
      setShowClearConfirm(false);
      // 如果目前畫面上有查詢結果，順便重新查一次，避免列表裡還顯示
      // 剛剛已經被刪掉的記錄
      if (results) {
        const rows = await searchQuotesAction({
          checkInDate: checkInDate || undefined,
          search: searchTerm || undefined,
        });
        setResults(rows);
      }
    } catch (err) {
      setClearError(err instanceof Error ? err.message : "清除失敗，請稍後再試");
    } finally {
      setIsClearing(false);
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setIsSearching(true);
    setSearchError(null);
    setResults(null);
    setSelectedId(null);
    setSelectedQuote(null);

    try {
      const rows = await searchQuotesAction({
        checkInDate: checkInDate || undefined,
        search: searchTerm || undefined,
      });
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
    setDetailError(null);
    setConfirmedReservationNo(null);
    setCopied(false);
    setShowFullReceipt(false);
    setConfirmGuestName("");
    setConfirmGuestPhone("");
    setConfirmBookingSource("line_official");
    setConfirmInvoiceTitle("");
    setConfirmInvoiceTaxId("");
    setExtraBedRoomOptions([]);
    setSelectedExtraBedRoomIds([]);
    setIsLoadingDetail(true);

    try {
      const saved = await getSavedQuoteAction(row.id);
      if (!saved) {
        setDetailError("找不到這張報價單的完整內容，可能是舊資料沒有存快照");
        return;
      }
      setSelectedQuote(saved.quote);
      setSelectedStatus(saved.status);

      if (saved.status === "accepted") {
        // 已經確認過訂房了，查出實際的訂房編號顯示給使用者看，不用
        // 再走一次確認流程
        const reservationNo = await getReservationNoForQuoteAction(row.id);
        setConfirmedReservationNo(reservationNo);
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

    if (!confirmGuestName.trim() || !confirmGuestPhone.trim()) {
      setDetailError("請先填寫客人姓名與電話再確認訂房");
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

      const { reservationNo } = await confirmReservationFromQuoteAction(selectedId, {
        guestName: confirmGuestName.trim(),
        guestPhone: confirmGuestPhone.trim(),
        bookingSource: confirmBookingSource,
        invoiceTitle: selectedQuote.request.invoice?.required ? confirmInvoiceTitle.trim() : undefined,
        invoiceTaxId: selectedQuote.request.invoice?.required ? confirmInvoiceTaxId.trim() : undefined,
        extraBedTempRoomCodes: extraBedTempRoomCodes.length > 0 ? extraBedTempRoomCodes : undefined,
      });
      setConfirmedReservationNo(reservationNo);
      setSelectedStatus("accepted");
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "確認訂房失敗，請稍後再試");
    } finally {
      setIsConfirming(false);
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

  const isConfirmed = selectedStatus === "accepted" || Boolean(confirmedReservationNo);

  return (
    <div className={`${body.className} flex min-h-screen w-full justify-center px-5 py-8`} style={{ backgroundColor: colors.canvas }}>
      <div className="w-full" style={{ maxWidth: "24rem", color: colors.ink }}>
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

        <form onSubmit={handleSearch} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
              入住日期（最常用，直接選日期查最快）
            </span>
            <input
              type="date"
              value={checkInDate}
              onChange={(e) => setCheckInDate(e.target.value)}
              className="w-full border-b bg-transparent py-1.5 text-sm outline-none"
              style={{ borderColor: colors.line, color: colors.ink }}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
              客人姓名／電話／報價單編號（選填，可以跟上面日期一起縮小範圍）
            </span>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full border-b bg-transparent py-1.5 text-sm outline-none"
              style={{ borderColor: colors.line, color: colors.ink }}
            />
          </label>

          <button
            type="submit"
            disabled={isSearching}
            className="w-full py-2 text-xs tracking-wide disabled:opacity-50"
            style={{ backgroundColor: colors.pine, color: colors.pineText }}
          >
            {isSearching ? "查詢中" : "確定"}
          </button>
        </form>

        {!selectedId && (
          <div className="mt-4">
            {!showClearConfirm ? (
              <button type="button" onClick={() => setShowClearConfirm(true)} className="text-xs" style={{ color: colors.alert }}>
                清除報價記錄
              </button>
            ) : (
              <div className="border-l-2 pl-3" style={{ borderColor: colors.alert }}>
                <p className="text-xs leading-relaxed" style={{ color: colors.alert }}>
                  確定要刪除今天以前的所有報價記錄嗎？不管有沒有確認訂房都會刪除（已確認訂房的正式記錄本身不受影響，只是報價單本身查不到了），此動作無法復原。
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
                className="border p-3 text-left text-xs transition-colors"
                style={{ borderColor: colors.line, color: colors.ink }}
              >
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
                    {/* 確認訂房前才收集的資料：姓名/電話/訂房來源/發票/
                        加臨時床房號，直接接在摘要卡片下面，不用先滑過
                        一整份完整報價內容才看得到 */}
                    <div className="mt-5 flex flex-col gap-4">
                      <p className="text-xs font-bold" style={{ color: colors.blue }}>
                        客人確認訂房後填寫
                      </p>

                      <div className="grid grid-cols-2 gap-4">
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
                            客人電話
                          </span>
                          <input
                            type="tel"
                            value={confirmGuestPhone}
                            onChange={(e) => setConfirmGuestPhone(e.target.value)}
                            className="w-full border-b bg-transparent py-1 text-sm outline-none"
                            style={{ borderColor: colors.line, color: colors.ink }}
                          />
                        </label>
                      </div>

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
                    <div className="mt-4 overflow-hidden" style={{ backgroundColor: colors.surface, border: `1px solid ${colors.line}` }}>
                      <div className="px-6 py-6 text-center" style={{ backgroundColor: colors.pine }}>
                        <p className={`${display.className} text-3xl italic`} style={{ color: colors.pineText }}>
                          {`${selectedQuote.messageContext.propertyName}私人會所`}
                        </p>
                        <p className="mt-1 tracking-[0.3em]" style={{ color: colors.pineSoft, fontSize: "16px" }}>
                          {isConfirmed ? "訂房確認單" : "包棟報價單"}
                        </p>
                      </div>

                      <div className="px-6 py-5" style={{ color: colors.ink }}>
                        <ReceiptSectionHeader icon="📅" title="預訂資訊" />
                        <div className="flex flex-col gap-1.5 text-xs">
                          <InfoRow label="入住日期" value={formatDateWithWeekday(selectedQuote.request.checkIn)} />
                          <InfoRow label="退房日期" value={formatDateWithWeekday(selectedQuote.request.checkOut)} />
                          <InfoRow label="預訂天數" value={daysNightsLabel(selectedQuote.nights)} />
                          <InfoRow label="入住人數" value={guestSummary(selectedQuote)} />
                          {roomAllocationSummaryItems(selectedQuote.roomAllocation).map((item, i) => (
                            <InfoRow key={`room-${i}`} label={i === 0 ? "房型配置" : ""} value={item.text} />
                          ))}
                          {addOnSummaryItems(selectedQuote).map((item, i) => (
                            <InfoRow key={`addon-${i}`} label={i === 0 ? "額外項目" : ""} value={item} />
                          ))}
                        </div>

                        <ReceiptSectionHeader icon="💰" title="費用明細" />
                        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 gap-y-1.5 text-xs" style={{ color: colors.muted }}>
                          {accommodationDayGroups(selectedQuote).map((group, gi) => (
                            <div key={`day-${gi}`} className="contents">
                              {group.dateLabel && (
                                <p className="col-span-4 mt-1 first:mt-0" style={{ color: colors.ink }}>
                                  {group.dateLabel}
                                </p>
                              )}
                              {group.items.map((item, i) => (
                                <div key={i} className="contents">
                                  <span className={group.dateLabel ? "pl-3" : undefined}>{item.roomLabel}</span>
                                  <span className="text-right tabular-nums">
                                    NT${item.unitPrice.toLocaleString()}×{item.qty}
                                  </span>
                                  <span>=</span>
                                  <span className="text-right tabular-nums">NT${item.lineTotal.toLocaleString()}</span>
                                </div>
                              ))}
                            </div>
                          ))}
                          {addOnFeeBreakdown(selectedQuote).map((item, i) => (
                            <div key={`fee-${i}`} className="contents">
                              <span>{item.label}</span>
                              <span />
                              <span />
                              <span className="text-right tabular-nums">NT${item.amount.toLocaleString()}</span>
                            </div>
                          ))}
                          {selectedQuote.discountAmount > 0 && (
                            <div className="contents">
                              <span>優惠折扣</span>
                              <span />
                              <span />
                              <span className="text-right tabular-nums">－NT${selectedQuote.discountAmount.toLocaleString()}</span>
                            </div>
                          )}
                          {selectedQuote.invoiceTaxAmount > 0 && (
                            <div className="contents">
                              <span>發票稅金(8%)</span>
                              <span />
                              <span />
                              <span className="text-right tabular-nums">NT${selectedQuote.invoiceTaxAmount.toLocaleString()}</span>
                            </div>
                          )}
                        </div>

                        <div className="mt-4 rounded-sm px-4 py-4" style={{ backgroundColor: colors.pineSoft }}>
                          <p className="text-[11px] tracking-wide" style={{ color: colors.muted }}>
                            包棟總費用
                          </p>
                          <p className={`${display.className} text-4xl italic`} style={{ color: colors.pine }}>
                            NT$ {selectedQuote.packageTotal.toLocaleString()}
                          </p>
                          <div className="mt-3 flex items-baseline justify-between border-t pt-2" style={{ borderColor: colors.line }}>
                            <span style={{ color: colors.muted }} className="text-xs tracking-wide">
                              訂金
                            </span>
                            <span style={{ color: colors.ink }} className="text-sm font-semibold">
                              NT$ {selectedQuote.deposit.toLocaleString()}
                            </span>
                          </div>
                          <div className="mt-1 flex items-baseline justify-between">
                            <span style={{ color: colors.muted }} className="text-xs tracking-wide">
                              尾款(入住前 1 週匯款)
                            </span>
                            <span style={{ color: colors.ink }} className="text-sm font-semibold">
                              NT$ {selectedQuote.balanceDue.toLocaleString()}
                            </span>
                          </div>
                        </div>

                        {selectedQuote.messageContext.bank && (
                          <>
                            <ReceiptSectionHeader icon="🏦" title="匯款帳號" />
                            <div className="flex flex-col gap-2 text-base font-semibold">
                              <InfoRow label="銀行" value={selectedQuote.messageContext.bank.name} />
                              <InfoRow label="分行" value={selectedQuote.messageContext.bank.branch} />
                              <InfoRow label="帳號" value={selectedQuote.messageContext.bank.accountNumber} />
                              <InfoRow label="戶名" value={selectedQuote.messageContext.bank.accountName} />
                            </div>
                            <p className="mt-2 text-xs font-semibold leading-relaxed" style={{ color: colors.alert }}>
                              ⚠️ {BANK_TRANSFER_NOTE}
                            </p>
                          </>
                        )}

                        <ReceiptSectionHeader icon="📝" title="預訂須知" />
                        <div className="flex flex-col gap-3 text-[11px] leading-relaxed" style={{ color: colors.muted }}>
                          {baseGuestsReminderItems(selectedQuote).length > 0 && (
                            <div>
                              <p>
                                {BASE_GUESTS_ICON} 包棟基本人數(未達以低消計)：
                              </p>
                              {baseGuestsReminderItems(selectedQuote).map((item, i) => (
                                <p key={i}>
                                  ・{item.label}({item.note})：{item.required} 人
                                </p>
                              ))}
                              <p>{INFANT_NOTE}</p>
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
                      {copied ? "已複製 ✓" : `複製${isConfirmed ? "訂房確認" : "報價"}內容`}
                    </button>
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
