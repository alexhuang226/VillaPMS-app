"use client";

/**
 * 報價表單元件 — 意式極簡風格
 *
 * v7 修正紀錄：
 * - 收據標頭：民宿名稱在上（大字），「包棟報價單」在下，字級固定
 *   16px
 * - 「(提供1床，以雙人套房計費)」改回接在「四人套房」後面，不再
 *   另起一行
 * - 進階選項：訪客人數移到跟加開房間數量同一列；加固定床／加臨時床／
 *   加開房間數量改成下拉選單（不用自己打字）。加臨時床的選項上限
 *   會依選的民宿即時變動（只此清綠4／陌隱1／水景璞堤2），切換民宿
 *   時如果原本填的數字超過新上限也會自動夾回上限
 * - 費用明細：改成用 accommodationDayGroups 以「天」分組（連續訂房
 *   時同一晚的房型不會每行都重複日期），單價×數量用 CSS Grid 排版
 *   讓數字上下對齊，整個費用明細區塊不再加粗
 * - 預訂須知每一項前面加「・」符號；「3歲以下幼童不算佔床」改成
 *   「・3歲以下幼童不算佔床。」的完整句子格式；退改政策文字微調
 *   （拿掉重複的「宜蘭」、補上逗號）
 *
 * v6 修正紀錄：
 * - 房型配置改成「雙人雅房→雙人套房→四人套房→四人套房(降規)」的順序
 * - 「加購項目」改名「額外項目」
 * - 入住日期一變更，退房日期永遠重設成入住日期+1天（不再嘗試保留
 *   使用者手動延長的退房日期，行為比較好預測，見 handleCheckInChange
 *   的說明）
 * - 進階選項欄位順序調整：訪客人數移到加開房間數量後面
 * - 新增發票稅金：勾選「需要開立發票」時，包棟總費用會加上折扣後
 *   小計的 8%，費用明細會列出這筆稅金
 * - 加固定床/加臨時床的數量現在有上限驗證（見
 *   property-room-allocation.ts 的 checkExtraBedLimits）
 * - 陌隱／水景璞堤的住宿費用計算 bug 修正：四人套房降規的房間之前
 *   被算成 $0（見 calculate-package-total.ts 的說明）
 * - 報價收據（receiptRef，也是轉圖片的範圍）整個重新設計：深綠色
 *   標頭、每個段落加 icon、總金額框淡綠底色，不再是純文字堆疊；
 *   內容區塊自己有 padding，轉圖片不會再貼齊邊緣；匯款帳號文字改大
 *   加粗；轉圖片前會等字型載入完成、並用實際內容尺寸截圖，避免
 *   下緣被裁掉
 *
 * v5 修正紀錄：
 * - 標題加大置中；「進階選項」改成粗體＋藍色，比較顯眼
 * - 四人套房降規那行的說明文字「(提供1床，以雙人套房計費)」改成
 *   另起一行顯示，不會跟數量擠在同一行
 * - 加購項目名稱對齊 services 表的服務名稱（例如「餐車」→「餐車
 *   場地費」）
 * - 費用明細改大字＋粗體，並且逐項列出每個加購項目「各自的金額」
 *   （之前只顯示一個籠統的「額外服務」加總數字）
 * - 連續訂房（2 晚以上）時，費用明細會逐晚列出每晚房價，不是只顯示
 *   一個住宿費用總額
 * - 報價收據區塊（receiptRef，也是轉圖片的截圖範圍）新增「匯款帳號」
 *   跟「預訂須知」（包棟基本人數／房型訂價參考／退改政策），跟複製
 *   文字版的內容一致——轉出來的圖片會包含這兩塊
 * - 上一輪為了排查加購費用問題加的「🔧 除錯資訊」區塊已移除
 *
 * v4 修正紀錄：
 * - 報價結果畫面新增「預訂資訊」區塊（民宿／日期／人數／房型配置），
 *   跟「費用明細」一起顯示在複製/分享之前，方便複製前先目視確認。
 * - 修正 RLS 導致房間數量／服務價格查到 0 筆的問題：見
 *   lib/supabase/service-role.ts 與 lib/pricing/queries.ts 的說明。
 * - 新增「轉成圖片分享」按鈕：用 html-to-image 把報價收據區塊轉成
 *   PNG，手機上會呼叫原生分享選單（可以直接選 LINE），桌機或不支援
 *   分享 API 的瀏覽器則直接下載圖片檔。
 *   ⚠️ 需要先安裝套件：npm install html-to-image
 *
 * v3 修正紀錄（寬度撐滿畫面／文字太淡）：
 * 顏色與「最大寬度／置中」全部改用 inline style 直接寫在元素上，不用
 * Tailwind 的 `bg-[#...]` / `text-[#...]` / `max-w-sm` 這類 class，
 * 因為 inline style 的優先權比任何一般 CSS 選擇器都高，不管專案的
 * Tailwind 掃描路徑或全域 CSS 有沒有衝突都會正確顯示。版面用的
 * flex/grid/間距還是用 Tailwind class。focus 狀態用一個小 <style>
 * 標籤搭配 .qf-input class 處理（inline style 沒辦法寫 :focus 偽類）。
 */

import { useEffect, useRef, useState, Fragment } from "react";
import { useRouter } from "next/navigation";
import { Fraunces, Work_Sans } from "next/font/google";
import { calculateAndSaveQuoteAction } from "@/app/actions/quote";
import { calculateAutoRoomAllocationAction } from "@/app/actions/reservation";
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
import { DOUBLE_PLAIN_ROOM_TOTAL, DOUBLE_SUITE_ROOM_TOTAL, EXTRA_BED_TEMP_MAX, FOUR_PERSON_ROOM_TOTAL } from "@/lib/pricing/property-room-allocation";
import type { PackageQuote, PropertyCode, RoomAllocationOverride, StayRequest } from "@/lib/pricing/types";


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

interface FormState {
  propertyCode: PropertyCode;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  infants: number;
  pets: number;
  extraBedFixedQty: number;
  extraBedTempQty: number;
  extraRoomQty: number;
  visitorQty: number;
  discountAmount: number;
  bbq: boolean;
  foodTruck: boolean;
  earlyCheckin: boolean;
  needsInvoice: boolean;
  useRoomOverride: boolean;
  overrideFourPersonSuiteCount: number;
  overrideFourPersonDowngradeCount: number;
  overrideDoubleSuiteCount: number;
  overrideDoublePlainCount: number;
}

const initialState: FormState = {
  propertyCode: "zhici",
  // 入住/退房日期改成 mount 後由 useEffect 補上預設值（見下方
  // getDefaultCheckIn 說明），這裡先留空字串，避免 SSR 跟 client
  // 算出的「今天」不一樣造成 hydration 不一致的警告/閃爍。
  checkIn: "",
  checkOut: "",
  adults: 10,
  children: 0,
  infants: 0,
  pets: 0,
  extraBedFixedQty: 0,
  extraBedTempQty: 0,
  extraRoomQty: 0,
  visitorQty: 0,
  discountAmount: 0,
  bbq: false,
  foodTruck: false,
  earlyCheckin: false,
  needsInvoice: false,
  useRoomOverride: false,
  overrideFourPersonSuiteCount: 0,
  overrideFourPersonDowngradeCount: 0,
  overrideDoubleSuiteCount: 0,
  overrideDoublePlainCount: 0,
};

/**
 * 'YYYY-MM-DD' 字串加一天，回傳新的 'YYYY-MM-DD' 字串。
 *
 * 原本的寫法是 `new Date(dateStr + "T00:00:00")` 用「不帶時區」的字串
 * 建構 Date，這會被瀏覽器解析成「本地時間」的午夜；但最後用
 * `toISOString()` 取字串時，`toISOString()` 一定是輸出 UTC 時間。
 * 台灣是 UTC+8，本地午夜換算成 UTC 是「前一天下午 4 點」，
 * `toISOString().slice(0,10)` 取到的日期就會被推回前一天，等於
 * 「加一天」的動作在轉換過程中被吃掉了。
 *
 * 修正方式：從頭到尾都用 UTC 操作（建構時補上 Z，用 setUTCDate 而不是
 * setDate），這樣就不會有本地時區跟 UTC 之間的轉換落差，純粹是字串
 * 對應的日曆日期 +1，跟使用者在哪個時區無關。
 */
function addOneDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Date 物件轉成「本地日曆日期」的 'YYYY-MM-DD'，不透過 toISOString()
 * （toISOString 一定轉成 UTC，會有跟上面同樣的時區位移問題）。 */
function formatLocalDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 預設入住日期：今天（使用者所在時區的今天）起一個月後，'YYYY-MM-DD' */
function getDefaultCheckIn(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return formatLocalDate(d);
}

function buildStayRequest(form: FormState): StayRequest {
  const roomOverride: RoomAllocationOverride | undefined = form.useRoomOverride
    ? {
        fourPersonSuiteCount: form.overrideFourPersonSuiteCount,
        fourPersonDowngradeCount: form.overrideFourPersonDowngradeCount,
        doubleSuiteCount: form.overrideDoubleSuiteCount,
        doublePlainCount: form.overrideDoublePlainCount,
      }
    : undefined;

  return {
    propertyCode: form.propertyCode,
    checkIn: form.checkIn,
    checkOut: form.checkOut,
    adults: form.adults,
    children: form.children,
    infants: form.infants,
    pets: form.pets,
    extraBedFixedQty: form.extraBedFixedQty,
    extraBedTempQty: form.extraBedTempQty,
    extraRoomQty: form.extraRoomQty,
    visitorQty: form.visitorQty,
    discountAmount: form.discountAmount,
    addOns: { bbq: form.bbq, foodTruck: form.foodTruck, earlyCheckin: form.earlyCheckin },
    // 抬頭/統編等客人確認訂房時才收集（見 quotes-search.tsx），
    // 這裡只需要 required 這個布林值，因為它會影響 8% 稅金要不要
    // 計入報價金額。
    invoice: { required: form.needsInvoice },
    roomOverride,
  };
}

/** 緊湊型數字輸入：底線樣式，label 在上方，數字置中。
 * 內部用自己的字串狀態(raw)顯示，不直接綁定父層的數字 value——
 * 如果直接綁 value={value}，欄位是 0 的時候使用者刪掉那個「0」，
 * onChange 收到空字串會被 Number("") 轉成 0，畫面又立刻被 React
 * 蓋回「0」，使用者永遠刪不掉，只能先打數字再回頭刪除 0，體驗很差。
 * 拆成獨立的內部字串狀態後，允許輸入框暫時顯示空字串，離開欄位
 * (onBlur) 時才補回「0」，同時每次有效輸入都會即時回報數字給父層。 */
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
        className="qf-input w-full border-b bg-transparent py-1 text-center text-sm outline-none"
        style={{ borderColor: colors.line, color: colors.ink }}
      />
    </label>
  );
}

/** 下拉選單版的數字欄位：0 到 max（含）逐一列出，給有明確數量上限的
 * 欄位用（加固定床／加臨時床／加開房間數量），比自由輸入更不容易
 * 手滑填超過範圍。 */
function SelectField({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  max: number;
}) {
  const options = Array.from({ length: max + 1 }, (_, i) => i);
  return (
    <label className="flex flex-col gap-1">
      <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
        {label}
      </span>
      <select
        value={Math.min(value, max)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="qf-input w-full border-b bg-transparent py-1 text-center text-sm outline-none"
        style={{ borderColor: colors.line, color: colors.ink }}
      >
        {options.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}

/** 藥丸型切換按鈕，用於單選（民宿）與複選（額外服務） */
function PillToggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border px-3 py-1.5 text-xs transition-colors"
      style={
        active
          ? { borderColor: colors.pine, backgroundColor: colors.pine, color: colors.pineText }
          : { borderColor: colors.line, backgroundColor: "transparent", color: colors.ink }
      }
    >
      {label}
    </button>
  );
}

/** 小型羅馬數字段落標題，做為版面的節奏標記 */
function SectionMark({ index, title }: { index: string; title: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <span className={`${display.className} text-sm italic`} style={{ color: colors.pine }}>
        {index}
      </span>
      <span style={{ color: colors.muted }} className="text-xs tracking-wide">
        {title}
      </span>
      <span className="h-px flex-1" style={{ backgroundColor: colors.line }} />
    </div>
  );
}

/** 報價有效期限——套用一般 hotel 業界慣例，報價日期起算 14 天
 * （兩週）。這裡的報價日期就是「今天」，因為這份報價正在被建立。
 * 用本地時區的年/月/日組字串，不要用 toISOString()（那是 UTC，
 * 台灣時間接近午夜前後那幾個小時會算出前一天的日期，跟畫面上其他
 * 地方一貫的本地時區日期處理方式不一致）。 */
const QUOTE_VALIDITY_DAYS = 14;
function todayYMD(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function addDaysToYMD(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** 'YYYY-MM-DD' → '2026/08/29'，標題右上角空間有限，用比 formatDateWithWeekday
 * （帶星期幾文字）更精簡的格式 */
function formatSlashDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${y}/${m}/${d}`;
}

/** 報價收據用的段落標題：icon + 標題文字，跟複製文字版的 emoji 對應，
 * 讓螢幕/圖片版跟複製文字版看起來是「同一份東西」的兩種呈現方式 */
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

export function QuoteForm() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(initialState);
  const [quote, setQuote] = useState<PackageQuote | null>(null);
  /** 依目前填的民宿/人數，系統原本會自動建議的房型配置——顯示在
   * 「手動調整房型」上方當參考，讓職員知道系統原本的建議是什麼，
   * 再決定要怎麼調整，不用憑空猜 */
  const [autoSuggestedAllocation, setAutoSuggestedAllocation] = useState<{
    fourPersonSuiteCount: number;
    fourPersonDowngradeCount: number;
    doubleSuiteCount: number;
    doublePlainCount: number;
  } | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [imageWorking, setImageWorking] = useState(false);
  const [imageNote, setImageNote] = useState<string | null>(null);
  const [savedQuoteNo, setSavedQuoteNo] = useState<string | null>(null);
  const receiptRef = useRef<HTMLDivElement>(null);

  // 預設入住日期＝今天起一個月後，退房日期＝入住日期+1天。
  // 放在 useEffect（只在瀏覽器端 mount 後執行一次）而不是直接寫在
  // initialState 裡，是為了避免 SSR 當下算出的「今天」跟瀏覽器
  // hydrate 當下的「今天」不一致（例如頁面是靜態預先產生的），
  // 造成 hydration mismatch 警告或畫面短暫閃爍。
  useEffect(() => {
    const defaultCheckIn = getDefaultCheckIn();
    setForm((prev) => ({
      ...prev,
      checkIn: defaultCheckIn,
      checkOut: addOneDay(defaultCheckIn),
    }));
  }, []);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  /**
   * 切換民宿時，好幾個欄位的上限都會跟著換（加臨時床、手動調整房型
   * 的四個房型數量），如果目前填的數字超過新民宿的上限，一併夾回
   * 上限，避免送出一個新民宿根本不允許的數字。
   */
  function handlePropertyChange(propertyCode: PropertyCode) {
    setForm((prev) => {
      const fourPersonMax = FOUR_PERSON_ROOM_TOTAL[propertyCode] ?? 0;
      const overrideFourPersonSuiteCount = Math.min(prev.overrideFourPersonSuiteCount, fourPersonMax);
      return {
        ...prev,
        propertyCode,
        extraBedTempQty: Math.min(prev.extraBedTempQty, EXTRA_BED_TEMP_MAX[propertyCode] ?? 0),
        extraBedFixedQty: Math.min(prev.extraBedFixedQty, fourPersonMax),
        overrideFourPersonSuiteCount,
        overrideFourPersonDowngradeCount: Math.min(
          prev.overrideFourPersonDowngradeCount,
          Math.max(0, fourPersonMax - overrideFourPersonSuiteCount)
        ),
        overrideDoubleSuiteCount: Math.min(prev.overrideDoubleSuiteCount, DOUBLE_SUITE_ROOM_TOTAL[propertyCode] ?? 0),
        overrideDoublePlainCount: Math.min(prev.overrideDoublePlainCount, DOUBLE_PLAIN_ROOM_TOTAL[propertyCode] ?? 0),
      };
    });
  }

  /** 這間民宿的四人套房實體房間總數，「四人套房」「降規四人套房」兩個
   * 下拉選單的上限都靠它算，元件裡多處要用，抽出來共用一次就好 */
  const fourPersonRoomMax = FOUR_PERSON_ROOM_TOTAL[form.propertyCode] ?? 0;

  // 民宿/人數改變時，重新查一次系統原本會自動建議的房型配置，顯示
  // 在「手動調整房型」上方當參考。這個計算需要查資料庫（每間民宿
  // 實際的房間數），沒辦法純前端算，所以呼叫跟「新增訂單」表單
  // 共用的同一個 action（calculateAutoRoomAllocationAction），確保
  // 兩邊看到的建議邏輯完全一致。
  useEffect(() => {
    let cancelled = false;
    calculateAutoRoomAllocationAction(form.propertyCode, form.adults, form.children)
      .then((result) => {
        if (!cancelled) setAutoSuggestedAllocation(result);
      })
      .catch(() => {
        // 這只是輔助參考顯示，查詢失敗不影響報價表單其他功能，
        // 安靜失敗就好
      });
    return () => {
      cancelled = true;
    };
  }, [form.propertyCode, form.adults, form.children]);

  /**
   * 手動調整房型的「四人套房」數量一改，「降規四人套房」的上限
   * （= 四人套房總數 - 手選的四人套房數量）也會跟著變小，如果原本
   * 填的降規數量超過新的上限，一併夾回上限。
   */
  function handleOverrideFourPersonSuiteChange(next: number) {
    setForm((prev) => ({
      ...prev,
      overrideFourPersonSuiteCount: next,
      overrideFourPersonDowngradeCount: Math.min(
        prev.overrideFourPersonDowngradeCount,
        Math.max(0, fourPersonRoomMax - next)
      ),
    }));
  }

  /**
   * 入住日期一變更，退房日期永遠重設成「入住日期 +1 天」，不管新選的
   * 入住日期比現有退房日期早還是晚、也不管退房日期是不是被手動改過。
   * 之前的版本會判斷「退房日期是不是已經晚於新的入住日期」，是的話
   * 就保留原本的退房日期不動——這個保留邏輯造成兩個不直覺的情況：
   * 入住日期選到比現有退房日期早的時候不會自動+1天，以及退房日期
   * 手動改過之後再調整入住日期，退房日期也不會跟著動。現在統一成
   * 「只要動了入住日期，退房日期就重算」，行為比較好預測；如果要訂
   * 多晚，請先選好入住日期，再手動把退房日期往後調。
   */
  function handleCheckInChange(newCheckIn: string) {
    setForm((prev) => ({
      ...prev,
      checkIn: newCheckIn,
      checkOut: newCheckIn ? addOneDay(newCheckIn) : prev.checkOut,
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    setWarning(null);
    setQuote(null);
    setCopied(false);
    setImageNote(null);
    setSavedQuoteNo(null);

    try {
      // 這裡不收客人姓名/電話——報價階段還不確定客人一定會訂，姓名/
      // 電話等到 /quotes 那邊「確認訂房」時才收集並補回這筆快照。
      const { quote: result, quoteNo } = await calculateAndSaveQuoteAction(buildStayRequest(form));

      if (result.minimumGuestsWarning) {
        setWarning(result.minimumGuestsWarning);
        return;
      }
      if (result.roomConfigWarning) {
        setWarning(result.roomConfigWarning);
        return;
      }
      if (result.capacityWarning) {
        setWarning(result.capacityWarning);
        return;
      }
      setQuote(result);
      if (quoteNo) {
        setSavedQuoteNo(quoteNo);
      } else {
        setImageNote("⚠️ 報價已算出，但這次存檔沒有成功，之後可能找不到這筆紀錄");
      }
    } catch (err) {
      setWarning(err instanceof Error ? err.message : "報價計算失敗，請稍後再試");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCopy() {
    // messageContext/roomAllocation 只有在完全沒有警告、報價成功算出來
    // 時才會有值（見 calculatePackageQuote 的說明），這裡防呆一下，
    // 理論上會走到這裡代表 quote 已經是乾淨的報價，一定會有值。
    if (!quote || !quote.messageContext || !quote.roomAllocation) return;
    const text = buildQuoteMessage(quote);

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setWarning("複製失敗，請手動選取文字複製");
    }
  }

  /**
   * 把報價收據區塊（receiptRef）轉成 PNG 圖片。
   * 手機瀏覽器支援 Web Share API 且能分享檔案時，直接呼叫原生分享
   * 選單（LINE 會是選項之一，點下去就能直接傳給正在聊天的客人）；
   * 不支援時（多半是桌機瀏覽器）退回直接下載圖片檔，請自己傳給客人。
   */
  async function handleShareImage() {
    if (!receiptRef.current) return;
    setImageWorking(true);
    setImageNote(null);
    // 記錄有沒有真的動過寬度、原本的寬度是什麼，這樣不管中間哪個
    // 步驟丟出例外，都能在最下面的 finally 保證改回去，不會把頁面
    // 卡在被截圖用的暫時寬度
    let widthWasOverridden = false;
    let originalWidth = "";

    try {
      // 等 next/font 載入的字型（Fraunces/Work Sans）完全就緒再截圖，
      // 不然截圖當下字型可能還沒套用完成，量到的高度跟實際排版後的
      // 高度對不起來，會讓下方內容被裁掉。
      if (typeof document !== "undefined" && document.fonts?.ready) {
        await document.fonts.ready;
      }

      const node = receiptRef.current;
      // ⚠️ 一般手機瀏覽器的畫面寬度（375～430px 左右）遠比整份收據
      // 設計時假設的寬度（40rem／640px）窄很多——收據本身是用
      // w-full + max-width 做響應式排版，在手機上會被壓縮到跟螢幕
      // 一樣窄，這時候某些原本該在一行內顯示完的內容（例如銀行帳號
      // 那一排）會被擠到換行。網頁上這樣顯示沒問題（響應式排版本來
      // 就該這樣），但截圖的時候如果直接用 node.scrollWidth（當下
      // 實際渲染的寬度），截出來的圖片就會是「手機螢幕寬度」的窄
      // 版本，帶著這些不必要的換行。
      // 這裡在截圖前，暫時把寬度強制改成比較寬的固定值，讓內容重新
      // 排版成「設計寬度」該有的樣子，截圖後再把寬度改回去（清空
      // inline style，讓它恢復成原本响應式的 w-full 行為），不影響
      // 使用者接下來繼續操作頁面看到的畫面。
      originalWidth = node.style.width;
      node.style.width = "480px";
      widthWasOverridden = true;
      // 改寬度後瀏覽器要重新排版才會反映到 scrollWidth/scrollHeight，
      // 用兩次 requestAnimationFrame 確保至少經過一次繪製週期
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

      // 明確指定寬高，用 scrollWidth/scrollHeight（完整內容的實際尺寸，
      // 不受目前畫面捲動位置影響）取代預設量法，避免圖片下緣被裁切。
      const { toBlob } = await import("html-to-image");
      const blob = await toBlob(node, {
        pixelRatio: 2, // 手機螢幕通常是高解析度，2x 避免圖片模糊
        backgroundColor: colors.canvas,
        width: node.scrollWidth,
        height: node.scrollHeight,
      });
      if (!blob) throw new Error("圖片產生失敗，請再試一次");

      const propertyLabel =
        quote?.messageContext?.propertyName ??
        PROPERTY_OPTIONS.find((opt) => opt.value === form.propertyCode)?.label ??
        "報價單";
      const file = new File([blob], `${propertyLabel}-報價單.png`, { type: "image/png" });

      const canShareFiles =
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] });

      if (canShareFiles) {
        await navigator.share({ files: [file], title: `${propertyLabel} 包棟報價單` });
      } else {
        // 桌機或不支援分享 API 的瀏覽器：直接觸發下載
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = file.name;
        link.click();
        URL.revokeObjectURL(url);
        setImageNote("已下載圖片，請自行傳給客人（這個瀏覽器不支援直接分享）");
      }
    } catch (err) {
      // 使用者在分享選單按「取消」也會被視為 AbortError，不算真的失敗
      if (err instanceof Error && err.name === "AbortError") return;
      setWarning(err instanceof Error ? err.message : "圖片產生失敗，請稍後再試");
    } finally {
      // 不管上面成功還是中途出錯，只要真的動過寬度就一定要改回去，
      // 不然頁面會卡在被截圖用的暫時寬度，使用者接下來看到的畫面
      // 會不正常
      if (widthWasOverridden && receiptRef.current) {
        receiptRef.current.style.width = originalWidth;
      }
      setImageWorking(false);
    }
  }

  return (
    <div
      className={`${body.className} qf-root flex min-h-screen w-full justify-center px-5`}
      style={{
        backgroundColor: colors.canvas,
        // ⚠️ 這個 app 整體是 viewport-fit=cover（見 app/layout.tsx 的
        // viewport 設定），內容本來就會延伸到瀏海/圓角這些安全區域
        // 底下，所以每個頁面自己都要處理安全區域的留白，不能只靠
        // 固定的 py-8——用 max() 確保「原本設計的 32px」跟「這台裝置
        // 實際的瀏海/圓角安全區域」兩者取比較大的那個，沒有瀏海的
        // 裝置維持原本 32px，有瀏海的裝置會自動多留一點，不會被
        // 瀏海蓋住最上面的內容。
        paddingTop: "max(2rem, env(safe-area-inset-top))",
        paddingBottom: "max(2rem, env(safe-area-inset-bottom))",
      }}
    >
      {/* focus 狀態用 :focus 偽類處理，inline style 無法直接寫偽類，
          用 !important 蓋過元素本身的 inline borderColor */}
      <style>{`
        .qf-root .qf-input:focus { border-color: ${colors.pine} !important; }
      `}</style>

      <div className="w-full" style={{ maxWidth: "40rem", color: colors.ink }}>
        {/* 改成瀏覽器上一頁，不是寫死連回首頁——這個頁面現在主要是從
            訂單管理（月曆上方「製作報價單」按鈕）點進來的，回上一頁
            實際上就是回到訂單管理，比強制導回首頁更符合現在的使用
            方式；如果偶爾是從其他地方點進來的，也能正確回到那裡，
            不是寫死一個固定目的地。 */}
        <button type="button" onClick={() => router.back()} className="text-xs" style={{ color: colors.blue }}>
          ← 返回上一頁
        </button>
        <header className="mb-6 text-center">
          <p style={{ color: colors.muted }} className="text-[11px] tracking-[0.2em]">
            宜蘭・包棟民宿
          </p>
          <h1 className={`${display.className} text-4xl italic`} style={{ color: colors.ink }}>
            報價試算
          </h1>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <section>
            <SectionMark index="Ⅰ" title="民宿與日期" />

            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                {PROPERTY_OPTIONS.map((opt) => (
                  <PillToggle
                    key={opt.value}
                    label={opt.label}
                    active={form.propertyCode === opt.value}
                    onClick={() => handlePropertyChange(opt.value)}
                  />
                ))}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <label className="flex flex-col gap-1">
                  <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                    入住
                  </span>
                  <input
                    type="date"
                    value={form.checkIn}
                    onChange={(e) => handleCheckInChange(e.target.value)}
                    required
                    className="qf-input w-full border-b bg-transparent py-1 text-sm outline-none"
                    style={{ borderColor: colors.line, color: colors.ink }}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                    退房
                  </span>
                  <input
                    type="date"
                    value={form.checkOut}
                    min={form.checkIn || undefined}
                    onChange={(e) => update("checkOut", e.target.value)}
                    required
                    className="qf-input w-full border-b bg-transparent py-1 text-sm outline-none"
                    style={{ borderColor: colors.line, color: colors.ink }}
                  />
                </label>
              </div>
            </div>
          </section>

          <section>
            <SectionMark index="Ⅱ" title="入住人數" />
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-4">
                <NumberField label="大人" value={form.adults} onChange={(v) => update("adults", v)} />
                <NumberField label="小孩" value={form.children} onChange={(v) => update("children", v)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <NumberField label="嬰幼兒" value={form.infants} onChange={(v) => update("infants", v)} />
                <NumberField label="寵物" value={form.pets} onChange={(v) => update("pets", v)} />
              </div>
            </div>
          </section>

          <section>
            <SectionMark index="Ⅲ" title="額外服務" />
            <div className="flex flex-wrap gap-2">
              <PillToggle label="烤肉" active={form.bbq} onClick={() => update("bbq", !form.bbq)} />
              <PillToggle label="餐車" active={form.foodTruck} onClick={() => update("foodTruck", !form.foodTruck)} />
              <PillToggle
                label="提前入住"
                active={form.earlyCheckin}
                onClick={() => update("earlyCheckin", !form.earlyCheckin)}
              />
            </div>
          </section>

          <details className="group">
            <summary
              style={{ color: colors.blue }}
              className="cursor-pointer list-none text-xs font-bold tracking-wide"
            >
              <span className="inline-flex items-center gap-1">
                進階選項 — 訪客・加床加房・折扣・發票・房型調整
                <span className="transition-transform group-open:rotate-180">⌄</span>
              </span>
            </summary>

            <div className="mt-4 flex flex-col gap-6 border-t pt-4" style={{ borderColor: colors.line }}>
              <div className="grid grid-cols-2 gap-3">
                <SelectField
                  label="加固定床"
                  value={form.extraBedFixedQty}
                  onChange={(v) => update("extraBedFixedQty", v)}
                  max={FOUR_PERSON_ROOM_TOTAL[form.propertyCode] ?? 0}
                />
                <SelectField
                  label="加臨時床"
                  value={form.extraBedTempQty}
                  onChange={(v) => update("extraBedTempQty", v)}
                  max={EXTRA_BED_TEMP_MAX[form.propertyCode] ?? 0}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <SelectField
                  label="加開房間數量"
                  value={form.extraRoomQty}
                  onChange={(v) => update("extraRoomQty", v)}
                  max={3}
                />
                <NumberField label="訪客人數" value={form.visitorQty} onChange={(v) => update("visitorQty", v)} />
              </div>

              <NumberField label="優惠折扣金額" value={form.discountAmount} onChange={(v) => update("discountAmount", v)} />

              <div>
                <label className="flex items-center gap-2 text-xs" style={{ color: colors.ink }}>
                  <input
                    type="checkbox"
                    checked={form.needsInvoice}
                    onChange={(e) => update("needsInvoice", e.target.checked)}
                    className="h-3.5 w-3.5"
                    style={{ accentColor: colors.pine }}
                  />
                  需要開立發票
                </label>
                {form.needsInvoice && (
                  <p className="mt-1 text-[11px] leading-relaxed" style={{ color: colors.muted }}>
                    發票抬頭跟統一編號等客人確認訂房時再填寫，這裡先確認
                    「要不要開發票」就好（會影響 8% 稅金是否計入報價）。
                  </p>
                )}
              </div>

              <div>
                <label className="flex items-center gap-2 text-xs" style={{ color: colors.ink }}>
                  <input
                    type="checkbox"
                    checked={form.useRoomOverride}
                    onChange={(e) => update("useRoomOverride", e.target.checked)}
                    className="h-3.5 w-3.5"
                    style={{ accentColor: colors.pine }}
                  />
                  手動調整房型（根據客人要求的房型報價）
                </label>
                {form.useRoomOverride && (
                  <>
                    {autoSuggestedAllocation && (
                      <p className="mt-2 text-[11px] leading-relaxed" style={{ color: colors.muted }}>
                        系統依目前人數自動建議：
                        {[
                          autoSuggestedAllocation.fourPersonSuiteCount > 0 && `四人套房 ${autoSuggestedAllocation.fourPersonSuiteCount}`,
                          autoSuggestedAllocation.fourPersonDowngradeCount > 0 &&
                            `降規四人套房 ${autoSuggestedAllocation.fourPersonDowngradeCount}`,
                          autoSuggestedAllocation.doubleSuiteCount > 0 && `雙人套房 ${autoSuggestedAllocation.doubleSuiteCount}`,
                          autoSuggestedAllocation.doublePlainCount > 0 && `雙人雅房 ${autoSuggestedAllocation.doublePlainCount}`,
                        ]
                          .filter(Boolean)
                          .join("、") || "（沒有建議房型）"}
                      </p>
                    )}
                    <div className="mt-3 grid grid-cols-2 gap-4">
                    <NumberField
                      label="四人套房"
                      value={form.overrideFourPersonSuiteCount}
                      onChange={handleOverrideFourPersonSuiteChange}
                    />
                    <NumberField
                      label="降規四人套房"
                      value={form.overrideFourPersonDowngradeCount}
                      onChange={(v) => update("overrideFourPersonDowngradeCount", v)}
                    />
                    <NumberField
                      label="雙人套房"
                      value={form.overrideDoubleSuiteCount}
                      onChange={(v) => update("overrideDoubleSuiteCount", v)}
                    />
                    <NumberField
                      label="雙人雅房"
                      value={form.overrideDoublePlainCount}
                      onChange={(v) => update("overrideDoublePlainCount", v)}
                    />
                    </div>
                  </>
                )}
              </div>
            </div>
          </details>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 text-sm tracking-wide transition-opacity disabled:opacity-50"
            style={{ backgroundColor: colors.pine, color: colors.pineText }}
          >
            {isLoading ? "計算中" : "立即計算報價"}
          </button>
        </form>

        {warning && (
          <p
            role="alert"
            className="mt-6 border-l-2 pl-3 text-xs leading-relaxed"
            style={{ borderColor: colors.alert, color: colors.alert }}
          >
            {warning}
          </p>
        )}

        {quote && !warning && (
          <>
            <div
              ref={receiptRef}
              className="mt-6 overflow-hidden"
              style={{ backgroundColor: colors.surface, border: `1px solid ${colors.line}` }}
            >
              {/* 標題：民宿名稱在上（大字），「包棟報價單」在下（16px）；
                  報價日期/有效期限用絕對定位疊在「包棟報價單」右邊，
                  不用 flex 排版——flex 會讓標題文字整塊跟著往左偏，
                  沒辦法維持標題原本置中的樣子。絕對定位的元素不算進
                  正常排版的寬度計算，標題才能繼續用 text-center 對
                  整個標題區塊的寬度置中，不受這裡多加的內容影響。 */}
              <div className="relative px-6 pb-4 pt-5 text-center" style={{ backgroundColor: colors.pine }}>
                <p className={`${display.className} text-2xl italic`} style={{ color: colors.pineText }}>
                  {`${
                    quote.messageContext?.propertyName ??
                    PROPERTY_OPTIONS.find((opt) => opt.value === quote.request.propertyCode)?.label
                  }私人會所`}
                </p>
                {/* 「包棟報價單」外面包一層 relative 容器——報價日期/
                    有效期限用 absolute + top:50%/translateY(-50%) 對齊
                    這個容器的垂直中心。
                    ⚠️ 這裡的 min-height 很關鍵：absolute 定位的子元素
                    不會影響父層的高度計算，如果只給父層一行文字的
                    自然高度，兩行的日期資訊會超出父層範圍，變成疊到
                    父層外面——如果父層外面剛好是標題區塊自己的下邊界
                    以外，日期資訊就會跑到深綠色背景外面、疊在下面
                    米色的內容區塊上，變得幾乎看不見（之前發生過的
                    「有效期限看不到」就是這樣來的）。這裡明確給
                    min-height，確保父層的高度一定容得下兩行文字，
                    不管視覺上「包棟報價單」本身多高。 */}
                {/* ⚠️ min-height 這裡故意給比視覺上兩行文字實際需要的
                    高度更多一些餘裕（32px，不是精算後剛好夠用的
                    20-24px）——中文字元的實際行高，在不同瀏覽器/裝置
                    上算出來的數字會有落差（尤其中文字型的預設行高
                    通常比純英數字更高），精算剛好夠用的數字曾經在
                    實機上還是不夠、導致文字疊出標題區塊外面。這裡
                    故意抓比較寬鬆的安全值，同時外層標題區塊自己的
                    下方 padding 也從 pb-6 加到 pb-8，兩層都留一點餘裕，
                    比只精算單一個數字更不容易再次出問題。 */}
                <div className="relative mt-1" style={{ minHeight: "32px" }}>
                  <p className="tracking-[0.3em]" style={{ color: colors.pineSoft, fontSize: "16px" }}>
                    包棟報價單
                  </p>
                  <div
                    className="absolute right-0 top-1/2 text-right text-[8px] leading-tight"
                    style={{ color: colors.pineSoft, transform: "translateY(-50%)" }}
                  >
                    <p>報價日期：{formatSlashDate(todayYMD())}</p>
                    <p>有效期限：{formatSlashDate(addDaysToYMD(todayYMD(), QUOTE_VALIDITY_DAYS))}</p>
                  </div>
                </div>
              </div>

              {/* 內容區：明確給 padding，轉圖片時這個縮排會一起被截進去。
                  上方 padding 特意比其他方向小很多——上面接的是深色
                  標題區塊，已經有自己的 py-6，兩個 padding 疊加會讓
                  「預訂資訊」上方空白感覺太大 */}
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
                  {quote.roomAllocation && (
                    <InfoRow
                      label="使用房數"
                      value={`${
                        quote.roomAllocation.fourPersonSuiteCount +
                        quote.roomAllocation.fourPersonDowngradeCount +
                        quote.roomAllocation.doubleSuiteCount +
                        quote.roomAllocation.doublePlainCount
                      } 間房（詳見下方費用明細）`}
                    />
                  )}
                  {addOnSummaryItems(quote).map((item, i) => (
                    <InfoRow key={`addon-${i}`} label={i === 0 ? "額外項目" : ""} value={item} />
                  ))}
                </div>

                {/* 費用明細：房型名稱、「單價×數量」公式、「=」符號、
                    金額分成四欄。原本「=NT$金額」擠在同一欄用 text-right，
                    等號會因為金額位數不同、被推到不同的水平位置，看起來
                    沒對齊——把「=」拆成自己獨立的一欄，才能讓每一列的
                    等號都印在同一個位置。連續訂房時以「天」分組，同一晚
                    的房型不用每行都重複日期，不加粗。 */}
                <ReceiptSectionHeader icon="💰" title="費用明細" />
                <div
                  className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 gap-y-1.5 text-xs"
                  style={{ color: colors.muted }}
                >
                  {consolidatedAccommodationGroups(quote).map((group, gi) => (
                    <Fragment key={`day-${gi}`}>
                      {group.dateRangeLabel && (
                        <p className="col-span-4 mt-1 first:mt-0" style={{ color: colors.ink }}>
                          {group.dateRangeLabel}
                        </p>
                      )}
                      {group.items.map((item, i) => (
                        <Fragment key={i}>
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
                        </Fragment>
                      ))}
                    </Fragment>
                  ))}
                  {/* 加臨時床用跟房型一樣的格式（單價×間數×晚數＝小計），
                      不是跟其他加購項目一樣塞進下面那個只有「標籤/
                      金額」兩欄的列表——這是唯一一項金額會隨晚數變動
                      的加購項目，格式跟房型一致比較看得出來怎麼算的。 */}
                  {(() => {
                    const item = extraBedTempLineItem(quote);
                    if (!item) return null;
                    return (
                      <Fragment key="extra-bed-temp">
                        <span>{item.roomLabel}</span>
                        <span className="text-right tabular-nums">
                          NT${item.unitPrice.toLocaleString()}×{item.qty}
                          {item.nights > 1 ? `×${item.nights}晚` : ""}
                        </span>
                        <span>=</span>
                        <span className="text-right tabular-nums">NT${item.lineTotal.toLocaleString()}</span>
                      </Fragment>
                    );
                  })()}
                  {addOnFeeBreakdown(quote).map((item, i) => (
                    <Fragment key={`fee-${i}`}>
                      <span>{item.label}</span>
                      <span />
                      <span />
                      <span className="text-right tabular-nums">NT${item.amount.toLocaleString()}</span>
                    </Fragment>
                  ))}
                  {quote.discountAmount > 0 && (
                    <>
                      <span>優惠折扣</span>
                      <span />
                      <span />
                      <span className="text-right tabular-nums">－NT${quote.discountAmount.toLocaleString()}</span>
                    </>
                  )}
                  {quote.invoiceTaxAmount > 0 && (
                    <>
                      <span>發票稅金(8%)</span>
                      <span />
                      <span />
                      <span className="text-right tabular-nums">NT${quote.invoiceTaxAmount.toLocaleString()}</span>
                    </>
                  )}
                </div>

                {/* 總金額：淡綠色底色的區塊，是整張收據視覺上的焦點。
                    標籤/金額改成同一列（原本是標籤一行、大字金額另外
                    一行），省一點垂直空間 */}
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

                {/* 匯款帳號：label/value 靠近一點方便逐行核對。分行併進
                    銀行名稱後面括號裡；「匯款後請告知」提醒改成緊接在
                    「匯款帳號」標題同一行、用括號附註
                    （ReceiptSectionHeader 的 note 參數），不再另外
                    佔一整行。
                    ⚠️ 戶名拿掉了——空出來的寬度讓給銀行（帶分行說明，
                    通常比較長）跟帳號，降低換行機率。 */}
                {quote.messageContext?.bank && (
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
                    // 退改政策那句裡的「入住前 30 天」要用粗體紅字強調，
                    // 用 split 找出這段文字前後的部分分開渲染；其他兩句
                    // 沒有這個片段，parts.length 不會是 2，直接照原樣顯示。
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

            {quote.messageContext ? (
              <div className="mt-5 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="w-full border py-2.5 text-xs tracking-wide transition-colors"
                  style={
                    copied
                      ? { borderColor: colors.pine, backgroundColor: colors.pine, color: colors.pineText }
                      : { borderColor: colors.line, backgroundColor: "transparent", color: colors.ink }
                  }
                >
                  {copied ? "已複製 ✓" : "複製報價內容"}
                </button>
                <button
                  type="button"
                  onClick={handleShareImage}
                  disabled={imageWorking}
                  className="w-full border py-2.5 text-xs tracking-wide transition-colors disabled:opacity-50"
                  style={{ borderColor: colors.line, backgroundColor: "transparent", color: colors.ink }}
                >
                  {imageWorking ? "圖片產生中…" : "轉成圖片分享"}
                </button>
                {imageNote && (
                  <p className="text-[11px] leading-relaxed" style={{ color: colors.muted }}>
                    {imageNote}
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-5 text-[11px] leading-relaxed" style={{ color: colors.muted }}>
                （民宿名稱／匯款帳戶資訊查詢失敗，暫時無法產生可複製的報價文字，金額計算不受影響）
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

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

/**
 * 「說明欄位」跟「內容」放近一點的列，用固定寬度的 label 欄位
 * （不是 justify-between 把兩端撐開），給預訂資訊／匯款帳號這種
 * 需要逐行核對內容的區塊用——Row 的兩端對齊比較適合金額（費用
 * 明細那種），但拿來放日期/人數/帳號這種說明文字時，短短的
 * label 跟 value 之間會空出一大段距離，反而不好核對。
 */
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
