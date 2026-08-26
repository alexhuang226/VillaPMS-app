import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * 查目前登入者對應的員工職稱（管理員／管家／房務員），給 server
 * component 用來決定要不要顯示某些功能（例如首頁導覽、房務排班的
 * 月份範圍限制）。跟 middleware.ts 的角色查詢邏輯是分開寫的兩份——
 * middleware 用 request cookies，這裡用 next/headers 的 cookies()，
 * 執行環境不一樣沒辦法直接共用同一個函式，但查詢邏輯本身刻意寫成
 * 一樣的（都是查 employees.position where user_id = 目前登入者的 id）。
 *
 * 沒登入、查不到對應員工資料，都回傳 null（呼叫端要自己決定 null
 * 代表什麼權限，目前的用法是「當作不是房務員」，也就是預設看得到
 * 完整功能——這是刻意的保守選擇：查詢失敗時不應該讓一般員工突然看
 * 不到自己平常在用的功能）。
 */
export async function getCurrentEmployeePosition(): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // 這個函式只讀 session、不寫 cookie，這裡刻意留空——server
          // component 裡本來就不能寫 cookie（會噴錯），實際的 session
          // 刷新是 middleware 在做
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const serviceClient = createServiceRoleClient();
    const { data } = await (serviceClient.from("employees") as any).select("position").eq("user_id", user.id).maybeSingle();
    return (data?.position as string) ?? null;
  } catch {
    return null;
  }
}

/**
 * 查目前登入者對應的員工職稱＋簡稱，給首頁導覽顯示「目前是誰登入」
 * 用。跟上面 getCurrentEmployeePosition() 是分開的兩個函式，不是
 * 把舊函式改回傳更多欄位——避免動到其他已經在用
 * getCurrentEmployeePosition() 那幾個頁面（只需要職稱，不需要簡稱）
 * 的呼叫方式。
 */
export interface CurrentEmployeeInfo {
  position: string | null;
  shortName: string | null;
}

export async function getCurrentEmployeeInfo(): Promise<CurrentEmployeeInfo> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return { position: null, shortName: null };

  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // 見 getCurrentEmployeePosition() 的說明
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { position: null, shortName: null };

    const serviceClient = createServiceRoleClient();
    const { data } = await (serviceClient.from("employees") as any)
      .select("position, short_name")
      .eq("user_id", user.id)
      .maybeSingle();
    return {
      position: (data?.position as string) ?? null,
      shortName: (data?.short_name as string) ?? null,
    };
  } catch {
    return { position: null, shortName: null };
  }
}
