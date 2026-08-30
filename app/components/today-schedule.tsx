"use client";

/**
 * 本日班表
 *
 * 顯示今天的上班名單，每筆排班如果有指定民宿，會即時查「這間民宿
 * 接下來最近一筆入住」的資訊當作房務準備內容（房型/加購/下一組客人
 * 的入住時間人數天數來源），不是另外填寫存起來的——資料來源就是
 * reservations，跟 /reservations 那邊看到的是同一份資料，不會兜不
 * 起來。
 *
 * 最上面會列出「今天退房但還沒分配房務人員」的訂單警告（用退房日不
 * 是入住日，因為打掃整理是客人離開之後才進行，見 /schedule/monthly
 * 的說明），可以直接在這裡指派、支援一次選多位房務人員。
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Fraunces, Work_Sans } from "next/font/google";
import {
  createStaffAssignmentAction,
  getCheckOutCoverageAction,
  getUpcomingPrepInfoAction,
  listActiveEmployeesAction,
  listStaffAssignmentsForDateAction,
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
};

const BOOKING_SOURCE_LABEL: Record<string, string> = {
  line_official: "LINE官方",
  airbnb: "Airbnb",
  walk_in: "現場",
  phone: "電話",
  other_ota: "其他OTA",
  other: "其他",
};

const WEEKDAY_LABELS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

function formatYMD(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatDateWithWeekday(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00`);
  return `${dateStr.replaceAll("-", "/")} (${WEEKDAY_LABELS[date.getDay()]})`;
}

interface AssignmentWithPrep {
  assignment: StaffAssignment;
  prep: UpcomingPrepInfo | null;
}

export function TodaySchedule({
  isHousekeepingStaff = false,
  currentEmployeeId = null,
}: {
  isHousekeepingStaff?: boolean;
  currentEmployeeId?: string | null;
}) {
  const [today, setToday] = useState<string>("");
  const [rows, setRows] = useState<AssignmentWithPrep[] | null>(null);
  const [unassigned, setUnassigned] = useState<CheckOutCoverage[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [assigningReservationId, setAssigningReservationId] = useState<string | null>(null);
  const [quickAssignEmployeeIds, setQuickAssignEmployeeIds] = useState<string[]>([]);
  const [isAssigning, setIsAssigning] = useState(false);

  useEffect(() => {
    const now = new Date();
    const todayStr = formatYMD(now.getFullYear(), now.getMonth() + 1, now.getDate());
    setToday(todayStr);
    loadToday(now.getFullYear(), now.getMonth() + 1, todayStr);
  }, []);

  async function loadToday(year: number, month: number, todayStr: string) {
    setIsLoading(true);
    setError(null);
    try {
      const [assignments, coverage, employeeList] = await Promise.all([
        listStaffAssignmentsForDateAction(todayStr),
        getCheckOutCoverageAction(year, month),
        listActiveEmployeesAction(),
      ]);
      const withPrep = await Promise.all(
        assignments.map(async (assignment) => {
          if (!assignment.propertyId) return { assignment, prep: null };
          const prep = await getUpcomingPrepInfoAction(assignment.propertyId, todayStr);
          return { assignment, prep };
        })
      );
      // 房務員登入時，只留自己的排班——不能讓他們看到其他房務人員
      // 今天被排到哪裡。「未指派」（完全沒人被排）對單一房務員來說
      // 不算「他自己的班表」，一併不顯示，理由跟 monthly-schedule.tsx
      // 的 selectedDayUnassigned 一致。
      const ownRows = isHousekeepingStaff
        ? withPrep.filter((row) => row.assignment.employeeId === currentEmployeeId)
        : withPrep;
      setRows(ownRows);
      setUnassigned(isHousekeepingStaff ? [] : coverage.filter((c) => c.checkOut === todayStr && !c.hasAssignment));
      setEmployees(employeeList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "讀取失敗，請稍後再試");
    } finally {
      setIsLoading(false);
    }
  }

  function startQuickAssign(reservationId: string) {
    setAssigningReservationId(reservationId);
    setQuickAssignEmployeeIds([]);
  }

  function toggleQuickAssignEmployee(id: string) {
    setQuickAssignEmployeeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleQuickAssign(coverage: CheckOutCoverage) {
    if (quickAssignEmployeeIds.length === 0) return;
    setIsAssigning(true);
    setError(null);
    try {
      await Promise.all(
        quickAssignEmployeeIds.map((employeeId) =>
          createStaffAssignmentAction({
            employeeId,
            propertyId: coverage.propertyId,
            workDate: coverage.checkOut,
            notes: null,
          })
        )
      );
      setAssigningReservationId(null);
      const now = new Date();
      await loadToday(now.getFullYear(), now.getMonth() + 1, today);
    } catch (err) {
      setError(err instanceof Error ? err.message : "指派失敗，請稍後再試");
    } finally {
      setIsAssigning(false);
    }
  }

  /** 把今天的排班依民宿分類，左邊民宿名稱、右邊房務人員（簡稱）用。
   * 同一間民宿當天的準備內容（下一組客人資訊）都一樣，取第一筆的
   * prep 就好，不用每個人各查一次、也不用重複顯示 */
  interface PropertyGroup {
    propertyId: string | null;
    propertyName: string;
    rows: AssignmentWithPrep[];
    prep: UpcomingPrepInfo | null;
  }
  const groupedRows: PropertyGroup[] = (() => {
    if (!rows) return [];
    const groups: PropertyGroup[] = [];
    for (const r of rows) {
      const key = r.assignment.propertyId ?? null;
      let group = groups.find((g) => g.propertyId === key);
      if (!group) {
        group = {
          propertyId: key,
          propertyName: r.assignment.propertyName ?? "（不指定民宿）",
          rows: [],
          prep: r.prep,
        };
        groups.push(group);
      }
      group.rows.push(r);
    }
    // 有指定民宿的排前面，不指定的排最後
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
            本日班表
          </h1>
          {today && (
            <p className="mt-1 text-xs" style={{ color: colors.muted }}>
              {formatDateWithWeekday(today)}
            </p>
          )}
        </header>

        {isLoading && (
          <p className="text-xs" style={{ color: colors.muted }}>
            讀取中…
          </p>
        )}

        {error && (
          <p role="alert" className="border-l-2 pl-3 text-xs leading-relaxed" style={{ borderColor: colors.alert, color: colors.alert }}>
            {error}
          </p>
        )}

        {!isLoading && unassigned.length > 0 && (
          <div className="mb-4 border p-3" style={{ borderColor: colors.alert }}>
            <p className="text-xs font-bold" style={{ color: colors.alert }}>
              ⚠️ 今天退房但還沒分配房務人員
            </p>
            <div className="mt-2 flex flex-col gap-2">
              {unassigned.map((c) => (
                <div key={c.reservationId} className="border p-2 text-xs" style={{ borderColor: colors.line }}>
                  <div className="flex items-baseline justify-between">
                    <span className="font-semibold">{c.propertyName}</span>
                    <span style={{ color: colors.muted }}>{c.reservationNo}</span>
                  </div>
                  <p style={{ color: colors.muted }}>{c.guestName || "（未填姓名）"}</p>

                  {isHousekeepingStaff ? null : assigningReservationId === c.reservationId ? (
                    <div className="mt-2 flex flex-col gap-2">
                      <div className="flex flex-wrap gap-2">
                        {employees.map((emp) => {
                          const active = quickAssignEmployeeIds.includes(emp.id);
                          return (
                            <button
                              key={emp.id}
                              type="button"
                              onClick={() => toggleQuickAssignEmployee(emp.id)}
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
                      className="mt-2 border px-3 py-1 text-xs"
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

        {rows && rows.length === 0 && !isLoading && (
          <p className="text-xs" style={{ color: colors.muted }}>
            今天沒有排班。
          </p>
        )}

        <div className="flex flex-col gap-3">
          {groupedRows.map((group) => (
            <div key={group.propertyId ?? "none"} className="border p-4" style={{ borderColor: colors.line }}>
              {/* 左邊民宿名稱、右邊房務人員（簡稱），一間民宿可能排了不只一人 */}
              <div className="flex items-baseline justify-between gap-3">
                <span className={`${display.className} text-xl italic`}>{group.propertyName}</span>
                <span className="text-right text-xs" style={{ color: colors.muted }}>
                  {group.rows.map((r) => r.assignment.employeeShortName).join("、")}
                </span>
              </div>

              {group.rows.some((r) => r.assignment.notes) && (
                <div className="mt-1 flex flex-col gap-0.5 text-xs" style={{ color: colors.muted }}>
                  {group.rows
                    .filter((r) => r.assignment.notes)
                    .map((r) => (
                      <p key={r.assignment.id}>
                        {r.assignment.employeeShortName}：{r.assignment.notes}
                      </p>
                    ))}
                </div>
              )}

              {group.propertyId && (
                <div className="mt-3 border-t pt-3" style={{ borderColor: colors.line }}>
                  <p className="text-[11px] font-bold" style={{ color: colors.ink }}>
                    房務準備內容
                  </p>
                  {!group.prep ? (
                    <p className="mt-1 text-xs" style={{ color: colors.muted }}>
                      近期沒有入住訂單，不用特別準備。
                    </p>
                  ) : (
                    <div className="mt-1 flex flex-col gap-1 text-xs" style={{ color: colors.muted }}>
                      <p>
                        下一組入住：{formatDateWithWeekday(group.prep.checkIn)} ～ {group.prep.checkOut}（{group.prep.nights}晚）
                      </p>
                      <p>
                        {group.prep.adults}大 {group.prep.children}小　{group.prep.guestName || "（未填姓名）"}　
                        {BOOKING_SOURCE_LABEL[group.prep.bookingSource] ?? group.prep.bookingSource}
                      </p>
                      {/* 房型呈現方式跟報價單一致：標籤只出現在第一行，
                          後面每個房型各自一行，不是逗號串成一行文字 */}
                      {group.prep.roomItems.map((item, i) => (
                        <div key={i} className="flex items-baseline gap-3">
                          <span className="w-10 shrink-0">{i === 0 ? "房型" : ""}</span>
                          <span>{item}</span>
                        </div>
                      ))}
                      {(group.prep.hasBbq || group.prep.hasExtraBed) && (
                        <p style={{ color: colors.pine }} className="font-semibold">
                          {group.prep.hasBbq ? "🍖 有烤肉　" : ""}
                          {group.prep.hasExtraBed ? "🛏️ 有加床" : ""}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
