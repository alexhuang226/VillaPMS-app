"use server";

/**
 * 報價 Server Action
 *
 * 用法（在 Client Component 裡）：
 *   const quote = await calculateQuoteAction({
 *     propertyCode: "zhici",
 *     checkIn: "2026-08-14",
 *     checkOut: "2026-08-16",
 *     adults: 12,
 *     children: 2,
 *     pets: 1,
 *     extraBedFixedQty: 1,
 *     addOns: { bbq: true },
 *   });
 *
 * 這個 action 只負責「組資料 → 算價格」，不寫入資料庫；
 * 若要把結果存成正式報價（quotes / quote_lines），
 * 請參考檔案最下方的 saveQuoteAction 範例。
 */

import {
  buildMinimumGuestsBlockedQuote,
  calculatePackageQuote,
  checkMinimumGuests,
} from "@/lib/pricing/calculate-package-total";
import { buildEffectiveDayTypeMap, listStayDates, resolveDayType } from "@/lib/pricing/day-type";
import {
  getBaseGuestsByDayType,
  getFlatServicePrices,
  getHolidayMap,
  getNightlyRateTable,
  getPropertyId,
  getPropertyRoomCounts,
} from "@/lib/pricing/queries";
import type { PackageQuote, StayRequest } from "@/lib/pricing/types";
import { createClient } from "@/lib/supabase/server";

const PRICE_CATEGORIES = ["regular", "holiday", "festival", "lunar_new_year", "new_year_eve"] as const;

export async function calculateQuoteAction(request: StayRequest): Promise<PackageQuote> {
  const propertyId = await getPropertyId(request.propertyCode);

  // 先只查「人數是否達到包棟基本人數」所需要的最少資料
  // （節日清單＋各 day_type 基本人數），不查房價/服務費用/房間數量。
  const [holidayMap, baseGuestsByDayType] = await Promise.all([
    getHolidayMap(null), // 若節日清單改成組織自訂，這裡傳 organization_id
    getBaseGuestsByDayType(propertyId),
  ]);

  const totalGuests = request.adults + request.children;
  const effectiveDayTypeMap = buildEffectiveDayTypeMap(holidayMap);
  const nightlyDayTypes = listStayDates(request.checkIn, request.checkOut).map((date) =>
    resolveDayType(date, effectiveDayTypeMap)
  );

  const minimumGuestsWarning = checkMinimumGuests({
    totalGuests,
    nightlyDayTypes,
    baseGuestsByDayType,
  });

  if (minimumGuestsWarning) {
    // 人數不足包棟基本人數：直接回傳警告，不再往下查房價/服務費用/
    // 房間數量，也不計算任何金額。
    return buildMinimumGuestsBlockedQuote(request, minimumGuestsWarning);
  }

  // 人數足夠，才繼續查完整的計價資料
  const [roomCounts, servicePrices, ...rateTables] = await Promise.all([
    getPropertyRoomCounts(propertyId),
    getFlatServicePrices(propertyId),
    ...PRICE_CATEGORIES.map((category) => getNightlyRateTable(propertyId, category)),
  ]);

  const rateTableByCategory = Object.fromEntries(
    PRICE_CATEGORIES.map((category, i) => [category, rateTables[i]])
  ) as Record<(typeof PRICE_CATEGORIES)[number], (typeof rateTables)[number]>;

  return calculatePackageQuote({
    request,
    roomCounts,
    servicePrices,
    holidayMap,
    baseGuestsByDayType,
    rateTableByCategory,
  });
}

/**
 * 範例：把計算結果存成正式報價單（quotes + quote_lines）。
 * 依你們實際的報價單編號規則、guest 建立流程調整即可。
 */
export async function saveQuoteAction(
  request: StayRequest,
  guestId: string,
  quoteNo: string
): Promise<{ quoteId: string }> {
  const quote = await calculateQuoteAction(request);
  if (quote.roomConfigWarning) {
    throw new Error(quote.roomConfigWarning);
  }
  if (quote.capacityWarning) {
    throw new Error(quote.capacityWarning);
  }
  if (quote.minimumGuestsWarning) {
    throw new Error(quote.minimumGuestsWarning);
  }

  const supabase = await createClient();
  const propertyId = await getPropertyId(request.propertyCode);

  const { data: quoteRow, error: quoteError } = await supabase
    .from("quotes")
    .insert({
      property_id: propertyId,
      guest_id: guestId,
      quote_no: quoteNo,
      status: "draft",
      check_in: request.checkIn,
      check_out: request.checkOut,
      adults: request.adults,
      children: request.children,
      infants: request.infants ?? 0,
      pets: request.pets ?? 0,
      visitors: request.visitorQty ?? 0,
      subtotal: quote.packageTotal + quote.discountAmount,
      discount_amount: quote.discountAmount,
      total_amount: quote.packageTotal,
      needs_invoice: request.invoice?.required ?? false,
      invoice_title: request.invoice?.title ?? null,
      invoice_tax_id: request.invoice?.taxId ?? null,
    })
    .select("id")
    .single();

  if (quoteError || !quoteRow) {
    throw new Error(`建立報價單失敗：${quoteError?.message}`);
  }

  const lines = [
    {
      quote_id: quoteRow.id,
      line_type: "stay",
      description: `住宿費用（${quote.nights} 晚）`,
      quantity: quote.nights,
      unit_price: quote.nights > 0 ? quote.accommodationTotal / quote.nights : 0,
      amount: quote.accommodationTotal,
      sort_order: 1,
    },
    quote.extraBedFee > 0 && {
      quote_id: quoteRow.id,
      line_type: "extra_bed",
      description: "加床費用",
      quantity: 1,
      unit_price: quote.extraBedFee,
      amount: quote.extraBedFee,
      sort_order: 2,
    },
    quote.extraRoomFee > 0 && {
      quote_id: quoteRow.id,
      line_type: "add_on",
      description: "加開房間",
      quantity: 1,
      unit_price: quote.extraRoomFee,
      amount: quote.extraRoomFee,
      sort_order: 3,
    },
    quote.petCleaningFee > 0 && {
      quote_id: quoteRow.id,
      line_type: "add_on",
      description: "寵物清潔費",
      quantity: 1,
      unit_price: quote.petCleaningFee,
      amount: quote.petCleaningFee,
      sort_order: 4,
    },
    quote.addOnFee > 0 && {
      quote_id: quoteRow.id,
      line_type: "add_on",
      description: "額外服務（烤肉/餐車/提前入住）",
      quantity: 1,
      unit_price: quote.addOnFee,
      amount: quote.addOnFee,
      sort_order: 5,
    },
    quote.visitorFee > 0 && {
      quote_id: quoteRow.id,
      line_type: "fee",
      description: "訪客費用",
      quantity: request.visitorQty ?? 0,
      unit_price: quote.visitorFee / (request.visitorQty || 1),
      amount: quote.visitorFee,
      sort_order: 6,
    },
    quote.discountAmount > 0 && {
      quote_id: quoteRow.id,
      line_type: "discount",
      description: "優惠折扣",
      quantity: 1,
      unit_price: -quote.discountAmount,
      amount: -quote.discountAmount,
      sort_order: 7,
    },
  ].filter(Boolean);

  const { error: lineError } = await supabase.from("quote_lines").insert(lines as any[]);
  if (lineError) {
    throw new Error(`寫入報價明細失敗：${lineError.message}`);
  }

  return { quoteId: quoteRow.id as string };
}

/**
 * 依「包棟總費用」建立訂金應收款記錄（payments 表，kind=deposit）。
 * dueDate 預設為今天起 3 天內，請依實際政策調整。
 */
export async function createDepositPaymentAction(params: {
  reservationId: string;
  packageTotal: number;
  dueDate?: string;
}): Promise<void> {
  const { calculateDeposit } = await import("@/lib/pricing/calculate-package-total");
  const deposit = calculateDeposit(params.packageTotal);

  const supabase = await createClient();
  const { error } = await supabase.from("payments").insert({
    reservation_id: params.reservationId,
    payment_kind: "deposit",
    direction: "receivable",
    amount: deposit,
    due_date: params.dueDate ?? new Date().toISOString().slice(0, 10),
    status: "pending",
  });

  if (error) {
    throw new Error(`建立訂金應收款失敗：${error.message}`);
  }
}
