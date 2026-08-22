"use server";

/**
 * 訂單（reservations）／應收款（payments）Server Action
 *
 * 跟 lib/pricing/queries.ts 裡的查詢函式一樣，用 service role client
 * （見 lib/supabase/service-role.ts 的說明），原因跟報價那邊一致：
 * 目前系統還沒接 Supabase Auth 登入流程。
 */

import {
  getReservationDetail,
  getReservationsForMonthCalendar,
  listReceivables,
  listReservations,
  markPaymentPaid,
  updateReservation,
} from "@/lib/pricing/queries";
import type {
  CalendarReservation,
  ReceivableSummary,
  ReservationDetail,
  ReservationSummary,
  ReservationUpdateFields,
} from "@/lib/pricing/queries";
import { buildReservationConfirmationMessage } from "@/lib/pricing/reservation-message";

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
