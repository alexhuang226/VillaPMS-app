/**
 * 費用記錄查詢層
 *
 * 跟 lib/pricing/queries.ts 一樣用 service role client（見
 * lib/supabase/service-role.ts 的說明）。
 *
 * 刻意設計得很簡單：只記錄「哪一天／哪間民宿／什麼類別／多少錢／
 * 備註」，不做審批流程、不做收據附件上傳。目的單純是讓營收統計
 * 報表能算出「營收－費用＝毛利」，不是要取代正式的記帳系統。
 */

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getSingleOrganizationId } from "@/lib/pricing/queries";

/** 固定的費用類別選單，避免手動輸入出現各式各樣不一致的名稱 */
export const EXPENSE_CATEGORIES = ["房租", "薪資", "水電瓦斯", "清潔用品", "維修保養", "其他"];

export interface ExpenseDetail {
  id: string;
  propertyId: string | null;
  /** 沒有指定民宿的費用（例如同時負責多間民宿的薪資），這裡是 null */
  propertyName: string | null;
  expenseDate: string;
  category: string;
  amount: number;
  notes: string | null;
}

export interface ExpenseFields {
  /** null 代表不指定民宿（例如薪資可能同時涵蓋好幾間） */
  propertyId: string | null;
  expenseDate: string;
  category: string;
  amount: number;
  notes: string | null;
}

/** 最近的費用記錄，給費用管理頁面的列表用，預設抓最近 200 筆 */
export async function listExpenses(limit = 200): Promise<ExpenseDetail[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("expenses")
    .select("id, property_id, expense_date, category, amount, notes, properties(name)")
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`查詢費用記錄失敗：${error.message}`);
  }
  return ((data ?? []) as any[]).map((row) => ({
    id: row.id as string,
    propertyId: (row.property_id as string) ?? null,
    propertyName: (row.properties?.name as string) ?? null,
    expenseDate: row.expense_date as string,
    category: row.category as string,
    amount: Number(row.amount),
    notes: (row.notes as string) ?? null,
  }));
}

export async function createExpense(fields: ExpenseFields): Promise<void> {
  const supabase = createServiceRoleClient();
  const organizationId = await getSingleOrganizationId();
  const { error } = await (supabase.from("expenses") as any).insert({
    organization_id: organizationId,
    property_id: fields.propertyId,
    expense_date: fields.expenseDate,
    category: fields.category,
    amount: fields.amount,
    notes: fields.notes,
  });
  if (error) {
    throw new Error(`新增費用記錄失敗：${error.message}`);
  }
}

export async function deleteExpense(id: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) {
    throw new Error(`刪除費用記錄失敗：${error.message}`);
  }
}

export interface MonthlyExpensesByProperty {
  propertyId: string | null;
  /** 沒有指定民宿的費用，這裡固定顯示「不指定民宿」 */
  propertyName: string;
  totalAmount: number;
}

/** 這個月每間民宿的費用加總，給營收統計報表算毛利用——「不指定
 * 民宿」的費用（例如跨民宿的薪資）獨立一組，不會被硬塞進某一間
 * 民宿，避免誤導個別民宿的毛利數字。 */
export async function getMonthlyExpensesByProperty(year: number, month: number): Promise<MonthlyExpensesByProperty[]> {
  const supabase = createServiceRoleClient();
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonthDate = new Date(year, month, 1);
  const nextMonthStart = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, "0")}-01`;

  const { data, error } = await supabase
    .from("expenses")
    .select("property_id, amount, properties(name)")
    .gte("expense_date", monthStart)
    .lt("expense_date", nextMonthStart);

  if (error) {
    throw new Error(`查詢月費用統計失敗：${error.message}`);
  }

  const totals = new Map<string, MonthlyExpensesByProperty>();
  for (const row of (data ?? []) as any[]) {
    const propertyId = (row.property_id as string) ?? null;
    const key = propertyId ?? "__unassigned__";
    const propertyName = propertyId ? ((row.properties?.name as string) ?? "") : "不指定民宿";
    const existing = totals.get(key);
    if (existing) {
      existing.totalAmount += Number(row.amount);
    } else {
      totals.set(key, { propertyId, propertyName, totalAmount: Number(row.amount) });
    }
  }
  return Array.from(totals.values());
}

export interface MonthlyPropertyExpense {
  month: number; // 1-12
  propertyCode: string;
  totalAmount: number;
}

/** 全年、每月、每間民宿的費用加總，鍵值（month + propertyCode）
 * 跟 lib/revenue/queries.ts 的 MonthlyPropertyStats 保持一致，方便
 * 營收統計報表直接用同一組鍵值合併兩邊資料算毛利。這裡用
 * properties(code) 取代 name，因為要對照的是 revenue 那邊用的
 * propertyCode（例如 "zhici"），不是顯示用的中文名稱。
 *
 * 「不指定民宿」的費用（property_id 是 null）不會出現在這個回傳
 * 結果裡——這種費用沒辦法歸屬到單一民宿，個別民宿的毛利明細本來
 * 就不該算進去，避免誤導。營收統計頁面另外用
 * getYearlyUnassignedExpensesAction 查這部分，獨立顯示「全公司整體
 * 費用」，不混進個別民宿的數字。 */
export async function getYearlyExpensesByProperty(year: number): Promise<MonthlyPropertyExpense[]> {
  const supabase = createServiceRoleClient();
  const yearStart = `${year}-01-01`;
  const yearEndExclusive = `${year + 1}-01-01`;

  const { data, error } = await supabase
    .from("expenses")
    .select("expense_date, amount, properties(code)")
    .not("property_id", "is", null)
    .gte("expense_date", yearStart)
    .lt("expense_date", yearEndExclusive);

  if (error) {
    throw new Error(`查詢全年費用統計失敗：${error.message}`);
  }

  const totals = new Map<string, MonthlyPropertyExpense>();
  for (const row of (data ?? []) as any[]) {
    const propertyCode = row.properties?.code as string | undefined;
    if (!propertyCode) continue;
    const month = Number((row.expense_date as string).slice(5, 7));
    const key = `${month}|${propertyCode}`;
    const existing = totals.get(key);
    if (existing) {
      existing.totalAmount += Number(row.amount);
    } else {
      totals.set(key, { month, propertyCode, totalAmount: Number(row.amount) });
    }
  }
  return Array.from(totals.values());
}

/** 全年「不指定民宿」的費用加總（例如同時涵蓋好幾間民宿的薪資）——
 * 沒辦法歸屬到單一民宿，跟 getYearlyExpensesByProperty 分開回傳 */
export interface YearlyUnassignedExpenses {
  /** 全年總額，給年度總覽用 */
  totalAmount: number;
  /** 每月各自的金額，給「每月總覽」表格算「這個月總費用」用——
   * 不能只看 getYearlyExpensesByProperty（那個只有指定民宿的部分），
   * 不然這個月的總費用會漏掉不指定民宿的那些 */
  byMonth: { month: number; amount: number }[];
}

/** 全年「不指定民宿」的費用（例如同時涵蓋好幾間民宿的薪資）——
 * 沒辦法歸屬到單一民宿，跟 getYearlyExpensesByProperty 分開回傳。
 * 同時給「全年總額」跟「每月各自金額」，兩種畫面都會用到。 */
export async function getYearlyUnassignedExpenses(year: number): Promise<YearlyUnassignedExpenses> {
  const supabase = createServiceRoleClient();
  const yearStart = `${year}-01-01`;
  const yearEndExclusive = `${year + 1}-01-01`;

  const { data, error } = await supabase
    .from("expenses")
    .select("expense_date, amount")
    .is("property_id", null)
    .gte("expense_date", yearStart)
    .lt("expense_date", yearEndExclusive);

  if (error) {
    throw new Error(`查詢全年不指定民宿費用失敗：${error.message}`);
  }

  const byMonth = new Map<number, number>();
  let totalAmount = 0;
  for (const row of (data ?? []) as any[]) {
    const amount = Number(row.amount);
    const month = Number((row.expense_date as string).slice(5, 7));
    byMonth.set(month, (byMonth.get(month) ?? 0) + amount);
    totalAmount += amount;
  }
  return {
    totalAmount,
    byMonth: Array.from(byMonth.entries()).map(([month, amount]) => ({ month, amount })),
  };
}
