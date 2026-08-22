import type { MetadataRoute } from "next";

/**
 * Next.js App Router 的檔案慣例：這個檔案會自動被編譯成
 * /manifest.webmanifest，而且 Next.js 會自動在 <head> 加上對應的
 * <link rel="manifest">，不用手動在 layout.tsx 裡另外加連結。
 *
 * display: "standalone" 是「看起來像 APP」最關鍵的一個設定——手機
 * 瀏覽器把網站加到主畫面之後，打開時不會顯示網址列跟瀏覽器工具列，
 * 看起來就像一般的原生 APP。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "民宿管理",
    short_name: "民宿管理",
    description: "宜蘭包棟民宿管理系統：報價、訂單、應收查詢",
    start_url: "/",
    display: "standalone",
    background_color: "#FAF8F4",
    theme_color: "#33422E",
    orientation: "portrait",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
