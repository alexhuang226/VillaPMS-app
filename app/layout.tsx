import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "包棟報價試算",
  description: "民宿包棟報價試算工具",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  // iOS Safari 對「加到主畫面」的支援跟 manifest.json 是分開的兩套
  // 機制，沒有下面這幾個 apple-mobile-web-app-* 標籤的話，就算有
  // manifest 也一樣會顯示網址列，不會有 standalone 的效果。
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "民宿管理",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // viewport-fit=cover 讓內容延伸到瀏海/圓角這些安全區域之外，
  // 搭配 standalone 模式時畫面看起來才會滿版、不會四周留一圈黑邊
  viewportFit: "cover",
  themeColor: "#33422E",
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
