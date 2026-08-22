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
 * 使用前置：
 *
 * Supabase 專案 → Settings → API Keys。如果你看到的是「Publishable
 * and secret API keys」這個分頁（沒有 anon/service_role 那組），
 * 代表你的專案是用 Supabase 新版 API key 系統建立的——這是正常的，
 * 2025 年底之後新建的 Supabase 專案預設就只有新版 key。新版命名
 * 對應關係：
 *
 *   舊版 anon (JWT)          → 新版 Publishable key (sb_publishable_...)
 *   舊版 service_role (JWT)  → 新版 Secret key       (sb_secret_...)
 *
 * 兩者功能對等：Secret key 一樣帶有 Postgres 的 BYPASSRLS 屬性，
 * 一樣會略過所有 RLS 規則，用法完全相同，supabase-js 也不需要改
 * 任何程式碼就能吃新版 key。
 *
 * 複製 Secret keys 區塊裡的值（通常命名為 default，格式是
 * `sb_secret_...` 開頭），加到 .env.local：
 *
 *   SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxxxxxxx
 *
 * （如果你的專案比較舊、還看得到 Legacy API Keys 分頁裡的
 * service_role key，兩種格式都能用，效果一樣，不用特別轉換。）
 *
 * ⚠️ 不管是哪一種格式，這組值都完全繞過 RLS、擁有資料庫完整讀寫
 * 權限，絕對不能加 NEXT_PUBLIC_ 前綴、不能提交到 git、不能出現在
 * 任何會送到瀏覽器的程式碼裡。部署到 Vercel 時記得到 Project
 * Settings → Environment Variables 另外設定一次（不會從 .env.local
 * 自動帶過去），改完要重新部署，本機開發改完要重啟 `npm run dev`
 * （環境變數只有啟動當下會讀取）。
 */

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * ⚠️ 型別寫法很重要：這裡故意用明確的 `SupabaseClient<any, any, any>`
 * 當作快取變數的型別，不是寫 `ReturnType<typeof createSupabaseClient>`。
 *
 * 原本的寫法在 Vercel 上實際跑出的錯誤模式（幾乎整個 queries.ts 的
 * 每一個查詢，不分表、不分欄位，全部被判定成 `never`）符合一個已知的
 * TypeScript 陷阱：對「還沒被呼叫、只是參照函式本身」的泛型函式
 * （createSupabaseClient 剛好就是這種——Database/SchemaName/Schema
 * 都有預設值，而且後兩個的預設值是根據 Database 算出來的條件型別）
 * 算 ReturnType，套用預設泛型參數的時機/方式跟「直接呼叫該函式」不
 * 完全一樣，某些 TypeScript 版本組合下會讓那些條件型別解析失敗、
 * 連帶讓整個 Database 型別壞掉。
 *
 * 這裡沒辦法用真正的 @supabase/supabase-js 套件重現到一模一樣的失敗
 * （沙盒環境無法連網安裝套件驗證），所以不誇口說這就是唯一或百分之百
 * 確認的成因，但這個修法本身無論如何都是穩妥的：不透過 ReturnType
 * 間接推導，而是直接、明確地指定 `SupabaseClient<any, any, any>`，
 * 不依賴任何泛型預設值的自動解析——不管原本斷掉的確切機制是什麼，
 * 這樣寫都不會再觸發同一類推導問題。
 */
let cachedClient: SupabaseClient<any, any, any> | null = null;

export function createServiceRoleClient(): SupabaseClient<any, any, any> {
  if (cachedClient) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY 環境變數。" +
        "請到 Supabase 專案設定 → API Keys，複製 Publishable and secret " +
        "API keys 分頁裡「Secret keys」區塊的值（sb_secret_ 開頭；舊專案則是 " +
        "Legacy API Keys 分頁裡的 service_role key），加到 .env.local，" +
        "Vercel 部署也要另外在 Environment Variables 設定一次。"
    );
  }

  cachedClient = createSupabaseClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}