/**
 * 包棟總費用計算核心
 *
 * 對應「公式計算説明.docx」：
 * [住宿費用]    = 床位數檢查通過 ? SUM(每日住宿費用) : 報錯
 * [包棟總費用]  = [住宿費用] + [加床費用] + [加房費用] + [寵物清潔費]
 *              + [額外服務費用] + [訪客費用] - [優惠折扣]
 * [訂金]        = FLOOR([包棟總費用] * 0.3 / 1000) * 1000
 *
 * 這裡刻意寫成「不碰資料庫」的純函式：所有價格資料（NightlyRateTable /
 * FlatServicePrices / PropertyRoomCounts / HolidayMap）都由呼叫端先用
 * queries.ts 撈好再傳進來，方便單元測試與未來替換資料來源。
 */

import { allocateDoublePlainRoom, allocateFourPersonRooms } from "./property-room-allocation";
import { listStayDates, resolveDayType, toPriceCategory } from "./day-type";
import type { HolidayMap } from "./day-type";
import type {
  FlatServicePrices,
  NightlyBreakdownItem,
  NightlyRateTable,
  PackageQuote,
  PropertyCode,
  PropertyRoomCounts,
  StayRequest,
} from "./types";

type PriceCategory = "regular" | "holiday" | "festival" | "lunar_new_year" | "new_year_eve";

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
 * 床位數檢查：
 * (大人+小孩) > 4*四人套房數量 + 2*(獨立雙人套房+獨立雙人雅房+四人套房降規數量+加固定床+加臨時床)
 * 成立時代表床位不足。
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
 * 計算每日住宿費用明細。
 * 房型分配（四人套房全開／降規／雙人套房／雙人雅房數量）在整個訂房期間
 * 是固定的（只依總人數決定一次），每晚只有「價格類別」不同，
 * 對應原始 AppSheet 公式：房型數量固定，逐日套用不同價格欄位。
 */
export function calculateNightlyBreakdown(params: {
  propertyCode: PropertyCode;
  checkIn: string;
  checkOut: string;
  totalGuests: number;
  doubleSuiteFixedCount: number; // 該民宿獨立雙人套房實際房間數（陌隱/水景璞堤用）
  holidayMap: HolidayMap;
  rateTableByCategory: Record<PriceCategory, NightlyRateTable>;
}): NightlyBreakdownItem[] {
  const {
    propertyCode,
    checkIn,
    checkOut,
    totalGuests,
    doubleSuiteFixedCount,
    holidayMap,
    rateTableByCategory,
  } = params;

  const { fullPriceCount, downgradeCount } = allocateFourPersonRooms(propertyCode, totalGuests);
  const doublePlainCount = allocateDoublePlainRoom(propertyCode, totalGuests);

  // 只此清綠沒有獨立雙人套房房間，doubleSuiteFixedCount 應為 0，
  // 「降規雙人套房」才是它的雙人房收入來源（由 downgradeCount 負責）。
  const doubleSuiteCount = doubleSuiteFixedCount;

  return listStayDates(checkIn, checkOut).map((date) => {
    const dayType = resolveDayType(date, holidayMap);
    const priceCategory = toPriceCategory(dayType);
    const rates = rateTableByCategory[priceCategory];

    const amount =
      fullPriceCount * rates.fourPersonSuite +
      downgradeCount * rates.downgradeDoubleSuite +
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
 * 組出完整的包棟總費用報價（含加購項目與訂金）。
 * 這是給 server action 呼叫的主入口：所有資料庫查詢結果都在呼叫端
 * 準備好之後傳進來，本函式本身不做任何 I/O。
 */
export function calculatePackageQuote(params: {
  request: StayRequest;
  roomCounts: PropertyRoomCounts;
  servicePrices: FlatServicePrices;
  holidayMap: HolidayMap;
  rateTableByCategory: Record<PriceCategory, NightlyRateTable>;
  depositOptions?: { rate?: number; roundingUnit?: number };
}): PackageQuote {
  const { request, roomCounts, servicePrices, holidayMap, rateTableByCategory, depositOptions } =
    params;

  const totalGuests = request.adults + request.children;
  const extraBedFixedQty = request.extraBedFixedQty ?? 0;
  const extraBedTempQty = request.extraBedTempQty ?? 0;
  const extraRoomQty = request.extraRoomQty ?? 0;
  const petQty = request.pets ?? 0;
  const visitorQty = request.visitorQty ?? 0;
  const discountAmount = request.discountAmount ?? 0;

  const { fullPriceCount, downgradeCount } = allocateFourPersonRooms(
    request.propertyCode,
    totalGuests
  );
  const doublePlainCount = allocateDoublePlainRoom(request.propertyCode, totalGuests);

  const capacityWarning = checkCapacity({
    totalGuests,
    fourPersonFullCount: fullPriceCount,
    fourPersonDowngradeCount: downgradeCount,
    doubleSuiteCount: roomCounts.doubleSuiteCount,
    doublePlainCount,
    extraBedFixedQty,
    extraBedTempQty,
  });

  const nightlyBreakdown = calculateNightlyBreakdown({
    propertyCode: request.propertyCode,
    checkIn: request.checkIn,
    checkOut: request.checkOut,
    totalGuests,
    doubleSuiteFixedCount: roomCounts.doubleSuiteCount,
    holidayMap,
    rateTableByCategory,
  });

  const accommodationTotal = capacityWarning
    ? 0
    : nightlyBreakdown.reduce((sum, night) => sum + night.amount, 0);

  const extraBedFee = calculateExtraBedFee(extraBedFixedQty, extraBedTempQty, servicePrices);
  const extraRoomFee = calculateExtraRoomFee(extraRoomQty, servicePrices);
  const petCleaningFee = calculatePetCleaningFee(petQty, roomCounts.freePetAllowance, servicePrices);
  const addOnFee = calculateAddOnFee(request.addOns, servicePrices);
  const visitorFee = calculateVisitorFee(visitorQty, servicePrices);

  const packageTotal =
    accommodationTotal +
    extraBedFee +
    extraRoomFee +
    petCleaningFee +
    addOnFee +
    visitorFee -
    discountAmount;

  const deposit = calculateDeposit(packageTotal, depositOptions);

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
    packageTotal,
    deposit,
    balanceDue: packageTotal - deposit,
    capacityWarning,
  };
}
