import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * 查目前登入者對應的員工職稱（管理員／管家／房務員），給 server
 * component 用來決定要不要顯示某些功能（例如首頁導覽、房務排班的
 * 月份範圍限制）。
 *
 * ⚠️ 效能優化：proxy.ts 在每個請求進來時，本來就已經查過一次同一個
 * 資訊（用來判斷這個角色能不能存取這個路徑），並且把結果寫進
 * x-employee-position／x-employee-short-name 這兩個 request header
 * 往下傳。這裡優先直接讀這兩個 header，讀得到的話完全不用再連一次
 * Supabase——避免同一個請求裡查兩次一模一樣的資料庫資料。
 *
 * 只有在 header 真的不存在時（理論上不該發生，除非 proxy.ts 的
 * matcher 設定被改到不涵蓋這個路徑，或本機開發環境某些情況下
 * middleware 沒有正常執行過），才 fallback 回自己重新查一次，確保
 * 這個函式在任何情況下都還是能正確運作，不會因為拿不到 header 就
 * 整個掛掉。
 *
 * 沒登入、查不到對應員工資料，都回傳 null（呼叫端要自己決定 null
 * 代表什麼權限，目前的用法是「當作不是房務員」，也就是預設看得到
 * 完整功能——這是刻意的保守選擇：查詢失敗時不應該讓一般員工突然看
 * 不到自己平常在用的功能）。
 */
export async function getCurrentEmployeePosition(): Promise<string | null> {
  const headerStore = await headers();
  const headerPosition = headerStore.get("x-employee-position");
  if (headerPosition !== null) {
    return headerPosition || null;
  }

  return getCurrentEmployeePositionUncached();
}

async function getCurrentEmployeePositionUncached(): Promise<string | null> {
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
 * 的呼叫方式。一樣優先讀 proxy.ts 寫入的 request header，見上面
 * getCurrentEmployeePosition() 的效能優化說明。
 */
export interface CurrentEmployeeInfo {
  position: string | null;
  shortName: string | null;
}

export async function getCurrentEmployeeInfo(): Promise<CurrentEmployeeInfo> {
  const headerStore = await headers();
  const headerPosition = headerStore.get("x-employee-position");
  const headerShortName = headerStore.get("x-employee-short-name");
  if (headerPosition !== null) {
    return { position: headerPosition || null, shortName: headerShortName || null };
  }

  return getCurrentEmployeeInfoUncached();
}

async function getCurrentEmployeeInfoUncached(): Promise<CurrentEmployeeInfo> {
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
