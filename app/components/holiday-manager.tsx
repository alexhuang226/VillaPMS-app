"use client";

/**
 * 節日管理頁面
 *
 * 上方年份下拉選單，底下列出該年度所有節日（日期/名稱/分類），可以
 * 單筆編輯分類、刪除，也可以新增單筆。
 *
 * 「批次匯入」是貼上一段文字、一次匯入整年節日的地方——這是「一鍵
 * 匯入」實際的樣子：由 Claude（或你自己）先查好official行事曆、
 * 整理成「日期,名稱,分類」一行一筆的格式，貼到這裡，按一次「匯入」
 * 就整批寫進資料庫，不用再手動一筆一筆新增、也不用另外寫 SQL
 * migration 檔案。同一個日期重複貼進來會直接覆蓋成最新的內容，
 * 不會出現重複資料。
 *
 * 分類欄位可以填英文代碼（holiday／festival／lunar_new_year／
 * new_year_eve）或中文（假日／節日／春節／跨年），兩種都看得懂。
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Fraunces, Work_Sans } from "next/font/google";
import {
  bulkImportHolidaysAction,
  createHolidayAction,
  deleteHolidayAction,
  getHolidaysForYearAction,
  updateHolidayAction,
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
};

const DAY_TYPE_LABEL: Record<HolidayDayType, string> = {
  holiday: "假日",
  festival: "節日",
  lunar_new_year: "春節",
  new_year_eve: "跨年",
};
const DAY_TYPE_OPTIONS: HolidayDayType[] = ["holiday", "festival", "lunar_new_year", "new_year_eve"];

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

export function HolidayManager() {
  const [year, setYear] = useState<number | null>(null);
  const [holidays, setHolidays] = useState<HolidayEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newName, setNewName] = useState("");
  const [newDayType, setNewDayType] = useState<HolidayDayType>("holiday");
  const [isSavingNew, setIsSavingNew] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [showBulkForm, setShowBulkForm] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkErrors, setBulkErrors] = useState<string[]>([]);
  const [isBulkImporting, setIsBulkImporting] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  useEffect(() => {
    setYear(new Date().getFullYear());
  }, []);

  useEffect(() => {
    if (year === null) return;
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

  async function handleCategoryChange(entry: HolidayEntry, newType: HolidayDayType) {
    try {
      await updateHolidayAction(entry.id, entry.name ?? "", newType);
      if (year !== null) await loadYear(year);
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新失敗，請稍後再試");
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteHolidayAction(id);
      setHolidays((prev) => prev?.filter((h) => h.id !== id) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "刪除失敗，請稍後再試");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleAddSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newDate || !newName.trim()) {
      setAddError("請填寫日期跟名稱");
      return;
    }
    setIsSavingNew(true);
    setAddError(null);
    try {
      await createHolidayAction(newDate, newName.trim(), newDayType);
      setShowAddForm(false);
      setNewDate("");
      setNewName("");
      setNewDayType("holiday");
      if (year !== null) await loadYear(year);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "新增失敗，請稍後再試");
    } finally {
      setIsSavingNew(false);
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
      if (year !== null) await loadYear(year);
    } catch (err) {
      setBulkErrors([err instanceof Error ? err.message : "匯入失敗，請稍後再試"]);
    } finally {
      setIsBulkImporting(false);
    }
  }

  const thisYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 7 }, (_, i) => thisYear + 2 - i);

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

        {year !== null && (
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="mb-4 w-full border-b bg-transparent py-2 text-center text-sm outline-none"
            style={{ borderColor: colors.line, color: colors.ink }}
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y} 年
              </option>
            ))}
          </select>
        )}

        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={() => {
              setShowAddForm((v) => !v);
              setShowBulkForm(false);
            }}
            className="flex-1 border py-2 text-xs tracking-wide"
            style={{ borderColor: colors.line, color: colors.ink }}
          >
            ＋ 新增單筆
          </button>
          <button
            type="button"
            onClick={() => {
              setShowBulkForm((v) => !v);
              setShowAddForm(false);
            }}
            className="flex-1 py-2 text-xs tracking-wide"
            style={{ backgroundColor: colors.pine, color: colors.pineText }}
          >
            批次匯入
          </button>
        </div>

        {showAddForm && (
          <form onSubmit={handleAddSubmit} className="mb-4 flex flex-col gap-3 border p-3" style={{ borderColor: colors.line }}>
            <label className="flex flex-col gap-1">
              <span style={{ color: colors.muted }} className="text-[11px]">
                日期
              </span>
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="w-full border-b bg-transparent py-1 text-sm outline-none"
                style={{ borderColor: colors.line, color: colors.ink }}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span style={{ color: colors.muted }} className="text-[11px]">
                名稱
              </span>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full border-b bg-transparent py-1 text-sm outline-none"
                style={{ borderColor: colors.line, color: colors.ink }}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span style={{ color: colors.muted }} className="text-[11px]">
                分類
              </span>
              <select
                value={newDayType}
                onChange={(e) => setNewDayType(e.target.value as HolidayDayType)}
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
            {addError && (
              <p role="alert" className="text-[11px]" style={{ color: colors.alert }}>
                {addError}
              </p>
            )}
            <button
              type="submit"
              disabled={isSavingNew}
              className="py-2 text-xs tracking-wide disabled:opacity-50"
              style={{ backgroundColor: colors.pine, color: colors.pineText }}
            >
              {isSavingNew ? "新增中…" : "新增"}
            </button>
          </form>
        )}

        {showBulkForm && (
          <div className="mb-4 flex flex-col gap-2 border p-3" style={{ borderColor: colors.line }}>
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
        {!isLoading && holidays && holidays.length === 0 && (
          <p className="text-xs" style={{ color: colors.muted }}>
            這一年還沒有任何節日資料。
          </p>
        )}

        <div className="flex flex-col gap-2">
          {holidays?.map((h) => (
            <div key={h.id} className="flex items-center justify-between border p-3 text-xs" style={{ borderColor: colors.line }}>
              <div>
                <p className="font-semibold">
                  {h.holidayDate}　{h.name}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={h.dayType}
                  onChange={(e) => handleCategoryChange(h, e.target.value as HolidayDayType)}
                  className="border-b bg-transparent py-1 text-xs outline-none"
                  style={{ borderColor: colors.line, color: colors.ink }}
                >
                  {DAY_TYPE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {DAY_TYPE_LABEL[opt]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => handleDelete(h.id)}
                  disabled={deletingId === h.id}
                  className="px-2 py-1 disabled:opacity-50"
                  style={{ color: colors.alert }}
                >
                  {deletingId === h.id ? "刪除中…" : "刪除"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
