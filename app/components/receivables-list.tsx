"use client";

/**
 * 查詢應收頁面
 *
 * 只顯示「入住日期在未來 10 天內」的應收款（含已經入住但還沒收到
 * 尾款的，也就是入住日期已經過去的）——民宿的匯尾款提醒是訂在入住
 * 前一週，10 天的視窗剛好包含「快到提醒時間點」跟「已經逾期」這兩種
 * 都需要優先處理的狀況，太遠的不用先看到，減少雜訊。
 *
 * 「逾期」的定義刻意不是看 payments.due_date 有沒有過——訂金的
 * due_date 是「訂房當天」，不是照入住日期算的，用 due_date 判斷逾期
 * 對訂金來說沒有意義。逾期一律看「離入住日期不到 7 天」（民宿的
 * 尾款提醒規則本來就是入住前一週），不管這筆是訂金還是尾款，統一
 * 用同一個入住日期為準的規則判斷，比較站得住腳。
 *
 * 每一筆可以直接標記「已收款」，標記後會從列表移除（不用重新整理
 * 頁面）。
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Fraunces, Work_Sans } from "next/font/google";
import { listReceivablesAction, markPaymentPaidAction } from "@/app/actions/reservation";
import type { ReceivableSummary } from "@/lib/pricing/queries";

const display = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  variable: "--font-display",
});
const body = Work_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
});

const colors = {
  canvas: "#FAF8F4",
  ink: "#221F1B",
  muted: "#57514A",
  line: "#D9D1C4",
  pine: "#33422E",
  pineSoft: "#E7EAE1",
  pineText: "#FFFFFF",
  alert: "#A23E2D",
  blue: "#2455A4",
};

const PAYMENT_KIND_LABEL: Record<string, string> = {
  deposit: "訂金",
  balance: "尾款",
  security_deposit: "保證金",
  adjustment: "調整款",
  refund: "退款",
};

const SHOW_WITHIN_DAYS = 10;
const OVERDUE_WITHIN_DAYS = 7; // 尾款提醒規則：入住前一週

/** 今天算起，距離某個日期還剩幾天；已經過去回傳負數 */
function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function ReceivablesList() {
  const [rows, setRows] = useState<ReceivableSummary[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);

  async function loadReceivables() {
    setIsLoading(true);
    setError(null);
    try {
      const data = await listReceivablesAction();
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "查詢失敗，請稍後再試");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadReceivables();
  }, []);

  async function handleMarkPaid(paymentId: string) {
    setMarkingId(paymentId);
    setError(null);
    try {
      await markPaymentPaidAction(paymentId);
      setRows((prev) => (prev ? prev.filter((r) => r.paymentId !== paymentId) : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "標記失敗，請稍後再試");
    } finally {
      setMarkingId(null);
    }
  }

  // 只留下「入住日期在未來 10 天內」的（含已經入住、還沒收尾款的
  // 過期狀況），依入住日期由近到遠排序——最急迫的排最前面。
  const visibleRows = (rows ?? [])
    .filter((r) => daysUntil(r.checkIn) <= SHOW_WITHIN_DAYS)
    .sort((a, b) => daysUntil(a.checkIn) - daysUntil(b.checkIn));

  const totalOutstanding = visibleRows.reduce((sum, r) => sum + r.amount, 0);

  return (
    <div className={`${body.className} flex min-h-screen w-full justify-center px-5 py-8`} style={{ backgroundColor: colors.canvas }}>
      <div className="w-full" style={{ maxWidth: "24rem", color: colors.ink }}>
        <Link href="/" className="text-xs" style={{ color: colors.blue }}>
          ← 返回首頁
        </Link>
        <header className="mb-6 text-center">
          <p style={{ color: colors.muted }} className="text-[11px] tracking-[0.2em]">
            宜蘭・包棟民宿
          </p>
          <h1 className={`${display.className} text-4xl italic`} style={{ color: colors.ink }}>
            應收查詢
          </h1>
          <p className="mt-1 text-[11px]" style={{ color: colors.muted }}>
            只顯示入住日期在未來 {SHOW_WITHIN_DAYS} 天內（含已逾期）的應收款
          </p>
        </header>

        {isLoading && (
          <p className="text-xs" style={{ color: colors.muted }}>
            讀取中…
          </p>
        )}

        {error && (
          <p role="alert" className="mb-4 border-l-2 pl-3 text-xs leading-relaxed" style={{ borderColor: colors.alert, color: colors.alert }}>
            {error}
          </p>
        )}

        {!isLoading && visibleRows.length === 0 && (
          <p className="text-xs" style={{ color: colors.muted }}>
            未來 {SHOW_WITHIN_DAYS} 天內沒有應收款項。
          </p>
        )}

        {visibleRows.length > 0 && (
          <>
            <div className="rounded-sm px-4 py-4" style={{ backgroundColor: colors.pineSoft }}>
              <p className="text-[11px] tracking-wide" style={{ color: colors.muted }}>
                未收款總額（{visibleRows.length} 筆）
              </p>
              <p className={`${display.className} text-3xl italic`} style={{ color: colors.pine }}>
                NT$ {totalOutstanding.toLocaleString()}
              </p>
            </div>

            <div className="mt-4 flex flex-col gap-3">
              {visibleRows.map((row) => {
                const overdue = daysUntil(row.checkIn) < OVERDUE_WITHIN_DAYS;
                return (
                  <div key={row.paymentId} className="border p-3 text-xs" style={{ borderColor: overdue ? colors.alert : colors.line }}>
                    <div className="flex items-baseline justify-between">
                      <span className="font-semibold">{row.propertyName}</span>
                      <span style={{ color: overdue ? colors.alert : colors.muted }}>
                        入住：{row.checkIn}
                        {overdue ? "（已逾期）" : ""}
                      </span>
                    </div>
                    <p className="mt-1" style={{ color: colors.muted }}>
                      {row.dueDate ? `到期：${row.dueDate}　` : ""}
                      {row.reservationNo}
                    </p>
                    <p className="mt-1" style={{ color: colors.muted }}>
                      {row.guestName || "（未填姓名）"}
                      {row.guestPhone ? `　${row.guestPhone}` : ""}
                    </p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="font-semibold">
                        {PAYMENT_KIND_LABEL[row.paymentKind] ?? row.paymentKind}　NT$ {row.amount.toLocaleString()}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleMarkPaid(row.paymentId)}
                        disabled={markingId === row.paymentId}
                        className="border px-3 py-1.5 text-xs tracking-wide transition-colors disabled:opacity-50"
                        style={{ borderColor: colors.pine, color: colors.pine }}
                      >
                        {markingId === row.paymentId ? "處理中…" : "標記已收款"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
