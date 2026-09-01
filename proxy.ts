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
 *   /holidays（節日設定，跟管理員權限一樣沒有限制）、變更密碼。看不到
 *   報價、應收、營收統計、房價設定、民宿資料。
 * - 管理員（以及任何職稱不是上面兩種的登入者）：不受限制。
 *
 * 用 service role client 查職稱，不透過 RLS——這裡不確定
 * employees 表的 RLS policy 有沒有開放「查自己 user_id 對應的那筆」，
 * 用 service role 直接繞過，比較不會因為 RLS 設定不如預期而讓限制
 * 失效或誤擋。
 *
 * ⚠️ 效能優化：這裡查到的職稱/簡稱，會透過 x-employee-position／
 * x-employee-short-name 這兩個 request header 往下傳給實際的頁面
 * （server component）——lib/auth/current-employee.ts 的
 * getCurrentEmployeePosition()／getCurrentEmployeeInfo() 會先看這兩個
 * header 有沒有值，有的話直接用，不用的話才自己重新查一次。原本這裡
 * 跟每個頁面各自獨立查一次職稱（等於同一個資訊、同一次請求裡查兩次
 * Supabase：一次在這裡、一次在頁面的 server component），是「點首頁
 * 按鈕後畫面偶爾卡住、查詢有點久」的主要原因之一——每次切換頁面都
 * 多一輪不必要的資料庫查詢延遲。這樣改完，正常情況下整個請求只會
 * 查一次職稱，不會查兩次。
 */
const HOUSEKEEPING_STAFF_ALLOWED_PREFIXES = ["/schedule", "/change-password", "/login"];
const HOUSEKEEPING_MANAGER_ALLOWED_PREFIXES = [
  "/schedule",
  "/reservations",
  "/employees",
  "/holidays",
  "/change-password",
  "/login",
];
/** 處理垃圾的清潔員、來收備品的洗衣公司——只能看兩個班表頁面，跟
 * 房務員的路徑限制範圍一樣，但畫面內容會被大幅簡化（見
 * monthly-schedule.tsx/today-schedule.tsx 收到 isPropertyRestricted
 * 之後的處理） */
const PROPERTY_RESTRICTED_ALLOWED_PREFIXES = ["/schedule", "/change-password", "/login"];

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
        .select("id, position, short_name, employee_property_access(property_id)")
        .eq("user_id", user.id)
        .maybeSingle();
      const employeeId = (employeeRow?.id as string | undefined) ?? "";
      const position = (employeeRow?.position as string | undefined) ?? "";
      const shortName = (employeeRow?.short_name as string | undefined) ?? "";
      const isPropertyRestricted = position === "清潔員" || position === "洗衣公司";
      const allowedPropertyIds: string[] = isPropertyRestricted
        ? ((employeeRow?.employee_property_access ?? []) as any[]).map((r) => r.property_id as string)
        : [];

      // 把查到的職稱/簡稱/員工id/可見民宿範圍寫進 request header，往下
      // 傳給實際的頁面，避免頁面自己再查一次——見上面檔案開頭的效能
      // 優化說明。
      // ⚠️ 這裡重建 supabaseResponse 時，要把「原本 supabaseResponse
      // 上可能已經有的 cookie」複製過去——上面 supabase.auth.getUser()
      // 如果剛好觸發 session token 刷新，會透過 setAll callback 把新
      // 的 cookie 寫在原本的 supabaseResponse 上；如果這裡整個重新
      // 建立一個新的 NextResponse.next() 卻沒有把這些 cookie 複製過
      // 去，會把剛刷新好的 session cookie 弄丟，導致使用者的登入
      // session 沒辦法正常延續。
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("x-employee-id", employeeId);
      requestHeaders.set("x-employee-position", position);
      requestHeaders.set("x-employee-short-name", shortName);
      requestHeaders.set("x-employee-allowed-property-ids", allowedPropertyIds.join(","));
      const responseWithHeaders = NextResponse.next({ request: { headers: requestHeaders } });
      supabaseResponse.cookies.getAll().forEach((cookie) => {
        responseWithHeaders.cookies.set(cookie.name, cookie.value);
      });
      supabaseResponse = responseWithHeaders;

      const allowedPrefixes =
        position === "房務員"
          ? HOUSEKEEPING_STAFF_ALLOWED_PREFIXES
          : position === "管家"
            ? HOUSEKEEPING_MANAGER_ALLOWED_PREFIXES
            : isPropertyRestricted
              ? PROPERTY_RESTRICTED_ALLOWED_PREFIXES
              : null;

      if (allowedPrefixes) {
        // 房務員、清潔員、洗衣公司都只需要看房務班表，首頁對他們來說
        // 只有一堆點了也進不去的按鈕，直接把根目錄也當「不允許」，
        // 逼他們一登入就被導去房務班表——管家維持原本的行為，根目錄
        // 還是允許的，不受這次改動影響（管家能用的功能比較多，首頁
        // 對他們還是有意義的）。
        const shouldRedirectRootToMonthly = position === "房務員" || isPropertyRestricted;
        const isRoot = pathname === "/" && !shouldRedirectRootToMonthly;
        const isAllowed = isRoot || allowedPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
        if (!isAllowed) {
          const redirectUrl = request.nextUrl.clone();
          // 導去房務班表（月曆檢視），不是本日班表——本日班表這個頁面
          // 之後會被移除，房務班表點進特定日期已經包含原本本日班表的
          // 所有內容
          redirectUrl.pathname = shouldRedirectRootToMonthly ? "/schedule/monthly" : "/schedule/today";
          return NextResponse.redirect(redirectUrl);
        }
      }
    } catch {
      // 查角色失敗（例如資料庫暫時連不上）不要整個擋掉登入使用者，
      // 只是這種情況下角色限制暫時不會生效、也不會設定 header（頁面
      // 那邊會偵測到 header 不存在，自動 fallback 回自己查一次）——
      // 比起讓所有人都進不去，這個折衷風險比較小
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
