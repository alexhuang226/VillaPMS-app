/**
 * Service role Supabase client — 只能在伺服器端程式碼使用
 * （server actions / route handlers），絕對不能把這個 client 或
 * service role key 暴露給瀏覽器／client component。
 *
 * 為什麼報價引擎需要這個，而不是用一般帶 RLS 的 client：
 *
 * 001_pms_schema.sql 幫每張表都設計了 RLS，例如 rooms/room_types/
 * services/rate_rules 這些表都要求 `is_org_member(organization_id)`
 * 才能 SELECT。這個設計假設「每個會呼叫這些查詢的使用者，都已經
 * 用 Supabase Auth 登入，而且 organization_members 表裡有對應那個
 * auth.uid() 的成員資料列」。
 *
 * 但報價試算頁面（QuoteForm）目前還沒有接 Supabase Auth 登入流程，
 * 也沒有人手動去 organization_members 表新增自己的成員資料列——這會
 * 導致 is_org_member() 對任何人都回傳 false，RLS 把 rooms/services/
 * rate_rules 這些查詢全部擋成「查得到但是 0 筆」，不會報錯，只是
 * 靜靜地回傳空結果。這正好可以解釋「手動調整房型一直說超過實際四人
 * 套房房間數 0 間」（房間數量查到 0 筆）跟「額外服務/加床/加房/
 * 訪客/寵物的費用都算成 0」（services 表的價格也查到 0 筆，
 * 所有單價變成 0）這兩個症狀。
 *
 * 報價引擎讀取的這些資料（房型、價格、服務、房間數量）本質上是
 * 「系統設定/營運資料」，不是「使用者個人資料」，用服務端信任邊界
 * （這裡的每個函式都只在 server action 裡執行，不會被瀏覽器直接
 * 呼叫）取代逐筆 RLS 檢查是合理的作法：真正需要保護的是「誰可以
 * 呼叫這個報價功能」，那一層權限控管應該做在頁面/路由層級（例如要求
 * 先登入才能進入 /quote），而不是在資料庫每一次查詢都重新驗證。
 *
 * 使用前置：Supabase 專案 → Settings → API → service_role key
 * 複製起來，加到 .env.local：
 *
 *   SUPABASE_SERVICE_ROLE_KEY=xxxxxxxx
 *
 * ⚠️ 這組 key 完全繞過 RLS、擁有資料庫完整讀寫權限，絕對不能加
 * NEXT_PUBLIC_ 前綴、不能提交到 git、不能出現在任何會送到瀏覽器的
 * 程式碼裡。部署到 Vercel 時記得到 Project Settings → Environment
 * Variables 另外設定一次（不會從 .env.local 自動帶過去）。
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

let cachedClient: ReturnType<typeof createSupabaseClient> | null = null;

export function createServiceRoleClient() {
  if (cachedClient) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY 環境變數。" +
        "請到 Supabase 專案設定 → API 複製 Project URL 跟 service_role key，" +
        "加到 .env.local（SUPABASE_SERVICE_ROLE_KEY 不要加 NEXT_PUBLIC_ 前綴），" +
        "Vercel 部署也要另外在 Environment Variables 設定一次。"
    );
  }

  cachedClient = createSupabaseClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}
