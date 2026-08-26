"use client";

/**
 * 節日管理頁面 — 月曆檢視
 *
 * 比照行政院辦公日曆表的呈現方式：一格一天的月曆，節日用顏色標記，
 * 比條列式清單更容易一眼看出哪些日子是節日、連續假期的範圍多大。
 * 點一天會在下方展開該天的詳細內容，可以新增／編輯／刪除。
 *
 * 「批次匯入」維持原本貼上文字整批匯入的做法（見 lib/pricing/
 * holidays.ts 的說明），這是輸入一整年份資料最快的方式，跟月曆
 * 檢視是互補的兩件事：批次匯入負責「一次性把資料放進去」，月曆
 * 檢視負責「檢查資料對不對、事後個別調整」。
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Fraunces, Work_Sans } from "next/font/google";
import {
  bulkImportHolidaysAction,
  createHolidayAction,
  deleteHolidayAction,
  getHolidaysForYearAction,
} from "@/app/actions/holidays";
import type { BulkHolidayEntry, HolidayDayType, HolidayEntry } from "@/lib/pricing/holidays";

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

const DAY_TYPE_LABEL: Record<HolidayDayType, string> = {
  holiday: "假日",
  festival: "節日",
  lunar_new_year: "春節",
  new_year_eve: "跨年",
};
const DAY_TYPE_OPTIONS: HolidayDayType[] = ["holiday", "festival", "lunar_new_year", "new_year_eve"];
const DAY_TYPE_COLOR: Record<HolidayDayType, string> = {
  holiday: "#FF99FF",
  festival: "#FF99FF",
  lunar_new_year: "#FF99FF",
  new_year_eve: "#FF99FF",
};

const CATEGORY_ALIASES: Record<string, HolidayDayType> = {
  holiday: "holiday",
  假日: "holiday",
  festival: "festival",
  節日: "festival",
  lunar_new_year: "lunar_new_year",
  春節: "lunar_new_year",
  new_year_eve: "new_year_eve",
  跨年: "new_year_eve",
};

function parseBulkText(text: string): { entries: BulkHolidayEntry[]; errors: string[] } {
  const entries: BulkHolidayEntry[] = [];
  const errors: string[] = [];
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  lines.forEach((line, i) => {
    const parts = line.split(",").map((p) => p.trim());
    if (parts.length !== 3) {
      errors.push(`第 ${i + 1} 行格式不對（應該是「日期,名稱,分類」三個欄位，用逗號分隔）：${line}`);
      return;
    }
    const [date, name, categoryRaw] = parts;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push(`第 ${i + 1} 行日期格式不對（應該是 YYYY-MM-DD）：${date}`);
      return;
    }
    const dayType = CATEGORY_ALIASES[categoryRaw];
    if (!dayType) {
      errors.push(
        `第 ${i + 1} 行分類看不懂（要填 holiday/festival/lunar_new_year/new_year_eve 或 假日/節日/春節/跨年）：${categoryRaw}`
      );
      return;
    }
    entries.push({ date, name, dayType });
  });

  return { entries, errors };
}

function firstWeekdayOfMonth(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}
function formatYMD(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function HolidayManager() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [holidays, setHolidays] = useState<HolidayEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDayType, setEditDayType] = useState<HolidayDayType>("holiday");
  const [isSavingDay, setIsSavingDay] = useState(false);
  const [dayError, setDayError] = useState<string | null>(null);
  const [isDeletingDay, setIsDeletingDay] = useState(false);

  const [showBulkForm, setShowBulkForm] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkErrors, setBulkErrors] = useState<string[]>([]);
  const [isBulkImporting, setIsBulkImporting] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  useEffect(() => {
    loadYear(year);
  }, [year]);

  async function loadYear(y: number) {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getHolidaysForYearAction(y);
      setHolidays(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "讀取失敗，請稍後再試");
    } finally {
      setIsLoading(false);
    }
  }

  function goToPrevMonth() {
    if (month === 1) {
      setYear((y) => y - 1);
      setMonth(12);
    } else {
      setMonth((m) => m - 1);
    }
    setSelectedDate(null);
  }
  function goToNextMonth() {
    if (month === 12) {
      setYear((y) => y + 1);
      setMonth(1);
    } else {
      setMonth((m) => m + 1);
    }
    setSelectedDate(null);
  }

  function selectDate(dateStr: string) {
    setSelectedDate(dateStr);
    setDayError(null);
    const existing = holidays?.find((h) => h.holidayDate === dateStr);
    setEditName(existing?.name ?? "");
    setEditDayType(existing?.dayType ?? "holiday");
  }

  async function handleSaveDay() {
    if (!selectedDate) return;
    if (!editName.trim()) {
      setDayError("請填寫名稱");
      return;
    }
    setIsSavingDay(true);
    setDayError(null);
    try {
      await createHolidayAction(selectedDate, editName.trim(), editDayType);
      await loadYear(year);
    } catch (err) {
      setDayError(err instanceof Error ? err.message : "儲存失敗，請稍後再試");
    } finally {
      setIsSavingDay(false);
    }
  }

  async function handleDeleteDay() {
    if (!selectedDate) return;
    const existing = holidays?.find((h) => h.holidayDate === selectedDate);
    if (!existing) return;
    setIsDeletingDay(true);
    setDayError(null);
    try {
      await deleteHolidayAction(existing.id);
      setSelectedDate(null);
      await loadYear(year);
    } catch (err) {
      setDayError(err instanceof Error ? err.message : "刪除失敗，請稍後再試");
    } finally {
      setIsDeletingDay(false);
    }
  }

  async function handleBulkImport() {
    const { entries, errors } = parseBulkText(bulkText);
    if (errors.length > 0) {
      setBulkErrors(errors);
      setBulkResult(null);
      return;
    }
    if (entries.length === 0) {
      setBulkErrors(["沒有偵測到任何有效的節日資料"]);
      return;
    }
    setBulkErrors([]);
    setIsBulkImporting(true);
    setBulkResult(null);
    try {
      const result = await bulkImportHolidaysAction(entries);
      setBulkResult(`✓ 已匯入 ${result.imported} 筆節日資料`);
      setBulkText("");
      setShowBulkForm(false);
      await loadYear(year);
    } catch (err) {
      setBulkErrors([err instanceof Error ? err.message : "匯入失敗，請稍後再試"]);
    } finally {
      setIsBulkImporting(false);
    }
  }

  const holidaysByDate = new Map((holidays ?? []).map((h) => [h.holidayDate, h]));
  const firstWeekday = firstWeekdayOfMonth(year, month);
  const totalDays = daysInMonth(year, month);
  const weekdayHeaders = ["日", "一", "二", "三", "四", "五", "六"];

  const selectedHoliday = selectedDate ? holidaysByDate.get(selectedDate) : undefined;

  return (
    <div className={`${body.className} flex min-h-screen w-full justify-center px-5 py-8`} style={{ backgroundColor: colors.canvas }}>
      <div className="w-full" style={{ maxWidth: "24rem", color: colors.ink }}>
        <Link href="/" className="text-xs" style={{ color: colors.blue }}>
          ← 返回首頁
        </Link>
        <header className="mb-4 text-center">
          <p style={{ color: colors.muted }} className="text-[11px] tracking-[0.2em]">
            宜蘭・包棟民宿
          </p>
          <h1 className={`${display.className} text-4xl italic`} style={{ color: colors.ink }}>
            節日設定
          </h1>
        </header>

        <div className="mb-3 flex items-center justify-between">
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

        {!isLoading && (
          <div>
            <div className="grid grid-cols-7 gap-1 text-center text-[10px]" style={{ color: colors.muted }}>
              {weekdayHeaders.map((w) => (
                <div key={w} className="py-1">
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: firstWeekday }).map((_, i) => (
                <div key={`blank-${i}`} />
              ))}
              {Array.from({ length: totalDays }, (_, i) => i + 1).map((day) => {
                const dateStr = formatYMD(year, month, day);
                const holiday = holidaysByDate.get(dateStr);
                const isSelected = selectedDate === dateStr;
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => selectDate(dateStr)}
                    className="flex min-h-[3.25rem] flex-col items-center justify-start gap-0.5 rounded-sm border px-0.5 py-1 text-[11px] transition-colors"
                    style={
                      holiday
                        ? { backgroundColor: DAY_TYPE_COLOR[holiday.dayType], color: colors.ink, borderColor: DAY_TYPE_COLOR[holiday.dayType] }
                        : isSelected
                          ? { borderColor: colors.ink, color: colors.ink, backgroundColor: "transparent" }
                          : { borderColor: colors.line, color: colors.ink, backgroundColor: "transparent" }
                    }
                  >
                    <span>{day}</span>
                    {holiday && (
                      <span className="text-center text-[8px] leading-[1.1] break-all">{holiday.name}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {selectedDate && (
          <div className="mt-4 border p-3" style={{ borderColor: colors.line }}>
            <p className="mb-2 text-xs font-semibold">{selectedDate}</p>
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1">
                <span style={{ color: colors.muted }} className="text-[11px]">
                  名稱
                </span>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full border-b bg-transparent py-1 text-sm outline-none"
                  style={{ borderColor: colors.line, color: colors.ink }}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span style={{ color: colors.muted }} className="text-[11px]">
                  分類
                </span>
                <select
                  value={editDayType}
                  onChange={(e) => setEditDayType(e.target.value as HolidayDayType)}
                  className="w-full border-b bg-transparent py-1 text-sm outline-none"
                  style={{ borderColor: colors.line, color: colors.ink }}
                >
                  {DAY_TYPE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {DAY_TYPE_LABEL[opt]}
                    </option>
                  ))}
                </select>
              </label>

              {dayError && (
                <p role="alert" className="text-[11px]" style={{ color: colors.alert }}>
                  {dayError}
                </p>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSaveDay}
                  disabled={isSavingDay}
                  className="flex-1 py-2 text-xs tracking-wide disabled:opacity-50"
                  style={{ backgroundColor: colors.pine, color: colors.pineText }}
                >
                  {isSavingDay ? "儲存中…" : selectedHoliday ? "更新" : "新增"}
                </button>
                {selectedHoliday && (
                  <button
                    type="button"
                    onClick={handleDeleteDay}
                    disabled={isDeletingDay}
                    className="flex-1 border py-2 text-xs tracking-wide disabled:opacity-50"
                    style={{ borderColor: colors.alert, color: colors.alert }}
                  >
                    {isDeletingDay ? "刪除中…" : "刪除"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowBulkForm((v) => !v)}
            className="w-full py-2 text-xs tracking-wide"
            style={{ backgroundColor: colors.pine, color: colors.pineText }}
          >
            批次匯入
          </button>
          {showBulkForm && (
            <div className="mt-2 flex flex-col gap-2 border p-3" style={{ borderColor: colors.line }}>
              <p className="text-[11px] leading-relaxed" style={{ color: colors.muted }}>
                一行一筆，格式「日期,名稱,分類」，例如：
                <br />
                2027-01-01,元旦,holiday
                <br />
                2027-02-05,除夕,春節
              </p>
              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                rows={8}
                className="w-full border p-2 text-xs outline-none"
                style={{ borderColor: colors.line, color: colors.ink }}
                placeholder="2027-01-01,元旦,holiday"
              />
              {bulkErrors.length > 0 && (
                <div className="text-[11px] leading-relaxed" style={{ color: colors.alert }}>
                  {bulkErrors.map((e, i) => (
                    <p key={i}>{e}</p>
                  ))}
                </div>
              )}
              {bulkResult && (
                <p className="text-[11px]" style={{ color: colors.pine }}>
                  {bulkResult}
                </p>
              )}
              <button
                type="button"
                onClick={handleBulkImport}
                disabled={isBulkImporting}
                className="py-2 text-xs tracking-wide disabled:opacity-50"
                style={{ backgroundColor: colors.pine, color: colors.pineText }}
              >
                {isBulkImporting ? "匯入中…" : "匯入"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
