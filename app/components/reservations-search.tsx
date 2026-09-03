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

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fraunces, Work_Sans } from "next/font/google";
import { buildReservationConfirmationMessageAction, deleteReservationAction, getCalendarReservationsForRangeAction, getExtraBedRoomOptionsForCreateAction, getReservationDetailAction, listReceivablesAction, markPaymentPaidAction, updateReservationAction, updateReservationPaymentStatusAction } from "@/app/actions/reservation";
import { deleteStaffAssignmentsForPropertyDateAction } from "@/app/actions/schedule";
import type { CalendarReservation, CreateReservationFields, ExtraBedRoomOption, ReceivableSummary, ReservationDetail, ReservationUpdateFields } from "@/lib/pricing/queries";

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

/** 訂房確認單專用的咖啡色系——跟報價單的深綠(colors.pine)區分開來，
 * 讓「已經確認的訂房」在視覺上跟「還在報價階段」的文件有明顯區別。
 * 深焙咖啡色（標題）+ 淺焦糖／拿鐵色（金額强調框），走內斂沉穩、
 * 不搶眼的路線。只用在訂房確認單這張卡片，不影響頁面其他地方
 * 原本的綠色系。 */
const CONFIRM_DARK = "#3E2B23";
const CONFIRM_LIGHT = "#F1E4D3";
const CONFIRM_ACCENT = "#8A6A4F";

const PROPERTIES = [
  // 只此清綠原本用跟按鈕/標頭一樣的深綠（colors.pine），色塊太小
  // 一塊時顏色太深、不容易看清楚，這裡另外用一個淺一點的綠。
  // 陌隱／水景璞堤的顏色互換（原本陌隱藍、水景璞堤金，改成陌隱金、
  // 水景璞堤藍）。
  // shortLabel 跟房務班表（monthly-schedule.tsx 的
  // PROPERTY_SHORT_LABELS）用同一套簡稱，日曆色塊欄位窄，全名塞
  // 不下——即使只跨 1 天的訂單也要看得出是哪間民宿，不能乾脆不顯示
  // 文字，只顯示顏色的話還要另外去對照圖例，不夠直覺。
  { code: "zhici", label: "只此清綠", shortLabel: "只此", color: "#5C7A4A" },
  { code: "moyin", label: "陌隱", shortLabel: "陌隱", color: colors.gold },
  { code: "shuijing", label: "水景璞堤", shortLabel: "水景", color: colors.blue },
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

/** 應收帳款清單用——只顯示「入住日期在未來 10 天內」的應收款（含
 * 已經入住但還沒收到尾款的，也就是入住日期已經過去的），詳細規則
 * 說明見原本 receivables-list.tsx 的檔案開頭註解，這裡整合進訂單
 * 管理頁面後沿用同一套邏輯。 */
const RECEIVABLES_SHOW_WITHIN_DAYS = 10;
const RECEIVABLES_OVERDUE_WITHIN_DAYS = 7; // 尾款提醒規則：入住前一週

/** 今天算起，距離某個日期還剩幾天；已經過去回傳負數 */
function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

const BOOKING_SOURCE_OPTIONS = Object.entries(BOOKING_SOURCE_LABEL).map(([value, label]) => ({ value, label }));

/** Date 物件轉成「本地日曆日期」的 'YYYY-MM-DD'（不透過 toISOString，
 * 那個一定轉成 UTC，會有時區位移問題，見 quote-form.tsx 的說明） */
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

/** (year, month) 往前/往後推 delta 個月，月份會正確跨年進位/借位 */
function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (((total % 12) + 12) % 12) + 1 };
}

/** 這個月的月曆格子實際涵蓋的完整日期範圍（含前後補的跨月天數）——
 * 用 JS Date 的自動進位/借位處理月份邊界，比手動算「上個月有幾天」
 * 更不容易出錯 */
function getGridDateRange(year: number, month: number): { startDate: string; endDateExclusive: string } {
  const leadingBlanks = firstWeekdayOfMonth(year, month);
  const daysInMonth = getDaysInMonth(year, month);
  const weeksCount = Math.ceil((leadingBlanks + daysInMonth) / 7);
  const totalGridDays = weeksCount * 7;

  const gridStart = new Date(Date.UTC(year, month - 1, 1 - leadingBlanks));
  const gridEndExclusive = new Date(Date.UTC(year, month - 1, 1 - leadingBlanks + totalGridDays));

  return {
    startDate: gridStart.toISOString().slice(0, 10),
    endDateExclusive: gridEndExclusive.toISOString().slice(0, 10),
  };
}

/** 查「這個月月曆格子」實際涵蓋範圍（含跨月補的天數）的訂單資料，
 * 4 個地方共用（初次載入、換月份、新增/編輯/刪除訂單後重新整理），
 * 避免各自重複算 getGridDateRange 再各自呼叫一次 action */
async function fetchCalendarRange(year: number, month: number): Promise<CalendarReservation[]> {
  const { startDate, endDateExclusive } = getGridDateRange(year, month);
  return getCalendarReservationsForRangeAction(startDate, endDateExclusive);
}

/** 某筆訂房區間（checkIn ~ checkOut）落在某年某月的晚數，兩者沒有
 * 重疊回傳 0——跟 lib/revenue/queries.ts 的同名函式邏輯一致，這裡是
 * 前端要用，兩邊執行環境不同沒辦法直接共用。用來算「當月每間民宿
 * 統計訂房天數」，月曆資料本身含跨月補的天數（見 getGridDateRange
 * 的說明），只算真正屬於目前這個月份的晚數，不能整包直接數。 */
function nightsInMonth(checkIn: string, checkOut: string, year: number, month: number): number {
  const monthStart = Date.UTC(year, month - 1, 1);
  const monthEndExclusive = Date.UTC(year, month, 1);
  const stayStart = new Date(`${checkIn}T00:00:00Z`).getTime();
  const stayEnd = new Date(`${checkOut}T00:00:00Z`).getTime();

  const overlapStart = Math.max(monthStart, stayStart);
  const overlapEnd = Math.min(monthEndExclusive, stayEnd);

  const nights = Math.round((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24));
  return Math.max(0, nights);
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
interface CalendarCell {
  year: number;
  month: number;
  day: number;
  /** 是不是目前顯示的這個月——false 代表是補在前後、跨月的日子 */
  isCurrentMonth: boolean;
}

function computeWeekSegments(week: CalendarCell[], propertyReservations: CalendarReservation[]): WeekBarSegment[] {
  const segments: WeekBarSegment[] = [];

  for (const res of propertyReservations) {
    let startCol = -1;
    let endCol = -1;

    for (let col = 0; col < 7; col++) {
      const cell = week[col];
      const dateStr = formatYMD(cell.year, cell.month, cell.day);
      const activeThisDay = res.checkIn <= dateStr && dateStr < res.checkOut;
      if (activeThisDay) {
        if (startCol === -1) startCol = col + 1;
        endCol = col + 1;
      }
    }

    if (startCol === -1) continue; // 這週完全沒有這筆訂單的入住天數

    const startCell = week[startCol - 1];
    const endCell = week[endCol - 1];
    const isActualStart = formatYMD(startCell.year, startCell.month, startCell.day) === res.checkIn;
    const isActualEnd = addOneDayToYMD(formatYMD(endCell.year, endCell.month, endCell.day)) === res.checkOut;

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

/**
 * 數字輸入框——跟報價單（quote-form.tsx）用的是同一種寫法：
 * type="text" + inputMode="numeric"，內部自己維護一份原始字串狀態
 * （raw），不是讓 <input type="number"> 直接綁定數字。理由是
 * type="number" 直接綁定數字值時，要把 0 改成別的數字，得先在 0
 * 後面打新數字（變成例如 "05"），再手動把 0 刪掉，體驗很不好；
 * 用字串狀態的話，欄位可以先被整個清空成空字串，再直接打新數字，
 * 失焦時如果還是空字串才補回 0，不會有「先打字才能刪 0」的問題。
 */
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

  // value 是外部（表單狀態）算出來的，例如切換民宿導致自動建議的
  // 房型配置改變——這種「外部改變」要同步更新顯示的字串，不然使用者
  // 會看到欄位沒有跟著變
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
        className="w-full border-b bg-transparent py-1 text-sm outline-none"
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

export function ReservationsSearch({
  isHousekeepingManager = false,
  initialReservations = null,
  initialYear = null,
  initialMonth = null,
}: {
  isHousekeepingManager?: boolean;
  /** 由 page.tsx（server component）先在伺服器端把「這個月」的日曆
   * 資料查好、直接當 props 傳進來——避免使用者從首頁點進這個頁面時，
   * 要等這個 client component 先掛載、再另外發一次請求去查資料，才
   * 看得到內容，中間會有明顯的空白等待時間。有帶初始資料的話，第一
   * 次的資料就直接用這個，不用再自己重新查一次。 */
  initialReservations?: CalendarReservation[] | null;
  initialYear?: number | null;
  initialMonth?: number | null;
}) {
  const router = useRouter();

  // 應收帳款——整合進訂單管理頁面，用切換按鈕在「月曆檢視」跟
  // 「應收帳款」兩個畫面之間切換，不是獨立頁面。資料是點切換過去
  // 才查（見下面的 useEffect），不在頁面一開始就查，避免多一次
  // 使用者可能根本用不到的查詢。
  const [viewMode, setViewMode] = useState<"calendar" | "receivables">("calendar");
  const [receivableRows, setReceivableRows] = useState<ReceivableSummary[] | null>(null);
  const [isLoadingReceivables, setIsLoadingReceivables] = useState(false);
  const [receivableError, setReceivableError] = useState<string | null>(null);
  const [markingPaymentId, setMarkingPaymentId] = useState<string | null>(null);

  useEffect(() => {
    if (viewMode !== "receivables" || receivableRows !== null) return;
    let cancelled = false;
    setIsLoadingReceivables(true);
    setReceivableError(null);
    listReceivablesAction()
      .then((rows) => {
        if (!cancelled) setReceivableRows(rows);
      })
      .catch((err) => {
        if (!cancelled) setReceivableError(err instanceof Error ? err.message : "查詢失敗，請稍後再試");
      })
      .finally(() => {
        if (!cancelled) setIsLoadingReceivables(false);
      });
    return () => {
      cancelled = true;
    };
  }, [viewMode, receivableRows]);

  async function handleMarkReceivablePaid(paymentId: string) {
    setMarkingPaymentId(paymentId);
    setReceivableError(null);
    try {
      await markPaymentPaidAction(paymentId);
      setReceivableRows((prev) => (prev ? prev.filter((r) => r.paymentId !== paymentId) : prev));
    } catch (err) {
      setReceivableError(err instanceof Error ? err.message : "標記失敗，請稍後再試");
    } finally {
      setMarkingPaymentId(null);
    }
  }

  const now = new Date();
  // 年/月直接用初始值（優先用 server component 傳進來的、沒有的話用
  // 現在的年月）當 useState 的初始值，不要另外開一個 useEffect 在
  // 掛載後才用 setState 賦值——那樣會多一次不必要的 render，讓後面
  // 依賴年/月的資料查詢 effect 也跟著晚一輪才能開始執行。
  const [year, setYear] = useState<number | null>(initialYear ?? now.getFullYear());
  const [month, setMonth] = useState<number | null>(initialMonth ?? now.getMonth() + 1);
  const [reservations, setReservations] = useState<CalendarReservation[]>(initialReservations ?? []);
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
  const [isUpdatingPaymentStatus, setIsUpdatingPaymentStatus] = useState(false);
  const [paymentStatusError, setPaymentStatusError] = useState<string | null>(null);
  const [imageWorking, setImageWorking] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageNote, setImageNote] = useState<string | null>(null);
  const confirmationCardRef = useRef<HTMLDivElement>(null);

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

  // 年/月留到 mount 後才設定成「今天」，避免 SSR 跟 client 算出的
  // 「今天」不一樣造成 hydration 不一致的警告/閃爍（跟 quote-form.tsx
  // 入住日期預設值的處理方式一樣）。
  const skippedInitialFetchRef = useRef(false);

  useEffect(() => {
    if (year === null || month === null) return;

    // Server component（page.tsx）如果已經先查好「剛好符合目前這個
    // 年/月」的初始資料，第一次執行這個 effect 的時候不用再重複查
    // 一次——reservations 這個 state 一開始就是用 initialReservations
    // 當初始值，這裡只是避免多發一次一模一樣的請求。之後只要使用者
    // 换月份、年/月改變了，effect 還是會正常重新查詢，不受這個影響。
    if (!skippedInitialFetchRef.current) {
      skippedInitialFetchRef.current = true;
      if (initialReservations !== null && initialYear === year && initialMonth === month) {
        return;
      }
    }

    let cancelled = false;

    setIsLoading(true);
    setError(null);
    fetchCalendarRange(year, month)
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

  /** 改整體付款狀況，在訂單詳情頁面直接可以改，不用進到「編輯」表單。
   * 改完重新查一次這筆訂單的詳細內容，讓下方訂金/尾款金額跟著更新
   * （updateReservationPaymentStatusAction 會同步 payments 表） */
  async function handleChangePaymentStatus(newStatus: string) {
    if (!selectedId) return;
    setIsUpdatingPaymentStatus(true);
    setPaymentStatusError(null);
    try {
      await updateReservationPaymentStatusAction(selectedId, newStatus);
      const result = await getReservationDetailAction(selectedId);
      if (result) setDetail(result);
      // 付款狀況會影響月曆上的圖示（例如尾款未收的 ⚠ 提示），改完要
      // 重新查一次目前這個月的日曆，不然月曆畫面不會馬上反映最新狀態。
      // 套用跟新增/編輯/刪除訂單同樣的短暫延遲再查詢，理由一致（見
      // 新增訂單那段程式碼的註解）。
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (year !== null && month !== null) {
        const rows = await fetchCalendarRange(year, month);
        setReservations(rows);
      }
    } catch (err) {
      setPaymentStatusError(err instanceof Error ? err.message : "更新付款狀況失敗，請稍後再試");
    } finally {
      setIsUpdatingPaymentStatus(false);
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
      // 刪除成功後重新查一次目前這個月的日曆，讓訂單馬上從列表消失。
      // 套用跟新增/編輯訂單同樣的短暫延遲再查詢，理由一致（見新增
      // 訂單那段程式碼的註解）。
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (year !== null && month !== null) {
        const rows = await fetchCalendarRange(year, month);
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
    // 訂金金額預設帶入目前已經記錄的金額——如果這筆訂單是從報價單
    // 確認轉過來的，這個金額本來就等於當初報價單算出的訂金；如果是
    // 直接建立的訂單，就是職員當初填的金額，兩種情況都不需要另外
    // 查一次報價單，目前記錄的金額就是正確的預設值
    const currentDepositPayment = detail.payments.find((p) => p.paymentKind === "deposit");

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
      depositAmount: currentDepositPayment?.amount ?? 0,
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
      // ⚠️ 上面只有重新整理「詳情頁面自己的內容」（detail），沒有
      // 重新整理上方月曆用的 reservations——如果這次編輯改了會影響
      // 月曆顯示的內容（例如把狀態改成「已取消」），月曆會繼續顯示
      // 編輯前的舊資料，直到使用者換月份、切回來才會看到最新狀態。
      // 跟新增訂單後同樣的道理，一併重新查一次目前這個月的月曆。
      // 這裡也套用跟新增訂單同樣的短暫延遲再查詢——研判是剛寫入的
      // 資料庫更新，緊接著馬上查詢時還沒完全反映出來，換月份時因為
      // 隔了一段使用者操作的時間，這個延遲早就過了才不會遇到（詳細
      // 說明見新增訂單那段程式碼的註解）。
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (year !== null && month !== null) {
        const rows = await fetchCalendarRange(year, month);
        setReservations(rows);
      }
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
      const result = await buildReservationConfirmationMessageAction(selectedId);
      if (!result.success) {
        setCopyError(result.message);
        return;
      }
      await navigator.clipboard.writeText(result.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : "複製失敗，請稍後再試");
    }
  }

  /** 'YYYY-MM-DD' → '2026/08/29'，用在報價日期/有效期限這種不需要
   * 顯示星期幾的地方 */
  function formatSlashDate(dateStr: string): string {
    const [y, m, d] = dateStr.split("-");
    return `${y}/${m}/${d}`;
  }

  /** 'YYYY-MM-DD' → '2026/08/29 (週四)'，入住/退房日期用——跟報價單
   * 的日期格式一致（lib/pricing/quote-message.ts 的
   * formatDateWithWeekday 是同樣的格式，只是那邊是私有函式沒有
   * export，這裡另外寫一份一樣邏輯的，不特別為此加一個新的 import
   * 依賴）。原本這裡是顯示 (15:00後)/(11:00前) 這種入住/退房時間
   * 提示，改成跟報價單一致顯示星期幾。 */
  function formatDateWithWeekdayLocal(dateStr: string): string {
    const WEEKDAY_LABELS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
    const date = new Date(`${dateStr}T00:00:00`);
    return `${formatSlashDate(dateStr)} (${WEEKDAY_LABELS[date.getDay()]})`;
  }

  function nightsLabel(checkIn: string, checkOut: string): string {
    const nights = Math.round(
      (new Date(`${checkOut}T00:00:00`).getTime() - new Date(`${checkIn}T00:00:00`).getTime()) / (1000 * 60 * 60 * 24)
    );
    return `${nights + 1}天${nights}夜`;
  }

  async function handleShareConfirmationImage() {
    if (!confirmationCardRef.current || !detail) return;
    setImageWorking(true);
    setImageError(null);

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
        setImageNote("已下載圖片，請自行傳給客人（這個瀏覽器不支援直接分享）");
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setImageError(err instanceof Error ? err.message : "圖片產生失敗，請稍後再試");
    } finally {
      setImageWorking(false);
    }
  }

  const daysInMonth = year !== null && month !== null ? getDaysInMonth(year, month) : 0;

  // 月曆格子：前面補上這個月第一天之前的空格，讓日期對齊正確的星期
  // 欄位——現在這些補位不再是空白，是真的算出上個月/下個月對應的
  // 日期，一起顯示跨月那一週前後月份的訂房狀況
  const leadingBlanks = year !== null && month !== null ? firstWeekdayOfMonth(year, month) : 0;
  const totalCells = leadingBlanks + daysInMonth;
  const weeksCount = Math.ceil(totalCells / 7) || 0;
  const calendarCells: CalendarCell[] = Array.from({ length: weeksCount * 7 }, (_, i) => {
    const offset = i - leadingBlanks; // 0-indexed，落在這個月範圍內的話對應 day = offset+1
    if (year === null || month === null) return { year: 0, month: 1, day: 1, isCurrentMonth: false };
    if (offset < 0) {
      // 補在最前面的、屬於上個月的日子
      const prev = shiftMonth(year, month, -1);
      const prevDays = getDaysInMonth(prev.year, prev.month);
      return { year: prev.year, month: prev.month, day: prevDays + offset + 1, isCurrentMonth: false };
    }
    if (offset >= daysInMonth) {
      // 補在最後面的、屬於下個月的日子
      const next = shiftMonth(year, month, 1);
      return { year: next.year, month: next.month, day: offset - daysInMonth + 1, isCurrentMonth: false };
    }
    return { year, month, day: offset + 1, isCurrentMonth: true };
  });
  // 切成一週一列（7 個一組），每一列各自算色塊要畫在哪幾欄
  const weeks: CalendarCell[][] = Array.from({ length: weeksCount }, (_, w) => calendarCells.slice(w * 7, w * 7 + 7));

  // 當月每間民宿統計訂房天數——用月曆本來就已經載入的 reservations
  // 直接算，不用另外查資料庫。跟 lib/revenue/queries.ts 算全年住房率
  // 用的是同一種邏輯：已取消的訂單不算、訂房晚數只算真正落在目前
  // 這個月份的部分（月曆資料含跨月補的天數，不能整包直接數）。
  const propertyNightsStats =
    year !== null && month !== null
      ? PROPERTIES.map((p) => {
          const nights = reservations
            .filter((r) => r.propertyCode === p.code && r.status !== "cancelled")
            .reduce((sum, r) => sum + nightsInMonth(r.checkIn, r.checkOut, year, month), 0);
          return { ...p, nights };
        })
      : [];

  return (
    <div className={`${body.className} flex min-h-screen w-full justify-center px-5 py-8`} style={{ backgroundColor: colors.canvas }}>
      <div className="w-full" style={{ maxWidth: "24rem", color: colors.ink }}>
        {/* 改成瀏覽器上一頁，不是寫死連回首頁——訂單管理現在常常是從
            其他地方（例如首頁其他功能）點進來查看/處理訂單，回上
            一頁比強制導回首頁更符合實際的使用路徑。 */}
        <button type="button" onClick={() => router.back()} className="text-xs" style={{ color: colors.blue }}>
          ← 返回上一頁
        </button>
        <header className="relative mb-6 text-center">
          <p style={{ color: colors.muted }} className="text-[11px] tracking-[0.2em]">
            宜蘭・包棟民宿
          </p>
          <h1 className={`${display.className} text-4xl italic`} style={{ color: colors.ink }}>
            訂單管理
          </h1>
          {/* 民宿篩選改成下拉選單，放在標題右邊——用 absolute 定位疊在
              標題那一行的右側，不影響上面「訂單管理」本身的置中，跟
              報價單「報價日期」疊在標題角落用的是同一種技巧 */}
          <select
            value={propertyFilter ?? ""}
            onChange={(e) => setPropertyFilter(e.target.value || null)}
            className="absolute bottom-1 right-0 border bg-transparent px-2 py-1 text-xs"
            style={{ borderColor: colors.line, color: colors.ink }}
          >
            <option value="">全部</option>
            {PROPERTIES.map((p) => (
              <option key={p.code} value={p.code}>
                {p.label}
              </option>
            ))}
          </select>
        </header>

        {/* 應收帳款整合進這個頁面，用切換按鈕在「月曆檢視」跟「應收
            帳款」之間切換——月曆內容本身用 display:none 切換隱藏/
            顯示，不是條件式掛載/卸載，這樣不用把後面一大段既有的
            月曆／訂單詳情 JSX 整段包進條件判斷，改動範圍小很多、
            比較不容易改壞。 */}
        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={() => setViewMode("calendar")}
            className="flex-1 border py-2 text-center text-xs tracking-wide"
            style={
              viewMode === "calendar"
                ? { borderColor: colors.pine, backgroundColor: colors.pine, color: colors.pineText }
                : { borderColor: colors.line, color: colors.ink }
            }
          >
            月曆檢視
          </button>
          <button
            type="button"
            onClick={() => setViewMode("receivables")}
            className="flex-1 border py-2 text-center text-xs tracking-wide"
            style={
              viewMode === "receivables"
                ? { borderColor: colors.pine, backgroundColor: colors.pine, color: colors.pineText }
                : { borderColor: colors.line, color: colors.ink }
            }
          >
            應收帳款
          </button>
        </div>

        {viewMode === "receivables" && (
          <div>
            <p className="mb-4 text-[11px]" style={{ color: colors.muted }}>
              只顯示入住日期在未來 {RECEIVABLES_SHOW_WITHIN_DAYS} 天內（含已逾期）的應收款
            </p>

            {isLoadingReceivables && (
              <p className="text-xs" style={{ color: colors.muted }}>
                讀取中…
              </p>
            )}

            {receivableError && (
              <p role="alert" className="mb-4 border-l-2 pl-3 text-xs leading-relaxed" style={{ borderColor: colors.alert, color: colors.alert }}>
                {receivableError}
              </p>
            )}

            {!isLoadingReceivables &&
              receivableRows &&
              (() => {
                const visibleRows = receivableRows
                  .filter((r) => daysUntil(r.checkIn) <= RECEIVABLES_SHOW_WITHIN_DAYS)
                  .sort((a, b) => daysUntil(a.checkIn) - daysUntil(b.checkIn));
                const totalOutstanding = visibleRows.reduce((sum, r) => sum + r.amount, 0);

                if (visibleRows.length === 0) {
                  return (
                    <p className="text-xs" style={{ color: colors.muted }}>
                      未來 {RECEIVABLES_SHOW_WITHIN_DAYS} 天內沒有應收款項。
                    </p>
                  );
                }

                return (
                  <>
                    <div className="rounded-sm px-4 py-4" style={{ backgroundColor: colors.pineSoft }}>
                      <p className="text-[11px] tracking-wide" style={{ color: colors.muted }}>
                        未收款總額（{visibleRows.length} 筆）
                      </p>
                      <p className={`${display.className} text-3xl italic`} style={{ color: colors.pine }}>
                        NT$ {totalOutstanding.toLocaleString()}
                      </p>
                    </div>

                    <div className="mt-4 flex flex-col gap-3">
                      {visibleRows.map((row) => {
                        const overdue = daysUntil(row.checkIn) < RECEIVABLES_OVERDUE_WITHIN_DAYS;
                        return (
                          <div key={row.paymentId} className="border p-3 text-xs" style={{ borderColor: overdue ? colors.alert : colors.line }}>
                            <div className="flex items-baseline justify-between">
                              <span className="font-semibold">{row.propertyName}</span>
                              <span style={{ color: overdue ? colors.alert : colors.muted }}>
                                入住：{row.checkIn}
                                {overdue ? "（已逾期）" : ""}
                              </span>
                            </div>
                            <p className="mt-1" style={{ color: colors.muted }}>
                              {row.dueDate ? `到期：${row.dueDate}　` : ""}
                              {row.reservationNo}
                            </p>
                            <p className="mt-1" style={{ color: colors.muted }}>
                              {row.guestName || "（未填姓名）"}
                              {row.guestPhone ? `　${row.guestPhone}` : ""}
                            </p>
                            <div className="mt-2 flex items-center justify-between">
                              <span className="font-semibold">
                                {PAYMENT_KIND_LABEL[row.paymentKind] ?? row.paymentKind}　NT$ {row.amount.toLocaleString()}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleMarkReceivablePaid(row.paymentId)}
                                disabled={markingPaymentId === row.paymentId}
                                className="border px-3 py-1.5 text-xs tracking-wide transition-colors disabled:opacity-50"
                                style={{ borderColor: colors.pine, color: colors.pine }}
                              >
                                {markingPaymentId === row.paymentId ? "處理中…" : "標記已收款"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
          </div>
        )}

        <div style={{ display: viewMode === "calendar" ? undefined : "none" }}>
        {!isHousekeepingManager && (
          <div className="mb-4 flex gap-2">
            <Link
              href="/quote"
              className="flex-1 border py-2 text-center text-xs tracking-wide"
              style={{ borderColor: colors.pine, color: colors.pine }}
            >
              📝 製作報價單
            </Link>
            <Link
              href="/reservations/new"
              className="flex-1 border py-2 text-center text-xs tracking-wide"
              style={{ borderColor: colors.line, color: colors.ink }}
            >
              ＋ 新增訂單
            </Link>
          </div>
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
                    {week.map((cell, i) => {
                      const now = new Date();
                      const isToday =
                        cell.year === now.getFullYear() && cell.month === now.getMonth() + 1 && cell.day === now.getDate();
                      return (
                        <div key={i} className="flex justify-center">
                          <span
                            className="flex h-4 w-4 items-center justify-center rounded-full text-[10px]"
                            style={
                              isToday
                                ? { backgroundColor: colors.pine, color: "#FFFFFF" }
                                : { color: cell.isCurrentMonth ? colors.ink : colors.muted, opacity: cell.isCurrentMonth ? 1 : 0.5 }
                            }
                          >
                            {cell.day}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-1 flex flex-col gap-[3px]">
                    {(propertyFilter ? PROPERTIES.filter((p) => p.code === propertyFilter) : PROPERTIES).map((property) => {
                      // 已取消的訂單不應該繼續佔用月曆上的格子——這
                      // 個日期實際上是空的、可以重新接受訂房，如果
                      // 已取消的訂單還畫在月曆上，會誤導成「這天已經
                      // 被訂走了」
                      const propertyReservations = reservations.filter(
                        (r) => r.propertyCode === property.code && r.status !== "cancelled"
                      );
                      const segments = computeWeekSegments(week, propertyReservations);
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

                      {/* 訂金金額——預設帶入目前已經記錄的金額（見
                          startEdit() 的說明），可以直接改；尾款會用
                          「總金額－這裡填的訂金」重算 */}
                      <div className="mt-2">
                        <NumberField
                          label="訂金金額"
                          value={editFields.depositAmount}
                          onChange={(v) => updateEditField("depositAmount", v)}
                        />
                      </div>
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
                    {!isHousekeepingManager && (
                      <>
                        <p className="text-xs font-bold" style={{ color: colors.ink }}>
                          付款狀況
                        </p>
                        <select
                          value={detail.paymentStatus}
                          onChange={(e) => handleChangePaymentStatus(e.target.value)}
                          disabled={isUpdatingPaymentStatus}
                          className="mt-1 w-full border-b bg-transparent py-1.5 text-sm outline-none disabled:opacity-50"
                          style={{ borderColor: colors.line, color: colors.ink }}
                        >
                          {Object.entries(RESERVATION_PAYMENT_STATUS_LABEL).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                        {detail.status === "cancelled" && detail.paymentStatus === "deposit_forfeited" && (
                          <p className="mt-1 text-[11px] leading-relaxed" style={{ color: colors.pine }}>
                            ⚠️
                            這筆訂單已取消、付款狀況是「沒收訂金」——訂金金額會照樣計入這個月的營收（用實際收到的訂金金額，不是訂單總金額），住房天數不會計入。
                          </p>
                        )}
                        {isUpdatingPaymentStatus && (
                          <p className="mt-1 text-[11px]" style={{ color: colors.muted }}>
                            更新中…
                          </p>
                        )}
                        {paymentStatusError && (
                          <p role="alert" className="mt-1 text-[11px]" style={{ color: colors.alert }}>
                            {paymentStatusError}
                          </p>
                        )}

                        {detail.payments.length > 0 && (
                          <div className="mt-2 flex flex-col gap-1.5 text-xs">
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
                        )}
                      </>
                    )}

                    <div className="mt-3 border-t pt-3" style={{ borderColor: colors.line }} />
                    <InfoRow label="訂單編號" value={detail.reservationNo} />
                    <InfoRow label="預訂日期" value={formatSlashDate(detail.createdAt.slice(0, 10))} />
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

                          <button
                            type="button"
                            onClick={handleShareConfirmationImage}
                            disabled={imageWorking}
                            className="mt-2 w-full border py-2.5 text-xs tracking-wide transition-colors disabled:opacity-50"
                            style={{ borderColor: colors.line, backgroundColor: "transparent", color: colors.ink }}
                          >
                            {imageWorking ? "圖片產生中…" : "🖼️ 轉成圖片"}
                          </button>
                          {imageError && (
                            <p className="mt-2 text-[11px]" style={{ color: colors.alert }}>
                              {imageError}
                            </p>
                          )}
                          {imageNote && (
                            <p className="mt-2 text-[11px]" style={{ color: colors.pine }}>
                              {imageNote}
                            </p>
                          )}

                          {/* 隱藏的訂房確認單卡片，只用來截圖產生分享用的圖片，
                              畫面上不會顯示。⚠️ 這裡刻意不用
                              position: fixed——iOS Safari 對於「螢幕外的
                              fixed 元素」的版面計算/渲染有很多已知的
                              相容性問題（WebKit bug tracker 上有大量
                              相關回報），實際發生過的症狀就是截出來的
                              圖片最上方的標題不見了。改用
                              position: absolute 放在一個高度是 0、
                              overflow:hidden 的外層容器裡——元素還是
                              留在正常的版面配置流程中（量測尺寸才會
                              準確），視覺上完全不影響頁面，同時避開
                              fixed 定位在 iOS 上的已知問題。跟
                              quote-form.tsx/quotes-search.tsx 用同一套
                              html-to-image 技術，維持風格一致 */}
                          <div style={{ height: 0, overflow: "hidden" }}>
                          <div style={{ position: "absolute", left: "-9999px", top: 0 }}>
                            <div
                              ref={confirmationCardRef}
                              className={body.className}
                              style={{ width: "375px", backgroundColor: colors.canvas }}
                            >
                              <div className="relative px-6 pb-6 pt-8 text-center" style={{ backgroundColor: CONFIRM_DARK }}>
                                <p className={`${display.className} text-2xl italic`} style={{ color: "#FFFFFF" }}>
                                  {detail.propertyName}私人會所
                                </p>
                                <div className="relative mt-1" style={{ minHeight: "24px" }}>
                                  <p className="tracking-[0.3em]" style={{ color: CONFIRM_LIGHT, fontSize: "16px" }}>
                                    訂房確認單
                                  </p>
                                  <div
                                    className="absolute right-0 bottom-0 text-right text-[8px] leading-tight"
                                    style={{ color: CONFIRM_LIGHT }}
                                  >
                                    <p>預訂日期：{formatSlashDate(detail.createdAt.slice(0, 10))}</p>
                                  </div>
                                </div>
                              </div>
                              <div className="px-6 py-5 text-xs leading-relaxed" style={{ color: colors.ink }}>
                                <p className="mt-1 font-bold">📅 預訂資訊</p>
                                <p className="mt-1">• 入住日期：{formatDateWithWeekdayLocal(detail.checkIn)}</p>
                                <p>• 退房日期：{formatDateWithWeekdayLocal(detail.checkOut)}</p>
                                <p>• 預訂天數：{nightsLabel(detail.checkIn, detail.checkOut)}</p>
                                <p>
                                  • 入住人數：{detail.adults}大
                                  {detail.children ? ` ${detail.children}小` : ""}
                                  {detail.infants ? ` ${detail.infants}幼` : ""}
                                  {detail.pets ? ` ${detail.pets}寵` : ""}
                                </p>
                                <p>
                                  • 使用房數：
                                  {detail.roomAllocation.fourPersonSuiteCount +
                                    detail.roomAllocation.fourPersonDowngradeCount +
                                    detail.roomAllocation.doubleSuiteCount +
                                    detail.roomAllocation.doublePlainCount}{" "}
                                  間房
                                </p>
                                {/* 包棟總費用——改成跟報價單一樣的強調框，背景換成
                                    淺焦糖／拿鐵色（CONFIRM_LIGHT），跟上面標題的深
                                    咖啡色（CONFIRM_DARK）同一個色系、深淺搭配，取代
                                    原本文字版的訂金/尾款條列 */}
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
                                            {depositPayment?.paidAt
                                              ? `（收到日期：${depositPayment.paidAt.slice(5, 10).replace("-", "/")}）`
                                              : ""}
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
                                  return balancePayment ? <p className="mt-2">⚠️ 尾款請於入住前一星期匯款。</p> : null;
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
                        </>
                      )}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* 當月每間民宿統計訂房天數——放在頁面最下方，不管有沒有選取
            某一筆訂單都會顯示，不用另外查資料庫，直接用月曆已經載入
            的資料算 */}
        {propertyNightsStats.length > 0 && (
          <div className="mt-8 border-t pt-4" style={{ borderColor: colors.line }}>
            <p className="mb-2 text-xs font-bold" style={{ color: colors.ink }}>
              {year} 年 {month} 月 各民宿訂房天數
            </p>
            <div className="flex flex-col gap-1.5 text-xs">
              {propertyNightsStats.map((p) => (
                <div key={p.code} className="flex items-baseline justify-between">
                  <span style={{ color: colors.muted }}>{p.label}</span>
                  <span style={{ color: colors.ink }}>{p.nights} 天</span>
                </div>
              ))}
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
