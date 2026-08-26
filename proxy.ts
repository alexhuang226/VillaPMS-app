import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * 全站登入保護 ＋ 角色限制（房務員／管家兩種）。
 *
 * ⚠️ 這個檔案原本叫 middleware.ts，Next.js 16 把這個檔案慣例改名成
 * proxy.ts（middleware.ts 被標記為 deprecated），對應的匯出函式也要
 * 從 `middleware` 改成 `proxy`，否則檔案會被直接忽略、不會執行——
 * 而且是「沒有任何錯誤或警告」地被忽略：整個登入保護、角色限制會
 * 悄悄失效，所有頁面變成任何人都能直接存取，卻不會有任何錯誤訊息
 * 提示你發生了這件事。這個檔案已經照新規範命名/改好，不要再改回
 * middleware.ts / export function middleware()。
 *
 * 登入保護：除了 /login 本身跟幾個公開的靜態資源（PWA
 * manifest／icon），其他所有路徑都需要先登入才能進去，沒登入會被
 * 導向 /login；已經登入的人再跑去 /login 則會被導回首頁。
 *
 * 角色限制（頁面層級，只能整頁允許/擋掉，沒辦法在這裡做「同一頁
 * 但唯讀」這種更細的區分——那部分是 reservations-search.tsx／
 * employee-manager.tsx 元件內部自己根據角色 prop 決定要不要顯示
 * 編輯用的按鈕，這裡負責的是「這個角色能不能進到這個路徑」）：
 *
 * - 房務員：只能進首頁、/schedule 底下（本日班表／房務班表，且
 *   房務班表是唯讀，見 monthly-schedule.tsx／today-schedule.tsx）、
 *   變更密碼。
 * - 管家：首頁、/schedule（可以排班，不是唯讀）、/reservations
 *   （唯讀、金額隱藏，見 reservations-search.tsx）、/employees
 *   （只能新增房務人員、改房務人員在職狀態，見 employee-manager.tsx）、
 *   變更密碼。看不到報價、應收、營收統計、民宿資料。
 * - 管理員（以及任何職稱不是上面兩種的登入者）：不受限制。
 *
 * 用 service role client 查職稱，不透過 RLS——這裡不確定
 * employees 表的 RLS policy 有沒有開放「查自己 user_id 對應的那筆」，
 * 用 service role 直接繞過，比較不會因為 RLS 設定不如預期而讓限制
 * 失效或誤擋。
 */
const HOUSEKEEPING_STAFF_ALLOWED_PREFIXES = ["/schedule", "/change-password", "/login"];
const HOUSEKEEPING_MANAGER_ALLOWED_PREFIXES = ["/schedule", "/reservations", "/employees", "/change-password", "/login"];

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // 環境變數沒設定的話，不擋任何請求——避免設定漏掉時整個網站
    // 直接打不開、連除錯都沒辦法，讓實際的頁面/action 自己去報缺少
    // 環境變數的錯誤（跟 service-role.ts 的處理方式一致）
    return supabaseResponse;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublicPath =
    pathname === "/login" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/favicon.ico" ||
    /\.(png|jpg|jpeg|svg|ico)$/.test(pathname);

  if (!user && !isPublicPath) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    return NextResponse.redirect(redirectUrl);
  }

  if (user && pathname === "/login") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/";
    return NextResponse.redirect(redirectUrl);
  }

  if (user && !isPublicPath) {
    try {
      const serviceClient = createServiceRoleClient();
      const { data: employeeRow } = await (serviceClient.from("employees") as any)
        .select("position")
        .eq("user_id", user.id)
        .maybeSingle();
      const position = employeeRow?.position as string | undefined;
      const allowedPrefixes =
        position === "房務員"
          ? HOUSEKEEPING_STAFF_ALLOWED_PREFIXES
          : position === "管家"
            ? HOUSEKEEPING_MANAGER_ALLOWED_PREFIXES
            : null;

      if (allowedPrefixes) {
        const isRoot = pathname === "/";
        const isAllowed = isRoot || allowedPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
        if (!isAllowed) {
          const redirectUrl = request.nextUrl.clone();
          redirectUrl.pathname = "/schedule/today";
          return NextResponse.redirect(redirectUrl);
        }
      }
    } catch {
      // 查角色失敗（例如資料庫暫時連不上）不要整個擋掉登入使用者，
      // 只是這種情況下角色限制暫時不會生效——比起讓所有人都進不去，
      // 這個折衷風險比較小
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * 排除 Next.js 內部的靜態資源路徑（_next/static、_next/image），
     * 其他路徑都要經過這個 proxy 檢查
     */
    "/((?!_next/static|_next/image).*)",
  ],
};
