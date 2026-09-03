"use server";

/**
 * 訂單（reservations）／應收款（payments）Server Action
 *
 * 跟 lib/pricing/queries.ts 裡的查詢函式一樣，用 service role client
 * （見 lib/supabase/service-role.ts 的說明），原因跟報價那邊一致：
 * 目前系統還沒接 Supabase Auth 登入流程。
 */

import {
  createReservationDirectly,
  deleteReservation,
  getExtraBedEligibleRooms,
  getPropertyId,
  getPropertyRoomCounts,
  getReservationDetail,
  getReservationsForMonthCalendar,
  listReceivables,
  listReservations,
  markPaymentPaid,
  updateReservation,
  updateReservationPaymentStatus,
  updateReservationStatus,
} from "@/lib/pricing/queries";
import type {
  CalendarReservation,
  CreateReservationFields,
  ExtraBedRoomOption,
  ReceivableSummary,
  ReservationDetail,
  ReservationSummary,
  ReservationUpdateFields,
} from "@/lib/pricing/queries";
import { buildReservationConfirmationMessage } from "@/lib/pricing/reservation-message";
import { resolveRoomAllocation } from "@/lib/pricing/property-room-allocation";
import type { PropertyCode } from "@/lib/pricing/types";

export async function searchReservationsAction(params?: {
  search?: string;
  checkInDate?: string;
}): Promise<ReservationSummary[]> {
  return listReservations(params);
}

export async function getReservationDetailAction(reservationId: string): Promise<ReservationDetail | null> {
  return getReservationDetail(reservationId);
}

export async function listReceivablesAction(): Promise<ReceivableSummary[]> {
  return listReceivables();
}

export async function markPaymentPaidAction(paymentId: string): Promise<void> {
  return markPaymentPaid(paymentId);
}

/**
 * 改整體付款狀況（訂單詳情頁面直接可以改，不用進到「編輯」表單），
 * 會同時同步訂金/尾款兩筆付款記錄——見 lib/pricing/queries.ts
 * updateReservationPaymentStatus() 的說明。
 */
export async function updateReservationPaymentStatusAction(reservationId: string, paymentStatus: string): Promise<void> {
  return updateReservationPaymentStatus(reservationId, paymentStatus);
}

/** 訂單詳情頁面快速切換整體狀態（已確認/已取消/未到），不用進到
 * 「編輯」表單——見 lib/pricing/queries.ts updateReservationStatus()
 * 的說明。 */
export async function updateReservationStatusAction(reservationId: string, status: string): Promise<void> {
  return updateReservationStatus(reservationId, status);
}

/**
 * 日曆檢視用：查某年某月三間民宿的訂單。month 是 1-12（一般人習慣的
 * 月份表示法，不是 JS Date 的 0-11）。
 */
export async function getCalendarReservationsAction(year: number, month: number): Promise<CalendarReservation[]> {
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonthDate = new Date(year, month, 1); // month 是 1-12，剛好等於「下個月」用 JS Date 的 0-11 表示
  const nextMonthStart = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, "0")}-01`;
  return getReservationsForMonthCalendar(monthStart, nextMonthStart);
}

/**
 * 跟上面 getCalendarReservationsAction 查的是同一張表，差別是直接
 * 接受明確的日期區間，不是限定「一整個月」——月曆畫面補在跨月那一
 * 週前後、屬於上個月/下個月的格子，也要顯示真實的訂房狀況（不是
 * 空白格），需要查的範圍比「這個月」再寬一點點（最多前後各 6 天，
 * 一週最多補到 6 天）。呼叫端自己算好要查的起訖日期傳進來。
 */
export async function getCalendarReservationsForRangeAction(
  startDate: string,
  endDateExclusive: string
): Promise<CalendarReservation[]> {
  return getReservationsForMonthCalendar(startDate, endDateExclusive);
}

/**
 * 組出客人已付訂金後要傳給客人的訂房確認單文字。
 * 只有訂金已經標記為已收款（markPaymentPaidAction）才能用——沒收到
 * 訂金卻產生「已收到訂金匯款」的訊息會誤導客人，所以直接在這裡查
 * 一次最新的訂單詳細內容，用實際的付款狀態產生內容，不接受呼叫端
 * 自己組好的資料（避免畫面上顯示的跟資料庫實際狀態不同步）。
 */
/**
 * 這個函式的回傳值刻意用「結果物件」而不是回傳字串／直接 throw——
 * 理由見 app/actions/quote.ts 的 ConfirmReservationResult 說明：
 * Next.js 正式環境下，Server Action 用 throw 拋出的錯誤訊息會被
 * 自動抹除，只留一段看不懂的 React 錯誤代碼（Minified React error
 * #441），本機開發環境不會出現這個問題，只有部署到正式環境才會
 * 發生。這個函式原本就是用 throw（找不到訂單、訂金還沒收款兩種
 * 情況），是踩到同一個問題的另一個例子——複製訂房確認內容這個按鈕
 * 在正式環境點下去，一樣只會看到看不懂的錯誤代碼，看不到真正的
 * 中文錯誤訊息。
 */
export type BuildConfirmationMessageResult = { success: true; text: string } | { success: false; message: string };

export async function buildReservationConfirmationMessageAction(reservationId: string): Promise<BuildConfirmationMessageResult> {
  try {
    const detail = await getReservationDetail(reservationId);
    if (!detail) {
      return { success: false, message: "找不到這筆訂單" };
    }
    const text = buildReservationConfirmationMessage(detail);
    return { success: true, text };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "產生訂房確認內容失敗，請稍後再試" };
  }
}

/**
 * 編輯訂單基本資料（人數/客戶來源/發票/總金額/訂單狀態/付款狀況），
 * 因應客人確認訂房後又變更人數或其他需求。不含入住/退房日期跟房型
 * 配置的編輯——見 ReservationUpdateFields 的說明。
 */
export async function updateReservationAction(reservationId: string, fields: ReservationUpdateFields): Promise<void> {
  return updateReservation(reservationId, fields);
}

/**
 * 真正刪除一筆訂單（連子資料一起刪掉，無法復原）——測試訂單/建錯的
 * 訂單用這個清掉。客人真的取消預訂，應該用「編輯」把訂單狀態改成
 * 「已取消」，不要用這個：那樣訂單記錄還會保留，系統裡的統計/房務
 * 排班本來就會自動排除已取消的訂單。
 */
export async function deleteReservationAction(reservationId: string): Promise<void> {
  return deleteReservation(reservationId);
}

/**
 * 直接建立訂單，跳過報價／訂房確認單流程——給 Airbnb 等 OTA 平台
 * 訂房用，房價跟收款平台都已經處理過了，不需要民宿這邊再走一次
 * 報價確認的流程。
 */
export async function createReservationDirectlyAction(
  fields: CreateReservationFields
): Promise<{ reservationId: string; reservationNo: string }> {
  return createReservationDirectly(fields);
}

/** 房型配置，只有數量，不含價格 */
export interface AutoRoomAllocation {
  fourPersonSuiteCount: number;
  fourPersonDowngradeCount: number;
  doubleSuiteCount: number;
  doublePlainCount: number;
}

/**
 * 純粹依人數自動算出房型配置，不跑計價——「新增訂單」表單用，跟
 * 報價單套用完全同一套分配公式（resolveRoomAllocation），人數改變
 * 時即時重算建議的房型組合，職員仍然可以在表單上手動調整覆蓋掉。
 */
export async function calculateAutoRoomAllocationAction(
  propertyCode: PropertyCode,
  adults: number,
  children: number
): Promise<AutoRoomAllocation> {
  const propertyId = await getPropertyId(propertyCode);
  const roomCounts = await getPropertyRoomCounts(propertyId);
  const totalGuests = adults + children;
  const { allocation } = resolveRoomAllocation(propertyCode, totalGuests, roomCounts);
  return {
    fourPersonSuiteCount: allocation.fullPriceCount,
    fourPersonDowngradeCount: allocation.downgradeCount,
    doubleSuiteCount: allocation.doubleSuiteCount,
    doublePlainCount: allocation.doublePlainCount,
  };
}

/** 該民宿「可以加床」的房間選項，跟報價確認訂房那邊共用同一個查詢 */
export async function getExtraBedRoomOptionsForCreateAction(propertyCode: PropertyCode): Promise<ExtraBedRoomOption[]> {
  const propertyId = await getPropertyId(propertyCode);
  return getExtraBedEligibleRooms(propertyId);
}
