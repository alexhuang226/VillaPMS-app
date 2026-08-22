"use client";

/**
 * 訂單查詢 — 日曆檢視
 *
 * 傳統月曆版面：一個畫面顯示完整一個月，一列一週（週日~週六 7 欄）。
 * 日期數字下面，每個民宿各自固定一條色帶（同一民宿永遠同一個位置，
 * 一眼就能認出是哪間），連續訂房會畫成一條連續色塊橫跨整段入住
 * 期間（只在「週」的邊界會斷開重畫一段，這是月曆版面的常見取捨，
 * 週內一定是連續的）。色塊上如果有 ⚠️，就是「這個民宿、這筆訂單」
 * 尾款還沒收到——⚠️ 直接畫在該筆訂單自己的色塊上，不會混淆是哪
 * 一間民宿。點色塊直接展開該筆訂單的完整詳細內容，不會有「兩天的
 * 同一筆訂房被當成兩筆」的問題（因為色塊本身就代表單一筆訂單，
 * 不是先聚合成「這天有哪些訂單」的中間清單）。
 *
 * （最早一版是「橫軸整個月、縱軸三間民宿」的整月甘特圖，色塊用
 * gridRow:1 強制定位、背景格子走自動排版，兩者疊圖邏輯脆弱，出現過
 * 異常空白列的問題。這版把甘特圖的邏輯「縮小範圍到一週」重新做，
 * 保留「同一民宿固定一條色帶、連續訂房畫成連續色塊」的優點，但每週
 * 各自是獨立的小 grid，不會再有跨整月排版出錯的問題。）
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Fraunces, Work_Sans } from "next/font/google";
import { buildReservationConfirmationMessageAction, getCalendarReservationsAction, getReservationDetailAction, updateReservationAction } from "@/app/actions/reservation";
import type { CalendarReservation, ReservationDetail, ReservationUpdateFields } from "@/lib/pricing/queries";

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
  ink: "#221F1B",
  muted: "#57514A",
  line: "#D9D1C4",
  pine: "#33422E",
  pineSoft: "#E7EAE1",
  pineText: "#FFFFFF",
  alert: "#A23E2D",
  blue: "#2455A4",
  gold: "#A67C3D",
};

const PROPERTIES = [
  // 只此清綠原本用跟按鈕/標頭一樣的深綠（colors.pine），色塊太小
  // 一塊時顏色太深、不容易看清楚，這裡另外用一個淺一點的綠。
  // 陌隱／水景璞堤的顏色互換（原本陌隱藍、水景璞堤金，改成陌隱金、
  // 水景璞堤藍）。
  { code: "zhici", label: "只此清綠", color: "#5C7A4A" },
  { code: "moyin", label: "陌隱", color: colors.gold },
  { code: "shuijing", label: "水景璞堤", color: colors.blue },
];

const STATUS_LABEL: Record<string, string> = {
  confirmed: "已確認",
  checked_in: "已入住",
  checked_out: "已退房",
  cancelled: "已取消",
  no_show: "未到",
};
const BOOKING_SOURCE_LABEL: Record<string, string> = {
  line_official: "LINE官方",
  airbnb: "Airbnb",
  walk_in: "現場",
  phone: "電話",
  other_ota: "其他OTA",
  other: "其他",
};
const PAYMENT_KIND_LABEL: Record<string, string> = {
  deposit: "訂金",
  balance: "尾款",
  security_deposit: "保證金",
  adjustment: "調整款",
  refund: "退款",
};
const PAYMENT_STATUS_LABEL: Record<string, string> = {
  pending: "未收",
  paid: "已收",
  void: "作廢",
  refunded: "已退款",
};

const WEEKDAY_HEADERS = ["日", "一", "二", "三", "四", "五", "六"];

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function monthLabel(year: number, month: number): string {
  return `${year} 年 ${month} 月`;
}

/** month 是 1-12 */
function formatYMD(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 這個月第一天是星期幾（0=週日），用來決定月曆第一週要空幾格 */
function firstWeekdayOfMonth(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

/** 'YYYY-MM-DD' 字串加一天，全程用 UTC 運算避免時區造成的位移
 * （原因見 quote-form.tsx 的 addOneDay 說明，這裡沿用同樣的寫法） */
function addOneDayToYMD(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

interface WeekBarSegment {
  reservation: CalendarReservation;
  startCol: number; // 1-7，這筆訂單在這一週最早出現的欄位
  endCol: number; // 1-7，這筆訂單在這一週最晚出現的欄位（含）
  isActualStart: boolean; // 入住當天是不是落在這一週（是的話色塊左邊要畫圓角）
  isActualEnd: boolean; // 最後一晚是不是落在這一週（是的話色塊右邊要畫圓角）
}

/**
 * 算出某個民宿在「這一週」裡，每一筆訂單的色塊要畫在第幾欄到第幾欄。
 * week 是這一週 7 天的日期數字（該月範圍外的格子是 null）。
 */
function computeWeekSegments(
  week: (number | null)[],
  year: number,
  month: number,
  propertyReservations: CalendarReservation[]
): WeekBarSegment[] {
  const segments: WeekBarSegment[] = [];

  for (const res of propertyReservations) {
    let startCol = -1;
    let endCol = -1;

    for (let col = 0; col < 7; col++) {
      const day = week[col];
      if (day === null) continue;
      const dateStr = formatYMD(year, month, day);
      const activeThisDay = res.checkIn <= dateStr && dateStr < res.checkOut;
      if (activeThisDay) {
        if (startCol === -1) startCol = col + 1;
        endCol = col + 1;
      }
    }

    if (startCol === -1) continue; // 這週完全沒有這筆訂單的入住天數

    const startDay = week[startCol - 1] as number;
    const endDay = week[endCol - 1] as number;
    const isActualStart = formatYMD(year, month, startDay) === res.checkIn;
    const isActualEnd = addOneDayToYMD(formatYMD(year, month, endDay)) === res.checkOut;

    segments.push({ reservation: res, startCol, endCol, isActualStart, isActualEnd });
  }

  return segments;
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

export function ReservationsSearch() {
  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [reservations, setReservations] = useState<CalendarReservation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReservationDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  // 編輯模式：因應客人確認訂房後又變更人數或其他需求
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<ReservationUpdateFields | null>(null);

  // 年/月留到 mount 後才設定成「今天」，避免 SSR 跟 client 算出的
  // 「今天」不一樣造成 hydration 不一致的警告/閃爍（跟 quote-form.tsx
  // 入住日期預設值的處理方式一樣）。
  useEffect(() => {
    const now = new Date();
    setYear(now.getFullYear());
    setMonth(now.getMonth() + 1);
  }, []);

  useEffect(() => {
    if (year === null || month === null) return;
    let cancelled = false;

    setIsLoading(true);
    setError(null);
    getCalendarReservationsAction(year, month)
      .then((rows) => {
        if (!cancelled) setReservations(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "查詢失敗，請稍後再試");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [year, month]);

  function goToPrevMonth() {
    if (year === null || month === null) return;
    setSelectedId(null);
    if (month === 1) {
      setYear(year - 1);
      setMonth(12);
    } else {
      setMonth(month - 1);
    }
  }

  function goToNextMonth() {
    if (year === null || month === null) return;
    setSelectedId(null);
    if (month === 12) {
      setYear(year + 1);
      setMonth(1);
    } else {
      setMonth(month + 1);
    }
  }

  async function handleSelectReservation(res: CalendarReservation) {
    setSelectedId(res.id);
    setDetail(null);
    setDetailError(null);
    setCopied(false);
    setCopyError(null);
    setIsEditing(false);
    setEditError(null);
    setIsLoadingDetail(true);

    try {
      const result = await getReservationDetailAction(res.id);
      if (!result) {
        setDetailError("找不到這筆訂單的詳細內容");
        return;
      }
      setDetail(result);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "讀取訂單失敗，請稍後再試");
    } finally {
      setIsLoadingDetail(false);
    }
  }

  /** 開始編輯：用目前的訂單內容當作表單初始值 */
  function startEdit() {
    if (!detail) return;
    setEditError(null);
    setEditFields({
      checkIn: detail.checkIn,
      checkOut: detail.checkOut,
      adults: detail.adults,
      children: detail.children,
      infants: detail.infants,
      pets: detail.pets,
      visitors: detail.visitors,
      bookingSource: detail.bookingSource,
      status: detail.status,
      finalTotal: detail.finalTotal,
      needsInvoice: detail.needsInvoice,
      invoiceTitle: detail.invoiceTitle,
      invoiceTaxId: detail.invoiceTaxId,
      fourPersonSuiteCount: detail.roomAllocation.fourPersonSuiteCount,
      fourPersonDowngradeCount: detail.roomAllocation.fourPersonDowngradeCount,
      doubleSuiteCount: detail.roomAllocation.doubleSuiteCount,
      doublePlainCount: detail.roomAllocation.doublePlainCount,
    });
    setIsEditing(true);
  }

  function cancelEdit() {
    setIsEditing(false);
    setEditError(null);
    setEditFields(null);
  }

  function updateEditField<K extends keyof ReservationUpdateFields>(key: K, value: ReservationUpdateFields[K]) {
    setEditFields((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function saveEdit() {
    if (!selectedId || !editFields) return;
    setIsSaving(true);
    setEditError(null);

    try {
      await updateReservationAction(selectedId, editFields);
      // 存檔成功後重新讀一次訂單內容，確保畫面顯示的跟資料庫一致
      const result = await getReservationDetailAction(selectedId);
      if (result) setDetail(result);
      setIsEditing(false);
      setEditFields(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "儲存失敗，請稍後再試");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCopyConfirmation() {
    if (!selectedId) return;
    setCopyError(null);
    try {
      const text = await buildReservationConfirmationMessageAction(selectedId);
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : "複製失敗，請稍後再試");
    }
  }

  const daysInMonth = year !== null && month !== null ? getDaysInMonth(year, month) : 0;

  // 月曆格子：前面補上這個月第一天之前的空格，讓日期對齊正確的星期欄位
  const leadingBlanks = year !== null && month !== null ? firstWeekdayOfMonth(year, month) : 0;
  const totalCells = leadingBlanks + daysInMonth;
  const weeksCount = Math.ceil(totalCells / 7) || 0;
  const calendarCells: (number | null)[] = Array.from({ length: weeksCount * 7 }, (_, i) => {
    const day = i - leadingBlanks + 1;
    return day >= 1 && day <= daysInMonth ? day : null;
  });
  // 切成一週一列（7 個一組），每一列各自算色塊要畫在哪幾欄
  const weeks: (number | null)[][] = Array.from({ length: weeksCount }, (_, w) => calendarCells.slice(w * 7, w * 7 + 7));

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
            訂單查詢
          </h1>
        </header>

        <div className="flex items-center justify-between">
          <button type="button" onClick={goToPrevMonth} className="px-3 py-1 text-sm" style={{ color: colors.pine }}>
            ← 上個月
          </button>
          <p className={`${display.className} text-lg italic`}>
            {year !== null && month !== null ? monthLabel(year, month) : "…"}
          </p>
          <button type="button" onClick={goToNextMonth} className="px-3 py-1 text-sm" style={{ color: colors.pine }}>
            下個月 →
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-4 border-l-2 pl-3 text-xs leading-relaxed" style={{ borderColor: colors.alert, color: colors.alert }}>
            {error}
          </p>
        )}

        {isLoading && (
          <p className="mt-4 text-xs" style={{ color: colors.muted }}>
            讀取中…
          </p>
        )}

        {!isLoading && year !== null && month !== null && (
          <div className="mt-4">
            {/* 星期標題列 */}
            <div className="grid grid-cols-7 gap-1">
              {WEEKDAY_HEADERS.map((w) => (
                <div key={w} className="text-center text-[10px]" style={{ color: colors.muted }}>
                  {w}
                </div>
              ))}
            </div>

            {/* 月曆本體：一列一週。每週先是 7 個日期數字，接著三間民宿
                各一條固定色帶（同一民宿永遠同一條，不會跟其他民宿混在
                一起），連續訂房在同一週內會畫成一條連續色塊。 */}
            <div className="mt-1 flex flex-col gap-2">
              {weeks.map((week, weekIndex) => (
                <div key={weekIndex}>
                  <div className="grid grid-cols-7 gap-1">
                    {week.map((day, i) => (
                      <div key={i} className="text-center text-[10px]" style={{ color: day ? colors.ink : "transparent" }}>
                        {day ?? "·"}
                      </div>
                    ))}
                  </div>
                  <div className="mt-1 flex flex-col gap-[3px]">
                    {PROPERTIES.map((property) => {
                      const propertyReservations = reservations.filter((r) => r.propertyCode === property.code);
                      const segments = computeWeekSegments(week, year, month, propertyReservations);
                      return (
                        <div key={property.code} className="grid grid-cols-7 gap-1" style={{ height: "16px" }}>
                          {segments.map((seg) => (
                            <button
                              key={seg.reservation.id}
                              type="button"
                              onClick={() => handleSelectReservation(seg.reservation)}
                              className="flex items-center justify-center overflow-hidden whitespace-nowrap px-0.5 text-[8px] leading-none text-white"
                              style={{
                                gridColumnStart: seg.startCol,
                                gridColumnEnd: seg.endCol + 1,
                                backgroundColor: property.color,
                                borderTopLeftRadius: seg.isActualStart ? "8px" : 0,
                                borderBottomLeftRadius: seg.isActualStart ? "8px" : 0,
                                borderTopRightRadius: seg.isActualEnd ? "8px" : 0,
                                borderBottomRightRadius: seg.isActualEnd ? "8px" : 0,
                              }}
                            >
                              {property.label}
                              {seg.reservation.hasBbq ? "🍖" : ""}
                              {seg.reservation.balanceUnpaid ? " ⚠" : ""}
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {selectedId && (
          <div className="mt-6">
            <button
              type="button"
              onClick={() => {
                setSelectedId(null);
                setDetail(null);
              }}
              className="text-xs"
              style={{ color: colors.blue }}
            >
              ← 收起詳細內容
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

            {detail && (
              <div className="mt-4 border p-4" style={{ borderColor: colors.line }}>
                <div className="flex items-baseline justify-between">
                  <span className={`${display.className} text-xl italic`}>{detail.propertyName}</span>
                  {!isEditing && (
                    <button type="button" onClick={startEdit} className="text-xs" style={{ color: colors.blue }}>
                      編輯
                    </button>
                  )}
                </div>

                {isEditing && editFields ? (
                  <div className="mt-3 flex flex-col gap-3 text-xs">
                    <p className="text-[11px] leading-relaxed" style={{ color: colors.alert }}>
                      ⚠️ 改了入住/退房日期或房型配置後，「總金額」不會自動
                      重算（系統沒有存完整的原始報價條件，沒辦法像 /quote
                      那樣重新算出正確金額）。需要的話，另外開 /quote 用
                      同樣的條件重新試算一次，再把算出來的金額填到下面的
                      「總金額」欄位。
                    </p>

                    <div className="grid grid-cols-2 gap-3">
                      <label className="flex flex-col gap-1">
                        <span style={{ color: colors.muted }} className="text-[11px]">
                          入住日期
                        </span>
                        <input
                          type="date"
                          value={editFields.checkIn}
                          onChange={(e) => updateEditField("checkIn", e.target.value)}
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
                          value={editFields.checkOut}
                          onChange={(e) => updateEditField("checkOut", e.target.value)}
                          className="w-full border-b bg-transparent py-1 text-sm outline-none"
                          style={{ borderColor: colors.line, color: colors.ink }}
                        />
                      </label>
                    </div>

                    <div>
                      <p style={{ color: colors.muted }} className="text-[11px]">
                        房型配置
                      </p>
                      <div className="mt-1 grid grid-cols-2 gap-3">
                        <label className="flex flex-col gap-1">
                          <span style={{ color: colors.muted }} className="text-[11px]">
                            四人套房
                          </span>
                          <input
                            type="number"
                            min={0}
                            value={editFields.fourPersonSuiteCount}
                            onChange={(e) => updateEditField("fourPersonSuiteCount", Number(e.target.value))}
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
                            value={editFields.fourPersonDowngradeCount}
                            onChange={(e) => updateEditField("fourPersonDowngradeCount", Number(e.target.value))}
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
                            value={editFields.doubleSuiteCount}
                            onChange={(e) => updateEditField("doubleSuiteCount", Number(e.target.value))}
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
                            value={editFields.doublePlainCount}
                            onChange={(e) => updateEditField("doublePlainCount", Number(e.target.value))}
                            className="w-full border-b bg-transparent py-1 text-sm outline-none"
                            style={{ borderColor: colors.line, color: colors.ink }}
                          />
                        </label>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <label className="flex flex-col gap-1">
                        <span style={{ color: colors.muted }} className="text-[11px]">
                          大人
                        </span>
                        <input
                          type="number"
                          min={0}
                          value={editFields.adults}
                          onChange={(e) => updateEditField("adults", Number(e.target.value))}
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
                          value={editFields.children}
                          onChange={(e) => updateEditField("children", Number(e.target.value))}
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
                          value={editFields.infants}
                          onChange={(e) => updateEditField("infants", Number(e.target.value))}
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
                          value={editFields.pets}
                          onChange={(e) => updateEditField("pets", Number(e.target.value))}
                          className="w-full border-b bg-transparent py-1 text-sm outline-none"
                          style={{ borderColor: colors.line, color: colors.ink }}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span style={{ color: colors.muted }} className="text-[11px]">
                          訪客
                        </span>
                        <input
                          type="number"
                          min={0}
                          value={editFields.visitors}
                          onChange={(e) => updateEditField("visitors", Number(e.target.value))}
                          className="w-full border-b bg-transparent py-1 text-sm outline-none"
                          style={{ borderColor: colors.line, color: colors.ink }}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span style={{ color: colors.muted }} className="text-[11px]">
                          總金額
                        </span>
                        <input
                          type="number"
                          min={0}
                          value={editFields.finalTotal}
                          onChange={(e) => updateEditField("finalTotal", Number(e.target.value))}
                          className="w-full border-b bg-transparent py-1 text-sm outline-none"
                          style={{ borderColor: colors.line, color: colors.ink }}
                        />
                      </label>
                    </div>

                    <label className="flex flex-col gap-1">
                      <span style={{ color: colors.muted }} className="text-[11px]">
                        訂單狀態
                      </span>
                      <select
                        value={editFields.status}
                        onChange={(e) => updateEditField("status", e.target.value)}
                        className="w-full border-b bg-transparent py-1 text-sm outline-none"
                        style={{ borderColor: colors.line, color: colors.ink }}
                      >
                        {Object.entries(STATUS_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex flex-col gap-1">
                      <span style={{ color: colors.muted }} className="text-[11px]">
                        客戶來源
                      </span>
                      <select
                        value={editFields.bookingSource}
                        onChange={(e) => updateEditField("bookingSource", e.target.value)}
                        className="w-full border-b bg-transparent py-1 text-sm outline-none"
                        style={{ borderColor: colors.line, color: colors.ink }}
                      >
                        {Object.entries(BOOKING_SOURCE_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={editFields.needsInvoice}
                        onChange={(e) => updateEditField("needsInvoice", e.target.checked)}
                        className="h-3.5 w-3.5"
                        style={{ accentColor: colors.pine }}
                      />
                      需要開立發票
                    </label>

                    {editFields.needsInvoice && (
                      <div className="grid grid-cols-2 gap-3">
                        <label className="flex flex-col gap-1">
                          <span style={{ color: colors.muted }} className="text-[11px]">
                            發票抬頭
                          </span>
                          <input
                            type="text"
                            value={editFields.invoiceTitle ?? ""}
                            onChange={(e) => updateEditField("invoiceTitle", e.target.value)}
                            className="w-full border-b bg-transparent py-1 text-sm outline-none"
                            style={{ borderColor: colors.line, color: colors.ink }}
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span style={{ color: colors.muted }} className="text-[11px]">
                            統一編號
                          </span>
                          <input
                            type="text"
                            value={editFields.invoiceTaxId ?? ""}
                            onChange={(e) => updateEditField("invoiceTaxId", e.target.value)}
                            className="w-full border-b bg-transparent py-1 text-sm outline-none"
                            style={{ borderColor: colors.line, color: colors.ink }}
                          />
                        </label>
                      </div>
                    )}

                    {editError && (
                      <p style={{ color: colors.alert }} className="text-[11px] leading-relaxed">
                        {editError}
                      </p>
                    )}

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={cancelEdit}
                        disabled={isSaving}
                        className="flex-1 border py-2 text-xs tracking-wide disabled:opacity-50"
                        style={{ borderColor: colors.line, color: colors.ink }}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={saveEdit}
                        disabled={isSaving}
                        className="flex-1 py-2 text-xs tracking-wide disabled:opacity-50"
                        style={{ backgroundColor: colors.pine, color: colors.pineText }}
                      >
                        {isSaving ? "儲存中…" : "儲存"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-col gap-1.5 text-xs">
                    <InfoRow label="訂單編號" value={detail.reservationNo} />
                    <InfoRow label="狀態" value={STATUS_LABEL[detail.status] ?? detail.status} />
                    <InfoRow label="入住日期" value={detail.checkIn} />
                    <InfoRow label="退房日期" value={detail.checkOut} />
                    <InfoRow
                      label="入住人數"
                      value={`${detail.adults}大 ${detail.children}小${detail.infants ? ` ${detail.infants}幼` : ""}${detail.pets ? ` ${detail.pets}寵` : ""}`}
                    />
                    <InfoRow label="客人姓名" value={detail.guestName || "（未填）"} />
                    <InfoRow label="客人電話" value={detail.guestPhone || "（未填）"} />
                    <InfoRow label="客戶來源" value={BOOKING_SOURCE_LABEL[detail.bookingSource] ?? detail.bookingSource} />
                    {detail.visitors > 0 && <InfoRow label="訪客人數" value={String(detail.visitors)} />}
                    {detail.needsInvoice && (
                      <>
                        <InfoRow label="發票抬頭" value={detail.invoiceTitle || "（未填）"} />
                        <InfoRow label="統一編號" value={detail.invoiceTaxId || "（未填）"} />
                      </>
                    )}
                  </div>
                )}

                {!isEditing && (
                  <>
                    {detail.roomLines.length > 0 && (
                      <>
                        <p className="mt-4 border-t pt-3 text-xs font-bold" style={{ borderColor: colors.line, color: colors.ink }}>
                          房型配置
                        </p>
                        <div className="mt-1 flex flex-col gap-1 text-xs" style={{ color: colors.muted }}>
                          {detail.roomLines.map((line, i) => (
                            <p key={i}>
                              {line.quantity} 間{line.notes ? `　${line.notes}` : ""}
                            </p>
                          ))}
                        </div>
                      </>
                    )}

                    {detail.items.length > 0 && (
                      <>
                        <p className="mt-4 border-t pt-3 text-xs font-bold" style={{ borderColor: colors.line, color: colors.ink }}>
                          加購項目
                        </p>
                        <div className="mt-1 flex flex-col gap-1 text-xs">
                          {detail.items.map((item, i) => (
                            <div key={i} className="flex items-baseline justify-between" style={{ color: colors.muted }}>
                              <span>
                                {item.description}
                                {item.notes ? `（${item.notes}）` : ""}
                              </span>
                              <span className="tabular-nums">NT$ {item.amount.toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    <div className="mt-4 rounded-sm px-4 py-4" style={{ backgroundColor: colors.pineSoft }}>
                      <p className="text-[11px] tracking-wide" style={{ color: colors.muted }}>
                        訂單總金額
                      </p>
                      <p className={`${display.className} text-3xl italic`} style={{ color: colors.pine }}>
                        NT$ {detail.finalTotal.toLocaleString()}
                      </p>
                    </div>

                    {detail.payments.length > 0 && (
                      <>
                        <p className="mt-4 border-t pt-3 text-xs font-bold" style={{ borderColor: colors.line, color: colors.ink }}>
                          付款狀態
                        </p>
                        <div className="mt-1 flex flex-col gap-1.5 text-xs">
                          {detail.payments.map((p, i) => (
                            <div key={i} className="flex items-baseline justify-between">
                              <span style={{ color: colors.muted }}>
                                {PAYMENT_KIND_LABEL[p.paymentKind] ?? p.paymentKind}
                                {p.dueDate ? `（到期：${p.dueDate}）` : ""}
                              </span>
                              <span className="font-semibold" style={{ color: p.status === "paid" ? colors.pine : colors.alert }}>
                                NT$ {p.amount.toLocaleString()}　{PAYMENT_STATUS_LABEL[p.status] ?? p.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {/* 訂金已收款才能產生「已收到訂金匯款」的確認內容，避免
                        在還沒收到錢的狀況下傳出跟事實不符的訊息給客人 */}
                    {detail.payments.some((p) => p.paymentKind === "deposit" && p.status === "paid") && (
                      <>
                        <button
                          type="button"
                          onClick={handleCopyConfirmation}
                          className="mt-4 w-full border py-2.5 text-xs tracking-wide transition-colors"
                          style={
                            copied
                              ? { borderColor: colors.pine, backgroundColor: colors.pine, color: colors.pineText }
                              : { borderColor: colors.line, backgroundColor: "transparent", color: colors.ink }
                          }
                        >
                          {copied ? "已複製 ✓" : "複製訂房確認內容"}
                        </button>
                        {copyError && (
                          <p className="mt-2 text-[11px]" style={{ color: colors.alert }}>
                            {copyError}
                          </p>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
