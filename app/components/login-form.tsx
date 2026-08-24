"use client";

/**
 * 登入頁面
 *
 * 用 email/密碼登入（Supabase Auth 內建的方式，帳號要先由管理者在
 * 「員工管理」頁面幫每位員工建立好，見 employee-manager.tsx 的
 * 「建立登入帳號」功能）。登入成功後 middleware.ts 會放行，導回
 * 使用者原本想去的頁面（或首頁）。
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
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
};

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(signInError.message === "Invalid login credentials" ? "帳號或密碼錯誤" : signInError.message);
        return;
      }
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登入失敗，請稍後再試");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className={`${body.className} flex min-h-screen w-full items-center justify-center px-5`} style={{ backgroundColor: colors.canvas }}>
      <div className="w-full" style={{ maxWidth: "20rem", color: colors.ink }}>
        <header className="mb-8 text-center">
          <p style={{ color: colors.muted }} className="text-[11px] tracking-[0.2em]">
            宜蘭・包棟民宿
          </p>
          <h1 className={`${display.className} text-4xl italic`} style={{ color: colors.ink }}>
            民宿管理系統
          </h1>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
              Email
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
              className="w-full border-b bg-transparent py-1.5 text-sm outline-none"
              style={{ borderColor: colors.line, color: colors.ink }}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
              密碼
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full border-b bg-transparent py-1.5 text-sm outline-none"
              style={{ borderColor: colors.line, color: colors.ink }}
            />
          </label>

          {error && (
            <p role="alert" className="text-xs leading-relaxed" style={{ color: colors.alert }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="mt-2 w-full py-2.5 text-xs tracking-wide disabled:opacity-50"
            style={{ backgroundColor: colors.pine, color: colors.pineText }}
          >
            {isLoading ? "登入中…" : "登入"}
          </button>
        </form>
      </div>
    </div>
  );
}
