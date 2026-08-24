"use client";

/**
 * 房務排班（原本的「安排排班」跟「每月班表」合併成這一頁）
 *
 * 月曆版面（一列一週）。每天格子改成用民宿「名稱文字」呈現（不是
 * 色點）——名稱後面接兩個小圖示：🍖 代表下一組客人有加購烤肉，
 * ✓/⚠ 代表這間民宿這天有沒有指派房務人員。名稱用簡稱（清綠/陌隱/
 * 璞堤）不是全名，塞不下手機螢幕上一個日期格子的寬度。
 *
 * 點某一天展開的清單改成「以民宿分類」呈現——每間民宿一個區塊，底下
 * 列出負責的房務人員，比原本一整排人名混在一起清楚哪間民宿排了誰。
 *
 * 日期是退房日（打掃整理是客人離開之後才進行，準備給下一組客人，
 * 見 lib/schedule/queries.ts 的 getCheckOutCoverage 說明）。如果某天
 * 有排班但那天實際上沒有訂單退房（例如單純安排的一般工作），清單裡
 * 會特別標注「非退房日」，避免誤會成當天有客人退房。
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Fraunces, Work_Sans } from "next/font/google";
import {
  createStaffAssignmentAction,
  deleteStaffAssignmentAction,
  getCheckOutCoverageAction,
  getUpcomingPrepInfoAction,
  listActiveEmployeesAction,
  listStaffAssignmentsForMonthAction,
} from "@/app/actions/schedule";
import type { CheckOutCoverage, Employee, StaffAssignment, UpcomingPrepInfo } from "@/lib/schedule/queries";

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
  gold: "#A67C3D",
};

const PROPERTY_OPTIONS = [
  { value: "0a16233a-9846-421e-b6d6-ccced85792b4", label: "只此清綠", color: "#5C7A4A" },
  { value: "c4fe9189-051f-4a3f-aa43-9f04b0043723", label: "陌隱", color: colors.gold },
  { value: "146fe8ae-84b5-4170-8747-dd15afc4e722", label: "水景璞堤", color: colors.blue },
];
/** 月曆格子太窄放不下全名，用簡稱——民宿名稱後面還要接烤肉/指派狀態圖示 */
const PROPERTY_SHORT_LABELS: Record<string, string> = {
  zhici: "清綠",
  moyin: "陌隱",
  shuijing: "璞堤",
};

const WEEKDAY_HEADERS = ["日", "一", "二", "三", "四", "五", "六"];

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function firstWeekdayOfMonth(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

function formatYMD(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 複選房務人員用的藥丸按鈕群組，指派未分配訂單、新增排班兩個地方共用 */
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

export function MonthlySchedule() {
  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [assignments, setAssignments] = useState<StaffAssignment[]>([]);
  const [coverage, setCoverage] = useState<CheckOutCoverage[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // 針對未分配訂單快速指派（支援複選）
  const [assigningReservationId, setAssigningReservationId] = useState<string | null>(null);
  const [quickAssignEmployeeIds, setQuickAssignEmployeeIds] = useState<string[]>([]);
  const [isAssigning, setIsAssigning] = useState(false);

  // 一般新增排班（不一定對應到未分配訂單，原「安排排班」頁面功能）
  const [showGeneralForm, setShowGeneralForm] = useState(false);
  const [generalPropertyId, setGeneralPropertyId] = useState("");
  const [generalEmployeeIds, setGeneralEmployeeIds] = useState<string[]>([]);
  const [generalNotes, setGeneralNotes] = useState("");
  const [isSavingGeneral, setIsSavingGeneral] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);

  // 選中某一天後，針對當天每個已排班、有指定民宿的排班，懶載入
  // 「下一組客人」的房務準備內容（房型/烤肉/加床），還沒查過的
  // （民宿＋日期）組合才會發查詢，避免重複查。key 必須包含日期——
  // 準備內容是「以某天為準往後查」算出來的，同一間民宿在不同天各自
  // 查到的結果不一定一樣，只用 propertyId 當 key 會讓不同天顯示到
  // 彼此快取住的舊資料。
  const [prepInfoByProperty, setPrepInfoByProperty] = useState<Record<string, UpcomingPrepInfo | null>>({});

  // 修改某間民宿某一天的房務人員名單——新增/變更/刪除人員，不能
  // 改成其他民宿（要換民宿的話，那是不同的排班，應該用「新增排班」
  // 另外排，不是「編輯」這筆的民宿）。用複選按鈕呈現目前這個
  // （民宿＋日期）已經指派的人，勾掉代表移除、勾新的代表新增。
  const [editingGroupKey, setEditingGroupKey] = useState<string | null>(null); // propertyId ?? "none"
  const [editGroupEmployeeIds, setEditGroupEmployeeIds] = useState<string[]>([]);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    const now = new Date();
    setYear(now.getFullYear());
    setMonth(now.getMonth() + 1);
  }, []);

  useEffect(() => {
    if (year === null || month === null) return;
    loadMonth(year, month);
  }, [year, month]);

  // 選中某一天後，針對當天每個已排班、有指定民宿的排班，懶載入
  // 「下一組客人」的房務準備內容（房型/烤肉/加床），還沒查過的民宿
  // 才會發查詢，避免重複查
  useEffect(() => {
    if (!selectedDate) return;
    const propertyIds = Array.from(
      new Set(
        assignments
          .filter((a) => a.workDate === selectedDate && a.propertyId)
          .map((a) => a.propertyId as string)
      )
    );
    const toFetch = propertyIds.filter((id) => !(`${id}|${selectedDate}` in prepInfoByProperty));
    if (toFetch.length === 0) return;

    Promise.all(
      toFetch.map(async (propertyId) => {
        try {
          const prep = await getUpcomingPrepInfoAction(propertyId, selectedDate);
          return [`${propertyId}|${selectedDate}`, prep] as const;
        } catch {
          return [`${propertyId}|${selectedDate}`, null] as const;
        }
      })
    ).then((entries) => {
      setPrepInfoByProperty((prev) => {
        const next = { ...prev };
        for (const [key, prep] of entries) next[key] = prep;
        return next;
      });
    });
  }, [selectedDate, assignments, prepInfoByProperty]);

  async function loadMonth(y: number, m: number) {
    setIsLoading(true);
    setError(null);
    setSelectedDate(null);
    try {
      const [assignmentData, coverageData, employeeList] = await Promise.all([
        listStaffAssignmentsForMonthAction(y, m),
        getCheckOutCoverageAction(y, m),
        listActiveEmployeesAction(),
      ]);
      setAssignments(assignmentData);
      setCoverage(coverageData);
      setEmployees(employeeList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "查詢失敗，請稍後再試");
    } finally {
      setIsLoading(false);
    }
  }

  function goToPrevMonth() {
    if (year === null || month === null) return;
    if (month === 1) {
      setYear(year - 1);
      setMonth(12);
    } else {
      setMonth(month - 1);
    }
  }

  function goToNextMonth() {
    if (year === null || month === null) return;
    if (month === 12) {
      setYear(year + 1);
      setMonth(1);
    } else {
      setMonth(month + 1);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteStaffAssignmentAction(id);
      setAssignments((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "刪除失敗，請稍後再試");
    } finally {
      setDeletingId(null);
    }
  }

  function startEditGroup(group: AssignmentGroup) {
    setEditingGroupKey(group.propertyId ?? "none");
    setEditGroupEmployeeIds(group.list.map((a) => a.employeeId));
    setEditError(null);
  }

  function cancelEditGroup() {
    setEditingGroupKey(null);
    setEditError(null);
  }

  function toggleEditGroupEmployee(id: string) {
    setEditGroupEmployeeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  /** 儲存這個（民宿＋日期）的人員異動：多選的跟原本比對，新勾選的
   * 新增一筆排班、取消勾選的刪除那筆排班，民宿本身不會被改動 */
  async function saveEditGroup(group: AssignmentGroup) {
    if (year === null || month === null || !selectedDate) return;
    setIsSavingEdit(true);
    setEditError(null);
    try {
      const originalIds = new Set(group.list.map((a) => a.employeeId));
      const newIds = new Set(editGroupEmployeeIds);

      const toAdd = editGroupEmployeeIds.filter((id) => !originalIds.has(id));
      const toRemove = group.list.filter((a) => !newIds.has(a.employeeId));

      await Promise.all([
        ...toAdd.map((employeeId) =>
          createStaffAssignmentAction({ employeeId, propertyId: group.propertyId, workDate: selectedDate, notes: null })
        ),
        ...toRemove.map((a) => deleteStaffAssignmentAction(a.id)),
      ]);

      setEditingGroupKey(null);
      await loadMonth(year, month);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "修改失敗，請稍後再試");
    } finally {
      setIsSavingEdit(false);
    }
  }

  function startQuickAssign(reservationId: string) {
    setAssigningReservationId(reservationId);
    setQuickAssignEmployeeIds([]);
  }

  function toggleQuickAssignEmployee(id: string) {
    setQuickAssignEmployeeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleQuickAssign(c: CheckOutCoverage) {
    if (quickAssignEmployeeIds.length === 0 || year === null || month === null) return;
    setIsAssigning(true);
    setError(null);
    try {
      await Promise.all(
        quickAssignEmployeeIds.map((employeeId) =>
          createStaffAssignmentAction({ employeeId, propertyId: c.propertyId, workDate: c.checkOut, notes: null })
        )
      );
      setAssigningReservationId(null);
      await loadMonth(year, month);
      setSelectedDate(c.checkOut);
    } catch (err) {
      setError(err instanceof Error ? err.message : "指派失敗，請稍後再試");
    } finally {
      setIsAssigning(false);
    }
  }

  function toggleGeneralEmployee(id: string) {
    setGeneralEmployeeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function openGeneralForm() {
    setGeneralPropertyId("");
    setGeneralEmployeeIds([]);
    setGeneralNotes("");
    setGeneralError(null);
    setShowGeneralForm(true);
  }

  async function handleGeneralSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedDate || generalEmployeeIds.length === 0) {
      setGeneralError("請至少選擇一位房務人員");
      return;
    }
    if (year === null || month === null) return;
    setIsSavingGeneral(true);
    setGeneralError(null);
    try {
      await Promise.all(
        generalEmployeeIds.map((employeeId) =>
          createStaffAssignmentAction({
            employeeId,
            propertyId: generalPropertyId || null,
            workDate: selectedDate,
            notes: generalNotes.trim() || null,
          })
        )
      );
      setShowGeneralForm(false);
      await loadMonth(year, month);
      setSelectedDate(selectedDate);
    } catch (err) {
      setGeneralError(err instanceof Error ? err.message : "新增排班失敗，請稍後再試");
    } finally {
      setIsSavingGeneral(false);
    }
  }

  const daysInMonth = year !== null && month !== null ? getDaysInMonth(year, month) : 0;
  const leadingBlanks = year !== null && month !== null ? firstWeekdayOfMonth(year, month) : 0;
  const totalCells = leadingBlanks + daysInMonth;
  const weeksCount = Math.ceil(totalCells / 7) || 0;
  const calendarCells: (number | null)[] = Array.from({ length: weeksCount * 7 }, (_, i) => {
    const day = i - leadingBlanks + 1;
    return day >= 1 && day <= daysInMonth ? day : null;
  });

  function unassignedForDay(day: number): CheckOutCoverage[] {
    if (year === null || month === null) return [];
    const dateStr = formatYMD(year, month, day);
    return coverage.filter((c) => c.checkOut === dateStr && !c.hasAssignment);
  }

  /** 這天每間有活動（退房或排班）的民宿狀態，日曆格子上要顯示
   * 「民宿名稱＋烤肉圖示＋指派狀態」用這個算 */
  interface DayPropertyStatus {
    propertyId: string;
    shortLabel: string;
    hasBbq: boolean;
    isAssigned: boolean;
  }
  function propertyStatusesForDay(day: number): DayPropertyStatus[] {
    if (year === null || month === null) return [];
    const dateStr = formatYMD(year, month, day);
    const map = new Map<string, DayPropertyStatus>();

    for (const c of coverage.filter((c) => c.checkOut === dateStr)) {
      map.set(c.propertyId, {
        propertyId: c.propertyId,
        shortLabel: PROPERTY_SHORT_LABELS[c.propertyCode] ?? c.propertyName,
        hasBbq: c.hasBbq,
        isAssigned: c.hasAssignment,
      });
    }
    for (const a of assignments.filter((a) => a.workDate === dateStr && a.propertyId)) {
      const pid = a.propertyId as string;
      if (!map.has(pid)) {
        map.set(pid, {
          propertyId: pid,
          shortLabel: PROPERTY_SHORT_LABELS[a.propertyCode ?? ""] ?? a.propertyName ?? "",
          hasBbq: false,
          isAssigned: true,
        });
      }
    }
    return Array.from(map.values());
  }

  const selectedDayAssignments = selectedDate ? assignments.filter((a) => a.workDate === selectedDate) : [];
  const selectedDayUnassigned = selectedDate ? coverage.filter((c) => c.checkOut === selectedDate && !c.hasAssignment) : [];

  /** 這筆排班的（民宿＋日期）當天是不是真的有訂單退房——不是的話要
   * 標注清楚，避免被誤會成「這天有客人退房」 */
  function isActualCheckoutDay(propertyId: string | null, date: string): boolean {
    if (!propertyId) return false;
    return coverage.some((c) => c.propertyId === propertyId && c.checkOut === date);
  }

  /** 把當天的排班依民宿分類，沒有指定民宿的排在最後自成一組 */
  interface AssignmentGroup {
    propertyId: string | null;
    propertyName: string;
    list: StaffAssignment[];
  }
  const selectedDayGroups: AssignmentGroup[] = (() => {
    const groups: AssignmentGroup[] = [];
    for (const a of selectedDayAssignments) {
      const key = a.propertyId ?? null;
      let group = groups.find((g) => g.propertyId === key);
      if (!group) {
        group = { propertyId: key, propertyName: a.propertyName ?? "（不指定民宿）", list: [] };
        groups.push(group);
      }
      group.list.push(a);
    }
    // 有指定民宿的排前面，不指定的排最後
    return groups.sort((a, b) => (a.propertyId === null ? 1 : b.propertyId === null ? -1 : 0));
  })();

  /** 這個月每間民宿、每個房務人員各上了幾次班——核對薪水用。直接從
   * 已經載入的 assignments 算，不用另外查詢。 */
  interface StaffCount {
    employeeId: string;
    employeeShortName: string;
    count: number;
  }
  interface PropertyStaffStats {
    propertyId: string | null;
    propertyName: string;
    staffCounts: StaffCount[];
  }
  const monthlyStaffStats: PropertyStaffStats[] = (() => {
    const groups: PropertyStaffStats[] = [];
    for (const a of assignments) {
      const key = a.propertyId ?? null;
      let group = groups.find((g) => g.propertyId === key);
      if (!group) {
        group = { propertyId: key, propertyName: a.propertyName ?? "（不指定民宿）", staffCounts: [] };
        groups.push(group);
      }
      let entry = group.staffCounts.find((s) => s.employeeId === a.employeeId);
      if (!entry) {
        entry = { employeeId: a.employeeId, employeeShortName: a.employeeShortName, count: 0 };
        group.staffCounts.push(entry);
      }
      entry.count += 1;
    }
    for (const group of groups) {
      group.staffCounts.sort((a, b) => b.count - a.count);
    }
    return groups.sort((a, b) => (a.propertyId === null ? 1 : b.propertyId === null ? -1 : 0));
  })();

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
            房務排班
          </h1>
        </header>

        {year !== null && month !== null && (
          <div className="mb-4 flex items-center justify-between">
            <button type="button" onClick={goToPrevMonth} className="px-3 py-1 text-sm" style={{ color: colors.blue }}>
              ← 上個月
            </button>
            <span className="text-sm font-semibold">
              {year} 年 {month} 月
            </span>
            <button type="button" onClick={goToNextMonth} className="px-3 py-1 text-sm" style={{ color: colors.blue }}>
              下個月 →
            </button>
          </div>
        )}

        {isLoading && (
          <p className="text-xs" style={{ color: colors.muted }}>
            讀取中…
          </p>
        )}
        {error && (
          <p role="alert" className="mb-3 border-l-2 pl-3 text-xs leading-relaxed" style={{ borderColor: colors.alert, color: colors.alert }}>
            {error}
          </p>
        )}

        {!isLoading && year !== null && month !== null && (
          <div>
            <div className="grid grid-cols-7 gap-1">
              {WEEKDAY_HEADERS.map((w) => (
                <div key={w} className="text-center text-[10px]" style={{ color: colors.muted }}>
                  {w}
                </div>
              ))}
            </div>

            <div className="mt-1 grid grid-cols-7 gap-1">
              {calendarCells.map((day, i) => {
                if (day === null) return <div key={i} />;
                const dateStr = formatYMD(year, month, day);
                const dayUnassigned = unassignedForDay(day);
                const propertyStatuses = propertyStatusesForDay(day);
                const isSelected = selectedDate === dateStr;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setSelectedDate(dateStr);
                      setShowGeneralForm(false);
                      setAssigningReservationId(null);
                      setEditingGroupKey(null);
                    }}
                    className="flex flex-col items-center gap-0.5 border px-0.5 pb-1 pt-1 text-[9px] leading-tight transition-colors"
                    style={{
                      borderColor: dayUnassigned.length > 0 ? colors.alert : isSelected ? colors.pine : colors.line,
                      backgroundColor: isSelected ? colors.pineSoft : "transparent",
                      color: colors.ink,
                    }}
                  >
                    <span>{day}</span>
                    {propertyStatuses.map((ps) => (
                      <div key={ps.propertyId} className="flex items-center gap-0.5 whitespace-nowrap">
                        <span>{ps.shortLabel}</span>
                        {ps.hasBbq && <span>🍖</span>}
                        <span style={{ color: ps.isAssigned ? colors.pine : colors.alert }}>{ps.isAssigned ? "✓" : "⚠"}</span>
                      </div>
                    ))}
                  </button>
                );
              })}
            </div>

            <div className="mt-2 flex flex-col gap-1 border-t pt-2 text-[10px]" style={{ borderColor: colors.line, color: colors.muted }}>
              <p>日期是退房日（打掃整理是客人離開後才進行，準備給下一組客人）</p>
              <p>
                <span style={{ color: colors.pine }}>✓</span> 已指派房務人員　
                <span style={{ color: colors.alert }}>⚠</span> 還沒指派房務人員　🍖 下一組客人有加購烤肉
              </p>
              <p>格子邊框紅色：這天至少有一間民宿的退房訂單還沒分配房務人員</p>
            </div>

            {selectedDate && (
              <div className="mt-4 border-t pt-3" style={{ borderColor: colors.line }}>
                <p className="text-xs font-bold" style={{ color: colors.ink }}>
                  {selectedDate} 的排班
                </p>

                {selectedDayUnassigned.length > 0 && (
                  <div className="mt-2 border p-2" style={{ borderColor: colors.alert }}>
                    <p className="text-[11px] font-bold" style={{ color: colors.alert }}>
                      ⚠️ 還沒分配房務人員的退房訂單
                    </p>
                    <div className="mt-1 flex flex-col gap-2">
                      {selectedDayUnassigned.map((c) => (
                        <div key={c.reservationId} className="text-xs">
                          <div className="flex items-baseline justify-between">
                            <span className="font-semibold">{c.propertyName}</span>
                            <span style={{ color: colors.muted }}>{c.reservationNo}</span>
                          </div>
                          <p style={{ color: colors.muted }}>{c.guestName || "（未填姓名）"}</p>

                          {assigningReservationId === c.reservationId ? (
                            <div className="mt-1 flex flex-col gap-2">
                              <EmployeeMultiSelect
                                employees={employees}
                                selectedIds={quickAssignEmployeeIds}
                                onToggle={toggleQuickAssignEmployee}
                              />
                              <button
                                type="button"
                                onClick={() => handleQuickAssign(c)}
                                disabled={isAssigning || quickAssignEmployeeIds.length === 0}
                                className="px-3 py-1.5 text-xs disabled:opacity-50"
                                style={{ backgroundColor: colors.pine, color: colors.pineText }}
                              >
                                {isAssigning ? "指派中…" : `指派（已選 ${quickAssignEmployeeIds.length} 人）`}
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => startQuickAssign(c.reservationId)}
                              className="mt-1 border px-3 py-1 text-xs"
                              style={{ borderColor: colors.alert, color: colors.alert }}
                            >
                              指派房務人員
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedDayAssignments.length === 0 ? (
                  <p className="mt-2 text-xs" style={{ color: colors.muted }}>
                    這天沒有排班。
                  </p>
                ) : (
                  <div className="mt-2 flex flex-col gap-3">
                    {selectedDayGroups.map((group) => {
                      const isCheckout = isActualCheckoutDay(group.propertyId, selectedDate ?? "");
                      const prep =
                        group.propertyId && selectedDate ? prepInfoByProperty[`${group.propertyId}|${selectedDate}`] : undefined;
                      return (
                        <div key={group.propertyId ?? "none"} className="border p-3 text-xs" style={{ borderColor: colors.line }}>
                          <div className="flex items-baseline justify-between">
                            <p className={`${display.className} text-base italic`}>{group.propertyName}</p>
                            {/* 這天沒有實際退房，特別標注一下，避免被誤會成
                                「這天有客人退房」——這個民宿這天的排班只是
                                一般安排的工作，跟訂單退房無關 */}
                            {group.propertyId && !isCheckout && (
                              <span style={{ color: colors.blue }}>（非退房日，一般安排）</span>
                            )}
                          </div>

                          {editingGroupKey === (group.propertyId ?? "none") ? (
                            <div className="mt-2 flex flex-col gap-2">
                              <p style={{ color: colors.muted }} className="text-[11px]">
                                勾選這間民宿這天要指派的房務人員（取消勾選代表移除）
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {employees.map((emp) => {
                                  const active = editGroupEmployeeIds.includes(emp.id);
                                  return (
                                    <button
                                      key={emp.id}
                                      type="button"
                                      onClick={() => toggleEditGroupEmployee(emp.id)}
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
                              {editError && (
                                <p role="alert" style={{ color: colors.alert }} className="text-[11px]">
                                  {editError}
                                </p>
                              )}
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={cancelEditGroup}
                                  disabled={isSavingEdit}
                                  className="flex-1 border py-1.5 text-[11px] disabled:opacity-50"
                                  style={{ borderColor: colors.line, color: colors.ink }}
                                >
                                  取消
                                </button>
                                <button
                                  type="button"
                                  onClick={() => saveEditGroup(group)}
                                  disabled={isSavingEdit}
                                  className="flex-1 py-1.5 text-[11px] disabled:opacity-50"
                                  style={{ backgroundColor: colors.pine, color: colors.pineText }}
                                >
                                  {isSavingEdit ? "儲存中…" : "儲存"}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="mt-1.5 flex flex-col gap-1">
                                {group.list.map((a) => (
                                  <div key={a.id} className="flex items-center justify-between">
                                    <span>
                                      {a.employeeShortName}
                                      {a.notes ? `　${a.notes}` : ""}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleDelete(a.id)}
                                      disabled={deletingId === a.id}
                                      className="shrink-0 px-2 py-1 text-[11px] disabled:opacity-50"
                                      style={{ color: colors.alert }}
                                    >
                                      {deletingId === a.id ? "刪除中…" : "刪除"}
                                    </button>
                                  </div>
                                ))}
                              </div>
                              <button
                                type="button"
                                onClick={() => startEditGroup(group)}
                                className="mt-2 text-[11px]"
                                style={{ color: colors.blue }}
                              >
                                編輯房務人員（新增／變更）
                              </button>
                            </>
                          )}

                          {isCheckout && prep && (prep.hasBbq || prep.hasExtraBed) && (
                            <p className="mt-1.5 border-t pt-1.5 font-semibold" style={{ borderColor: colors.line, color: colors.pine }}>
                              下一組：
                              {prep.hasBbq ? "🍖 有烤肉　" : ""}
                              {prep.hasExtraBed ? "🛏️ 有加床" : ""}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {!showGeneralForm ? (
                  <button
                    type="button"
                    onClick={openGeneralForm}
                    className="mt-3 w-full border py-2 text-xs tracking-wide"
                    style={{ borderColor: colors.line, color: colors.ink }}
                  >
                    ＋ 新增排班
                  </button>
                ) : (
                  <form onSubmit={handleGeneralSubmit} className="mt-3 flex flex-col gap-3 border p-3" style={{ borderColor: colors.line }}>
                    <div>
                      <p style={{ color: colors.muted }} className="mb-1 text-[11px] tracking-wide">
                        負責民宿（選填）
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {PROPERTY_OPTIONS.map((opt) => {
                          const active = generalPropertyId === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => setGeneralPropertyId(active ? "" : opt.value)}
                              className="rounded-full border px-3 py-1.5 text-xs transition-colors"
                              style={
                                active
                                  ? { borderColor: opt.color, backgroundColor: opt.color, color: colors.pineText }
                                  : { borderColor: colors.line, backgroundColor: "transparent", color: colors.ink }
                              }
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <p style={{ color: colors.muted }} className="mb-1 text-[11px] tracking-wide">
                        房務人員（可複選）
                      </p>
                      <EmployeeMultiSelect employees={employees} selectedIds={generalEmployeeIds} onToggle={toggleGeneralEmployee} />
                    </div>

                    <label className="flex flex-col gap-1">
                      <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                        備註（選填）
                      </span>
                      <input
                        type="text"
                        value={generalNotes}
                        onChange={(e) => setGeneralNotes(e.target.value)}
                        className="w-full border-b bg-transparent py-1 text-sm outline-none"
                        style={{ borderColor: colors.line, color: colors.ink }}
                      />
                    </label>

                    {generalError && (
                      <p role="alert" className="text-xs leading-relaxed" style={{ color: colors.alert }}>
                        {generalError}
                      </p>
                    )}

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setShowGeneralForm(false)}
                        disabled={isSavingGeneral}
                        className="flex-1 border py-2 text-xs tracking-wide disabled:opacity-50"
                        style={{ borderColor: colors.line, color: colors.ink }}
                      >
                        取消
                      </button>
                      <button
                        type="submit"
                        disabled={isSavingGeneral}
                        className="flex-1 py-2 text-xs tracking-wide disabled:opacity-50"
                        style={{ backgroundColor: colors.pine, color: colors.pineText }}
                      >
                        {isSavingGeneral ? "新增中…" : "新增排班"}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {/* 本月出勤統計：依民宿分類，每個房務人員上班次數，核對薪水用 */}
            <div className="mt-6 border-t pt-3">
              <p className="text-xs font-bold" style={{ color: colors.ink }}>
                本月出勤統計（核對薪水用）
              </p>
              {monthlyStaffStats.length === 0 ? (
                <p className="mt-2 text-xs" style={{ color: colors.muted }}>
                  這個月沒有排班紀錄。
                </p>
              ) : (
                <div className="mt-2 flex flex-col gap-3">
                  {monthlyStaffStats.map((group) => (
                    <div key={group.propertyId ?? "none"} className="border p-3 text-xs" style={{ borderColor: colors.line }}>
                      <p className={`${display.className} text-base italic`}>{group.propertyName}</p>
                      <div className="mt-1 flex flex-col gap-1">
                        {group.staffCounts.map((s) => (
                          <div key={s.employeeId} className="flex items-center justify-between">
                            <span>{s.employeeShortName}</span>
                            <span style={{ color: colors.muted }}>{s.count} 次</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
