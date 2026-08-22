/**
 * 定價相關型別定義
 * 對應 Supabase schema：properties / room_types / rooms / rate_plans /
 * rate_rules / rate_rule_tiers / services / quotes / reservations
 */

/** 民宿代碼，對應 properties.code */
export type PropertyCode = "zhici" | "moyin" | "shuijing";

/**
 * 價格日期分類，對應資料庫 enum day_type。
 * weekday 與 peak 的「房價」完全相同（原始 Excel 的「平旺日」欄位），
 * 只有「基本人數」不同；目前所有計價公式都不使用 base_guests，
 * 所以在計價邏輯裡 weekday / peak 可以視為同一組價格處理。
 */
export type DayType =
  | "weekday"
  | "peak"
  | "holiday"
  | "festival"
  | "lunar_new_year"
  | "new_year_eve";

/**
 * 房型入住配置標籤，對應 rate_rule_tiers.config_label。
 * - 只此清綠：四人套房 / 降規雙人套房（同一間房，只是降規銷售）
 * - 陌隱／水景璞堤：四人套房 / 雙人套房（獨立房間，只是共用同一張
 *   每日計價表）
 * - 陌隱另外還有：雙人雅房
 */
export type RoomConfigLabel = "四人套房" | "降規雙人套房" | "雙人套房" | "雙人雅房";

/** 每晚實際套用的價格分類，weekday/peak 收斂成 regular（見 day-type.ts） */
export type PriceCategory = "regular" | "holiday" | "festival" | "lunar_new_year" | "new_year_eve";

/** 每晚各房型配置的價格（新台幣） */
export interface NightlyRateTable {
  fourPersonSuite: number; // 四人套房（全開）
  downgradeDoubleSuite: number; // 只此清綠專用：四人套房降規為雙人套房
  doubleSuite: number; // 陌隱／水景璞堤：獨立雙人套房
  doublePlain: number; // 陌隱：獨立雙人雅房
}

/** 單一民宿的固定費用項目（不隨日期類型變動），對應 services 表 */
export interface FlatServicePrices {
  extraBedFixed: number; // 加固定床費用（每床）
  extraBedTemp: number; // 加臨時床費用（每床）
  extraRoom: number; // 加開房間費用（每間）
  petCleaning: number; // 寵物清潔費（每隻，超出免費數量才收）
  bbq: number; // 烤肉（每次入住）
  foodTruck: number; // 餐車場地費（每次入住）
  earlyCheckin: number; // 提前入住（每次入住）
  visitor: number; // 訪客費用（每人）
}

/** 民宿固定房型數量（來自實體房間表 rooms 的統計，非依人數變動） */
export interface PropertyRoomCounts {
  /** 四人套房實體房間總數（只此清綠 7、陌隱 4、水景璞堤 3） */
  fourPersonSuiteTotal: number;
  /** 獨立雙人套房數量（只此清綠 0、陌隱 1、水景璞堤 1） */
  doubleSuiteCount: number;
  /** 獨立雙人雅房數量（只陌隱有 1，其餘 0） */
  doublePlainCount: number;
  /** 免費寵物數量上限 */
  freePetAllowance: number;
}

/**
 * 手動調整房型配置（櫃檯人員覆寫系統依人數自動算出的房型組合）。
 * 任何一個欄位有填值，就代表要「取代」系統自動算出的對應數字；
 * 沒填的欄位，還是照原本依人數計算的結果。
 *
 * 用途例如：
 * - 客人指定要多開一間房（不是靠加開房間的固定費用，而是實際多算
 *   一間房型的每晚房價）
 * - 客人想把某間四人房降規成雙人房銷售，即使人數其實足夠住滿四人房
 * - 陌隱/水景璞堤想手動指定要不要把獨立雙人套房/雙人雅房算進本次
 *   包棟範圍
 */
export interface RoomAllocationOverride {
  /** 四人套房（全額計價）數量 */
  fourPersonSuiteCount?: number;
  /** 四人套房降規為雙人套房計價的數量（僅只此清綠適用） */
  fourPersonDowngradeCount?: number;
  /** 獨立雙人套房數量（陌隱／水景璞堤） */
  doubleSuiteCount?: number;
  /** 獨立雙人雅房數量（僅陌隱） */
  doublePlainCount?: number;
}

/** 發票資訊 */
export interface InvoiceInfo {
  /** 是否需要開立發票 */
  required: boolean;
  /** 發票抬頭（公司/個人名稱），開立三聯式發票時使用 */
  title?: string;
  /** 統一編號，開立三聯式發票時使用 */
  taxId?: string;
}

/** 民宿匯款帳戶資訊，用於報價訊息中的「匯款帳號」區塊 */
export interface BankInfo {
  name: string; // 銀行名稱
  branch: string; // 分行
  accountNumber: string; // 完整帳號（給客人匯款用，不是遮罩版本）
  accountName: string; // 戶名
}

/**
 * 組成客人版報價訊息文字（buildQuoteMessage）需要的額外參考資料。
 * 這些資料跟金額計算無關，純粹是「顯示用」的參考內容：民宿名稱、
 * 匯款帳戶、各價格分類的房型定價表（用來列出「房型訂價」參考區塊）、
 * 各 day_type 的包棟基本人數（用來列出「包棟基本人數」提醒）。
 */
export interface QuoteMessageContext {
  propertyName: string;
  bank: BankInfo | null;
  rateTableByCategory: Record<PriceCategory, NightlyRateTable>;
  baseGuestsByDayType: Record<DayType, number>;
  /**
   * 加購服務單價（加床/加房/寵物清潔/烤肉/餐車/提前入住/訪客），
   * 用來在報價訊息的「費用明細」列出每個加購項目各自的金額，
   * 不是只顯示一個籠統的加總數字。
   */
  servicePrices: FlatServicePrices;
  /** 訂金比例，用「成」表示，例如 0.3 → 3 */
  depositRatePercent: number;
  /** 尾款須於入住前幾天匯款，用於「請於入住前 N 天匯尾款」文字 */
  balanceDueDaysBeforeCheckIn: number;
}

/** 單一入住需求（一次報價／訂房） */
export interface StayRequest {
  propertyCode: PropertyCode;
  checkIn: string; // 'YYYY-MM-DD'
  checkOut: string; // 'YYYY-MM-DD'（不含退房日當晚）
  adults: number;
  children: number;
  /** 嬰幼兒人數：不佔床位、不計入人數上下限與房型分配計算，僅供記錄 */
  infants?: number;
  pets?: number;
  /** 加固定床數量 */
  extraBedFixedQty?: number;
  /** 加臨時床數量 */
  extraBedTempQty?: number;
  /** 加開房間數量（固定費用，例如借用多功能廳等額外空間） */
  extraRoomQty?: number;
  /** 訪客人數 */
  visitorQty?: number;
  /** 額外服務：烤肉／餐車／提前入住 */
  addOns?: {
    bbq?: boolean;
    foodTruck?: boolean;
    earlyCheckin?: boolean;
  };
  /** 優惠折扣金額（直接扣除，非百分比） */
  discountAmount?: number;
  /** 發票資訊 */
  invoice?: InvoiceInfo;
  /**
   * 手動調整房型配置。有填的欄位會取代系統依人數自動算出的房型組合，
   * 讓客人可以彈性加開房間、變更房型銷售方式。
   * 詳見 RoomAllocationOverride 說明。
   */
  roomOverride?: RoomAllocationOverride;
}

/** 每晚的房型配置與計算出的住宿費用明細 */
export interface NightlyBreakdownItem {
  date: string; // 'YYYY-MM-DD'
  dayType: DayType;
  priceCategory: PriceCategory;
  fourPersonSuiteCount: number; // 當晚以全額計價的四人套房數量
  fourPersonDowngradeCount: number; // 當晚降規為雙人套房計價的四人套房數量（僅只此清綠適用）
  doubleSuiteCount: number; // 當晚獨立雙人套房數量（陌隱／水景璞堤）
  doublePlainCount: number; // 當晚獨立雙人雅房數量（僅陌隱可能 >0）
  amount: number; // 當晚住宿費用小計
}

/** 整個訂房期間固定的房型數量組合（自動分配或手動覆寫後的最終結果） */
export interface QuoteRoomAllocation {
  fourPersonSuiteCount: number;
  fourPersonDowngradeCount: number;
  doubleSuiteCount: number;
  doublePlainCount: number;
}

/** 完整的包棟總費用計算結果 */
export interface PackageQuote {
  request: StayRequest;
  nights: number;
  nightlyBreakdown: NightlyBreakdownItem[];
  accommodationTotal: number; // 住宿費用（各晚加總）
  extraBedFee: number; // 加床費用
  extraRoomFee: number; // 加房費用
  petCleaningFee: number; // 寵物清潔費
  addOnFee: number; // 額外服務費用（烤肉／餐車／提前入住）
  visitorFee: number; // 訪客費用
  discountAmount: number; // 優惠折扣
  /** 發票稅金：需要開立發票時，以「折扣後小計」的 8% 計算，未勾選發票則是 0 */
  invoiceTaxAmount: number;
  packageTotal: number; // 包棟總費用
  deposit: number; // 訂金
  balanceDue: number; // 尾款（包棟總費用 - 訂金）
  capacityWarning: string | null; // 床位數不夠時的警告訊息（人數超過房間容納上限）
  /**
   * 入住人數低於包棟基本人數時的警告訊息（人數不足下限）。
   * 只要不是 null，就代表「不允許產生報價」，packageTotal/deposit
   * 會被強制歸零，呼叫端應該阻擋報價/訂房建立流程並顯示這則訊息。
   */
  minimumGuestsWarning: string | null;
  /**
   * 手動調整房型配置超過該民宿實際房間數量時的警告訊息。
   * 不為 null 時同樣代表「不允許產生報價」，金額會被強制歸零。
   */
  roomConfigWarning: string | null;
  /** 這次訂房實際使用的房型數量組合；被 minimumGuestsWarning 擋下時為 null */
  roomAllocation: QuoteRoomAllocation | null;
  /**
   * 組成客人版報價訊息（buildQuoteMessage）所需的參考資料。
   * 只有在完全沒有任何警告、報價成功算出來時才會有值；
   * 三個警告任一存在時都是 null，呼叫端應該先確認沒有警告，
   * 再檢查 messageContext 是否存在，才呼叫 buildQuoteMessage()。
   */
  messageContext: QuoteMessageContext | null;
}
