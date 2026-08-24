import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * 全站登入保護（第一階段的權限控管）。
 *
 * 除了 /login 本身跟幾個公開的靜態資源（PWA manifest／icon），其他
 * 所有路徑都需要先登入才能進去，沒登入會被導向 /login；已經登入的
 * 人再跑去 /login 則會被導回首頁。
 *
 * ⚠️ 這是「第一階段」——目前只分「有沒有登入」，不分角色，管理員／
 * 管家／房務員登入後看到的功能完全一樣。之後如果要做更細的角色
 * 權限（例如房務員只能看自己的班表），要在這裡或個別頁面/action
 * 再加判斷條件，那部分還沒做。
 */
export async function middleware(request: NextRequest) {
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

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * 排除 Next.js 內部的靜態資源路徑（_next/static、_next/image），
     * 其他路徑都要經過這個 middleware 檢查
     */
    "/((?!_next/static|_next/image).*)",
  ],
};
