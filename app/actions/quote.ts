"use server";

/**
 * 報價 / 訂房 Server Action
 *
 * calculateQuoteAction         純計算，不寫入資料庫（給即時試算用）
 * calculateAndSaveQuoteAction  計算＋存成報價單快照（給「立即計算報價」
 *                              按鈕用，客人不會馬上確認訂房，先把這次
 *                              報價存起來，避免之後要重新輸入一次）
 * searchQuotesAction           依入住日期／姓名／電話／報價單編號查以前的報價
 * getSavedQuoteAction          讀回單一報價單的完整快照
 * confirmReservationFromQuoteAction
 *                              客人確認訂房後，把報價單轉成正式的
 *                              訂房記錄（reservations 相關資料表）
 *
 * ⚠️ 這幾個會寫入資料庫的 action（存報價、建立客人、建立訂房記錄）
 * 目前都用 service role client（略過 RLS），原因跟 lib/pricing/
 * queries.ts、lib/supabase/service-role.ts 的說明一致：這個系統目前
 * 還沒有接 Supabase Auth 登入流程，用一般 RLS client 寫入會直接被擋
 * 掉。之後如果要幫每個操作記錄「是哪個員工做的」（審計用途），要先
 * 把登入流程接上，這幾個 action 再改回用登入者的 client、並把
 * actor_user_id 一併記錄下來。
 */

import {
  buildMinimumGuestsBlockedQuote,
  calculatePackageQuote,
  checkMinimumGuests,
} from "@/lib/pricing/calculate-package-total";
import { buildEffectiveDayTypeMap, listStayDates, resolveDayType } from "@/lib/pricing/day-type";
import { addOnFeeBreakdown } from "@/lib/pricing/quote-message";
import {
  findOrCreateGuest,
  getBaseGuestsByDayType,
  getExtraBedEligibleRooms,
  getFlatServicePrices,
  getHolidayMap,
  getNightlyRateTable,
  getPropertyDisplayInfo,
  getPropertyId,
  getPropertyRoomCounts,
  getQuoteSnapshot,
  getReservationNoByQuoteId,
  getSingleOrganizationId,
  listRecentQuotes,
} from "@/lib/pricing/queries";
import type { ExtraBedRoomOption, QuoteSummary } from "@/lib/pricing/queries";
import type { PackageQuote, PropertyCode, QuoteRoomAllocation, StayRequest } from "@/lib/pricing/types";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const PRICE_CATEGORIES = ["weekday", "peak", "holiday", "festival", "lunar_new_year", "new_year_eve"] as const;

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
  const [roomCounts, servicePrices, propertyDisplay, ...rateTables] = await Promise.all([
    getPropertyRoomCounts(propertyId),
    getFlatServicePrices(propertyId),
    // 民宿名稱／匯款帳戶只是用來組「複製報價內容」文字的附加資料，
    // 跟金額計算無關。這裡故意單獨 catch 起來：就算這筆查詢失敗
    // （例如還沒執行 006_add_bank_account_full.sql、或帳戶設定
    // 還沒建立），也不應該讓整個報價（含金額）算不出來——
    // 只是那種情況下沒辦法產生客人版報價文字而已。
    getPropertyDisplayInfo(propertyId).catch((err) => {
      console.error(
        "查詢民宿顯示資訊（名稱/匯款帳戶）失敗，報價金額仍會正常計算，" +
          "只是無法產生「複製報價內容」文字：",
        err
      );
      return undefined;
    }),
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
    propertyDisplay,
  });
}

function generateDocNo(prefix: "Q" | "R"): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}${y}${m}${d}-${rand}`;
}

export interface SaveQuoteResult {
  quote: PackageQuote;
  /** 存檔成功才有值；報價本身還是照算，存檔失敗只是代表之後查不到這筆 */
  quoteId: string | null;
  quoteNo: string | null;
}

/**
 * 算報價，並且在沒有任何警告時把這次報價存成快照。
 *
 * 存檔刻意設計成「失敗也不影響報價金額顯示」：客人在櫃檯前等報價，
 * 資料庫寫入萬一出問題，也不該讓報價整個顯示不出來，只是那種情況下
 * quoteId/quoteNo 會是 null，畫面上要跟使用者說「這次沒有存檔成功」。
 *
 * 這個階段刻意不收客人姓名/電話、發票抬頭/統編——報價階段客人還沒
 * 確定要訂，先不強迫櫃檯人員問這些；guest_id 留 null，等 /quotes
 * 那邊「確認訂房」時才收集，那時候才建立/連結客人資料。
 */
export async function calculateAndSaveQuoteAction(request: StayRequest): Promise<SaveQuoteResult> {
  const quote = await calculateQuoteAction(request);

  if (quote.minimumGuestsWarning || quote.roomConfigWarning || quote.capacityWarning) {
    return { quote, quoteId: null, quoteNo: null };
  }

  try {
    const propertyId = await getPropertyId(request.propertyCode);
    const organizationId = await getSingleOrganizationId();
    const quoteNo = generateDocNo("Q");

    const supabase = createServiceRoleClient();
    // 型別檢查繞過：見 lib/pricing/queries.ts 裡 getReservationDetail
    // 的 `as any` 說明——專案裡的 Supabase 產生型別檔案比 010/012
    // migration 舊，不認得 request_snapshot/quote_snapshot 這些欄位，
    // 會讓 Vercel 的 `next build` 型別檢查失敗。
    const { data: row, error } = await (supabase.from("quotes") as any)
      .insert({
        organization_id: organizationId,
        property_id: propertyId,
        guest_id: null,
        quote_no: quoteNo,
        status: "sent",
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
        request_snapshot: request,
        quote_snapshot: quote,
      })
      .select("id")
      .single();

    if (error || !row) {
      console.error("儲存報價單快照失敗：", error);
      return { quote, quoteId: null, quoteNo: null };
    }

    return { quote, quoteId: row.id as string, quoteNo };
  } catch (err) {
    console.error("儲存報價單快照失敗：", err);
    return { quote, quoteId: null, quoteNo: null };
  }
}

/** 依姓名／電話／報價單編號搜尋以前的報價紀錄，search 留空回傳最近 100 筆 */
/** 依入住日期（優先，資料庫層精準比對）／姓名／電話／報價單編號搜尋以前的報價紀錄，都留空回傳最近 100 筆 */
export async function searchQuotesAction(params?: { search?: string; checkInDate?: string }): Promise<QuoteSummary[]> {
  return listRecentQuotes(params);
}

/**
 * 清除「今天以前建立、還沒確認訂房」的報價記錄，減少報價記錄的
 * 累積量。
 *
 * 刻意只刪 status != 'accepted' 的報價，已經確認訂房的報價不會被
 * 刪掉——因為 reservations.source_quote_id 會參照到這筆報價，雖然
 * 資料庫設計是刪除時該欄位自動變 null（不會連 reservations 一起砍），
 * 但已確認訂房的報價本身是重要的business記錄（客人當初實際看到、
 * 同意的金額），刪掉可惜也沒必要，只清理「問過價、後來沒下文」的
 * 那些。
 */
/**
 * 清除「今天以前建立」的報價記錄，減少報價記錄的累積量。
 *
 * 不管有沒有確認訂房，一律刪除——報價一旦轉成訂房記錄，之後就以
 * reservations 為主要依據，舊的報價記錄本身不重要了。
 * reservations.source_quote_id 參照到報價單，刪除時會自動變成
 * null（不會連 reservations 一起砍掉），已確認訂房的正式記錄不受
 * 影響。
 */
export async function clearOldQuotesAction(): Promise<{ deletedCount: number }> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("quotes")
    .delete()
    .lt("created_at", todayStart.toISOString())
    .select("id");

  if (error) {
    throw new Error(`清除報價記錄失敗：${error.message}`);
  }
  return { deletedCount: (data ?? []).length };
}

/** 讀回單一報價單快照（給檢視頁 / 轉訂房確認用） */
export async function getSavedQuoteAction(quoteId: string): Promise<{
  quote: PackageQuote;
  request: StayRequest;
  status: string;
} | null> {
  const saved = await getQuoteSnapshot(quoteId);
  if (!saved) return null;
  return {
    quote: saved.quote as unknown as PackageQuote,
    request: saved.request as unknown as StayRequest,
    status: saved.status,
  };
}

/** 該民宿「可以加床」的房間選項，給確認訂房時指定加臨時床房號用 */
export async function getExtraBedRoomOptionsAction(propertyCode: PropertyCode): Promise<ExtraBedRoomOption[]> {
  const propertyId = await getPropertyId(propertyCode);
  return getExtraBedEligibleRooms(propertyId);
}

/** 這張報價單已經確認訂房的話，查出實際的訂房編號 */
export async function getReservationNoForQuoteAction(quoteId: string): Promise<string | null> {
  return getReservationNoByQuoteId(quoteId);
}

const ITEM_TYPE_BY_LABEL: Record<string, string> = {
  訪客費用: "visitor",
  加固定床: "extra_bed_fixed",
  加臨時床: "extra_bed_temporary",
  加開房間: "other",
  寵物清潔費: "pet_cleaning",
  烤肉: "bbq",
  餐車場地費: "food_truck",
  提前入住: "early_checkin",
};

export type BookingSource = "line_official" | "airbnb" | "walk_in" | "phone" | "other_ota" | "other";

export interface ConfirmReservationDetails {
  guestName: string;
  guestPhone: string;
  /** 訂房來源，記在 reservations.booking_source */
  bookingSource: BookingSource;
  /** 只有報價當初勾選「需要開立發票」時才需要填 */
  invoiceTitle?: string;
  invoiceTaxId?: string;
  /**
   * 加臨時床要放哪個房號（從 getExtraBedRoomOptionsAction 選）。
   * 只有報價當初有填 extraBedTempQty 時才需要。
   */
  extraBedTempRoomCodes?: string[];
}

/**
 * 客人確認訂房後，把已存檔的報價單轉成正式訂房記錄：
 * reservations + reservation_room_lines + reservation_items + payments
 * （訂金應收款），並把來源報價單狀態改成 accepted。
 *
 * 客人姓名/電話、發票抬頭/統編、訂房來源、加臨時床房號都是這個階段
 * 才收集（報價階段刻意不問，見 calculateAndSaveQuoteAction 的說明）。
 *
 * 金額一律用 quote_snapshot 凍結當下算出的數字，不重新呼叫計價引擎
 * 重算——避免民宿之後調整價格，讓確認訂房的金額跟客人當初看到的
 * 報價兜不起來。
 */
export async function confirmReservationFromQuoteAction(
  quoteId: string,
  details: ConfirmReservationDetails
): Promise<{ reservationId: string; reservationNo: string }> {
  const saved = await getQuoteSnapshot(quoteId);
  if (!saved) {
    throw new Error("找不到這張報價單，請確認報價單編號是否正確");
  }
  if (saved.status === "accepted") {
    throw new Error("這張報價單已經確認過訂房了，不能重複確認");
  }

  const quote = saved.quote as unknown as PackageQuote;
  const request = saved.request as unknown as StayRequest;
  const { propertyId } = saved;

  if (quote.minimumGuestsWarning || quote.roomConfigWarning || quote.capacityWarning) {
    throw new Error("這張報價單當初就沒有算出有效金額，無法確認訂房，請重新報價");
  }

  const extraBedTempQty = request.extraBedTempQty ?? 0;
  if (extraBedTempQty > 0 && (details.extraBedTempRoomCodes?.length ?? 0) === 0) {
    throw new Error("這張報價有加臨時床，請先選好要放在哪個房號再確認訂房");
  }

  const guestId = await findOrCreateGuest({ name: details.guestName, phone: details.guestPhone });
  const reservationNo = generateDocNo("R");
  const organizationId = await getSingleOrganizationId();
  const supabase = createServiceRoleClient();

  const { data: reservationRow, error: reservationError } = await (supabase.from("reservations") as any)
    .insert({
      organization_id: organizationId,
      property_id: propertyId,
      guest_id: guestId,
      source_quote_id: quoteId,
      reservation_no: reservationNo,
      booking_source: details.bookingSource,
      status: "confirmed",
      check_in: request.checkIn,
      check_out: request.checkOut,
      adults: request.adults,
      children: request.children,
      infants: request.infants ?? 0,
      pets: request.pets ?? 0,
      visitors: request.visitorQty ?? 0,
      quoted_total: quote.packageTotal,
      final_total: quote.packageTotal,
      currency: "TWD",
      needs_invoice: request.invoice?.required ?? false,
      invoice_title: request.invoice?.required ? details.invoiceTitle ?? null : null,
      invoice_tax_id: request.invoice?.required ? details.invoiceTaxId ?? null : null,
      // 直接把房型數量存成結構化欄位（不是只存在 reservation_room_lines
      // 的自由文字 notes 裡），訂房確認單要重建「房型配置」文字時才有
      // 乾淨的數字可以用（見 lib/pricing/reservation-message.ts 的
      // confirmationRoomAllocationLines），也不用擔心報價記錄被清除
      // 之後房型配置就重建不出來了。
      four_person_suite_count: quote.roomAllocation?.fourPersonSuiteCount ?? 0,
      four_person_downgrade_count: quote.roomAllocation?.fourPersonDowngradeCount ?? 0,
      double_suite_count: quote.roomAllocation?.doubleSuiteCount ?? 0,
      double_plain_count: quote.roomAllocation?.doublePlainCount ?? 0,
    })
    .select("id")
    .single();

  if (reservationError || !reservationRow) {
    throw new Error(`建立訂房記錄失敗：${reservationError?.message}`);
  }
  const reservationId = reservationRow.id as string;

  // 房型明細（只記數量／說明，單價會因為連續訂房逐晚不同，正式的
  // 金額 authoritative 來源是 reservations.final_total，不是這裡）
  const allocation = quote.roomAllocation as QuoteRoomAllocation | null;
  if (allocation) {
    const roomLines: Record<string, unknown>[] = [];
    if (allocation.fourPersonSuiteCount > 0) {
      roomLines.push({
        reservation_id: reservationId,
        line_role: "included",
        quantity: allocation.fourPersonSuiteCount,
        notes: "四人套房",
      });
    }
    if (allocation.fourPersonDowngradeCount > 0) {
      roomLines.push({
        reservation_id: reservationId,
        line_role: "included",
        quantity: allocation.fourPersonDowngradeCount,
        beds_open: 1,
        notes: "降規四人套房（提供1床，以雙人套房計費）",
      });
    }
    if (allocation.doubleSuiteCount > 0) {
      roomLines.push({
        reservation_id: reservationId,
        line_role: "included",
        quantity: allocation.doubleSuiteCount,
        notes: "雙人套房",
      });
    }
    if (allocation.doublePlainCount > 0) {
      roomLines.push({
        reservation_id: reservationId,
        line_role: "included",
        quantity: allocation.doublePlainCount,
        notes: "雙人雅房",
      });
    }
    if (roomLines.length > 0) {
      const { error: roomLineError } = await (supabase.from("reservation_room_lines") as any).insert(roomLines);
      if (roomLineError) throw new Error(`寫入房型明細失敗：${roomLineError.message}`);
    }
  }

  // 加購項目（跟報價收據顯示的「費用明細」用同一份 addOnFeeBreakdown
  // 邏輯算，確保訂房記錄裡的項目跟客人當初看到的一致）。加臨時床那筆
  // 額外把選定的房號記進 notes，房務人員才知道要準備哪間房。
  const itemLines: Record<string, unknown>[] = addOnFeeBreakdown(quote).map((item) => ({
    reservation_id: reservationId,
    item_type: ITEM_TYPE_BY_LABEL[item.label] ?? "other",
    description: item.label,
    quantity: 1,
    unit_price: item.amount,
    amount: item.amount,
    notes:
      item.label === "加臨時床" && details.extraBedTempRoomCodes && details.extraBedTempRoomCodes.length > 0
        ? `房號：${details.extraBedTempRoomCodes.join("、")}`
        : null,
  }));
  if (quote.discountAmount > 0) {
    itemLines.push({
      reservation_id: reservationId,
      item_type: "discount",
      description: "優惠折扣",
      quantity: 1,
      unit_price: -quote.discountAmount,
      amount: -quote.discountAmount,
    });
  }
  if (quote.invoiceTaxAmount > 0) {
    itemLines.push({
      reservation_id: reservationId,
      item_type: "other",
      description: "發票稅金(8%)",
      quantity: 1,
      unit_price: quote.invoiceTaxAmount,
      amount: quote.invoiceTaxAmount,
    });
  }
  if (itemLines.length > 0) {
    const { error: itemError } = await (supabase.from("reservation_items") as any).insert(itemLines);
    if (itemError) throw new Error(`寫入加購項目失敗：${itemError.message}`);
  }

  // 訂金應收款
  const { error: paymentError } = await (supabase.from("payments") as any).insert({
    organization_id: organizationId,
    reservation_id: reservationId,
    payment_kind: "deposit",
    direction: "receivable",
    amount: quote.deposit,
    currency: "TWD",
    due_date: new Date().toISOString().slice(0, 10),
    status: "pending",
  });
  if (paymentError) throw new Error(`建立訂金應收款失敗：${paymentError.message}`);

  // 尾款應收款：到期日用報價單當初顯示的「入住前 N 天」（一般是 7
  // 天）往前推算。這筆記錄是「日曆訂單查詢」判斷尾款有沒有收的
  // 依據——沒有這筆 pending 記錄，日曆頁面就沒辦法標示「尾款未收」。
  const balanceDueDaysBeforeCheckIn = quote.messageContext?.balanceDueDaysBeforeCheckIn ?? 7;
  const checkInDate = new Date(`${request.checkIn}T00:00:00`);
  checkInDate.setDate(checkInDate.getDate() - balanceDueDaysBeforeCheckIn);
  const balanceDueDate = checkInDate.toISOString().slice(0, 10);

  const { error: balancePaymentError } = await (supabase.from("payments") as any).insert({
    organization_id: organizationId,
    reservation_id: reservationId,
    payment_kind: "balance",
    direction: "receivable",
    amount: quote.balanceDue,
    currency: "TWD",
    due_date: balanceDueDate,
    status: "pending",
  });
  if (balancePaymentError) throw new Error(`建立尾款應收款失敗：${balancePaymentError.message}`);

  const { error: updateError } = await (supabase.from("quotes") as any).update({ status: "accepted" }).eq("id", quoteId);
  if (updateError) throw new Error(`更新報價單狀態失敗：${updateError.message}`);

  return { reservationId, reservationNo };
}
