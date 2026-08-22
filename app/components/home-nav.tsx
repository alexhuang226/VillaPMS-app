"use client";

/**
 * 首頁導覽
 *
 * 目前實際可用的功能：製作報價單／查詢報價單／查詢訂單／查詢應收。
 * 排班相關（安排排班／本日班表／每月班表）先放路由但顯示「即將
 * 推出」——這是完全不同的功能領域（員工排班/任務指派），資料庫
 * schema 裡雖然已經有 housekeeping_tasks 之類的表，但還沒有實際的
 * 查詢/操作邏輯跟畫面，需要先確認具體要怎麼運作（例如：排班是排
 * 「哪個員工哪天上班」，還是排「哪個員工負責哪間房的清潔任務」？
 * 本日班表跟每月班表要顯示什麼欄位？）才能開始做，不想先亂猜一個
 * 版本出來。
 */

import Link from "next/link";
import { Fraunces, Work_Sans } from "next/font/google";

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
  surface: "#FFFFFF",
  ink: "#221F1B",
  muted: "#57514A",
  line: "#D9D1C4",
  pine: "#33422E",
  pineSoft: "#E7EAE1",
  pineText: "#FFFFFF",
};

interface NavItem {
  href: string;
  icon: string;
  title: string;
  description: string;
  disabled?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/quote", icon: "📝", title: "製作報價單", description: "填入住資訊，自動算價格並存檔" },
  { href: "/quotes", icon: "🔍", title: "查詢報價單", description: "找以前的報價，客人確認後轉為訂房記錄" },
  { href: "/reservations", icon: "📖", title: "查詢訂單", description: "查已確認的訂房記錄與付款狀態" },
  { href: "/receivables", icon: "💰", title: "查詢應收", description: "訂金／尾款收款狀況，標記已收款" },
  { href: "/schedule", icon: "🗓️", title: "安排排班", description: "即將推出", disabled: true },
  { href: "/schedule/today", icon: "📅", title: "本日班表", description: "即將推出", disabled: true },
  { href: "/schedule/monthly", icon: "🗂️", title: "每月班表", description: "即將推出", disabled: true },
];

export function HomeNav() {
  return (
    <div className={`${body.className} flex min-h-screen w-full justify-center px-5 py-8`} style={{ backgroundColor: colors.canvas }}>
      <div className="w-full" style={{ maxWidth: "24rem", color: colors.ink }}>
        <header className="mb-6 text-center">
          <p style={{ color: colors.muted }} className="text-[11px] tracking-[0.2em]">
            宜蘭・包棟民宿
          </p>
          <h1 className={`${display.className} text-4xl italic`} style={{ color: colors.ink }}>
            民宿管理
          </h1>
        </header>

        <div className="grid grid-cols-2 gap-3">
          {NAV_ITEMS.map((item) =>
            item.disabled ? (
              <div
                key={item.href}
                className="flex flex-col items-center gap-1 border p-4 text-center opacity-50"
                style={{ borderColor: colors.line }}
              >
                <span className="text-2xl leading-none">{item.icon}</span>
                <p className="mt-1 text-sm font-semibold">{item.title}</p>
                <p className="text-[11px]" style={{ color: colors.muted }}>
                  {item.description}
                </p>
              </div>
            ) : (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-col items-center gap-1 border p-4 text-center transition-colors"
                style={{ borderColor: colors.line }}
              >
                <span className="text-2xl leading-none">{item.icon}</span>
                <p className="mt-1 text-sm font-semibold">{item.title}</p>
                <p className="text-[11px]" style={{ color: colors.muted }}>
                  {item.description}
                </p>
              </Link>
            )
          )}
        </div>
      </div>
    </div>
  );
}
