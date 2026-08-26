"use client";

/**
 * 首頁導覽
 */

import Link from "next/link";
import { Fraunces, Work_Sans } from "next/font/google";
import { logoutAction } from "@/app/actions/auth";

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
  /** 房務員登入後只看得到標記這個的項目——見 proxy.ts 的說明，
   * 這裡的過濾只是畫面上不顯示，真正擋存取的是 proxy.ts */
  housekeepingVisible?: boolean;
  /** 管家登入後只看得到標記這個的項目，範圍要跟 proxy.ts 的
   * HOUSEKEEPING_MANAGER_ALLOWED_PREFIXES 保持一致——否則管家會看到
   * 點下去就被導回本日班表的無效選項 */
  housekeepingManagerVisible?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/quote", icon: "📝", title: "製作報價單", description: "填入住資訊，自動算價格並存檔" },
  { href: "/quotes", icon: "🔍", title: "查詢報價單", description: "找以前的報價，客人確認後轉為訂房記錄" },
  {
    href: "/reservations",
    icon: "📖",
    title: "訂單管理",
    description: "查已確認的訂房記錄與付款狀態",
    housekeepingManagerVisible: true,
  },
  { href: "/receivables", icon: "💰", title: "查詢應收", description: "訂金／尾款收款狀況，標記已收款" },
  {
    href: "/schedule/today",
    icon: "📅",
    title: "本日班表",
    description: "今天上班名單與房務準備內容",
    housekeepingVisible: true,
    housekeepingManagerVisible: true,
  },
  {
    href: "/schedule/monthly",
    icon: "🗂️",
    title: "房務班表",
    description: "月曆檢視、指派房務人員，退房訂單缺人會警示",
    housekeepingVisible: true,
    housekeepingManagerVisible: true,
  },
  {
    href: "/employees",
    icon: "🧑‍💼",
    title: "員工管理",
    description: "新增／編輯員工資料",
    housekeepingManagerVisible: true,
  },
  { href: "/properties", icon: "🏠", title: "民宿資料", description: "編輯匯款帳號、地址、停車資訊、各房型價格" },
  {
    href: "/holidays",
    icon: "📆",
    title: "節日設定",
    description: "查看/新增/編輯節日，一鍵批次匯入整年",
    housekeepingManagerVisible: true,
  },
  { href: "/revenue", icon: "📊", title: "營收統計", description: "年度總營收、住房率、每月明細" },
];

export function HomeNav({
  isHousekeepingStaff = false,
  isHousekeepingManager = false,
  currentUserShortName = null,
}: {
  isHousekeepingStaff?: boolean;
  isHousekeepingManager?: boolean;
  currentUserShortName?: string | null;
}) {
  const visibleItems = isHousekeepingStaff
    ? NAV_ITEMS.filter((item) => item.housekeepingVisible)
    : isHousekeepingManager
      ? NAV_ITEMS.filter((item) => item.housekeepingManagerVisible)
      : NAV_ITEMS;

  return (
    <div className={`${body.className} flex min-h-screen w-full justify-center px-5 py-8`} style={{ backgroundColor: colors.canvas }}>
      <div className="w-full" style={{ maxWidth: "24rem", color: colors.ink }}>
        <header className="mb-6 text-center">
          <p style={{ color: colors.muted }} className="text-[11px] tracking-[0.2em]">
            宜蘭・包棟民宿
          </p>
          <h1 className={`${display.className} text-4xl italic`} style={{ color: colors.ink }}>
            民宿管理系統
          </h1>
          {currentUserShortName && (
            <p className="mt-1 text-xs" style={{ color: colors.muted }}>
              目前登入：{currentUserShortName}
            </p>
          )}
        </header>

        <div className="grid grid-cols-2 gap-3">
          {visibleItems.map((item) =>
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

        <Link
          href="/change-password"
          className="mt-4 block w-full border py-2.5 text-center text-xs tracking-wide"
          style={{ borderColor: colors.line, color: colors.muted }}
        >
          變更密碼
        </Link>

        <form action={logoutAction} className="mt-2">
          <button type="submit" className="w-full border py-2.5 text-xs tracking-wide" style={{ borderColor: colors.line, color: colors.muted }}>
            登出
          </button>
        </form>
      </div>
    </div>
  );
}
