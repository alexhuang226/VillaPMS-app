"use client";

/**
 * 變更密碼頁面
 *
 * 給已經登入的人（不管是管理員、管家、房務員）自己改密碼用——管理者
 * 用「員工管理」的「建立登入帳號」功能建帳號時，只能先設一組初始
 * 密碼，員工登入之後可以來這裡自己改成想要的密碼，不用每次都麻煩
 * 管理者。
 *
 * 用瀏覽器端的 supabase.auth.updateUser() 直接改自己的密碼——因為
 * 使用者已經是登入狀態（有 session），這個操作不需要驗證信、不需要
 * 寄信服務，這也是這個系統目前沒有接 email 發信服務的狀況下，唯一
 * 不求人的改密碼方式（Supabase 內建的「忘記密碼」流程需要寄驗證信，
 * 這個專案還沒設定發信服務，那條路線目前走不通）。
 */

import { useState } from "react";
import Link from "next/link";
import { Fraunces, Work_Sans } from "next/font/google";
import { createClient } from "@/lib/supabase/client";

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
};

export function ChangePasswordForm() {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword.length < 6) {
      setError("密碼至少需要 6 個字元");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("兩次輸入的密碼不一樣");
      return;
    }

    setIsSaving(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      setSuccess(true);
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "變更密碼失敗，請稍後再試");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className={`${body.className} flex min-h-screen w-full justify-center px-5 py-8`} style={{ backgroundColor: colors.canvas }}>
      <div className="w-full" style={{ maxWidth: "20rem", color: colors.ink }}>
        <Link href="/" className="text-xs" style={{ color: colors.blue }}>
          ← 返回首頁
        </Link>
        <header className="mb-6 text-center">
          <p style={{ color: colors.muted }} className="text-[11px] tracking-[0.2em]">
            宜蘭・包棟民宿
          </p>
          <h1 className={`${display.className} text-4xl italic`} style={{ color: colors.ink }}>
            變更密碼
          </h1>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
              新密碼（至少 6 個字元）
            </span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoComplete="new-password"
              className="w-full border-b bg-transparent py-1.5 text-sm outline-none"
              style={{ borderColor: colors.line, color: colors.ink }}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
              再輸入一次新密碼
            </span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
              className="w-full border-b bg-transparent py-1.5 text-sm outline-none"
              style={{ borderColor: colors.line, color: colors.ink }}
            />
          </label>

          {error && (
            <p role="alert" className="text-xs leading-relaxed" style={{ color: colors.alert }}>
              {error}
            </p>
          )}
          {success && (
            <p className="text-xs leading-relaxed" style={{ color: colors.pine }}>
              ✓ 密碼已更新，下次登入請用新密碼
            </p>
          )}

          <button
            type="submit"
            disabled={isSaving}
            className="mt-2 w-full py-2.5 text-xs tracking-wide disabled:opacity-50"
            style={{ backgroundColor: colors.pine, color: colors.pineText }}
          >
            {isSaving ? "更新中…" : "更新密碼"}
          </button>
        </form>
      </div>
    </div>
  );
}
