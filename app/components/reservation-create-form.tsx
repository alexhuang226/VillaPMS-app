"use client";

/**
 * 新增訂單——獨立頁面
 *
 * 原本是訂單管理頁面（reservations-search.tsx）裡用 showCreateForm
 * 這個 state 切換顯示/隱藏的表單區塊，跟月曆、訂單詳情、應收帳款
 * 擠在同一個頁面裡。這次抽成獨立頁面，這裡只有新增訂單這個表單，
 * 不顯示月曆、不顯示「當月各民宿統計訂房天數」。
 *
 * 這裡用到的欄位定義（EMPTY_CREATE_FIELDS）、NumberField、PROPERTIES、
 * BOOKING_SOURCE_LABEL 等等，reservations-search.tsx 裡也有一份一模
 * 一樣的——兩邊都用得到（reservations-search.tsx 的編輯表單也要用），
 * 沒辦法只留一份互相 import（那些是各自檔案內的區域定義，不是
 * export 出來的模組），所以維持重複定義。如果之後要改欄位選項、
 * 樣式，記得兩邊要一起改。
 *
 * 建立成功後導回訂單管理頁面（/reservations），不是像原本那樣自己
 * 重新查一次月曆——導頁本身就會讓訂單管理重新載入、抓到最新資料，
 * 不用另外處理「這個獨立頁面要怎麼通知月曆更新」的問題。
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Fraunces, Work_Sans } from "next/font/google";
import {
  calculateAutoRoomAllocationAction,
  createReservationDirectlyAction,
  getExtraBedRoomOptionsForCreateAction,
} from "@/app/actions/reservation";
import { createStaffAssignmentAction, listActiveEmployeesAction } from "@/app/actions/schedule";
import type { CreateReservationFields, ExtraBedRoomOption } from "@/lib/pricing/queries";
import type { Employee } from "@/lib/schedule/queries";

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
  pineText: "#FFFFFF",
  alert: "#A23E2D",
  blue: "#2455A4",
  gold: "#A67C3D",
};

const PROPERTIES = [
  { code: "zhici", label: "只此清綠", color: "#5C7A4A" },
  { code: "moyin", label: "陌隱", color: colors.gold },
  { code: "shuijing", label: "水景璞堤", color: colors.blue },
];

/** 民宿代碼對應 properties.id——跟 monthly-schedule.tsx 的
 * PROPERTY_OPTIONS 是同一組固定 ID（見 CLAUDE.md「核心 ID」），排班
 * 表單（staff_assignments.property_id）要用這個，不是訂單用的
 * propertyCode 字串。 */
const PROPERTY_ID_BY_CODE: Record<string, string> = {
  zhici: "0a16233a-9846-421e-b6d6-ccced85792b4",
  moyin: "c4fe9189-051f-4a3f-aa43-9f04b0043723",
  shuijing: "146fe8ae-84b5-4170-8747-dd15afc4e722",
};

const RESERVATION_PAYMENT_STATUS_LABEL: Record<string, string> = {
  pending_deposit: "待匯訂金",
  deposit_paid: "已匯訂金",
  balance_paid: "已匯尾款",
  deposit_refunded: "退還訂金",
  deposit_forfeited: "沒收訂金",
};
const BOOKING_SOURCE_LABEL: Record<string, string> = {
  line_official: "LINE官方",
  facebook: "Facebook",
  airbnb: "Airbnb",
  walk_in: "現場",
  phone: "電話",
  other_ota: "其他OTA",
  other: "其他",
};
const BOOKING_SOURCE_OPTIONS = Object.entries(BOOKING_SOURCE_LABEL).map(([value, label]) => ({ value, label }));

const EMPTY_CREATE_FIELDS: CreateReservationFields = {
  propertyCode: "zhici",
  guestName: "",
  guestPhone: "",
  checkIn: "",
  checkOut: "",
  adults: 10,
  children: 0,
  infants: 0,
  pets: 0,
  visitors: 0,
  bookingSource: "airbnb",
  finalTotal: 0,
  paymentStatus: "pending_deposit",
  depositAmount: 0,
  needsInvoice: false,
  invoiceTitle: null,
  invoiceTaxId: null,
  fourPersonSuiteCount: 0,
  fourPersonDowngradeCount: 0,
  doubleSuiteCount: 0,
  doublePlainCount: 0,
  extraBedFixedRoomCodes: [],
  extraBedTempRoomCodes: [],
  extraRoomQty: 0,
  bbq: false,
  foodTruck: false,
  earlyCheckin: false,
};

/** Date 物件轉成「本地日曆日期」的 'YYYY-MM-DD'（不透過 toISOString，
 * 那個一定轉成 UTC，會有時區位移問題，見 quote-form.tsx 的說明） */
function formatLocalDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDefaultCreateCheckIn(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return formatLocalDate(d);
}

/** 'YYYY-MM-DD' 字串加一天，全程用 UTC 運算避免時區造成的位移 */
function addOneDayToYMD(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** 跟 quote-form.tsx / reservations-search.tsx 用的是同一種寫法：
 * type="text" + inputMode="numeric"，內部自己維護一份原始字串狀態，
 * 不用先在 0 後面打字才能刪 0 */
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

/** 新增訂單表單的區塊標題——比照報價試算（quote-form.tsx 的
 * SectionMark）／訂單編輯表單的樣式：淺色小標＋一條往右延伸的
 * 分隔線。 */
function CreateSectionHeading({ title }: { title: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <span style={{ color: colors.muted }} className="text-xs tracking-wide">
        {title}
      </span>
      <span className="h-px flex-1" style={{ backgroundColor: colors.line }} />
    </div>
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

export function ReservationCreateForm() {
  const router = useRouter();

  const [createFields, setCreateFields] = useState<CreateReservationFields>(() => {
    const defaultCheckIn = getDefaultCreateCheckIn();
    return { ...EMPTY_CREATE_FIELDS, checkIn: defaultCheckIn, checkOut: addOneDayToYMD(defaultCheckIn) };
  });
  const [isSavingCreate, setIsSavingCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // 總金額刻意留空白，不套用計價公式（Airbnb 等平台的房價是平台
  // 訂的，不是照民宿自己的計價規則算），用獨立的原始字串狀態存，
  // 才能讓欄位一開始是真的空白，不是顯示著「0」
  const [finalTotalRaw, setFinalTotalRaw] = useState("");
  // 房型配置是不是職員手動調整過——調整過之後，人數再變動就不要
  // 覆蓋掉職員自己填的數字，跟報價單「手動覆寫房型」的邏輯一致
  const [roomAllocationTouched, setRoomAllocationTouched] = useState(false);
  // 加臨時床要放哪些房號的選項，跟著民宿變動即時查
  const [extraBedRoomOptions, setExtraBedRoomOptions] = useState<ExtraBedRoomOption[]>([]);
  // 退房打掃班表——建立訂單的同時可以順手排好退房日的房務人員，
  // 不用建單後再另外跑一趟房務班表頁面
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [scheduleEmployeeIds, setScheduleEmployeeIds] = useState<string[]>([]);
  const [scheduleNotes, setScheduleNotes] = useState("");

  function updateCreateField<K extends keyof CreateReservationFields>(key: K, value: CreateReservationFields[K]) {
    setCreateFields((prev) => ({ ...prev, [key]: value }));
  }

  /** 入住日期規則跟報價單一致：只要動了入住日期，退房日期就重算成
   * 入住日期+1 天 */
  function handleCreateCheckInChange(newCheckIn: string) {
    setCreateFields((prev) => ({
      ...prev,
      checkIn: newCheckIn,
      checkOut: newCheckIn ? addOneDayToYMD(newCheckIn) : prev.checkOut,
    }));
  }

  /** 房型數量欄位一旦被手動改過，就不要再讓自動計算蓋掉 */
  function updateCreateRoomField<K extends keyof CreateReservationFields>(key: K, value: CreateReservationFields[K]) {
    setRoomAllocationTouched(true);
    updateCreateField(key, value);
  }

  function toggleCreateExtraBedRoom(field: "extraBedFixedRoomCodes" | "extraBedTempRoomCodes", code: string) {
    setCreateFields((prev) => ({
      ...prev,
      [field]: prev[field].includes(code) ? prev[field].filter((c) => c !== code) : [...prev[field], code],
    }));
  }

  // 房型配置自動跟著民宿／人數重算，套用跟報價單同一套分配公式——
  // 只有房型還沒被手動調整過才會自動重算
  useEffect(() => {
    if (roomAllocationTouched) return;
    let cancelled = false;
    calculateAutoRoomAllocationAction(createFields.propertyCode, createFields.adults, createFields.children)
      .then((allocation) => {
        if (cancelled) return;
        setCreateFields((prev) => ({
          ...prev,
          fourPersonSuiteCount: allocation.fourPersonSuiteCount,
          fourPersonDowngradeCount: allocation.fourPersonDowngradeCount,
          doubleSuiteCount: allocation.doubleSuiteCount,
          doublePlainCount: allocation.doublePlainCount,
        }));
      })
      .catch(() => {
        // 自動計算失敗不擋表單——職員還是可以手動填房型數量
      });
    return () => {
      cancelled = true;
    };
  }, [roomAllocationTouched, createFields.propertyCode, createFields.adults, createFields.children]);

  // 加臨時床的房號選項跟著民宿變動即時查——民宿改變時，之前選的
  // 房號可能不再適用，一併清空避免留著錯的民宿的房號
  useEffect(() => {
    let cancelled = false;
    getExtraBedRoomOptionsForCreateAction(createFields.propertyCode)
      .then((options) => {
        if (!cancelled) setExtraBedRoomOptions(options);
      })
      .catch(() => {
        // 查詢失敗不擋表單，只是加床位置選單會是空的
      });
    setCreateFields((prev) => ({ ...prev, extraBedFixedRoomCodes: [], extraBedTempRoomCodes: [] }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createFields.propertyCode]);

  useEffect(() => {
    let cancelled = false;
    listActiveEmployeesAction()
      .then((list) => {
        if (!cancelled) setEmployees(list);
      })
      .catch(() => {
        // 查詢失敗不擋建單，只是排班人員選單會是空的——職員仍然可以
        // 之後到房務班表手動安排
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleScheduleEmployee(id: string) {
    setScheduleEmployeeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!createFields.guestName.trim() || !createFields.checkIn || !createFields.checkOut) {
      setCreateError("請填寫客人姓名、入住日期、退房日期");
      return;
    }
    setIsSavingCreate(true);
    setCreateError(null);
    try {
      await createReservationDirectlyAction({
        ...createFields,
        guestName: createFields.guestName.trim(),
        guestPhone: createFields.guestPhone.trim(),
        finalTotal: Number(finalTotalRaw) || 0,
      });

      if (scheduleEmployeeIds.length > 0) {
        try {
          const propertyId = PROPERTY_ID_BY_CODE[createFields.propertyCode];
          await Promise.all(
            scheduleEmployeeIds.map((employeeId) =>
              createStaffAssignmentAction({
                employeeId,
                propertyId,
                workDate: createFields.checkOut,
                notes: scheduleNotes.trim() || null,
              })
            )
          );
        } catch (err) {
          // 訂單本身已經成功建立，不要因為排班失敗就讓職員誤以為整筆
          // 都沒存到——停在這頁顯示錯誤，讓職員知道要改去房務班表
          // 頁面手動補上，而不是直接導頁把這個錯誤訊息蓋掉
          setCreateError(
            `訂單已建立成功，但排班安排失敗：${err instanceof Error ? err.message : "請稍後再試"}——請到房務班表手動補上退房日（${createFields.checkOut}）的人員`
          );
          return;
        }
      }

      // 建立成功後導回訂單管理頁面，並且帶著這筆新訂單入住日期所在
      // 的年/月——不然導回去預設看到的是「今天」那個月，如果訂單的
      // 入住日期不在當月（新增訂單的入住日期預設就是下個月），使用
      // 者存檔後還要自己手動切換月份才看得到剛剛新增的這筆。
      const [checkInYear, checkInMonth] = createFields.checkIn.split("-");
      router.push(`/reservations?year=${checkInYear}&month=${Number(checkInMonth)}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "建立訂單失敗，請稍後再試");
    } finally {
      setIsSavingCreate(false);
    }
  }

  return (
    <div
      className={`${body.className} flex min-h-screen w-full justify-center px-5 py-8`}
      style={{ backgroundColor: colors.canvas }}
    >
      <div className="w-full" style={{ maxWidth: "24rem", color: colors.ink }}>
        <button type="button" onClick={() => router.back()} className="text-xs" style={{ color: colors.blue }}>
          ← 返回上一頁
        </button>
        <header className="mb-6 text-center">
          <p style={{ color: colors.muted }} className="text-[11px] tracking-[0.2em]">
            宜蘭・包棟民宿
          </p>
          <h1 className={`${display.className} text-4xl italic`} style={{ color: colors.ink }}>
            新增訂單
          </h1>
        </header>

        <form onSubmit={handleCreateSubmit} className="flex flex-col gap-4 border p-4" style={{ borderColor: colors.line }}>
          <div>
            <p style={{ color: colors.muted }} className="mb-1 text-[11px] tracking-wide">
              民宿
            </p>
            <div className="flex flex-wrap gap-2">
              {PROPERTIES.map((p) => {
                const active = createFields.propertyCode === p.code;
                return (
                  <button
                    key={p.code}
                    type="button"
                    onClick={() => updateCreateField("propertyCode", p.code as CreateReservationFields["propertyCode"])}
                    className="rounded-full border px-3 py-1.5 text-xs transition-colors"
                    style={
                      active
                        ? { borderColor: p.color, backgroundColor: p.color, color: "#FFFFFF" }
                        : { borderColor: colors.line, backgroundColor: "transparent", color: colors.ink }
                    }
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="flex flex-col gap-1">
            <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
              付款狀況
            </span>
            <select
              value={createFields.paymentStatus}
              onChange={(e) => updateCreateField("paymentStatus", e.target.value)}
              className="w-full border-b bg-transparent py-1 text-sm outline-none"
              style={{ borderColor: colors.line, color: colors.ink }}
            >
              {Object.entries(RESERVATION_PAYMENT_STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <NumberField
            label="訂金金額（預設 0，依報價單金額填入）"
            value={createFields.depositAmount}
            onChange={(v) => updateCreateField("depositAmount", v)}
          />

          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1">
              <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                入住日期
              </span>
              <input
                type="date"
                value={createFields.checkIn}
                onChange={(e) => handleCreateCheckInChange(e.target.value)}
                required
                className="w-full border-b bg-transparent py-1 text-sm outline-none"
                style={{ borderColor: colors.line, color: colors.ink }}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                退房日期
              </span>
              <input
                type="date"
                value={createFields.checkOut}
                onChange={(e) => updateCreateField("checkOut", e.target.value)}
                required
                className="w-full border-b bg-transparent py-1 text-sm outline-none"
                style={{ borderColor: colors.line, color: colors.ink }}
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1">
              <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                客人姓名
              </span>
              <input
                type="text"
                value={createFields.guestName}
                onChange={(e) => updateCreateField("guestName", e.target.value)}
                required
                className="w-full border-b bg-transparent py-1 text-sm outline-none"
                style={{ borderColor: colors.line, color: colors.ink }}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                客人電話（選填）
              </span>
              <input
                type="tel"
                value={createFields.guestPhone}
                onChange={(e) => updateCreateField("guestPhone", e.target.value)}
                className="w-full border-b bg-transparent py-1 text-sm outline-none"
                style={{ borderColor: colors.line, color: colors.ink }}
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1">
              <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                客戶來源
              </span>
              <select
                value={createFields.bookingSource}
                onChange={(e) => updateCreateField("bookingSource", e.target.value)}
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
            <NumberField label="訪客" value={createFields.visitors} onChange={(v) => updateCreateField("visitors", v)} />
          </div>

          {/* 入住人數／房型配置比照報價試算（quote-form.tsx 的
              「Ⅱ 入住人數」）與訂單編輯表單：加分隔線小標、大人/小孩
              一列、嬰幼兒/寵物 一列、欄位置中（見 NumberField）。 */}
          <div>
            <CreateSectionHeading title="入住人數" />
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-4">
                <NumberField label="大人" value={createFields.adults} onChange={(v) => updateCreateField("adults", v)} />
                <NumberField label="小孩" value={createFields.children} onChange={(v) => updateCreateField("children", v)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <NumberField label="嬰幼兒" value={createFields.infants} onChange={(v) => updateCreateField("infants", v)} />
                <NumberField label="寵物" value={createFields.pets} onChange={(v) => updateCreateField("pets", v)} />
              </div>
            </div>
          </div>

          <div>
            <CreateSectionHeading title="房型配置" />
            <p className="mb-2 text-[11px]" style={{ color: colors.muted }}>
              跟著民宿／人數自動建議，可以手動調整
            </p>
            <div className="grid grid-cols-2 gap-4">
              <NumberField
                label="四人套房"
                value={createFields.fourPersonSuiteCount}
                onChange={(v) => updateCreateRoomField("fourPersonSuiteCount", v)}
              />
              <NumberField
                label="降規四人套房"
                value={createFields.fourPersonDowngradeCount}
                onChange={(v) => updateCreateRoomField("fourPersonDowngradeCount", v)}
              />
              <NumberField
                label="雙人套房"
                value={createFields.doubleSuiteCount}
                onChange={(v) => updateCreateRoomField("doubleSuiteCount", v)}
              />
              <NumberField
                label="雙人雅房"
                value={createFields.doublePlainCount}
                onChange={(v) => updateCreateRoomField("doublePlainCount", v)}
              />
            </div>
          </div>

          <div>
            <p style={{ color: colors.muted }} className="mb-1 text-[11px] tracking-wide">
              額外服務
            </p>

            <div className="mt-3">
              <p style={{ color: colors.muted }} className="mb-1 text-[11px] tracking-wide">
                加臨時床房號（複選）
              </p>
              {extraBedRoomOptions.length === 0 ? (
                <p className="text-[11px]" style={{ color: colors.alert }}>
                  這間民宿沒有設定可加床的房號，請直接跟房務確認
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {extraBedRoomOptions.map((room) => {
                    const active = createFields.extraBedTempRoomCodes.includes(room.code);
                    return (
                      <button
                        key={room.id}
                        type="button"
                        onClick={() => toggleCreateExtraBedRoom("extraBedTempRoomCodes", room.code)}
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

            <div className="mt-3 flex flex-wrap gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={createFields.bbq}
                  onChange={(e) => updateCreateField("bbq", e.target.checked)}
                  className="h-3.5 w-3.5"
                  style={{ accentColor: colors.pine }}
                />
                <span className="text-xs">烤肉</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={createFields.foodTruck}
                  onChange={(e) => updateCreateField("foodTruck", e.target.checked)}
                  className="h-3.5 w-3.5"
                  style={{ accentColor: colors.pine }}
                />
                <span className="text-xs">餐車場地</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={createFields.earlyCheckin}
                  onChange={(e) => updateCreateField("earlyCheckin", e.target.checked)}
                  className="h-3.5 w-3.5"
                  style={{ accentColor: colors.pine }}
                />
                <span className="text-xs">提前入住</span>
              </label>
            </div>
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={createFields.needsInvoice}
              onChange={(e) => updateCreateField("needsInvoice", e.target.checked)}
              className="h-3.5 w-3.5"
              style={{ accentColor: colors.pine }}
            />
            需要開立發票
          </label>

          {createFields.needsInvoice && (
            <div className="grid grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <span style={{ color: colors.muted }} className="text-[11px]">
                  發票抬頭
                </span>
                <input
                  type="text"
                  value={createFields.invoiceTitle ?? ""}
                  onChange={(e) => updateCreateField("invoiceTitle", e.target.value)}
                  className="w-full border-b bg-transparent py-1 text-sm outline-none"
                  style={{ borderColor: colors.line, color: colors.ink }}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span style={{ color: colors.muted }} className="text-[11px]">
                  統一編號
                </span>
                <input
                  type="text"
                  value={createFields.invoiceTaxId ?? ""}
                  onChange={(e) => updateCreateField("invoiceTaxId", e.target.value)}
                  className="w-full border-b bg-transparent py-1 text-sm outline-none"
                  style={{ borderColor: colors.line, color: colors.ink }}
                />
              </label>
            </div>
          )}

          <p className="text-[11px] leading-relaxed" style={{ color: colors.muted }}>
            💡 這裡會依照上面填的「訂金金額」跟下面的「總金額」，實際
            建立訂金／尾款的應收款記錄，「查詢應收」會顯示還沒收到的
            款項、快到期的尾款也會提醒。
            <br />
            如果是 Airbnb 等平台的訂房，訂房平台已經處理收款，訂金／
            尾款可以都填 0（或直接照平台顯示的金額填），不用特別去
            對應「訂金」「尾款」的概念。
            <br />
            如果是補登記漏掉的訂單（不是走 OTA 平台），記得把訂金／
            總金額都確實填上，不然這裡會漏掉、之後看不到尾款提醒。
          </p>

          <div className="border-t pt-3" style={{ borderColor: colors.line }}>
            <label className="flex flex-col gap-1">
              <span style={{ color: colors.muted }} className="text-[11px]">
                總金額（選填，Airbnb 等平台的房價不套用計價公式，直接填實收金額）
              </span>
              <input
                type="number"
                min={0}
                value={finalTotalRaw}
                onChange={(e) => setFinalTotalRaw(e.target.value)}
                placeholder="0"
                className="w-full border-b bg-transparent py-1 text-sm outline-none"
                style={{ borderColor: colors.line, color: colors.ink }}
              />
            </label>
          </div>

          <div>
            <CreateSectionHeading title="安排退房打掃班表（選填）" />
            <p className="mb-2 text-[11px]" style={{ color: colors.muted }}>
              退房日 {createFields.checkOut || "（請先填退房日期）"}——不指定人員也可以之後再到房務班表安排
            </p>
            <EmployeeMultiSelect employees={employees} selectedIds={scheduleEmployeeIds} onToggle={toggleScheduleEmployee} />
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

          {createError && (
            <p role="alert" className="text-xs leading-relaxed" style={{ color: colors.alert }}>
              {createError}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => router.push("/reservations")}
              disabled={isSavingCreate}
              className="flex-1 border py-2.5 text-xs tracking-wide disabled:opacity-50"
              style={{ borderColor: colors.line, color: colors.ink }}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSavingCreate}
              className="flex-1 py-2.5 text-xs tracking-wide disabled:opacity-50"
              style={{ backgroundColor: colors.pine, color: colors.pineText }}
            >
              {isSavingCreate ? "建立中…" : "建立訂單"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
