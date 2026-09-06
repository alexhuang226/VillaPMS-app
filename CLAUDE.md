# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

民宿 PMS 系統 — a property-management system for three 宜蘭 whole-villa B&Bs (包棟民宿): **只此清綠 (`zhici`)**, **陌隱 (`moyin`)**, **水景璞堤 (`shuijing`)**. It started as a whole-villa price calculator and grew into quoting, reservations, receivables, housekeeping rosters, revenue stats and expense tracking. Installed as a PWA (`display: standalone`), used mostly on phones by front-desk and housekeeping staff.

Stack: **Next.js 16 (App Router) · React 19 · Tailwind CSS v4 · TypeScript strict · Vercel · Supabase (PostgreSQL)**. Also `@supabase/ssr` + `@supabase/supabase-js`, `@line/liff`, `html-to-image` (quote/reservation → shareable PNG). Path alias `@/*` → repo root.

The codebase (comments, UI strings, commit messages) is in **Traditional Chinese**. Comments are unusually long and explain *why* past bugs happened — read them before changing nearby code.

Per `AGENTS.md`: **Next.js 16 has breaking changes vs. training data** — consult `node_modules/next/dist/docs/` before writing framework code. Notably `middleware.ts` is deprecated and renamed to `proxy.ts` with `export function proxy`.

## Commands

```bash
npm run dev      # next dev — also rewrites the nextjs-agent-rules block in AGENTS.md
npm run build    # next build — runs a FULL tsc typecheck (much stricter than `next dev`)
npm run start    # serve the production build
npm run lint     # eslint (eslint-config-next: core-web-vitals + typescript)
```

- **No test runner is configured.** `lib/pricing/*` is written as pure, side-effect-free functions "for unit testing", but no framework is installed — don't assume `npm test` exists.
- After changes, always run a full `tsc --noEmit` (or `npm run build`) before handing off — don't just eyeball for syntax errors. Past sessions had bugs (missed call-site updates, orphaned code) that only the full typecheck caught. Vercel's `next build` enforces strict types even though `next dev` locally does not.

## 核心 ID

- 只此清綠：`0a16233a-9846-421e-b6d6-ccced85792b4`
- 陌隱：`c4fe9189-051f-4a3f-aa43-9f04b0043723`
- 水景璞堤：`146fe8ae-84b5-4170-8747-dd15afc4e722`
- 組織 ID：`cb5b624b-8fdc-41ce-b1f1-55f9f85d816f`
- Supabase 專案 ID：`xinmtvzmvqlyzjalgagw`

## 角色權限

| 職稱 | 可存取路徑 | 說明 |
|---|---|---|
| 管理員 | 全部 | |
| 管家 | `/schedule` `/reservations` `/employees` `/holidays` `/expenses` `/revenue` `/change-password` `/login` | 訂單管理看不到月曆檢視/應收帳款切換、付款狀況、訂單狀態；營收統計只看得到住房率（不含營收/費用/毛利）；費用記錄看不到房租/薪資分類（`app/actions/expense.ts` 伺服器端過濾，`expense-manager.tsx` 下拉選單也濾掉） |
| 房務員/清潔員/洗衣公司 | `/schedule` `/change-password` `/login` | 登入直接導去 `/schedule/monthly`；清潔員/洗衣公司再依 `employee_property_access` 限制只看到被指派的民宿 |

- 權限判斷在 `proxy.ts`（`HOUSEKEEPING_MANAGER_ALLOWED_PREFIXES` 等常數，前綴比對，`/reservations/new` 這種子路徑會自動被 `/reservations` 涵蓋，不用額外列出）。
- **`proxy.ts` 這個檔名不能改回 `middleware.ts`**（export 也必須是 `proxy` 不是 `middleware`）——Next.js 16 會直接、無聲地忽略 `middleware.ts`，整站登入保護與角色限制會悄悄失效且沒有任何錯誤訊息。
- 改角色存取範圍時，**三個地方要同步**：`proxy.ts` 的前綴常數、`app/components/home-nav.tsx` 的 `housekeepingManagerVisible` 等顯示欄位、以及各頁面 client component 內部依角色 prop 隱藏編輯控制項的邏輯（`reservations-search.tsx`、`employee-manager.tsx`、`revenue-stats.tsx`、`monthly-schedule.tsx` 等）。
- 每個受角色限制的 `page.tsx`（server component）都呼叫 `getCurrentEmployeePosition()` 判斷是不是「管家」，再把 `isHousekeepingManager` 傳給 client component。`proxy.ts` 已經把職稱查好、透過 `x-employee-position` / `x-employee-short-name` / `x-employee-id` / `x-employee-allowed-property-ids` request header 往下傳，`lib/auth/current-employee.ts` 會先讀 header、讀不到才自己再查一次 Supabase。

## Architecture

### Supabase clients — `lib/supabase/`

| File | Key | Use |
|---|---|---|
| `client.ts` | anon / publishable (`NEXT_PUBLIC_`) | browser only, login page auth calls |
| `server.ts` | anon + RLS, cookie-bound | SSR/server components that should respect the user session |
| `service-role.ts` | secret / service_role, **bypasses RLS**, cached singleton | server actions & query layers |

**Most data access goes through the service-role client**, not RLS. The DB schema has RLS policies requiring `is_org_member(...)`, but the app never populates `organization_members` for logged-in users, so an RLS client silently returns **0 rows (no error)**. Never import `service-role.ts` into a client component. Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (also set in Vercel; `.env*` is gitignored).

### Pricing / quoting engine — `lib/pricing/`

- `calculate-package-total.ts` — pure calculation core. No I/O; the caller passes in every rate/service/room-count/holiday value. Formula: accommodation (per-night sum) + extra beds + extra rooms + pet cleaning + add-ons (BBQ/food truck/early check-in) + visitors − discount + 8% invoice tax; deposit = `floor(total * 0.3 / 1000) * 1000`.
- Three blocking warnings zero out the total (`packageTotal`/`deposit`/`roomAllocation`) and skip the full calculation: `capacityWarning` (over bed capacity), `minimumGuestsWarning` (below per-day-type base guests), `roomConfigWarning` (manual room override exceeds real room count). See the "坑" section below for the `allowBelowMinimumGuests` escape hatch.
- `day-type.ts` — classifies each night into 6 `DayType`s (`weekday`/`peak`/`holiday`/`festival`/`lunar_new_year`/`new_year_eve`). Saturday = `holiday` pricing; Fri/Sun = `peak`; `holidays` table entries win; consecutive-holiday runs get "day before" and "last day" downgraded to `peak` (with an exception when the following day is itself a weekend).
- `queries.ts` — all Supabase reads for pricing/reservations (large, ~1600 lines). `property-room-allocation.ts`, `quote-message.ts`, `reservation-message.ts` build the customer-facing text blocks.
- `app/actions/quote.ts` orchestrates: `calculateQuoteAction` (compute only) → `calculateAndSaveQuoteAction` (persists a snapshot) → `confirmReservationFromQuoteAction` (quote → reservation + room lines + items + `payments`).

### Data model notes

- `quotes` → `reservations` via `source_quote_id` (nullable; deleting a quote doesn't delete the reservation).
- Both tables store full JSON snapshots (`request_snapshot`, `quote_snapshot`). **Money is frozen in the snapshot.** Editing reservation fields (dates, room counts, guests) via `updateReservation` does **not** re-run the pricing engine — `final_total` is a manually-entered number; the UI warns to re-check it.
- `payments`: one `deposit` + one `balance` row per reservation, `direction = 'receivable'`. Overall `reservations.payment_status` and the two `payments` rows are kept aligned by a shared status map in `lib/pricing/queries.ts` (`updateReservationPaymentStatus`) and `confirmReservationFromQuoteAction`.
- Revenue (`lib/revenue/queries.ts`): a stay's total is split across calendar months **proportionally by nights** (mirrors the villa's original Google Sheet). Cancelled reservations are excluded from revenue and occupancy — **except** `payment_status = 'deposit_forfeited'` (沒收訂金), where the forfeited deposit counts as revenue for the check-in month.

### SQL migrations & generated types

- Comments reference `db/001_pms_schema.sql`, `db/006_add_bank_account_full.sql`, etc., but **no `.sql` files or `supabase/` directory are checked in** — schema lives only in the Supabase project.
- The committed Supabase generated `Database` type file is stale (predates several migrations), so `select()` strings mentioning newer columns collapse the whole query result type to `never`. Query-layer code works around this with `(supabase.from("x") as any)` casts and explicit `SupabaseClient<any, any, any>` typing. Build-time only; columns exist at runtime. Fix properly by regenerating: `npx supabase gen types typescript --project-id xinmtvzmvqlyzjalgagw`.

### Styling / PWA

- `app/manifest.ts` compiles to `/manifest.webmanifest`. `app/layout.tsx` sets Apple PWA meta tags and deliberately leaves `<body>` with **no className** — pages own their full-bleed background and centering (typically `max-w-md`, inline styles). `globals.css` intentionally omits `prefers-color-scheme: dark` (a past cause of washed-out text).
- `home-nav.tsx` uses an explicit color palette (pine `#33422E`) and `next/font` (Fraunces + Work Sans).

## 已經踩過、不要重犯的坑

- **數字輸入框**：絕對不要用 `<input type="number" value={num} onChange={(e) => setNum(Number(e.target.value))}>`，這樣要把 0 改成別的數字得先在 0 後面打字才能刪掉 0。一律用各檔案裡已經定義好的 `NumberField` 元件（內部用字串暫存 `raw` state，`onBlur` 時空字串補回 "0"）。這個 bug 在 `reservations-search.tsx` 發生過兩次，第二次是被某次编辑意外整段退回原始寫法造成的，改完一定要跑一次 `grep 'type="number"'` 確認沒有殘留。
- **Safari/iOS 剪貼簿權限**：`navigator.clipboard.write()` / `writeText()` 必須在使用者點擊的當下**同步**呼叫，中間不能先 `await` 任何非同步查詢（查資料庫、組文字），不然 Safari 會擋下權限、丟出 "The request is not allowed by the user agent..."。正確做法：把「準備內容」包成一個 async function，**不 await** 直接把這個 Promise 傳給 `ClipboardItem`（`new ClipboardItem({ "text/plain": promise.then(text => new Blob([text])) })`），讓 `clipboard.write()` 本身立刻同步執行。截圖轉圖片同理，用 `captureReceiptBlob()` 那種 clone 離屏截圖手法。
- **警告表情符號的平台差異**：`⚠`（U+26A0）不加變化選擇符（U+FE0F）的話，手機跟桌機會顯示不同樣式（一個是彩色emoji、一個是純文字外框），要統一寫成 `⚠️`（帶 U+FE0F）。
- **`calculateQuoteAction()` 的 `minimumGuestsWarning`**：只要偵測到人數低於基本入住人數，預設會直接把 `packageTotal`/`deposit`/`roomAllocation` 全部強制歸零並跳過完整計算，不是只回傳一個警告字串而已。編輯已存在的報價單需要允許「人數不足但仍要出價」（例如入住日期接近、不想讓房間空著）時，必須傳 `calculateQuoteAction(request, true)` 的第二個參數 `allowBelowMinimumGuests`，並且這個參數要一路傳到 `calculatePackageQuote()` 底層（只在呼叫端跳過檢查是不夠的，底層引擎自己也會重新判斷一次並歸零金額）。
- **報價單換民宿要清掉 `roomOverride`**（如果是「取代原本內容」的情境）：`roomOverride` 記的是換民宿前那間民宿的房型數量，帶著舊民宿的數字去新民宿計算，可能導致算出空的房型結果。但如果需求是「保留數量方便比較兩間民宿價格」，則不清空，改為依賴 `roomConfigWarning`（超過該民宿實際房間數）與 `capacityWarning`（床位數不夠住）在「重新試算並更新」時把關——這兩者都已經是拿目標民宿的實際房間/床位數字驗證，不用額外重寫。
- **`accommodationDayGroups()` 需要 `quote.messageContext`**：這個欄位只有在 `getPropertyDisplayInfo()`（查民宿名稱/匯款帳戶）成功、且沒有觸發任何 blocked warning 時才會有值，查詢失敗時是被 `.catch()` 吃掉、只在伺服器端 log 一筆錯誤，前端完全看不出來。任何用到這個函式算費用明細的地方，都要检查回傳陣列長度而不是只檢查 `quote` 是否為 null，並準備一個 fallback（例如顯示「住宿總額：$X」），避免整段空白。
- **訂單（`ReservationDetail`）沒有存逐項計價資料**：只有 `finalTotal` 一筆總額，沒有「單價×數量」明細。若要在訂單相關畫面（例如「轉成圖片」）顯示逐項費用明細，需要用 `calculateQuoteAction()` 拿訂單目前的民宿/日期/房型配置/加購項目**重新算一次**（這是「重新計算」不是「讀回原始報價」，如果訂單後來手動調過金額，例如 OTA 訂房，逐項總和可能跟 `finalTotal` 對不上——總金額本身仍然要顯示 `finalTotal`，重新算出來的 quote 只用在明細呈現）。

## 共用元件/格式規範

- `NumberField`：數字輸入框，見上方說明。各檔案（`quote-form.tsx`、`quotes-search.tsx`、`reservations-search.tsx`、`reservation-create-form.tsx`）各自有一份幾乎相同的定義，因為是各檔案內部的區域函式、無法共用 import，修改規則時要記得逐一同步。
- `PairedInfoRow`：兩個欄位並排顯示（例如入住/退房日期），同樣是各檔案各自一份定義。
- 訂房確認單／報價單的視覺格式已經統一：標題深咖啡色（`CONFIRM_DARK` #3E2B23）+ 淺焦糖強調框（`CONFIRM_LIGHT` #F1E4D3），入住/退房日期並排、預訂天數/入住人數並排，房型費用明細用 `consolidatedAccommodationGroups()` 表格對齊呈現（單價×數量×晚數＝小計，連續晚數合併），降規四人套房的括號說明文字要拆到下一行顯示（不要跟房型名稱擠在同一行）。
- 金額為 0 的欄位（小孩、嬰幼兒、寵物等）不顯示，只顯示大人數量，跟 `guestSummary()` 的邏輯保持一致。

## 通用開發習慣

- Server Action 的錯誤處理習慣用「回傳結果物件」（`{ success: boolean; message?: string }`）而不是 `throw`：正式環境下 Next.js 會把 Server Action `throw` 的錯誤訊息抹除（前端只看到 minified React error #441 的 digest），本機開發不會重現。任何錯誤訊息需要傳到使用者眼前的新 action 都要照這個模式。
- 新增/編輯/刪除訂單後，重新查詢月曆資料前先加一個約 400ms 的短暫延遲，避免緊接著資料庫寫入操作查到還沒完全反映的舊資料。

## 待辦／已知限制

- `app/revenue/page.tsx`、`app/expenses/page.tsx` 這兩個 server component wrapper 是憑既有模式重新寫的（`getCurrentEmployeePosition()` → 判斷「管家」→ 傳入 `isHousekeepingManager`），部署前建議跟本機實際檔案再比對一次。
- 2028 年及以後的節日資料尚未建立。
- 只此清綠、水景璞堤的地址/停車/導航連結尚未填入。
- 歷史訂房資料（2023/2024/2025 早期）未完全匯入；直接建立的歷史訂單在 `depositAmount` 功能加入前沒有 payments 記錄。
