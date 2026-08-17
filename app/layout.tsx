import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "包棟報價試算",
  description: "民宿包棟報價試算工具",
};

/**
 * 根版面配置。
 *
 * <body> 刻意不加任何 className——不設定寬度、不設定 flex、不設定
 * 顏色。QuoteForm 元件內部已經自己用 inline style 處理好「滿版背景
 * + 置中窄欄」，這裡如果又加一層 max-w-*／flex／文字顏色的 class，
 * 反而可能跟元件內部的版面邏輯打架，讓寬度或顏色又跑掉。
 *
 * 之後如果要加其他頁面（例如訂房管理、日曆），且需要共用的導覽列/
 * 頁尾，再回來這裡加，屆時也建議一樣用 inline style 或至少避開跟
 * 各頁面內部版面衝突的寬度設定。
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
