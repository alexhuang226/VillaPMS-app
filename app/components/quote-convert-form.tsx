"use client";

/**
 * 「報價 → 訂房記錄」確認表單（獨立頁面 /quotes/[id]/convert 用）。
 *
 * 上半部用跟報價記錄查詢詳情同一張報價收據卡片（QuoteReceiptCard，
 * preview 版：精簡標題、收緊內距、不顯示匯款帳號／預訂須知）呈現
 * 報價內容；下半部收集確認訂房才需要的資料（客人姓名／客戶來源／
 * 付款狀況／實收訂金／發票抬頭統編／加臨時床房號），最下方
 * 「確認轉為訂房記錄」。
 *
 * 確認流程（驗證、組 details、呼叫 confirmReservationFromQuoteAction、
 * 成功後導去訂單管理對應月份）原本內嵌在 quotes-search.tsx 的報價
 * 詳情區塊裡，現在整段搬到這個獨立頁面。
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fraunces, Work_Sans } from "next/font/google";
import { confirmReservationFromQuoteAction, getExtraBedRoomOptionsAction } from "@/app/actions/quote";
import type { BookingSource } from "@/app/actions/quote";
import { createStaffAssignmentAction, listActiveEmployeesAction } from "@/app/actions/schedule";
import { QuoteReceiptCard } from "@/app/components/quotes-search";
import type { ExtraBedRoomOption } from "@/lib/pricing/queries";
import type { Employee } from "@/lib/schedule/queries";
import type { PackageQuote, PropertyCode, StayRequest } from "@/lib/pricing/types";

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
  surface: "#FFFFFF",
  ink: "#221F1B",
  muted: "#57514A",
  line: "#D9D1C4",
  pine: "#33422E",
  pineSoft: "#E7EAE1",
  pineText: "#FFFFFF",
  alert: "#A23E2D",
  blue: "#2455A4",
};

const PROPERTY_LABEL: Record<PropertyCode, string> = {
  zhici: "只此清綠",
  moyin: "陌隱",
  shuijing: "水景璞堤",
};

/** 民宿代碼對應 properties.id——跟 monthly-schedule.tsx 的
 * PROPERTY_OPTIONS 是同一組固定 ID（見 CLAUDE.md「核心 ID」），排班
 * 表單（staff_assignments.property_id）要用這個，不是報價/訂房用的
 * PropertyCode 字串。 */
const PROPERTY_ID_BY_CODE: Record<PropertyCode, string> = {
  zhici: "0a16233a-9846-421e-b6d6-ccced85792b4",
  moyin: "c4fe9189-051f-4a3f-aa43-9f04b0043723",
  shuijing: "146fe8ae-84b5-4170-8747-dd15afc4e722",
};

/** 確認訂房時的付款狀況選項——預設「已收訂金」，實務上職員按這個
 * 按鈕的當下，客人通常都已經付了訂金（不然不會走到這一步確認）*/
const CONFIRM_PAYMENT_STATUS_LABEL: Record<string, string> = {
  deposit_paid: "已收訂金",
  balance_paid: "已收全額（含尾款）",
  pending_deposit: "尚未收款",
};

const BOOKING_SOURCE_OPTIONS: { value: BookingSource; label: string }[] = [
  { value: "line_official", label: "LINE官方" },
  { value: "facebook", label: "Facebook" },
  { value: "airbnb", label: "Airbnb" },
  { value: "walk_in", label: "現場" },
  { value: "phone", label: "電話" },
  { value: "other_ota", label: "其他OTA" },
  { value: "other", label: "其他" },
];

/** 跟 quotes-search.tsx / quote-form.tsx 同一種寫法：type="text" +
 * inputMode="numeric"，內部維護一份原始字串狀態（raw），不是讓
 * <input type="number"> 直接綁數字——要把 0 改成別的數字，不用先在
 * 0 後面打字再手動刪掉 0。各檔案各自維護一份區域定義。 */
function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const [raw, setRaw] = useState(() => String(value));

  useEffect(() => {
    setRaw(String(value));
  }, [value]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    if (next === "" || /^\d*$/.test(next)) {
      setRaw(next);
      onChange(next === "" ? 0 : Number(next));
    }
  }

  function handleBlur() {
    if (raw === "") setRaw("0");
  }

  return (
    <label className="flex flex-col gap-1">
      <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
        {label}
      </span>
      <input
        type="text"
        inputMode="numeric"
        value={raw}
        onChange={handleChange}
        onBlur={handleBlur}
        className="w-full border-b bg-transparent py-1 text-center text-sm outline-none"
        style={{ borderColor: colors.line, color: colors.ink }}
      />
    </label>
  );
}

/** 房務人員多選（複選）——跟房務班表（monthly-schedule.tsx）同一種
 * 圓角藥丸按鈕多選樣式，各檔案各自一份區域定義（見上面 NumberField
 * 的說明，同樣是無法共用 import 的區域函式）。 */
function EmployeeMultiSelect({
  employees,
  selectedIds,
  onToggle,
}: {
  employees: Employee[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  if (employees.length === 0) {
    return (
      <p className="text-[11px]" style={{ color: colors.alert }}>
        查不到職稱是「管家」或「房務員」的在職員工，請先到員工管理頁面確認
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {employees.map((emp) => {
        const active = selectedIds.includes(emp.id);
        return (
          <button
            key={emp.id}
            type="button"
            onClick={() => onToggle(emp.id)}
            className="rounded-full border px-3 py-1.5 text-xs transition-colors"
            style={
              active
                ? { borderColor: colors.pine, backgroundColor: colors.pine, color: colors.pineText }
                : { borderColor: colors.line, backgroundColor: "transparent", color: colors.ink }
            }
          >
            {emp.shortName}
          </button>
        );
      })}
    </div>
  );
}

export function QuoteConvertForm({
  quoteId,
  quote,
  request,
  createdAt,
}: {
  quoteId: string;
  quote: PackageQuote;
  request: StayRequest;
  createdAt: string | null;
}) {
  const router = useRouter();

  const [guestName, setGuestName] = useState("");
  const [bookingSource, setBookingSource] = useState<BookingSource>("line_official");
  const [paymentStatus, setPaymentStatus] = useState("deposit_paid");
  const [depositAmount, setDepositAmount] = useState(quote.deposit);
  const [invoiceTitle, setInvoiceTitle] = useState("");
  const [invoiceTaxId, setInvoiceTaxId] = useState("");

  const [extraBedRoomOptions, setExtraBedRoomOptions] = useState<ExtraBedRoomOption[]>([]);
  const [selectedExtraBedRoomIds, setSelectedExtraBedRoomIds] = useState<string[]>([]);

  // 退房打掃班表——確認訂房的同時可以順手排好退房日（request.checkOut）
  // 的房務人員，不用轉單後再另外跑一趟房務班表頁面
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [scheduleEmployeeIds, setScheduleEmployeeIds] = useState<string[]>([]);
  const [scheduleNotes, setScheduleNotes] = useState("");

  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const extraBedTempQty = request.extraBedTempQty ?? 0;
  const needsInvoice = request.invoice?.required ?? false;
  const propertyName = quote.messageContext?.propertyName ?? PROPERTY_LABEL[request.propertyCode] ?? request.propertyCode;

  useEffect(() => {
    if (extraBedTempQty <= 0) return;
    let cancelled = false;
    getExtraBedRoomOptionsAction(request.propertyCode)
      .then((options) => {
        if (!cancelled) setExtraBedRoomOptions(options);
      })
      .catch(() => {
        // 查詢失敗不擋轉單，只是房號選單會是空的——畫面上會提示直接
        // 跟房務確認
      });
    return () => {
      cancelled = true;
    };
  }, [extraBedTempQty, request.propertyCode]);

  useEffect(() => {
    let cancelled = false;
    listActiveEmployeesAction()
      .then((list) => {
        if (!cancelled) setEmployees(list);
      })
      .catch(() => {
        // 查詢失敗不擋轉單，只是排班人員選單會是空的——職員仍然可以
        // 之後到房務班表手動安排
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleScheduleEmployee(id: string) {
    setScheduleEmployeeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleExtraBedRoom(roomId: string) {
    setSelectedExtraBedRoomIds((prev) =>
      prev.includes(roomId) ? prev.filter((id) => id !== roomId) : [...prev, roomId]
    );
  }

  async function handleConfirm() {
    if (!guestName.trim()) {
      setError("請先填寫客人姓名再確認訂房");
      return;
    }
    if (paymentStatus !== "pending_deposit" && (!Number.isFinite(depositAmount) || depositAmount < 0)) {
      setError("請填寫實際收到的訂金金額");
      return;
    }
    if (extraBedTempQty > 0 && selectedExtraBedRoomIds.length === 0) {
      setError("這張報價有加臨時床，請先勾選要放在哪個房號");
      return;
    }

    setIsConfirming(true);
    setError(null);

    try {
      const extraBedTempRoomCodes = selectedExtraBedRoomIds
        .map((id) => extraBedRoomOptions.find((opt) => opt.id === id)?.code)
        .filter((code): code is string => Boolean(code));

      const result = await confirmReservationFromQuoteAction(quoteId, {
        guestName: guestName.trim(),
        bookingSource,
        paymentStatus,
        depositAmount: paymentStatus === "pending_deposit" ? 0 : depositAmount,
        invoiceTitle: needsInvoice ? invoiceTitle.trim() : undefined,
        invoiceTaxId: needsInvoice ? invoiceTaxId.trim() : undefined,
        extraBedTempRoomCodes: extraBedTempRoomCodes.length > 0 ? extraBedTempRoomCodes : undefined,
      });

      if (!result.success) {
        setError(result.message);
        return;
      }

      if (scheduleEmployeeIds.length > 0) {
        try {
          const propertyId = PROPERTY_ID_BY_CODE[request.propertyCode];
          await Promise.all(
            scheduleEmployeeIds.map((employeeId) =>
              createStaffAssignmentAction({
                employeeId,
                propertyId,
                workDate: request.checkOut,
                notes: scheduleNotes.trim() || null,
              })
            )
          );
        } catch (err) {
          // 訂房本身已經成功建立，不要因為排班失敗就讓職員誤以為整筆
          // 都沒存到——停在這頁顯示錯誤，讓職員知道要改去房務班表
          // 頁面手動補上，而不是直接導頁把這個錯誤訊息蓋掉
          setError(
            `訂房已建立成功，但排班安排失敗：${err instanceof Error ? err.message : "請稍後再試"}——請到房務班表手動補上退房日（${request.checkOut}）的人員`
          );
          return;
        }
      }

      // 確認訂房後導去訂單管理的月曆，帶著這筆訂房入住日期所在的
      // 年/月，不然要自己再手動切月份才看得到剛確認的這筆
      const [year, month] = request.checkIn.split("-");
      router.push(`/reservations?year=${year}&month=${Number(month)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "確認訂房失敗，請稍後再試");
    } finally {
      setIsConfirming(false);
    }
  }

  return (
    <div className={`${body.className} flex min-h-screen w-full justify-center px-5 py-8`} style={{ backgroundColor: colors.canvas }}>
      <div className="w-full" style={{ maxWidth: "32rem", color: colors.ink }}>
        <Link href="/quotes" className="text-xs" style={{ color: colors.blue }}>
          ← 回到報價記錄查詢
        </Link>
        <header className="mb-5 mt-2 text-center">
          <p style={{ color: colors.muted }} className="text-[11px] tracking-[0.2em]">
            宜蘭・包棟民宿
          </p>
          <h1 className={`${display.className} text-3xl italic`} style={{ color: colors.ink }}>
            轉為訂房記錄
          </h1>
          <p className="mt-1 text-xs" style={{ color: colors.muted }}>
            {propertyName}
          </p>
        </header>

        {/* 報價內容——跟報價記錄查詢詳情用同一張卡片（preview 版） */}
        {quote.messageContext && quote.roomAllocation ? (
          <div className="mx-auto w-full" style={{ maxWidth: "480px" }}>
            <QuoteReceiptCard quote={quote} createdAt={createdAt} isConfirmed={false} preview />
          </div>
        ) : (
          <p className="border-l-2 pl-3 text-xs leading-relaxed" style={{ borderColor: colors.alert, color: colors.alert }}>
            這張報價缺少完整內容（可能是查詢民宿資料時出錯），無法顯示明細——金額仍可照凍結的快照轉單，但請先確認報價單編號無誤。
          </p>
        )}

        {/* ── 表單：確認訂房要收集的資料 ── */}
        <section className="mt-5 flex flex-col gap-4">
          <p className="text-xs font-bold" style={{ color: colors.blue }}>
            客人確認訂房後填寫
          </p>

          <label className="flex flex-col gap-1">
            <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
              客人姓名
            </span>
            <input
              type="text"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              className="w-full border-b bg-transparent py-1 text-sm outline-none"
              style={{ borderColor: colors.line, color: colors.ink }}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
              客戶來源
            </span>
            <select
              value={bookingSource}
              onChange={(e) => setBookingSource(e.target.value as BookingSource)}
              className="w-full border-b bg-transparent py-1 text-sm outline-none"
              style={{ borderColor: colors.line, color: colors.ink }}
            >
              {BOOKING_SOURCE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1">
              <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                付款狀況
              </span>
              <select
                value={paymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value)}
                className="w-full border-b bg-transparent py-1 text-sm outline-none"
                style={{ borderColor: colors.line, color: colors.ink }}
              >
                {Object.entries(CONFIRM_PAYMENT_STATUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {paymentStatus !== "pending_deposit" && (
              <NumberField label="實收訂金金額" value={depositAmount} onChange={setDepositAmount} />
            )}
          </div>

          {needsInvoice && (
            <div className="grid grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                  發票抬頭
                </span>
                <input
                  type="text"
                  value={invoiceTitle}
                  onChange={(e) => setInvoiceTitle(e.target.value)}
                  className="w-full border-b bg-transparent py-1 text-sm outline-none"
                  style={{ borderColor: colors.line, color: colors.ink }}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                  統一編號
                </span>
                <input
                  type="text"
                  value={invoiceTaxId}
                  onChange={(e) => setInvoiceTaxId(e.target.value)}
                  className="w-full border-b bg-transparent py-1 text-sm outline-none"
                  style={{ borderColor: colors.line, color: colors.ink }}
                />
              </label>
            </div>
          )}

          {extraBedTempQty > 0 && (
            <div>
              <p style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                加臨時床房號（請勾選 {extraBedTempQty} 間）
              </p>
              {extraBedRoomOptions.length === 0 ? (
                <p className="mt-1 text-[11px]" style={{ color: colors.alert }}>
                  這間民宿沒有設定可加床的房號，請直接跟房務確認
                </p>
              ) : (
                <div className="mt-1 flex flex-wrap gap-2">
                  {extraBedRoomOptions.map((room) => {
                    const active = selectedExtraBedRoomIds.includes(room.id);
                    return (
                      <button
                        key={room.id}
                        type="button"
                        onClick={() => toggleExtraBedRoom(room.id)}
                        className="rounded-full border px-3 py-1.5 text-xs transition-colors"
                        style={
                          active
                            ? { borderColor: colors.pine, backgroundColor: colors.pine, color: colors.pineText }
                            : { borderColor: colors.line, backgroundColor: "transparent", color: colors.ink }
                        }
                      >
                        {room.code}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="border-t pt-4" style={{ borderColor: colors.line }}>
            <p className="text-xs font-bold" style={{ color: colors.blue }}>
              安排退房打掃班表（選填）
            </p>
            <p className="mt-1 text-[11px]" style={{ color: colors.muted }}>
              退房日 {request.checkOut}——不指定人員也可以之後再到房務班表安排
            </p>
            <div className="mt-2">
              <EmployeeMultiSelect employees={employees} selectedIds={scheduleEmployeeIds} onToggle={toggleScheduleEmployee} />
            </div>
            {scheduleEmployeeIds.length > 0 && (
              <label className="mt-3 flex flex-col gap-1">
                <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                  備註（選填）
                </span>
                <input
                  type="text"
                  value={scheduleNotes}
                  onChange={(e) => setScheduleNotes(e.target.value)}
                  className="w-full border-b bg-transparent py-1 text-sm outline-none"
                  style={{ borderColor: colors.line, color: colors.ink }}
                />
              </label>
            )}
          </div>

          {error && (
            <p role="alert" className="border-l-2 pl-3 text-xs leading-relaxed" style={{ borderColor: colors.alert, color: colors.alert }}>
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={handleConfirm}
            disabled={isConfirming}
            className="w-full py-2.5 text-xs tracking-wide transition-opacity disabled:opacity-50"
            style={{ backgroundColor: colors.pine, color: colors.pineText }}
          >
            {isConfirming ? "確認中…" : "確認轉為訂房記錄"}
          </button>
        </section>
      </div>
    </div>
  );
}
