"use client";

/**
 * 費用記錄頁面
 *
 * 刻意設計得很簡單：只記錄「哪一天／哪間民宿／什麼類別／多少錢／
 * 備註」，一個表單搞定新增，下面接著最近的記錄列表，可以刪除。
 * 目的是讓營收統計報表能算出「營收－費用＝毛利」，不是要取代正式
 * 的記帳系統，所以沒有審批流程、沒有收據附件上傳。
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Fraunces, Work_Sans } from "next/font/google";
import { createExpenseAction, deleteExpenseAction, listExpensesAction } from "@/app/actions/expense";
import { getAllPropertiesSettingsAction } from "@/app/actions/property";
import { EXPENSE_CATEGORIES } from "@/lib/expenses/queries";
import type { ExpenseDetail } from "@/lib/expenses/queries";
import type { PropertySettingsDetail } from "@/lib/pricing/queries";

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

function todayYMD(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// 管家不該看到薪資／房租這些跟人事、租約有關的費用分類——伺服器端
// 的過濾在 app/actions/expense.ts（真正防止資料外流的地方），這裡
// 是前端表單自己再過濾一次分類選單，避免管家新增了一筆自己之後
// 反而看不到的記錄。兩份清單要維持一致，之後如果要多藏哪個分類，
// 兩邊都要一起改。
const CATEGORIES_HIDDEN_FROM_HOUSEKEEPING_MANAGER = ["房租", "薪資"];

function visibleCategories(isHousekeepingManager: boolean): string[] {
  return isHousekeepingManager
    ? EXPENSE_CATEGORIES.filter((c) => !CATEGORIES_HIDDEN_FROM_HOUSEKEEPING_MANAGER.includes(c))
    : EXPENSE_CATEGORIES;
}

function emptyFields(isHousekeepingManager: boolean) {
  return {
    propertyId: "" as string, // 空字串代表「不指定民宿」，送出前轉成 null
    expenseDate: todayYMD(),
    category: visibleCategories(isHousekeepingManager)[0],
    amount: "",
    notes: "",
  };
}

export function ExpenseManager({ isHousekeepingManager = false }: { isHousekeepingManager?: boolean }) {
  const [expenses, setExpenses] = useState<ExpenseDetail[] | null>(null);
  const [properties, setProperties] = useState<PropertySettingsDetail[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [fields, setFields] = useState(() => emptyFields(isHousekeepingManager));
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    loadExpenses();
    getAllPropertiesSettingsAction()
      .then(setProperties)
      .catch(() => {
        // 民宿清單只是給下拉選單用，查詢失敗不影響費用記錄主功能
      });
  }, []);

  async function loadExpenses() {
    setIsLoading(true);
    setLoadError(null);
    try {
      const rows = await listExpensesAction();
      setExpenses(rows);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "查詢失敗，請稍後再試");
    } finally {
      setIsLoading(false);
    }
  }

  function updateField<K extends keyof ReturnType<typeof emptyFields>>(key: K, value: ReturnType<typeof emptyFields>[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amountNum = Number(fields.amount);
    if (!fields.expenseDate || !fields.category || !fields.amount.trim() || Number.isNaN(amountNum) || amountNum <= 0) {
      setSaveError("請填寫日期、類別，並填入大於 0 的金額");
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      const result = await createExpenseAction({
        propertyId: fields.propertyId || null,
        expenseDate: fields.expenseDate,
        category: fields.category,
        amount: amountNum,
        notes: fields.notes.trim() || null,
      });
      if (!result.success) {
        setSaveError(result.message);
        return;
      }
      // 存檔成功後，日期/民宿/類別維持剛剛選的（同一天常常要連續記
      // 好幾筆同類型費用），只清空金額跟備註，方便連續輸入
      setFields((prev) => ({ ...prev, amount: "", notes: "" }));
      await loadExpenses();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "儲存失敗，請稍後再試");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setDeleteError(null);
    try {
      const result = await deleteExpenseAction(id);
      if (!result.success) {
        setDeleteError(result.message);
        return;
      }
      await loadExpenses();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "刪除失敗，請稍後再試");
    } finally {
      setDeletingId(null);
    }
  }

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
            費用記錄
          </h1>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3 border p-4" style={{ borderColor: colors.line }}>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                日期
              </span>
              <input
                type="date"
                value={fields.expenseDate}
                onChange={(e) => updateField("expenseDate", e.target.value)}
                className="w-full border-b bg-transparent py-1 text-sm outline-none"
                style={{ borderColor: colors.line, color: colors.ink }}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                類別
              </span>
              <select
                value={fields.category}
                onChange={(e) => updateField("category", e.target.value)}
                className="w-full border-b bg-transparent py-1 text-sm outline-none"
                style={{ borderColor: colors.line, color: colors.ink }}
              >
                {visibleCategories(isHousekeepingManager).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
              民宿（不指定的話留空，例如同時涵蓋好幾間的薪資）
            </span>
            <select
              value={fields.propertyId}
              onChange={(e) => updateField("propertyId", e.target.value)}
              className="w-full border-b bg-transparent py-1 text-sm outline-none"
              style={{ borderColor: colors.line, color: colors.ink }}
            >
              <option value="">（不指定民宿）</option>
              {properties.map((p) => (
                <option key={p.propertyId} value={p.propertyId}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
              金額
            </span>
            <input
              type="number"
              min={0}
              value={fields.amount}
              onChange={(e) => updateField("amount", e.target.value)}
              placeholder="0"
              className="w-full border-b bg-transparent py-1 text-sm outline-none"
              style={{ borderColor: colors.line, color: colors.ink }}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
              備註（選填）
            </span>
            <input
              type="text"
              value={fields.notes}
              onChange={(e) => updateField("notes", e.target.value)}
              className="w-full border-b bg-transparent py-1 text-sm outline-none"
              style={{ borderColor: colors.line, color: colors.ink }}
            />
          </label>

          {saveError && (
            <p role="alert" className="text-xs" style={{ color: colors.alert }}>
              {saveError}
            </p>
          )}

          <button
            type="submit"
            disabled={isSaving}
            className="mt-1 py-2 text-sm disabled:opacity-50"
            style={{ backgroundColor: colors.pine, color: colors.pineText }}
          >
            {isSaving ? "儲存中…" : "＋ 新增費用記錄"}
          </button>
        </form>

        <div className="mt-6">
          <p className="mb-2 text-xs font-bold" style={{ color: colors.ink }}>
            最近的費用記錄
          </p>

          {isLoading && (
            <p className="text-center text-xs" style={{ color: colors.muted }}>
              載入中…
            </p>
          )}
          {loadError && (
            <p role="alert" className="text-center text-xs" style={{ color: colors.alert }}>
              {loadError}
            </p>
          )}
          {deleteError && (
            <p role="alert" className="mb-2 text-xs" style={{ color: colors.alert }}>
              {deleteError}
            </p>
          )}

          {!isLoading && expenses && expenses.length === 0 && (
            <p className="text-center text-xs" style={{ color: colors.muted }}>
              還沒有任何費用記錄。
            </p>
          )}

          {!isLoading && expenses && expenses.length > 0 && (
            <div className="flex flex-col gap-2">
              {expenses.map((e) => (
                <div key={e.id} className="flex items-start justify-between border p-3 text-xs" style={{ borderColor: colors.line }}>
                  <div>
                    <p style={{ color: colors.ink }}>
                      {e.expenseDate}　{e.category}　{e.propertyName ?? "（不指定民宿）"}
                    </p>
                    <p className="mt-0.5" style={{ color: colors.muted }}>
                      NT$ {e.amount.toLocaleString()}
                      {e.notes ? `　${e.notes}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(e.id)}
                    disabled={deletingId === e.id}
                    className="shrink-0 text-[11px] disabled:opacity-50"
                    style={{ color: colors.alert }}
                  >
                    {deletingId === e.id ? "刪除中…" : "刪除"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
