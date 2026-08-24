"use client";

/**
 * 員工管理頁面
 *
 * 列表＋新增＋編輯都在同一頁。列表預設顯示全部員工（在職排前面），
 * 離職的用淡色標示但不隱藏，方便查歷史紀錄。點「+ 新增員工」或點
 * 某一筆員工都會展開同一個表單（新增時是空白表單，編輯時預先帶入
 * 該員工的資料）。
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Fraunces, Work_Sans } from "next/font/google";
import { createEmployeeAction, createEmployeeLoginAccountAction, listAllEmployeesAction, updateEmployeeAction } from "@/app/actions/employee";
import type { EmployeeDetail, EmployeeFields } from "@/lib/schedule/queries";

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

const STATUS_OPTIONS = [
  { value: "active", label: "在職" },
  { value: "on_leave", label: "留職停薪" },
  { value: "inactive", label: "離職" },
];
const STATUS_LABEL: Record<string, string> = {
  active: "在職",
  on_leave: "留職停薪",
  inactive: "離職",
};

/** 職稱固定選單，避免手動輸入出現各式各樣不一致的名稱（例如「房務」
 * 跟「房務員」意思一樣但打法不同，之後篩選/比對會漏掉） */
const POSITION_OPTIONS = ["管理員", "房務員", "管家"];

const EMPTY_FIELDS: EmployeeFields = {
  name: "",
  shortName: "",
  phone: "",
  email: "",
  position: "",
  employmentStatus: "active",
  birthDate: "",
  hireDate: "",
  lineId: "",
};

/** 表單裡都用空字串代表「沒填」，送出前轉成 null（跟資料庫的 nullable 欄位對應） */
function toNullableFields(fields: EmployeeFields): EmployeeFields {
  return {
    name: fields.name.trim(),
    shortName: fields.shortName?.trim() || null,
    phone: fields.phone?.trim() || null,
    email: fields.email?.trim() || null,
    position: fields.position?.trim() || null,
    employmentStatus: fields.employmentStatus,
    birthDate: fields.birthDate || null,
    hireDate: fields.hireDate || null,
    lineId: fields.lineId?.trim() || null,
  };
}

function detailToFields(detail: EmployeeDetail): EmployeeFields {
  return {
    name: detail.name,
    shortName: detail.shortName ?? "",
    phone: detail.phone ?? "",
    email: detail.email ?? "",
    position: detail.position ?? "",
    employmentStatus: detail.employmentStatus,
    birthDate: detail.birthDate ?? "",
    hireDate: detail.hireDate ?? "",
    lineId: detail.lineId ?? "",
  };
}

export function EmployeeManager() {
  const [employees, setEmployees] = useState<EmployeeDetail[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // null = 列表檢視；"new" = 新增表單；其他字串 = 正在編輯這個 id 的員工
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [fields, setFields] = useState<EmployeeFields>(EMPTY_FIELDS);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 建立登入帳號（只有編輯「已存在」的員工才會顯示這個子表單——
  // 新增中的員工還沒有 id，沒辦法連結 user_id）
  const [showLoginAccountForm, setShowLoginAccountForm] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [createAccountError, setCreateAccountError] = useState<string | null>(null);
  const [createAccountSuccess, setCreateAccountSuccess] = useState(false);

  useEffect(() => {
    loadEmployees();
  }, []);

  async function loadEmployees() {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await listAllEmployeesAction();
      setEmployees(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "讀取失敗，請稍後再試");
    } finally {
      setIsLoading(false);
    }
  }

  function startCreate() {
    setFields(EMPTY_FIELDS);
    setSaveError(null);
    setEditingId("new");
  }

  function startEdit(detail: EmployeeDetail) {
    setFields(detailToFields(detail));
    setSaveError(null);
    setEditingId(detail.id);
    setShowLoginAccountForm(false);
    setLoginEmail(detail.email ?? "");
    setLoginPassword("");
    setCreateAccountError(null);
    setCreateAccountSuccess(false);
  }

  function cancelEdit() {
    setEditingId(null);
    setSaveError(null);
  }

  async function handleCreateLoginAccount() {
    if (editingId === "new" || !editingId) return;
    if (!loginEmail.trim() || !loginPassword.trim()) {
      setCreateAccountError("請填寫 Email 跟密碼");
      return;
    }
    setIsCreatingAccount(true);
    setCreateAccountError(null);
    try {
      await createEmployeeLoginAccountAction(editingId, loginEmail.trim(), loginPassword);
      setCreateAccountSuccess(true);
      setShowLoginAccountForm(false);
      await loadEmployees();
    } catch (err) {
      setCreateAccountError(err instanceof Error ? err.message : "建立帳號失敗，請稍後再試");
    } finally {
      setIsCreatingAccount(false);
    }
  }

  function updateField<K extends keyof EmployeeFields>(key: K, value: EmployeeFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fields.name.trim()) {
      setSaveError("請填寫姓名");
      return;
    }
    setIsSaving(true);
    setSaveError(null);

    try {
      const payload = toNullableFields(fields);
      if (editingId === "new") {
        await createEmployeeAction(payload);
      } else if (editingId) {
        await updateEmployeeAction(editingId, payload);
      }
      setEditingId(null);
      await loadEmployees();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "儲存失敗，請稍後再試");
    } finally {
      setIsSaving(false);
    }
  }

  const showForm = editingId !== null;
  const editingEmployee = editingId && editingId !== "new" ? employees?.find((e) => e.id === editingId) ?? null : null;

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
            員工管理
          </h1>
        </header>

        {!showForm && (
          <>
            <button
              type="button"
              onClick={startCreate}
              className="w-full py-2.5 text-xs tracking-wide"
              style={{ backgroundColor: colors.pine, color: colors.pineText }}
            >
              ＋ 新增員工
            </button>

            {isLoading && (
              <p className="mt-4 text-xs" style={{ color: colors.muted }}>
                讀取中…
              </p>
            )}
            {loadError && (
              <p role="alert" className="mt-4 border-l-2 pl-3 text-xs leading-relaxed" style={{ borderColor: colors.alert, color: colors.alert }}>
                {loadError}
              </p>
            )}

            <div className="mt-4 flex flex-col gap-2">
              {employees?.map((emp) => {
                const inactive = emp.employmentStatus !== "active";
                return (
                  <button
                    key={emp.id}
                    type="button"
                    onClick={() => startEdit(emp)}
                    className="flex items-center justify-between border p-3 text-left text-xs transition-colors"
                    style={{ borderColor: colors.line, opacity: inactive ? 0.55 : 1 }}
                  >
                    <div>
                      <p className="font-semibold">
                        {emp.name}
                        {emp.shortName && emp.shortName !== emp.name ? `（${emp.shortName}）` : ""}
                      </p>
                      <p style={{ color: colors.muted }}>
                        {emp.position ?? "（未填職稱）"}
                        {emp.phone ? `　${emp.phone}` : ""}
                      </p>
                    </div>
                    <span style={{ color: colors.muted }}>{STATUS_LABEL[emp.employmentStatus] ?? emp.employmentStatus}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {showForm && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <p className="text-xs font-bold" style={{ color: colors.blue }}>
              {editingId === "new" ? "新增員工" : "編輯員工"}
            </p>

            <div className="grid grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                  姓名
                </span>
                <input
                  type="text"
                  value={fields.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  required
                  className="w-full border-b bg-transparent py-1 text-sm outline-none"
                  style={{ borderColor: colors.line, color: colors.ink }}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                  簡稱
                </span>
                <input
                  type="text"
                  value={fields.shortName ?? ""}
                  onChange={(e) => updateField("shortName", e.target.value)}
                  className="w-full border-b bg-transparent py-1 text-sm outline-none"
                  style={{ borderColor: colors.line, color: colors.ink }}
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                  職稱
                </span>
                <select
                  value={fields.position ?? ""}
                  onChange={(e) => updateField("position", e.target.value)}
                  required
                  className="w-full border-b bg-transparent py-1 text-sm outline-none"
                  style={{ borderColor: colors.line, color: colors.ink }}
                >
                  <option value="" disabled>
                    請選擇職稱
                  </option>
                  {POSITION_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                  在職狀態
                </span>
                <select
                  value={fields.employmentStatus}
                  onChange={(e) => updateField("employmentStatus", e.target.value)}
                  className="w-full border-b bg-transparent py-1 text-sm outline-none"
                  style={{ borderColor: colors.line, color: colors.ink }}
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                  電話
                </span>
                <input
                  type="tel"
                  value={fields.phone ?? ""}
                  onChange={(e) => updateField("phone", e.target.value)}
                  className="w-full border-b bg-transparent py-1 text-sm outline-none"
                  style={{ borderColor: colors.line, color: colors.ink }}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                  LINE 帳號
                </span>
                <input
                  type="text"
                  value={fields.lineId ?? ""}
                  onChange={(e) => updateField("lineId", e.target.value)}
                  className="w-full border-b bg-transparent py-1 text-sm outline-none"
                  style={{ borderColor: colors.line, color: colors.ink }}
                />
              </label>
            </div>

            <label className="flex flex-col gap-1">
              <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                Email
              </span>
              <input
                type="email"
                value={fields.email ?? ""}
                onChange={(e) => updateField("email", e.target.value)}
                className="w-full border-b bg-transparent py-1 text-sm outline-none"
                style={{ borderColor: colors.line, color: colors.ink }}
              />
            </label>

            <div className="grid grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                  生日
                </span>
                <input
                  type="date"
                  value={fields.birthDate ?? ""}
                  onChange={(e) => updateField("birthDate", e.target.value)}
                  className="w-full border-b bg-transparent py-1 text-sm outline-none"
                  style={{ borderColor: colors.line, color: colors.ink }}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                  到職日期
                </span>
                <input
                  type="date"
                  value={fields.hireDate ?? ""}
                  onChange={(e) => updateField("hireDate", e.target.value)}
                  className="w-full border-b bg-transparent py-1 text-sm outline-none"
                  style={{ borderColor: colors.line, color: colors.ink }}
                />
              </label>
            </div>

            {/* 登入帳號——只有編輯已存在的員工才會出現（新增中的員工
                還沒有 id）。這是第一階段權限控管的一部分：能不能登入
                跟登入後有什麼權限是兩回事，目前所有登入的人權限都
                一樣，還沒做角色區分。 */}
            {editingEmployee && (
              <div className="border-t pt-3" style={{ borderColor: colors.line }}>
                <p className="text-[11px] font-bold" style={{ color: colors.ink }}>
                  登入帳號
                </p>
                {editingEmployee.hasLoginAccount ? (
                  <p className="mt-1 text-xs" style={{ color: colors.pine }}>
                    ✓ 已有登入帳號
                  </p>
                ) : createAccountSuccess ? (
                  <p className="mt-1 text-xs" style={{ color: colors.pine }}>
                    ✓ 已建立登入帳號
                  </p>
                ) : showLoginAccountForm ? (
                  <div className="mt-2 flex flex-col gap-2">
                    <label className="flex flex-col gap-1">
                      <span style={{ color: colors.muted }} className="text-[11px]">
                        登入用 Email
                      </span>
                      <input
                        type="email"
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        className="w-full border-b bg-transparent py-1 text-sm outline-none"
                        style={{ borderColor: colors.line, color: colors.ink }}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span style={{ color: colors.muted }} className="text-[11px]">
                        密碼（先幫他設一組，之後可以請他自己去 Supabase 忘記密碼流程更改）
                      </span>
                      <input
                        type="text"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        className="w-full border-b bg-transparent py-1 text-sm outline-none"
                        style={{ borderColor: colors.line, color: colors.ink }}
                      />
                    </label>
                    {createAccountError && (
                      <p role="alert" className="text-[11px]" style={{ color: colors.alert }}>
                        {createAccountError}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setShowLoginAccountForm(false)}
                        disabled={isCreatingAccount}
                        className="flex-1 border py-1.5 text-[11px] disabled:opacity-50"
                        style={{ borderColor: colors.line, color: colors.ink }}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={handleCreateLoginAccount}
                        disabled={isCreatingAccount}
                        className="flex-1 py-1.5 text-[11px] disabled:opacity-50"
                        style={{ backgroundColor: colors.pine, color: colors.pineText }}
                      >
                        {isCreatingAccount ? "建立中…" : "建立帳號"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowLoginAccountForm(true)}
                    className="mt-1 text-xs"
                    style={{ color: colors.blue }}
                  >
                    尚未建立登入帳號，點此建立
                  </button>
                )}
              </div>
            )}

            {saveError && (
              <p role="alert" className="text-xs leading-relaxed" style={{ color: colors.alert }}>
                {saveError}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={cancelEdit}
                disabled={isSaving}
                className="flex-1 border py-2.5 text-xs tracking-wide disabled:opacity-50"
                style={{ borderColor: colors.line, color: colors.ink }}
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex-1 py-2.5 text-xs tracking-wide disabled:opacity-50"
                style={{ backgroundColor: colors.pine, color: colors.pineText }}
              >
                {isSaving ? "儲存中…" : "儲存"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
