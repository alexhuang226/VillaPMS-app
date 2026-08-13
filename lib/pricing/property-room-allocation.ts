/**
 * 房型數量分配公式
 *
 * 直接對應「公式計算説明.docx」中的 [四人套房數量]／[四人套房降規數量]／
 * [雙人雅房數量] 這三條 AppSheet IFS 公式，逐一民宿硬編碼移植，
 * 刻意不做「聰明化」的通用簡化，以避免與原始業務邏輯出現落差。
 *
 * [雙人套房數量] 則「不」在這裡計算：它在原公式中是固定的
 * LOOKUP(民宿配置表)，也就是該民宿「獨立雙人套房房間」的實際數量
 * （只此清綠 0、陌隱 1、水景璞堤 1），與入住人數無關，一律整棟計費，
 * 因此直接由資料庫的 rooms 表數量提供（見 queries.ts 的
 * getPropertyRoomCounts）。
 */

import type { PropertyCode } from "./types";

/** 四人套房「全額計價」與「降規為雙人套房計價」的數量分配 */
export interface FourPersonAllocation {
  fullPriceCount: number; // 四人套房數量（全開四人房價格）
  downgradeCount: number; // 四人套房降規數量（以雙人套房價格計費）
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
