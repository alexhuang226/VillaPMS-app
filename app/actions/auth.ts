"use server";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

/**
 * 登出——清掉 Supabase Auth 的 session cookie，然後導回登入頁。
 * 用 cookies() 直接操作，不是 lib/supabase/client.ts 那個瀏覽器端
 * client（那個沒辦法在 server action 裡正確處理 cookie）。
 */
export async function logoutAction() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (url && anonKey) {
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    });
    await supabase.auth.signOut();
  }

  redirect("/login");
}
