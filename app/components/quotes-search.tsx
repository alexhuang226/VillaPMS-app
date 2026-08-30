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

import { useRef, useState } from "react";
import Link from "next/link";
import { Fraunces, Work_Sans } from "next/font/google";
import {
  calculateQuoteAction,
  clearOldQuotesAction,
  confirmReservationFromQuoteAction,
  getExtraBedRoomOptionsAction,
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
  const now = new Date();
  const [calendarYear, setCalendarYear] = useState(now.getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(now.getMonth() + 1);
  const [checkInDate, setCheckInDate] = useState("");
  const [results, setResults] = useState<QuoteSummary[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
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
  const [confirmGuestPhone, setConfirmGuestPhone] = useState("");
  const [confirmBookingSource, setConfirmBookingSource] = useState<BookingSource>("line_official");
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
        });
        setResults(rows);
      }
    } catch (err) {
      setClearError(err instanceof Error ? err.message : "清除失敗，請稍後再試");
    } finally {
      setIsClearing(false);
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
        guestPhone: confirmGuestPhone.trim() || undefined,
        bookingSource: confirmBookingSource,
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
      const text = await buildReservationConfirmationMessageAction(confirmedReservationId);
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "複製失敗，請稍後再試");
    }
  }

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

        {!selectedId && (
          <div className="mb-4">
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
                            客人電話（選填）
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
                      {imageWorking ? "圖片產生中…" : "🖼️ 轉成圖片"}
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

                    {/* 隱藏的訂房確認單卡片，只用來截圖產生分享用的圖片 */}
                    <div style={{ position: "fixed", top: 0, left: "-9999px" }}>
                      <div
                        ref={confirmationCardRef}
                        className={body.className}
                        style={{ width: "375px", backgroundColor: colors.canvas }}
                      >
                        <div className="px-6 py-6 text-center" style={{ backgroundColor: colors.pine }}>
                          <p className={`${display.className} text-2xl italic`} style={{ color: colors.pineText }}>
                            🏨 【{confirmedDetail.propertyName}訂房確認單】
                          </p>
                        </div>
                        <div className="px-6 py-5 text-xs leading-relaxed" style={{ color: colors.ink }}>
                          <p style={{ color: colors.pine }}>
                            ✅ 已收到訂金匯款，訂房已確認，期待您的光臨！請查看下方訂房資料是否正確哦~
                          </p>
                          <p className="mt-3" style={{ color: colors.muted }}>
                            ━━━━━━━━━━━━━━
                          </p>
                          <p className="mt-2 font-bold">📅 預訂資訊</p>
                          <p className="mt-1">• 入住日期：{formatSlashDate(confirmedDetail.checkIn)} (15:00後)</p>
                          <p>• 退房日期：{formatSlashDate(confirmedDetail.checkOut)} (11:00前)</p>
                          <p>• 預訂天數：{nightsLabel(confirmedDetail.checkIn, confirmedDetail.checkOut)}</p>
                          <p>
                            • 入住人數：{confirmedDetail.adults}大
                            {confirmedDetail.children ? ` ${confirmedDetail.children}小` : ""}
                            {confirmedDetail.infants ? ` ${confirmedDetail.infants}幼` : ""}
                            {confirmedDetail.pets ? ` ${confirmedDetail.pets}寵` : ""}
                          </p>
                          <p>
                            • 使用房數：
                            {confirmedDetail.roomAllocation.fourPersonSuiteCount +
                              confirmedDetail.roomAllocation.fourPersonDowngradeCount +
                              confirmedDetail.roomAllocation.doubleSuiteCount +
                              confirmedDetail.roomAllocation.doublePlainCount}{" "}
                            間房
                          </p>
                          <p className="mt-2" style={{ color: colors.muted }}>
                            ━━━━━━━━━━━━━━
                          </p>
                          <p className="mt-2 font-bold">💰 帳務明細</p>
                          <p className="mt-1">• 住宿總額：${confirmedDetail.finalTotal.toLocaleString()}元</p>
                          {(() => {
                            const depositPayment = confirmedDetail.payments.find((p) => p.paymentKind === "deposit");
                            const balancePayment = confirmedDetail.payments.find((p) => p.paymentKind === "balance");
                            return (
                              <>
                                <p>
                                  • 訂金已付：${(depositPayment?.amount ?? 0).toLocaleString()} 元
                                  {depositPayment?.paidAt
                                    ? ` (收到日期：${depositPayment.paidAt.slice(5, 10).replace("-", "/")})`
                                    : ""}
                                </p>
                                {balancePayment && (
                                  <>
                                    <p>• 剩餘尾款：${balancePayment.amount.toLocaleString()}元</p>
                                    <p>⚠️ 尾款請於入住前一星期匯款。</p>
                                  </>
                                )}
                              </>
                            );
                          })()}
                          <p className="mt-2" style={{ color: colors.muted }}>
                            ━━━━━━━━━━━━━━
                          </p>
                          <p className="font-bold">【重要提醒】</p>
                          <p className="mt-1">1. 入住前 7 天匯尾款前, 將依最終確認人數，按照 [平旺日/假日] 之計費標準重新核算。</p>
                          <p>2. 若結算人數低於基本人數將視房型開放對應間數；達全額人數則開放全棟房數。</p>
                          <p>3. 入住一個月內，恕不接受日期變更或取消。</p>
                          <p>4. 在入住前一週會發送【入住提醒】；當天會發送【入住須知】及【設備使用說明】。</p>
                          <p>5. 室內全面禁菸；22:00 後請降低音量維護鄰里安寧。</p>
                          <p className="mt-2" style={{ color: colors.muted }}>
                            ━━━━━━━━━━━━━━
                          </p>
                          {confirmedDetail.propertyAddress && <p className="mt-2">📍 民宿地址：{confirmedDetail.propertyAddress}</p>}
                          {confirmedDetail.parkingInfo && <p>🅿️ 停車資訊：{confirmedDetail.parkingInfo}</p>}
                          {confirmedDetail.mapUrl && <p>🗺️ 導航連結：{confirmedDetail.mapUrl}</p>}
                        </div>
                      </div>
                    </div>
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
