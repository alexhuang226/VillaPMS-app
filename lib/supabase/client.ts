import { createBrowserClient } from "@supabase/ssr";

/**
 * 瀏覽器端的 Supabase client，用在登入頁這種需要在瀏覽器直接呼叫
 * Supabase Auth API 的地方（例如 supabase.auth.signInWithPassword()）。
 *
 * ⚠️ 跟 lib/supabase/service-role.ts 不一樣：這裡用的是可以公開
 * 曝露在瀏覽器的 Publishable/anon key（NEXT_PUBLIC_ 開頭），不是
 * 有完整資料庫存取權限的 Secret/service_role key——絕對不能把
 * service role key 用在這個檔案，那個 key 只能在伺服器端使用。
 *
 * NEXT_PUBLIC_SUPABASE_ANON_KEY 這個環境變數要另外在 .env.local／
 * Vercel 設定：去 Supabase Dashboard → Settings → API Keys，複製
 * 「Publishable and secret API keys」分頁裡「Publishable key」區塊
 * 的值（sb_publishable_ 開頭；舊專案則是 Legacy API Keys 分頁裡的
 * anon / public key）。這個 key 本來就設計成可以公開，不是敏感資料。
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "缺少 NEXT_PUBLIC_SUPABASE_URL 或 NEXT_PUBLIC_SUPABASE_ANON_KEY 環境變數。" +
        "請到 Supabase 專案設定 → API Keys，複製 Publishable key 的值，加到 .env.local，" +
        "Vercel 部署也要另外在 Environment Variables 設定一次。"
    );
  }

  return createBrowserClient(url, anonKey);
}
