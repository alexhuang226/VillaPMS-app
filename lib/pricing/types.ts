/**
 * 定價相關型別定義
 * 對應 Supabase schema：properties / room_types / rooms / rate_plans /
 * rate_rules / rate_rule_tiers / services
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

/** 單一入住需求（一次報價／訂房） */
export interface StayRequest {
  propertyCode: PropertyCode;
  checkIn: string; // 'YYYY-MM-DD'
  checkOut: string; // 'YYYY-MM-DD'（不含退房日當晚）
  adults: number;
  children: number;
  pets?: number;
  /** 加固定床數量 */
  extraBedFixedQty?: number;
  /** 加臨時床數量 */
  extraBedTempQty?: number;
  /** 加開房間數量 */
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
}

/** 每晚的房型配置與計算出的住宿費用明細 */
export interface NightlyBreakdownItem {
  date: string; // 'YYYY-MM-DD'
  dayType: DayType;
  priceCategory: "regular" | "holiday" | "festival" | "lunar_new_year" | "new_year_eve";
  fourPersonSuiteCount: number; // 當晚以全額計價的四人套房數量
  fourPersonDowngradeCount: number; // 當晚降規為雙人套房計價的四人套房數量（僅只此清綠適用）
  doubleSuiteCount: number; // 當晚獨立雙人套房數量（陌隱／水景璞堤）
  doublePlainCount: number; // 當晚獨立雙人雅房數量（僅陌隱可能 >0）
  amount: number; // 當晚住宿費用小計
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
}
