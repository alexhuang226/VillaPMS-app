"use client";

/**
 * 訂單管理 — 日曆檢視
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
import { buildReservationConfirmationMessageAction, calculateAutoRoomAllocationAction, createReservationDirectlyAction, deleteReservationAction, getCalendarReservationsAction, getExtraBedRoomOptionsForCreateAction, getReservationDetailAction, updateReservationAction } from "@/app/actions/reservation";
import { deleteStaffAssignmentsForPropertyDateAction } from "@/app/actions/schedule";
import type { CalendarReservation, CreateReservationFields, ExtraBedRoomOption, ReservationDetail, ReservationUpdateFields } from "@/lib/pricing/queries";

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
  // shortLabel 跟房務班表（monthly-schedule.tsx 的
  // PROPERTY_SHORT_LABELS）用同一套簡稱，日曆色塊欄位窄，全名塞
  // 不下——即使只跨 1 天的訂單也要看得出是哪間民宿，不能乾脆不顯示
  // 文字，只顯示顏色的話還要另外去對照圖例，不夠直覺。
  { code: "zhici", label: "只此清綠", shortLabel: "清綠", color: "#5C7A4A" },
  { code: "moyin", label: "陌隱", shortLabel: "陌隱", color: colors.gold },
  { code: "shuijing", label: "水景璞堤", shortLabel: "璞堤", color: colors.blue },
];

/** 訂單狀態——只留這三種給人選/顯示，資料庫的 enum 本身還有
 * checked_in/checked_out 這兩個值，但這個規模的民宿不需要細分到
 * 那個程度，日常操作只會用到這三種 */
const STATUS_LABEL: Record<string, string> = {
  confirmed: "已確認",
  cancelled: "已取消",
  no_show: "未到",
};
/** 訂單整體「付款狀況」——跟 PAYMENT_STATUS_LABEL（下面，是單筆
 * payments 記錄的 pending/paid 狀態）是兩回事，這個是
 * reservations.payment_status 這個獨立欄位，管理者手動維護的整體
 * 標籤 */
const RESERVATION_PAYMENT_STATUS_LABEL: Record<string, string> = {
  pending_deposit: "待匯訂金",
  deposit_paid: "已匯訂金",
  balance_paid: "已匯尾款",
  deposit_refunded: "退還訂金",
  deposit_forfeited: "沒收訂金",
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

const BOOKING_SOURCE_OPTIONS = Object.entries(BOOKING_SOURCE_LABEL).map(([value, label]) => ({ value, label }));

const EMPTY_CREATE_FIELDS: CreateReservationFields = {
  propertyCode: "zhici",
  guestName: "",
  guestPhone: "",
  checkIn: "",
  checkOut: "",
  adults: 10,
  children: 0,
  infants: 0,
  pets: 0,
  visitors: 0,
  bookingSource: "airbnb",
  finalTotal: 0,
  paymentStatus: "pending_deposit",
  needsInvoice: false,
  invoiceTitle: null,
  invoiceTaxId: null,
  fourPersonSuiteCount: 0,
  fourPersonDowngradeCount: 0,
  doubleSuiteCount: 0,
  doublePlainCount: 0,
  extraBedFixedRoomCodes: [],
  extraBedTempRoomCodes: [],
  extraRoomQty: 0,
  bbq: false,
  foodTruck: false,
  earlyCheckin: false,
};

/** Date 物件轉成「本地日曆日期」的 'YYYY-MM-DD'（不透過 toISOString，
 * 那個一定轉成 UTC，會有時區位移問題，見 quote-form.tsx 的說明） */
function formatLocalDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 從 reservation_items 的 notes 欄位（格式「房號：A1、A2」）反解析出
 * 房號陣列——編輯訂單時，要把已經存在的加床項目還原成表單可以編輯
 * 的複選狀態，這是對應寫入時的格式（見 lib/pricing/queries.ts 的
 * buildAddOnItemLines） */
function parseRoomCodesFromNotes(notes: string | null): string[] {
  if (!notes) return [];
  const match = notes.match(/房號：(.+)/);
  if (!match) return [];
  return match[1]
    .split("、")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 新增訂單表單的預設入住日期：今天起一個月後——跟報價單的預設值
 * 一致（見 quote-form.tsx 的 getDefaultCheckIn） */
function getDefaultCreateCheckIn(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return formatLocalDate(d);
}

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

  // 依欄位（startCol）排序，確保畫面上的 DOM 順序跟實際欄位順序一致。
  // 這點很關鍵：CSS Grid 預設的 sparse 排列演算法，是按照 DOM 順序
  // 依序把每個元素往「目前游標之後最小可行的列」放，游標只會前進、
  // 不會回頭去補前面空出來的位置——如果這裡傳進來的 propertyReservations
  // 順序剛好不是按入住日期排的（例如來自資料庫查詢時沒有明確
  // order by，或是歷史資料匯入時是照原始試算表的順序寫入、不是照
  // 日期順序），會導致「後面的元素欄位其實比較前面」這種情況，
  // 讓瀏覽器誤判成需要另開一排，即使實際上完全沒有日期重疊。
  segments.sort((a, b) => a.startCol - b.startCol);

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

export function ReservationsSearch({ isHousekeepingManager = false }: { isHousekeepingManager?: boolean }) {
  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [reservations, setReservations] = useState<CalendarReservation[]>([]);
  // 只看某一間民宿的訂房狀況——null 代表全部民宿都顯示
  const [propertyFilter, setPropertyFilter] = useState<string | null>(null);
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
  const [editExtraBedRoomOptions, setEditExtraBedRoomOptions] = useState<ExtraBedRoomOption[]>([]);

  // 刪除訂單（測試訂單/建錯的訂單用，客人真的取消請改用編輯狀態）
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // 直接建立訂單（跳過報價/訂房確認單流程），給 Airbnb 等 OTA 平台
  // 訂房用——房價、收款平台都處理過了，不需要走一次報價確認流程
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createFields, setCreateFields] = useState<CreateReservationFields>(EMPTY_CREATE_FIELDS);
  const [isSavingCreate, setIsSavingCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdReservationNo, setCreatedReservationNo] = useState<string | null>(null);
  // 總金額刻意留空白，不套用計價公式（Airbnb 等平台的房價是平台
  // 訂的，不是照民宿自己的計價規則算），用獨立的原始字串狀態存，
  // 才能讓欄位一開始是真的空白，不是顯示著「0」
  const [finalTotalRaw, setFinalTotalRaw] = useState("");
  // 房型配置是不是職員手動調整過——調整過之後，人數再變動就不要
  // 覆蓋掉職員自己填的數字，跟報價單「手動覆寫房型」的邏輯一致
  const [roomAllocationTouched, setRoomAllocationTouched] = useState(false);
  // 加臨時床要放哪些房號的選項，跟著民宿變動即時查
  const [extraBedRoomOptions, setExtraBedRoomOptions] = useState<ExtraBedRoomOption[]>([]);

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

  function openCreateForm() {
    const defaultCheckIn = getDefaultCreateCheckIn();
    setCreateFields({ ...EMPTY_CREATE_FIELDS, checkIn: defaultCheckIn, checkOut: addOneDayToYMD(defaultCheckIn) });
    setFinalTotalRaw("");
    setRoomAllocationTouched(false);
    setExtraBedRoomOptions([]);
    setCreateError(null);
    setCreatedReservationNo(null);
    setShowCreateForm(true);
    setSelectedId(null);
  }

  function updateCreateField<K extends keyof CreateReservationFields>(key: K, value: CreateReservationFields[K]) {
    setCreateFields((prev) => ({ ...prev, [key]: value }));
  }

  /** 入住日期規則跟報價單一致：只要動了入住日期，退房日期就重算成
   * 入住日期+1 天（見 quote-form.tsx 的 handleCheckInChange 說明） */
  function handleCreateCheckInChange(newCheckIn: string) {
    setCreateFields((prev) => ({
      ...prev,
      checkIn: newCheckIn,
      checkOut: newCheckIn ? addOneDayToYMD(newCheckIn) : prev.checkOut,
    }));
  }

  /** 房型數量欄位一旦被手動改過，就不要再讓自動計算蓋掉——理由跟
   * 報價單「手動覆寫房型」一致：職員可能因為客人特殊需求調整過，
   * 人數再變動時不應該悄悄把調整覆蓋掉 */
  function updateCreateRoomField<K extends keyof CreateReservationFields>(key: K, value: CreateReservationFields[K]) {
    setRoomAllocationTouched(true);
    updateCreateField(key, value);
  }

  function toggleCreateExtraBedRoom(field: "extraBedFixedRoomCodes" | "extraBedTempRoomCodes", code: string) {
    setCreateFields((prev) => ({
      ...prev,
      [field]: prev[field].includes(code) ? prev[field].filter((c) => c !== code) : [...prev[field], code],
    }));
  }

  // 房型配置自動跟著民宿／人數重算，套用跟報價單同一套分配公式——
  // 只有表單開著、而且房型還沒被手動調整過才會自動重算
  useEffect(() => {
    if (!showCreateForm || roomAllocationTouched) return;
    let cancelled = false;
    calculateAutoRoomAllocationAction(createFields.propertyCode, createFields.adults, createFields.children)
      .then((allocation) => {
        if (cancelled) return;
        setCreateFields((prev) => ({
          ...prev,
          fourPersonSuiteCount: allocation.fourPersonSuiteCount,
          fourPersonDowngradeCount: allocation.fourPersonDowngradeCount,
          doubleSuiteCount: allocation.doubleSuiteCount,
          doublePlainCount: allocation.doublePlainCount,
        }));
      })
      .catch(() => {
        // 自動計算失敗不擋表單——職員還是可以手動填房型數量
      });
    return () => {
      cancelled = true;
    };
  }, [showCreateForm, roomAllocationTouched, createFields.propertyCode, createFields.adults, createFields.children]);

  // 加臨時床的房號選項跟著民宿變動即時查——民宿改變時，之前選的
  // 房號可能不再適用，一併清空避免留著錯的民宿的房號
  useEffect(() => {
    if (!showCreateForm) return;
    let cancelled = false;
    getExtraBedRoomOptionsForCreateAction(createFields.propertyCode)
      .then((options) => {
        if (!cancelled) setExtraBedRoomOptions(options);
      })
      .catch(() => {
        // 查詢失敗不擋表單，只是加床位置選單會是空的
      });
    setCreateFields((prev) => ({ ...prev, extraBedFixedRoomCodes: [], extraBedTempRoomCodes: [] }));
    return () => {
      cancelled = true;
    };
  }, [showCreateForm, createFields.propertyCode]);

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!createFields.guestName.trim() || !createFields.checkIn || !createFields.checkOut) {
      setCreateError("請填寫客人姓名、入住日期、退房日期");
      return;
    }
    setIsSavingCreate(true);
    setCreateError(null);
    try {
      const { reservationNo } = await createReservationDirectlyAction({
        ...createFields,
        guestName: createFields.guestName.trim(),
        guestPhone: createFields.guestPhone.trim(),
        finalTotal: Number(finalTotalRaw) || 0,
      });
      setCreatedReservationNo(reservationNo);
      setShowCreateForm(false);
      // 建立成功後重新查一次目前這個月的日曆，讓新訂單馬上顯示出來
      if (year !== null && month !== null) {
        const rows = await getCalendarReservationsAction(year, month);
        setReservations(rows);
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "建立訂單失敗，請稍後再試");
    } finally {
      setIsSavingCreate(false);
    }
  }

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
    setShowDeleteConfirm(false);
    setDeleteError(null);
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

  async function handleDeleteReservation() {
    if (!selectedId) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteReservationAction(selectedId);
      setSelectedId(null);
      setDetail(null);
      setShowDeleteConfirm(false);
      // 刪除成功後重新查一次目前這個月的日曆，讓訂單馬上從列表消失
      if (year !== null && month !== null) {
        const rows = await getCalendarReservationsAction(year, month);
        setReservations(rows);
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "刪除失敗，請稍後再試");
    } finally {
      setIsDeleting(false);
    }
  }

  /** 開始編輯：用目前的訂單內容當作表單初始值 */
  function startEdit() {
    if (!detail) return;
    setEditError(null);

    const extraBedFixedItem = detail.items.find((i) => i.itemType === "extra_bed_fixed");
    const extraBedTempItem = detail.items.find((i) => i.itemType === "extra_bed_temporary");
    const extraRoomItem = detail.items.find((i) => i.itemType === "other" && i.description === "加開房間");
    const bbqItem = detail.items.find((i) => i.itemType === "bbq");
    const foodTruckItem = detail.items.find((i) => i.itemType === "food_truck");
    const earlyCheckinItem = detail.items.find((i) => i.itemType === "early_checkin");

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
      paymentStatus: detail.paymentStatus,
      finalTotal: detail.finalTotal,
      needsInvoice: detail.needsInvoice,
      invoiceTitle: detail.invoiceTitle,
      invoiceTaxId: detail.invoiceTaxId,
      fourPersonSuiteCount: detail.roomAllocation.fourPersonSuiteCount,
      fourPersonDowngradeCount: detail.roomAllocation.fourPersonDowngradeCount,
      doubleSuiteCount: detail.roomAllocation.doubleSuiteCount,
      doublePlainCount: detail.roomAllocation.doublePlainCount,
      extraBedFixedRoomCodes: parseRoomCodesFromNotes(extraBedFixedItem?.notes ?? null),
      extraBedTempRoomCodes: parseRoomCodesFromNotes(extraBedTempItem?.notes ?? null),
      extraRoomQty: extraRoomItem?.quantity ?? 0,
      bbq: Boolean(bbqItem),
      foodTruck: Boolean(foodTruckItem),
      earlyCheckin: Boolean(earlyCheckinItem),
    });
    setIsEditing(true);

    // 加床位置選項要用民宿代碼查——編輯訂單不能換民宿，查一次就夠
    getExtraBedRoomOptionsForCreateAction(detail.propertyCode as CreateReservationFields["propertyCode"])
      .then((options) => setEditExtraBedRoomOptions(options))
      .catch(() => {
        // 查詢失敗不擋編輯，只是加床位置選單會是空的
      });
  }

  function toggleEditExtraBedRoom(field: "extraBedFixedRoomCodes" | "extraBedTempRoomCodes", code: string) {
    setEditFields((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [field]: prev[field].includes(code) ? prev[field].filter((c) => c !== code) : [...prev[field], code],
      };
    });
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
    if (!selectedId || !editFields || !detail) return;

    // 退房日期如果被改掉，原本安排的房務人員不一定能配合新日期，
    // 需要先跟他們確認過才能繼續用——不是靜靜地留著一筆「看起來已經
    // 排好人」但其實日期已經不對的排班，避免當天開天窗。這裡用簡單
    // 的瀏覽器確認視窗詢問，選「確定」才會清掉舊退房日的房務班表，
    // 選「取消」就維持原本的排班不動（畫面上之後可能會顯示「非退房
    // 日」的提醒，見 monthly-schedule.tsx 的說明）。
    const checkOutChanged = editFields.checkOut !== detail.checkOut;
    let shouldClearOldAssignment = false;
    if (checkOutChanged) {
      shouldClearOldAssignment = window.confirm(
        `退房日期從 ${detail.checkOut} 改成 ${editFields.checkOut}。\n\n` +
          `原本安排在 ${detail.checkOut} 的房務人員需要重新跟他們確認新日期能不能配合。\n\n` +
          `要不要現在把 ${detail.checkOut} 這天的房務班表清除，之後再重新安排？\n` +
          `（選「取消」會保留原本的排班，但日期已經跟訂單對不上了，要自己記得處理）`
      );
    }

    setIsSaving(true);
    setEditError(null);

    try {
      await updateReservationAction(selectedId, editFields);
      if (checkOutChanged && shouldClearOldAssignment) {
        await deleteStaffAssignmentsForPropertyDateAction(detail.propertyId, detail.checkOut);
      }
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
            訂單管理
          </h1>
        </header>

        <div className="mb-4 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => setPropertyFilter(null)}
            className="rounded-full border px-3 py-1.5 text-xs transition-colors"
            style={
              propertyFilter === null
                ? { borderColor: colors.ink, backgroundColor: colors.ink, color: "#FFFFFF" }
                : { borderColor: colors.line, backgroundColor: "transparent", color: colors.ink }
            }
          >
            全部
          </button>
          {PROPERTIES.map((p) => {
            const active = propertyFilter === p.code;
            return (
              <button
                key={p.code}
                type="button"
                onClick={() => setPropertyFilter(active ? null : p.code)}
                className="rounded-full border px-3 py-1.5 text-xs transition-colors"
                style={
                  active
                    ? { borderColor: p.color, backgroundColor: p.color, color: "#FFFFFF" }
                    : { borderColor: colors.line, backgroundColor: "transparent", color: colors.ink }
                }
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {!showCreateForm && !isHousekeepingManager && (
          <button
            type="button"
            onClick={openCreateForm}
            className="mb-4 w-full border py-2 text-xs tracking-wide"
            style={{ borderColor: colors.line, color: colors.ink }}
          >
            ＋ 新增訂單（Airbnb 等平台訂房，跳過報價流程直接建立）
          </button>
        )}

        {createdReservationNo && (
          <p className="mb-4 border-l-2 pl-3 text-xs leading-relaxed" style={{ borderColor: colors.pine, color: colors.pine }}>
            ✓ 已建立訂單，訂單編號：{createdReservationNo}
          </p>
        )}

        {showCreateForm && (
          <form onSubmit={handleCreateSubmit} className="mb-6 flex flex-col gap-4 border p-4" style={{ borderColor: colors.line }}>
            <p className="text-xs font-bold" style={{ color: colors.blue }}>
              新增訂單
            </p>

            <div>
              <p style={{ color: colors.muted }} className="mb-1 text-[11px] tracking-wide">
                民宿
              </p>
              <div className="flex flex-wrap gap-2">
                {PROPERTIES.map((p) => {
                  const active = createFields.propertyCode === p.code;
                  return (
                    <button
                      key={p.code}
                      type="button"
                      onClick={() => updateCreateField("propertyCode", p.code as CreateReservationFields["propertyCode"])}
                      className="rounded-full border px-3 py-1.5 text-xs transition-colors"
                      style={
                        active
                          ? { borderColor: p.color, backgroundColor: p.color, color: "#FFFFFF" }
                          : { borderColor: colors.line, backgroundColor: "transparent", color: colors.ink }
                      }
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="flex flex-col gap-1">
              <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                付款狀況
              </span>
              <select
                value={createFields.paymentStatus}
                onChange={(e) => updateCreateField("paymentStatus", e.target.value)}
                className="w-full border-b bg-transparent py-1 text-sm outline-none"
                style={{ borderColor: colors.line, color: colors.ink }}
              >
                {Object.entries(RESERVATION_PAYMENT_STATUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                  入住日期
                </span>
                <input
                  type="date"
                  value={createFields.checkIn}
                  onChange={(e) => handleCreateCheckInChange(e.target.value)}
                  required
                  className="w-full border-b bg-transparent py-1 text-sm outline-none"
                  style={{ borderColor: colors.line, color: colors.ink }}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                  退房日期
                </span>
                <input
                  type="date"
                  value={createFields.checkOut}
                  onChange={(e) => updateCreateField("checkOut", e.target.value)}
                  required
                  className="w-full border-b bg-transparent py-1 text-sm outline-none"
                  style={{ borderColor: colors.line, color: colors.ink }}
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                  客人姓名
                </span>
                <input
                  type="text"
                  value={createFields.guestName}
                  onChange={(e) => updateCreateField("guestName", e.target.value)}
                  required
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
                  value={createFields.guestPhone}
                  onChange={(e) => updateCreateField("guestPhone", e.target.value)}
                  className="w-full border-b bg-transparent py-1 text-sm outline-none"
                  style={{ borderColor: colors.line, color: colors.ink }}
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                  客戶來源
                </span>
                <select
                  value={createFields.bookingSource}
                  onChange={(e) => updateCreateField("bookingSource", e.target.value)}
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
              <label className="flex flex-col gap-1">
                <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                  訪客
                </span>
                <input
                  type="number"
                  min={0}
                  value={createFields.visitors}
                  onChange={(e) => updateCreateField("visitors", Number(e.target.value))}
                  className="w-full border-b bg-transparent py-1 text-sm outline-none"
                  style={{ borderColor: colors.line, color: colors.ink }}
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <span style={{ color: colors.muted }} className="text-[11px]">
                  大人
                </span>
                <input
                  type="number"
                  min={0}
                  value={createFields.adults}
                  onChange={(e) => updateCreateField("adults", Number(e.target.value))}
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
                  value={createFields.children}
                  onChange={(e) => updateCreateField("children", Number(e.target.value))}
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
                  value={createFields.infants}
                  onChange={(e) => updateCreateField("infants", Number(e.target.value))}
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
                  value={createFields.pets}
                  onChange={(e) => updateCreateField("pets", Number(e.target.value))}
                  className="w-full border-b bg-transparent py-1 text-sm outline-none"
                  style={{ borderColor: colors.line, color: colors.ink }}
                />
              </label>
            </div>

            <div>
              <p style={{ color: colors.muted }} className="mb-1 text-[11px] tracking-wide">
                房型配置（跟著民宿／人數自動建議，可以手動調整）
              </p>
              <div className="grid grid-cols-2 gap-4">
                <label className="flex flex-col gap-1">
                  <span style={{ color: colors.muted }} className="text-[11px]">
                    四人套房
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={createFields.fourPersonSuiteCount}
                    onChange={(e) => updateCreateRoomField("fourPersonSuiteCount", Number(e.target.value))}
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
                    value={createFields.fourPersonDowngradeCount}
                    onChange={(e) => updateCreateRoomField("fourPersonDowngradeCount", Number(e.target.value))}
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
                    value={createFields.doubleSuiteCount}
                    onChange={(e) => updateCreateRoomField("doubleSuiteCount", Number(e.target.value))}
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
                    value={createFields.doublePlainCount}
                    onChange={(e) => updateCreateRoomField("doublePlainCount", Number(e.target.value))}
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

              <div className="mt-3">
                <p style={{ color: colors.muted }} className="mb-1 text-[11px] tracking-wide">
                  加臨時床房號（複選）
                </p>
                {extraBedRoomOptions.length === 0 ? (
                  <p className="text-[11px]" style={{ color: colors.alert }}>
                    這間民宿沒有設定可加床的房號，請直接跟房務確認
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {extraBedRoomOptions.map((room) => {
                      const active = createFields.extraBedTempRoomCodes.includes(room.code);
                      return (
                        <button
                          key={room.id}
                          type="button"
                          onClick={() => toggleCreateExtraBedRoom("extraBedTempRoomCodes", room.code)}
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

              <div className="mt-3 flex flex-wrap gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={createFields.bbq}
                    onChange={(e) => updateCreateField("bbq", e.target.checked)}
                    className="h-3.5 w-3.5"
                    style={{ accentColor: colors.pine }}
                  />
                  <span className="text-xs">烤肉</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={createFields.foodTruck}
                    onChange={(e) => updateCreateField("foodTruck", e.target.checked)}
                    className="h-3.5 w-3.5"
                    style={{ accentColor: colors.pine }}
                  />
                  <span className="text-xs">餐車場地</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={createFields.earlyCheckin}
                    onChange={(e) => updateCreateField("earlyCheckin", e.target.checked)}
                    className="h-3.5 w-3.5"
                    style={{ accentColor: colors.pine }}
                  />
                  <span className="text-xs">提前入住</span>
                </label>
              </div>
            </div>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={createFields.needsInvoice}
                onChange={(e) => updateCreateField("needsInvoice", e.target.checked)}
                className="h-3.5 w-3.5"
                style={{ accentColor: colors.pine }}
              />
              需要開立發票
            </label>

            {createFields.needsInvoice && (
              <div className="grid grid-cols-2 gap-4">
                <label className="flex flex-col gap-1">
                  <span style={{ color: colors.muted }} className="text-[11px]">
                    發票抬頭
                  </span>
                  <input
                    type="text"
                    value={createFields.invoiceTitle ?? ""}
                    onChange={(e) => updateCreateField("invoiceTitle", e.target.value)}
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
                    value={createFields.invoiceTaxId ?? ""}
                    onChange={(e) => updateCreateField("invoiceTaxId", e.target.value)}
                    className="w-full border-b bg-transparent py-1 text-sm outline-none"
                    style={{ borderColor: colors.line, color: colors.ink }}
                  />
                </label>
              </div>
            )}

            <p className="text-[11px] leading-relaxed" style={{ color: colors.muted }}>
              ⚠️ 這裡建立的訂單不會產生訂金/尾款應收款記錄——OTA 平台
              已經處理收款，避免「查詢應收」顯示這筆其實已經收到錢的
              訂單還在等收款。
            </p>

            <div className="border-t pt-3" style={{ borderColor: colors.line }}>
              <label className="flex flex-col gap-1">
                <span style={{ color: colors.muted }} className="text-[11px]">
                  總金額（選填，Airbnb 等平台的房價不套用計價公式，直接填實收金額）
                </span>
                <input
                  type="number"
                  min={0}
                  value={finalTotalRaw}
                  onChange={(e) => setFinalTotalRaw(e.target.value)}
                  placeholder="0"
                  className="w-full border-b bg-transparent py-1 text-sm outline-none"
                  style={{ borderColor: colors.line, color: colors.ink }}
                />
              </label>
            </div>

            {createError && (
              <p role="alert" className="text-xs leading-relaxed" style={{ color: colors.alert }}>
                {createError}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                disabled={isSavingCreate}
                className="flex-1 border py-2.5 text-xs tracking-wide disabled:opacity-50"
                style={{ borderColor: colors.line, color: colors.ink }}
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isSavingCreate}
                className="flex-1 py-2.5 text-xs tracking-wide disabled:opacity-50"
                style={{ backgroundColor: colors.pine, color: colors.pineText }}
              >
                {isSavingCreate ? "建立中…" : "建立訂單"}
              </button>
            </div>
          </form>
        )}

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
                    {(propertyFilter ? PROPERTIES.filter((p) => p.code === propertyFilter) : PROPERTIES).map((property) => {
                      const propertyReservations = reservations.filter((r) => r.propertyCode === property.code);
                      const segments = computeWeekSegments(week, year, month, propertyReservations);
                      return (
                        <div
                          key={property.code}
                          className="grid grid-cols-7 gap-1"
                          style={{ minHeight: "16px", gridAutoRows: "16px" }}
                        >
                          {segments.map((seg) => {
                            return (
                              <button
                                key={seg.reservation.id}
                                type="button"
                                onClick={() => handleSelectReservation(seg.reservation)}
                                className="flex h-full items-center justify-center overflow-hidden whitespace-nowrap px-0.5 text-[8px] leading-none text-white"
                                style={{
                                  gridColumnStart: seg.startCol,
                                  gridColumnEnd: seg.endCol + 1,
                                  gridRow: 1,
                                  backgroundColor: property.color,
                                  borderTopLeftRadius: seg.isActualStart ? "8px" : 0,
                                  borderBottomLeftRadius: seg.isActualStart ? "8px" : 0,
                                  borderTopRightRadius: seg.isActualEnd ? "8px" : 0,
                                  borderBottomRightRadius: seg.isActualEnd ? "8px" : 0,
                                }}
                              >
                                {property.shortLabel}
                                {seg.reservation.hasBbq ? "🍖" : ""}
                                {seg.reservation.balanceUnpaid ? " ⚠" : ""}
                              </button>
                            );
                          })}
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
                  {!isEditing && !isHousekeepingManager && (
                    <div className="flex gap-3">
                      <button type="button" onClick={startEdit} className="text-xs" style={{ color: colors.blue }}>
                        編輯
                      </button>
                      <button type="button" onClick={() => setShowDeleteConfirm(true)} className="text-xs" style={{ color: colors.alert }}>
                        刪除
                      </button>
                    </div>
                  )}
                </div>

                {showDeleteConfirm && (
                  <div className="mt-3 border-l-2 pl-3" style={{ borderColor: colors.alert }}>
                    <p className="text-xs leading-relaxed" style={{ color: colors.alert }}>
                      確定要刪除這筆訂單嗎？連同房型明細、加購項目、付款記錄都會一起刪掉，無法復原。
                      <br />
                      客人如果是真的取消預訂，建議改用「編輯」把訂單狀態改成「已取消」，保留記錄比較好查——這個刪除是給測試訂單/建錯的訂單用的。
                    </p>
                    {deleteError && (
                      <p role="alert" className="mt-2 text-xs" style={{ color: colors.alert }}>
                        {deleteError}
                      </p>
                    )}
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setShowDeleteConfirm(false)}
                        disabled={isDeleting}
                        className="border px-3 py-1.5 text-xs disabled:opacity-50"
                        style={{ borderColor: colors.line, color: colors.ink }}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={handleDeleteReservation}
                        disabled={isDeleting}
                        className="px-3 py-1.5 text-xs disabled:opacity-50"
                        style={{ backgroundColor: colors.alert, color: "#FFFFFF" }}
                      >
                        {isDeleting ? "刪除中…" : "確定刪除"}
                      </button>
                    </div>
                  </div>
                )}

                {isEditing && editFields ? (
                  <div className="mt-3 flex flex-col gap-3 text-xs">
                    <div className="grid grid-cols-2 gap-4">
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
                          付款狀況
                        </span>
                        <select
                          value={editFields.paymentStatus}
                          onChange={(e) => updateEditField("paymentStatus", e.target.value)}
                          className="w-full border-b bg-transparent py-1 text-sm outline-none"
                          style={{ borderColor: colors.line, color: colors.ink }}
                        >
                          {Object.entries(RESERVATION_PAYMENT_STATUS_LABEL).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {editFields.status === "cancelled" && editFields.paymentStatus === "deposit_forfeited" && (
                      <p className="text-[11px] leading-relaxed" style={{ color: colors.pine }}>
                        ⚠️
                        這筆訂單已取消、付款狀況是「沒收訂金」——訂金金額會照樣計入這個月的營收（用實際收到的訂金金額，不是訂單總金額），住房天數不會計入。
                      </p>
                    )}

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
                    </div>

                    <div className="grid grid-cols-2 gap-3">
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
                    </div>

                    <div>
                      <p style={{ color: colors.muted }} className="mb-1 text-[11px] tracking-wide">
                        額外服務
                      </p>

                      <div className="mt-3">
                        <p style={{ color: colors.muted }} className="mb-1 text-[11px] tracking-wide">
                          加臨時床房號（複選）
                        </p>
                        {editExtraBedRoomOptions.length === 0 ? (
                          <p className="text-[11px]" style={{ color: colors.alert }}>
                            這間民宿沒有設定可加床的房號，請直接跟房務確認
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {editExtraBedRoomOptions.map((room) => {
                              const active = editFields.extraBedTempRoomCodes.includes(room.code);
                              return (
                                <button
                                  key={room.id}
                                  type="button"
                                  onClick={() => toggleEditExtraBedRoom("extraBedTempRoomCodes", room.code)}
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

                      <div className="mt-3 flex flex-wrap gap-4">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={editFields.bbq}
                            onChange={(e) => updateEditField("bbq", e.target.checked)}
                            className="h-3.5 w-3.5"
                            style={{ accentColor: colors.pine }}
                          />
                          <span className="text-xs">烤肉</span>
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={editFields.foodTruck}
                            onChange={(e) => updateEditField("foodTruck", e.target.checked)}
                            className="h-3.5 w-3.5"
                            style={{ accentColor: colors.pine }}
                          />
                          <span className="text-xs">餐車場地</span>
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={editFields.earlyCheckin}
                            onChange={(e) => updateEditField("earlyCheckin", e.target.checked)}
                            className="h-3.5 w-3.5"
                            style={{ accentColor: colors.pine }}
                          />
                          <span className="text-xs">提前入住</span>
                        </label>
                      </div>
                    </div>

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

                    <div className="border-t pt-3" style={{ borderColor: colors.line }}>
                      <p className="text-[11px] leading-relaxed" style={{ color: colors.alert }}>
                        ⚠️ 改了入住/退房日期或房型配置後，「總金額」不會自動重算。
                      </p>
                      <label className="mt-2 flex flex-col gap-1">
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
                    <InfoRow
                      label="付款狀況"
                      value={RESERVATION_PAYMENT_STATUS_LABEL[detail.paymentStatus] ?? detail.paymentStatus}
                    />
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

                    {!isHousekeepingManager && (
                      <div className="mt-4 rounded-sm px-4 py-4" style={{ backgroundColor: colors.pineSoft }}>
                        <p className="text-[11px] tracking-wide" style={{ color: colors.muted }}>
                          訂單總金額
                        </p>
                        <p className={`${display.className} text-3xl italic`} style={{ color: colors.pine }}>
                          NT$ {detail.finalTotal.toLocaleString()}
                        </p>
                      </div>
                    )}

                    {!isHousekeepingManager && detail.payments.length > 0 && (
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
                        在還沒收到錢的狀況下傳出跟事實不符的訊息給客人——
                        判斷依據是 reservations.payment_status（管理者在
                        編輯訂單畫面維護的整體付款狀況），不是 payments 表
                        個別記錄的 status，原因見 lib/pricing/
                        reservation-message.ts 開頭的說明：這兩個欄位原本
                        是各自獨立的機制，只看 payments 表會誤判成「還沒
                        收訂金」。管家看不到金額相關資訊，這個按鈕也一併
                        隱藏。 */}
                    {!isHousekeepingManager &&
                      (detail.paymentStatus === "deposit_paid" || detail.paymentStatus === "balance_paid") && (
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
