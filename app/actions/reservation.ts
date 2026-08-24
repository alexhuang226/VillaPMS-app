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
  getExtraBedEligibleRooms,
  getPropertyId,
  getPropertyRoomCounts,
  getReservationDetail,
  getReservationsForMonthCalendar,
  listReceivables,
  listReservations,
  markPaymentPaid,
  updateReservation,
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
 * 組出客人已付訂金後要傳給客人的訂房確認單文字。
 * 只有訂金已經標記為已收款（markPaymentPaidAction）才能用——沒收到
 * 訂金卻產生「已收到訂金匯款」的訊息會誤導客人，所以直接在這裡查
 * 一次最新的訂單詳細內容，用實際的付款狀態產生內容，不接受呼叫端
 * 自己組好的資料（避免畫面上顯示的跟資料庫實際狀態不同步）。
 */
export async function buildReservationConfirmationMessageAction(reservationId: string): Promise<string> {
  const detail = await getReservationDetail(reservationId);
  if (!detail) {
    throw new Error("找不到這筆訂單");
  }
  return buildReservationConfirmationMessage(detail);
}

/**
 * 編輯訂單基本資料（人數/客戶來源/發票/總金額/狀態），因應客人
 * 確認訂房後又變更人數或其他需求。不含入住/退房日期跟房型配置的
 * 編輯——見 ReservationUpdateFields 的說明。
 */
export async function updateReservationAction(reservationId: string, fields: ReservationUpdateFields): Promise<void> {
  return updateReservation(reservationId, fields);
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
