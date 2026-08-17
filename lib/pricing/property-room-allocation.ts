/**
 * 房型數量分配公式
 *
 * 直接對應「公式計算説明.docx」中的 [四人套房數量]／[四人套房降規數量]／
 * [雙人雅房數量] 這三條 AppSheet IFS 公式，逐一民宿硬編碼移植，
 * 刻意不做「聰明化」的通用簡化，以避免與原始業務邏輯出現落差。
 *
 * [雙人套房數量] 則「不」用公式計算：它在原公式中是固定的
 * LOOKUP(民宿配置表)，也就是該民宿「獨立雙人套房房間」的實際數量
 * （只此清綠 0、陌隱 1、水景璞堤 1），與入住人數無關，一律整棟計費，
 * 因此直接由資料庫的 rooms 表數量提供（PropertyRoomCounts.doubleSuiteCount）。
 *
 * `resolveRoomAllocation()` 在自動計算的結果之上，額外支援櫃檯人員
 * 手動覆寫房型組合（客人想加開房間、變更房型），並驗證覆寫後的數字
 * 有沒有超過該民宿實際的房間數量。
 */

import type { PropertyCode, PropertyRoomCounts, RoomAllocationOverride } from "./types";

/** 四人套房「全額計價」與「降規為雙人套房計價」的數量分配 */
export interface FourPersonAllocation {
  fullPriceCount: number; // 四人套房數量（全開四人房價格）
  downgradeCount: number; // 四人套房降規數量（以雙人套房價格計費）
}

/** 最終用於計價的房型數量組合（已套用手動覆寫，如果有的話） */
export interface RoomAllocationResult {
  fullPriceCount: number;
  downgradeCount: number;
  doubleSuiteCount: number;
  doublePlainCount: number;
}

/**
 * 四人套房數量 / 四人套房降規數量
 * 兩者相加＝該民宿四人套房實體房間總數，但總入住人數較少時，
 * 可能兩者加總會小於實體房間總數（代表部分房間當晚完全不開放）。
 */
export function allocateFourPersonRooms(
  propertyCode: PropertyCode,
  totalGuests: number
): FourPersonAllocation {
  switch (propertyCode) {
    case "moyin": // 陌隱：四人套房實體房間共 4 間
      if (totalGuests <= 12) return { fullPriceCount: 0, downgradeCount: 4 };
      if (totalGuests <= 14) return { fullPriceCount: 1, downgradeCount: 3 };
      if (totalGuests <= 16) return { fullPriceCount: 2, downgradeCount: 2 };
      if (totalGuests <= 18) return { fullPriceCount: 3, downgradeCount: 1 };
      return { fullPriceCount: 4, downgradeCount: 0 };

    case "shuijing": // 水景璞堤：四人套房實體房間共 3 間
      if (totalGuests <= 6) return { fullPriceCount: 0, downgradeCount: 2 };
      if (totalGuests <= 8) return { fullPriceCount: 0, downgradeCount: 3 };
      if (totalGuests <= 10) return { fullPriceCount: 1, downgradeCount: 2 };
      if (totalGuests <= 12) return { fullPriceCount: 2, downgradeCount: 1 };
      return { fullPriceCount: 3, downgradeCount: 0 };

    case "zhici": // 只此清綠：四人套房實體房間共 7 間
      if (totalGuests <= 10) return { fullPriceCount: 0, downgradeCount: 5 };
      if (totalGuests <= 12) return { fullPriceCount: 0, downgradeCount: 6 };
      if (totalGuests <= 14) return { fullPriceCount: 0, downgradeCount: 7 };
      if (totalGuests <= 16) return { fullPriceCount: 1, downgradeCount: 6 };
      if (totalGuests <= 18) return { fullPriceCount: 2, downgradeCount: 5 };
      if (totalGuests <= 20) return { fullPriceCount: 3, downgradeCount: 4 };
      if (totalGuests <= 22) return { fullPriceCount: 4, downgradeCount: 3 };
      if (totalGuests <= 24) return { fullPriceCount: 5, downgradeCount: 2 };
      if (totalGuests <= 26) return { fullPriceCount: 6, downgradeCount: 1 };
      return { fullPriceCount: 7, downgradeCount: 0 };

    default:
      return { fullPriceCount: 0, downgradeCount: 0 };
  }
}

/**
 * 雙人雅房數量：只有陌隱會依人數決定是否納入計費，
 * 其餘民宿一律為 0（水景璞堤、只此清綠皆無雙人雅房）。
 */
export function allocateDoublePlainRoom(
  propertyCode: PropertyCode,
  totalGuests: number
): number {
  if (propertyCode === "moyin") {
    return totalGuests <= 10 ? 0 : 1;
  }
  return 0;
}

/**
 * 算出最終要用來計價的房型數量組合：先套用自動分配公式，
 * 再用 override 裡「有填的欄位」蓋過去；沒有 override 就直接回傳
 * 自動分配結果（自動分配公式本身保證足夠容納傳入的人數，不需要
 * 額外驗證）。
 *
 * 有 override 時會額外驗證：
 * 1. 每個房型的數量有沒有超過該民宿實際房間數（PropertyRoomCounts）
 * 2. 選擇的房型組合，本身可容納人數是否 >= 入住的大人+小孩人數
 * 任一項不符合，就回傳 warning 訊息，呼叫端應該視同
 * capacityWarning／minimumGuestsWarning 一樣擋下報價金額計算。
 */
export function resolveRoomAllocation(
  propertyCode: PropertyCode,
  totalGuests: number,
  roomCounts: PropertyRoomCounts,
  override?: RoomAllocationOverride
): { allocation: RoomAllocationResult; warning: string | null } {
  const auto = allocateFourPersonRooms(propertyCode, totalGuests);
  const autoDoublePlain = allocateDoublePlainRoom(propertyCode, totalGuests);

  const allocation: RoomAllocationResult = {
    fullPriceCount: override?.fourPersonSuiteCount ?? auto.fullPriceCount,
    downgradeCount: override?.fourPersonDowngradeCount ?? auto.downgradeCount,
    doubleSuiteCount: override?.doubleSuiteCount ?? roomCounts.doubleSuiteCount,
    doublePlainCount: override?.doublePlainCount ?? autoDoublePlain,
  };

  if (!override) {
    return { allocation, warning: null };
  }

  const problems: string[] = [];

  for (const [label, value] of [
    ["四人套房", allocation.fullPriceCount],
    ["降規雙人套房", allocation.downgradeCount],
    ["雙人套房", allocation.doubleSuiteCount],
    ["雙人雅房", allocation.doublePlainCount],
  ] as const) {
    if (value < 0) problems.push(`${label}數量不能是負數`);
  }

  const fourPersonTotal = allocation.fullPriceCount + allocation.downgradeCount;
  if (fourPersonTotal > roomCounts.fourPersonSuiteTotal) {
    problems.push(
      `四人套房＋降規雙人套房共 ${fourPersonTotal} 間，超過實際四人套房房間數 ${roomCounts.fourPersonSuiteTotal} 間`
    );
  }
  if (allocation.doubleSuiteCount > roomCounts.doubleSuiteCount) {
    problems.push(
      `雙人套房 ${allocation.doubleSuiteCount} 間，超過實際房間數 ${roomCounts.doubleSuiteCount} 間`
    );
  }
  if (allocation.doublePlainCount > roomCounts.doublePlainCount) {
    problems.push(
      `雙人雅房 ${allocation.doublePlainCount} 間，超過實際房間數 ${roomCounts.doublePlainCount} 間`
    );
  }

  // 手動選擇的房型組合，本身可容納的人數（不含加床）是否足夠這次入住
  // 的大人+小孩人數。這是「房型選擇」層級的檢查，跟 calculate-package-
  // total.ts 的 checkCapacity()（會把加床也算進容量）是兩件事：即使
  // 之後可以靠加床補足床位，選出來的房型本身住不下這麼多人，也應該先
  // 提醒櫃檯人員「這個房型組合本身不夠住」。
  const selectedRoomCapacity =
    4 * allocation.fullPriceCount +
    2 * (allocation.downgradeCount + allocation.doubleSuiteCount + allocation.doublePlainCount);
  if (totalGuests > selectedRoomCapacity) {
    problems.push(
      `所選房型合計可住 ${selectedRoomCapacity} 人，低於入住人數（大人+小孩）${totalGuests} 人`
    );
  }

  const warning = problems.length > 0 ? `手動調整房型設定有誤：${problems.join("；")}` : null;
  return { allocation, warning };
}
