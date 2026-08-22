/**
 * 包棟總費用計算核心
 *
 * 對應「公式計算説明.docx」：
 * [住宿費用]    = 床位數檢查通過 ? SUM(每日住宿費用) : 報錯
 * [包棟總費用]  = [住宿費用] + [加床費用] + [加房費用] + [寵物清潔費]
 *              + [額外服務費用] + [訪客費用] - [優惠折扣]
 * [訂金]        = FLOOR([包棟總費用] * 0.3 / 1000) * 1000
 *
 * 另外加入業主補充的規則：
 * - 入住人數低於「包棟基本人數」時不允許產生報價（minimumGuestsWarning）
 * - 櫃檯人員可以手動覆寫房型組合（客人想加開房間、變更房型），
 *   但不能超過該民宿實際的房間數量（roomConfigWarning）
 * - 嬰幼兒人數（infants）不佔床位，不計入人數上下限與房型分配計算，
 *   純粹只是記錄用途
 *
 * 這裡刻意寫成「不碰資料庫」的純函式：所有價格資料（NightlyRateTable /
 * FlatServicePrices / PropertyRoomCounts / HolidayMap / 基本人數）都由
 * 呼叫端先用 queries.ts 撈好再傳進來，方便單元測試與未來替換資料來源。
 */

import { checkExtraBedLimits, resolveRoomAllocation } from "./property-room-allocation";
import type { RoomAllocationResult } from "./property-room-allocation";
import { buildEffectiveDayTypeMap, listStayDates, resolveDayType, toPriceCategory } from "./day-type";
import type { EffectiveDayTypeMap, HolidayMap } from "./day-type";
import type {
  BankInfo,
  DayType,
  FlatServicePrices,
  NightlyBreakdownItem,
  NightlyRateTable,
  PackageQuote,
  PriceCategory,
  PropertyRoomCounts,
  StayRequest,
} from "./types";

/** 開發票時的稅金比例（折扣後小計的 8%） */
const INVOICE_TAX_RATE = 0.08;

/** 依訂金比例與捨入單位計算訂金；預設對應原公式 FLOOR(total*0.3/1000)*1000 */
export function calculateDeposit(
  packageTotal: number,
  options?: { rate?: number; roundingUnit?: number }
): number {
  const rate = options?.rate ?? 0.3;
  const unit = options?.roundingUnit ?? 1000;
  return Math.floor((packageTotal * rate) / unit) * unit;
}

/** 加床費用：加固定床數量 * 加固定床費用 + 加臨時床數量 * 加臨時床費用 */
export function calculateExtraBedFee(
  extraBedFixedQty: number,
  extraBedTempQty: number,
  prices: FlatServicePrices
): number {
  if (extraBedFixedQty <= 0 && extraBedTempQty <= 0) return 0;
  return extraBedFixedQty * prices.extraBedFixed + extraBedTempQty * prices.extraBedTemp;
}

/** 加房費用：加房數量 * 加房費用 */
export function calculateExtraRoomFee(extraRoomQty: number, prices: FlatServicePrices): number {
  if (extraRoomQty <= 0) return 0;
  return extraRoomQty * prices.extraRoom;
}

/** 寵物清潔費：(寵物數量 - 免費寵物數量) * 寵物清潔費，超過 0 才收 */
export function calculatePetCleaningFee(
  petQty: number,
  freePetAllowance: number,
  prices: FlatServicePrices
): number {
  const billable = petQty - freePetAllowance;
  if (petQty <= 0 || billable <= 0) return 0;
  return billable * prices.petCleaning;
}

/** 額外服務費用：烤肉／餐車／提前入住（皆為每次入住固定金額） */
export function calculateAddOnFee(
  addOns: StayRequest["addOns"],
  prices: FlatServicePrices
): number {
  if (!addOns) return 0;
  let total = 0;
  if (addOns.bbq) total += prices.bbq;
  if (addOns.foodTruck) total += prices.foodTruck;
  if (addOns.earlyCheckin) total += prices.earlyCheckin;
  return total;
}

/** 訪客費用：訪客人數 * 訪客單價 */
export function calculateVisitorFee(visitorQty: number, prices: FlatServicePrices): number {
  if (visitorQty <= 0) return 0;
  return visitorQty * prices.visitor;
}

/**
 * 床位數檢查（上限）：
 * (大人+小孩) > 4*四人套房數量 + 2*(獨立雙人套房+獨立雙人雅房+四人套房降規數量+加固定床+加臨時床)
 * 成立時代表床位不足，人數超過可容納上限。嬰幼兒不佔床位，不計入。
 */
export function checkCapacity(params: {
  totalGuests: number;
  fourPersonFullCount: number;
  fourPersonDowngradeCount: number;
  doubleSuiteCount: number;
  doublePlainCount: number;
  extraBedFixedQty: number;
  extraBedTempQty: number;
}): string | null {
  const {
    totalGuests,
    fourPersonFullCount,
    fourPersonDowngradeCount,
    doubleSuiteCount,
    doublePlainCount,
    extraBedFixedQty,
    extraBedTempQty,
  } = params;

  const capacity =
    4 * fourPersonFullCount +
    2 *
      (doubleSuiteCount +
        doublePlainCount +
        fourPersonDowngradeCount +
        extraBedFixedQty +
        extraBedTempQty);

  return totalGuests > capacity ? "床位數不夠" : null;
}

/**
 * 包棟基本人數檢查（下限）：
 * 逐晚比對該晚 day_type 對應的基本人數，只要有任何一晚人數不足，
 * 就視為不符合包棟基本人數，不允許產生報價。嬰幼兒不計入人數。
 */
export function checkMinimumGuests(params: {
  totalGuests: number;
  nightlyDayTypes: DayType[];
  baseGuestsByDayType: Record<DayType, number>;
}): string | null {
  const { totalGuests, nightlyDayTypes, baseGuestsByDayType } = params;

  const dayTypeLabel: Record<DayType, string> = {
    weekday: "平日",
    peak: "旺日",
    holiday: "假日",
    festival: "節日",
    lunar_new_year: "春節",
    new_year_eve: "跨年",
  };

  // 同一種 day_type 只需要提醒一次，取這次入住期間出現過的所有 day_type
  const distinctDayTypes = Array.from(new Set(nightlyDayTypes));
  const shortfalls = distinctDayTypes
    .map((dayType) => ({ dayType, required: baseGuestsByDayType[dayType] ?? 0 }))
    .filter(({ required }) => required > 0 && totalGuests < required);

  if (shortfalls.length === 0) return null;

  const detail = shortfalls
    .map(({ dayType, required }) => `${dayTypeLabel[dayType]}需滿 ${required} 人`)
    .join("、");

  return `包棟基本人數不足：目前 ${totalGuests} 人，${detail}`;
}

/**
 * 計算每日住宿費用明細。
 * 房型分配（四人套房全開／降規／雙人套房／雙人雅房數量）在整個訂房期間
 * 是固定的（由 resolveRoomAllocation() 算好、可能含手動覆寫），
 * 每晚只有「價格類別」不同，對應原始 AppSheet 公式：房型數量固定，
 * 逐日套用不同價格欄位。
 */
export function calculateNightlyBreakdown(params: {
  checkIn: string;
  checkOut: string;
  roomAllocation: RoomAllocationResult;
  effectiveDayTypeMap: EffectiveDayTypeMap;
  rateTableByCategory: Record<PriceCategory, NightlyRateTable>;
}): NightlyBreakdownItem[] {
  const { checkIn, checkOut, roomAllocation, effectiveDayTypeMap, rateTableByCategory } = params;
  const { fullPriceCount, downgradeCount, doubleSuiteCount, doublePlainCount } = roomAllocation;

  return listStayDates(checkIn, checkOut).map((date) => {
    const dayType = resolveDayType(date, effectiveDayTypeMap);
    const priceCategory = toPriceCategory(dayType);
    const rates = rateTableByCategory[priceCategory];

    // 四人套房降規的房間該用哪個價格：只此清綠沒有獨立雙人套房房型，
    // 降規價格記在 downgradeDoubleSuite；陌隱／水景璞堤則是把「降規」
    // 跟「獨立雙人套房」視為同一組價格（它們的 rate_rule_tiers 只有
    // config_label='雙人套房'，沒有另外存一組'降規雙人套房'），所以
    // 要 fallback 到 doubleSuite。少了這個 fallback，陌隱/水景璞堤的
    // 降規房間會被當成 $0 計價，導致算出來的住宿費用只有獨立雙人套房
    // 那一間的錢，四人套房降規的房間全部漏算。
    const downgradePrice = rates.doubleSuite > 0 ? rates.doubleSuite : rates.downgradeDoubleSuite;

    const amount =
      fullPriceCount * rates.fourPersonSuite +
      downgradeCount * downgradePrice +
      doubleSuiteCount * rates.doubleSuite +
      doublePlainCount * rates.doublePlain;

    return {
      date,
      dayType,
      priceCategory,
      fourPersonSuiteCount: fullPriceCount,
      fourPersonDowngradeCount: downgradeCount,
      doubleSuiteCount,
      doublePlainCount,
      amount,
    };
  });
}

/**
 * 建立「人數不足包棟基本人數」時的報價結果，完全不需要查詢房價／服務
 * 費用等資料，供 server action 在檢查到 minimumGuestsWarning 時直接
 * 回傳，跳過後續所有計價查詢與計算（見 app/actions/quote.ts）。
 *
 * 注意：這裡刻意不順便計算 capacityWarning／roomConfigWarning——沒有
 * 真正的房間數量資料，硬塞假資料進去可能會生出誤導性的訊息。人數不足
 * 基本人數本身就已經是「不允許產生報價」的理由，不需要再判斷其他項目。
 */
export function buildMinimumGuestsBlockedQuote(
  request: StayRequest,
  minimumGuestsWarning: string
): PackageQuote {
  const nights = listStayDates(request.checkIn, request.checkOut).length;
  return {
    request,
    nights,
    nightlyBreakdown: [],
    accommodationTotal: 0,
    extraBedFee: 0,
    extraRoomFee: 0,
    petCleaningFee: 0,
    addOnFee: 0,
    visitorFee: 0,
    discountAmount: request.discountAmount ?? 0,
    invoiceTaxAmount: 0,
    packageTotal: 0,
    deposit: 0,
    balanceDue: 0,
    capacityWarning: null,
    minimumGuestsWarning,
    roomConfigWarning: null,
    roomAllocation: null,
    messageContext: null,
  };
}

/**
 * 組出完整的包棟總費用報價（含加購項目與訂金）。
 * 這是給 server action 呼叫的主入口：所有資料庫查詢結果都在呼叫端
 * 準備好之後傳進來，本函式本身不做任何 I/O。
 *
 * 若 capacityWarning、minimumGuestsWarning、roomConfigWarning 任一
 * 不為 null，packageTotal / deposit / balanceDue 會被強制歸零，代表
 * 「不允許產生報價」，呼叫端（server action）應該擋下後續的建立報價/
 * 訂房流程；此時 messageContext 也會是 null（不提供產生客人版報價
 * 訊息所需的參考資料，避免呼叫端誤用被擋下的報價產生訊息）。
 */
export function calculatePackageQuote(params: {
  request: StayRequest;
  roomCounts: PropertyRoomCounts;
  servicePrices: FlatServicePrices;
  holidayMap: HolidayMap;
  baseGuestsByDayType: Record<DayType, number>;
  rateTableByCategory: Record<PriceCategory, NightlyRateTable>;
  /**
   * 民宿顯示名稱與匯款帳戶，只用於組成 messageContext（客人版報價
   * 訊息），不影響金額計算。設計成 optional／可能是 undefined：
   * 就算查詢這筆資料失敗或呼叫端忘記傳，也不應該讓整個報價計算
   * (價格才是核心功能) 因此掛掉——沒有這筆資料時，退化成
   * messageContext: null，其餘金額照常算，只是無法顯示「複製報價
   * 內容」而已。
   */
  propertyDisplay?: { name: string; bank: BankInfo | null };
  depositOptions?: { rate?: number; roundingUnit?: number };
  /** 尾款須於入住前幾天匯款，預設 7 天，只用於 messageContext 顯示文字 */
  balanceDueDaysBeforeCheckIn?: number;
}): PackageQuote {
  const {
    request,
    roomCounts,
    servicePrices,
    holidayMap,
    baseGuestsByDayType,
    rateTableByCategory,
    propertyDisplay,
    depositOptions,
    balanceDueDaysBeforeCheckIn = 7,
  } = params;

  // 嬰幼兒不佔床位、不計入人數上下限與房型分配計算，純記錄用途。
  const totalGuests = request.adults + request.children;
  const extraBedFixedQty = request.extraBedFixedQty ?? 0;
  const extraBedTempQty = request.extraBedTempQty ?? 0;
  const extraRoomQty = request.extraRoomQty ?? 0;
  const petQty = request.pets ?? 0;
  const visitorQty = request.visitorQty ?? 0;
  const discountAmount = request.discountAmount ?? 0;

  const { allocation, warning: roomOverrideWarning } = resolveRoomAllocation(
    request.propertyCode,
    totalGuests,
    roomCounts,
    request.roomOverride
  );

  // 加床數量驗證（加固定床不能超過降規房間數；加臨時床有各民宿固定
  // 上限），跟房型覆寫驗證合併成同一個 roomConfigWarning——兩者本質
  // 上都是「這次的房型/加床設定有沒有超過實際可用的資源」。
  const extraBedWarning = checkExtraBedLimits({
    propertyCode: request.propertyCode,
    extraBedFixedQty,
    extraBedTempQty,
    fourPersonDowngradeCount: allocation.downgradeCount,
  });
  const roomConfigWarning =
    [roomOverrideWarning, extraBedWarning].filter((w): w is string => Boolean(w)).join("；") || null;

  const capacityWarning = checkCapacity({
    totalGuests,
    fourPersonFullCount: allocation.fullPriceCount,
    fourPersonDowngradeCount: allocation.downgradeCount,
    doubleSuiteCount: allocation.doubleSuiteCount,
    doublePlainCount: allocation.doublePlainCount,
    extraBedFixedQty,
    extraBedTempQty,
  });

  const effectiveDayTypeMap = buildEffectiveDayTypeMap(holidayMap);

  const nightlyBreakdown = calculateNightlyBreakdown({
    checkIn: request.checkIn,
    checkOut: request.checkOut,
    roomAllocation: allocation,
    effectiveDayTypeMap,
    rateTableByCategory,
  });

  const minimumGuestsWarning = checkMinimumGuests({
    totalGuests,
    nightlyDayTypes: nightlyBreakdown.map((n) => n.dayType),
    baseGuestsByDayType,
  });

  const blocked = Boolean(capacityWarning || minimumGuestsWarning || roomConfigWarning);

  const accommodationTotal = blocked
    ? 0
    : nightlyBreakdown.reduce((sum, night) => sum + night.amount, 0);

  const extraBedFee = calculateExtraBedFee(extraBedFixedQty, extraBedTempQty, servicePrices);
  const extraRoomFee = calculateExtraRoomFee(extraRoomQty, servicePrices);
  const petCleaningFee = calculatePetCleaningFee(petQty, roomCounts.freePetAllowance, servicePrices);
  const addOnFee = calculateAddOnFee(request.addOns, servicePrices);
  const visitorFee = calculateVisitorFee(visitorQty, servicePrices);

  const subtotalAfterDiscount = blocked
    ? 0
    : accommodationTotal +
      extraBedFee +
      extraRoomFee +
      petCleaningFee +
      addOnFee +
      visitorFee -
      discountAmount;

  // 開發票時，稅金以折扣後小計的 8% 計算，加進包棟總費用裡
  const invoiceTaxAmount = blocked || !request.invoice?.required
    ? 0
    : Math.round(subtotalAfterDiscount * INVOICE_TAX_RATE);

  const packageTotal = blocked ? 0 : subtotalAfterDiscount + invoiceTaxAmount;

  const deposit = blocked ? 0 : calculateDeposit(packageTotal, depositOptions);

  const roomAllocation = {
    fourPersonSuiteCount: allocation.fullPriceCount,
    fourPersonDowngradeCount: allocation.downgradeCount,
    doubleSuiteCount: allocation.doubleSuiteCount,
    doublePlainCount: allocation.doublePlainCount,
  };

  const depositRate = depositOptions?.rate ?? 0.3;

  return {
    request,
    nights: nightlyBreakdown.length,
    nightlyBreakdown,
    accommodationTotal,
    extraBedFee,
    extraRoomFee,
    petCleaningFee,
    addOnFee,
    visitorFee,
    discountAmount,
    invoiceTaxAmount,
    packageTotal,
    deposit,
    balanceDue: packageTotal - deposit,
    capacityWarning,
    minimumGuestsWarning,
    roomConfigWarning,
    roomAllocation,
    messageContext:
      blocked || !propertyDisplay
        ? null
        : {
            propertyName: propertyDisplay.name,
            bank: propertyDisplay.bank,
            rateTableByCategory,
            baseGuestsByDayType,
            servicePrices,
            depositRatePercent: Math.round(depositRate * 10),
            balanceDueDaysBeforeCheckIn,
          },
  };
}
