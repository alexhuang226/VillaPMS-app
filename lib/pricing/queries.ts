/**
 * Supabase 資料查詢層
 *
 * 這裡用的是 lib/supabase/service-role.ts 的 createServiceRoleClient()，
 * 不是一般帶 RLS 的 client——原因跟完整說明都寫在那個檔案裡：報價引擎
 * 讀取的房型/價格/服務/房間數量這些資料，不應該因為「現在有沒有人
 * 用 Supabase Auth 登入」而查不到，這裡的每個函式都只會在 server
 * action（伺服器端）被呼叫，不會暴露給瀏覽器。
 */

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { roomAllocationSummaryItems } from "./quote-message";
import type {
  BankInfo,
  DayType,
  FlatServicePrices,
  NightlyRateTable,
  PriceCategory,
  PropertyCode,
  PropertyRoomCounts,
} from "./types";
import type { HolidayCategory, HolidayMap } from "./day-type";

/** 依 property code 取得 property_id（可自行加上快取層） */
export async function getPropertyId(propertyCode: PropertyCode): Promise<string> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("properties")
    .select("id")
    .eq("code", propertyCode)
    .single();

  if (error || !data) {
    throw new Error(`找不到民宿代碼 ${propertyCode}：${error?.message ?? "no data"}`);
  }
  return data.id as string;
}

/**
 * 取得某民宿在指定價格分類（regular/holiday/festival/lunar_new_year/
 * new_year_eve）下，各房型配置的每晚價格。
 *
 * regular 對應資料庫的 weekday 或 peak day_type（兩者價格必然相同，
 * 取其中一筆即可，這裡固定查 weekday）。
 */
export async function getNightlyRateTable(
  propertyId: string,
  priceCategory: PriceCategory
): Promise<NightlyRateTable> {
  const supabase = createServiceRoleClient();
  // priceCategory 現在直接對應資料庫的 day_type 值，不需要再把
  // "regular" 特別轉成 "weekday"——weekday/peak 已經是各自獨立的
  // 分類，不會再互相覆蓋（見 day-type.ts toPriceCategory 的說明）
  const dbDayType = priceCategory;

  const table: NightlyRateTable = {
    fourPersonSuite: 0,
    downgradeDoubleSuite: 0,
    doubleSuite: 0,
    doublePlain: 0,
  };

  // 分兩步查，不要用一次查詢裡「透過兩層關聯表過濾」的巢狀 filter
  // （原本這裡是 .eq("rate_rules.rate_plans.property_id", ...) 這種
  // 雙層巢狀寫法）——那種寫法在 PostgREST／supabase-js 上不夠可靠，
  // 平日／假日這種天天都會用到的分類剛好每次都能查到資料所以沒被
  // 發現，但節日／跨年／春節在 2026 年節日資料匯入之前，從來沒有
  // 真正被觸發過這段查詢，所以這個問題一直沒被抓到。跟
  // lib/pricing/rate-editor.ts 用的是同一種穩妥、已經驗證過可以正常
  // 運作的兩段式查詢寫法。
  const { data: ruleData, error: ruleError } = await supabase
    .from("rate_rules")
    .select("id, rate_plans!inner(property_id)")
    .eq("day_type", dbDayType)
    .eq("rate_plans.property_id", propertyId)
    .maybeSingle();

  if (ruleError) {
    throw new Error(`查詢定價規則失敗：${ruleError.message}`);
  }
  if (!ruleData) return table;

  const { data: tiersData, error: tiersError } = await supabase
    .from("rate_rule_tiers")
    .select("amount, config_label")
    .eq("tier_type", "room_type_rate")
    .eq("rate_rule_id", (ruleData as any).id);

  if (tiersError) {
    throw new Error(`查詢每晚房價失敗：${tiersError.message}`);
  }

  for (const row of (tiersData ?? []) as any[]) {
    const amount = Number(row.amount);
    switch (row.config_label) {
      case "四人套房":
        table.fourPersonSuite = amount;
        break;
      case "降規雙人套房":
        table.downgradeDoubleSuite = amount;
        break;
      case "雙人套房":
        table.doubleSuite = amount;
        break;
      case "雙人雅房":
        table.doublePlain = amount;
        break;
    }
  }

  return table;
}

/** 取得某民宿的固定加購服務價格（加床／加房／寵物清潔／烤肉／餐車／提前入住／訪客） */
export async function getFlatServicePrices(propertyId: string): Promise<FlatServicePrices> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("services")
    .select("code, default_price")
    .eq("property_id", propertyId);

  if (error) {
    throw new Error(`查詢加購服務價格失敗：${error.message}`);
  }

  // 暫時的除錯 log：直接印出 Supabase 實際回傳的原始內容，跟查到的
  // propertyId，方便對照「SQL Editor 直接查到的資料」跟「app 透過
  // service role client 查到的資料」是不是真的一致。問題排除後可以
  // 把這行刪掉。本地執行 `next dev` 會直接印在終端機；部署在 Vercel
  // 的話要去 Vercel Dashboard → 專案 → Deployments → 對應的部署 →
  // Runtime Logs 看。
  console.log("[getFlatServicePrices] propertyId =", propertyId);
  console.log("[getFlatServicePrices] raw data =", JSON.stringify(data));

  const priceByCode = new Map<string, number>();
  for (const row of data ?? []) {
    priceByCode.set(row.code as string, Number(row.default_price));
  }

  const result: FlatServicePrices = {
    extraBedFixed: priceByCode.get("extra_bed_fixed") ?? 0,
    extraBedTemp: priceByCode.get("extra_bed_temp") ?? 0,
    extraRoom: priceByCode.get("extra_room") ?? 0,
    petCleaning: priceByCode.get("pet_cleaning") ?? 0,
    bbq: priceByCode.get("bbq") ?? 0,
    foodTruck: priceByCode.get("food_truck") ?? 0,
    earlyCheckin: priceByCode.get("early_checkin") ?? 0,
    visitor: priceByCode.get("visitor") ?? 0,
  };

  console.log("[getFlatServicePrices] result =", JSON.stringify(result));

  return result;
}

/**
 * 取得該民宿的固定房型數量（獨立雙人套房／雙人雅房實際房間數，
 * 以及免費寵物數量上限）。四人套房實體房間總數目前的計價公式不需要
 * 直接使用（allocateFourPersonRooms 已經內建各民宿的房間總數），
 * 但仍一併回傳方便前端顯示或做人數上限校驗。
 */
export async function getPropertyRoomCounts(propertyId: string): Promise<PropertyRoomCounts> {
  const supabase = createServiceRoleClient();

  const [{ data: roomRows, error: roomError }, { data: propRow, error: propError }] =
    await Promise.all([
      supabase
        .from("rooms")
        .select("room_types(name)")
        .eq("property_id", propertyId),
      supabase
        .from("properties")
        .select("free_pet_allowance")
        .eq("id", propertyId)
        .single(),
    ]);

  if (roomError) throw new Error(`查詢房間數量失敗：${roomError.message}`);
  if (propError || !propRow) throw new Error(`查詢免費寵物數量失敗：${propError?.message}`);

  let fourPersonSuiteTotal = 0;
  let doubleSuiteCount = 0;
  let doublePlainCount = 0;

  for (const row of roomRows ?? []) {
    const typeName = (row as any).room_types?.name as string | undefined;
    if (typeName === "四人套房") fourPersonSuiteTotal += 1;
    else if (typeName === "雙人套房") doubleSuiteCount += 1;
    else if (typeName === "雙人雅房") doublePlainCount += 1;
  }

  return {
    fourPersonSuiteTotal,
    doubleSuiteCount,
    doublePlainCount,
    freePetAllowance: Number(propRow.free_pet_allowance),
  };
}

/**
 * 取得該民宿各 day_type 的「包棟基本人數」（rate_rules.base_guests）。
 * 對應原始 Excel 的「平日/旺日/節假日包棟基本人數」欄位——假日/節日/
 * 春節/跨年 4 個分類在匯入時共用同一個「節假日基本人數」值。
 * 用於報價前檢查：入住人數不足基本人數時不允許產生報價。
 */
export async function getBaseGuestsByDayType(
  propertyId: string
): Promise<Record<DayType, number>> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("rate_rules")
    .select("day_type, base_guests, rate_plans!inner(property_id)")
    .eq("rate_plans.property_id", propertyId);

  if (error) {
    throw new Error(`查詢包棟基本人數失敗：${error.message}`);
  }

  const result: Record<DayType, number> = {
    weekday: 0,
    peak: 0,
    holiday: 0,
    festival: 0,
    lunar_new_year: 0,
    new_year_eve: 0,
  };

  for (const row of data ?? []) {
    result[row.day_type as DayType] = Number(row.base_guests);
  }

  return result;
}

/**
 * 取得節日清單對照表（holidays 表），組織自訂清單優先於全平台共用清單。
 * @param organizationId 若為 null，只取全平台共用清單（organization_id is null）
 */
export async function getHolidayMap(organizationId: string | null): Promise<HolidayMap> {
  const supabase = createServiceRoleClient();
  let query = supabase.from("holidays").select("holiday_date, day_type");

  query = organizationId
    ? query.or(`organization_id.eq.${organizationId},organization_id.is.null`)
    : query.is("organization_id", null);

  const { data, error } = await query;
  if (error) throw new Error(`查詢節日清單失敗：${error.message}`);

  const map: HolidayMap = new Map();
  for (const row of data ?? []) {
    const dt = row.day_type as string;
    if (dt === "holiday" || dt === "festival" || dt === "lunar_new_year" || dt === "new_year_eve") {
      map.set(row.holiday_date as string, dt as HolidayCategory);
    }
  }
  return map;
}

/**
 * 取得民宿顯示名稱與匯款帳戶資訊，只用於組成客人版報價訊息
 * （見 quote-message.ts 的 buildQuoteMessage），不影響金額計算。
 *
 * 帳號欄位優先讀 bank_account_full（完整帳號，見
 * db/006_add_bank_account_full.sql）；如果還沒補這個欄位，退回讀
 * bank_account_masked（遮罩版本）並在畫面上加註提醒，避免直接
 * 把不完整的帳號拿去給客人匯款。
 */
export async function getPropertyDisplayInfo(
  propertyId: string
): Promise<{ name: string; bank: BankInfo | null }> {
  const supabase = createServiceRoleClient();

  const [{ data: propRowData, error: propError }, { data: settingsRowData, error: settingsError }] =
    await Promise.all([
      supabase.from("properties").select("name").eq("id", propertyId).single(),
      supabase
        .from("property_settings")
        .select("bank_name, bank_branch, bank_account_full, bank_account_masked, account_name")
        .eq("property_id", propertyId)
        .maybeSingle(),
    ]);

  if (propError || !propRowData) {
    throw new Error(`查詢民宿名稱失敗：${propError?.message ?? "no data"}`);
  }
  if (settingsError) {
    throw new Error(`查詢民宿匯款資訊失敗：${settingsError.message}`);
  }

  // 型別檢查繞過：見 getReservationDetail 裡 `as any` 的說明
  const propRow = propRowData as any;
  const settingsRow = settingsRowData as any;

  const accountNumber = settingsRow?.bank_account_full ?? settingsRow?.bank_account_masked ?? "";
  const bank: BankInfo | null = settingsRow
    ? {
        name: settingsRow.bank_name ?? "",
        branch: settingsRow.bank_branch ?? "",
        accountNumber:
          settingsRow.bank_account_full != null
            ? accountNumber
            : `${accountNumber}（⚠️ 尚未設定完整帳號，這是遮罩版本，請先執行 006_add_bank_account_full.sql 並補上真實帳號）`,
        accountName: settingsRow.account_name ?? "",
      }
    : null;

  return { name: propRow.name as string, bank };
}

/**
 * 這個系統目前只有單一組織，直接抓第一筆 organizations 記錄當作
 * 「唯一組織」使用。如果之後變成多組織架構，這裡要改成明確傳入或
 * 從登入者身份推導 organization_id，不能再假設只有一筆。
 */
export async function getSingleOrganizationId(): Promise<string> {
  const supabase = createServiceRoleClient();
  const { data: org, error } = await supabase.from("organizations").select("id").limit(1).maybeSingle();
  if (error || !org) {
    throw new Error(`查詢組織資料失敗：${error?.message ?? "找不到組織"}`);
  }
  return org.id as string;
}

/**
 * 依電話號碼找客人，找不到就建立一筆新的。用電話當作辨識依據（同一位
 * 客人下次來訂房，電話一樣就會歸到同一筆 guests 記錄，報價紀錄查詢
 * 時才能正確歸戶）。目前系統只有單一組織，直接抓第一筆 organizations
 * 記錄；如果之後變成多組織架構，這裡要改成明確傳入 organization_id。
 *
 * 電話是選填的（確認訂房畫面不強制填）：如果沒填電話，就不做「依
 * 電話查找」這一步，直接建立一筆新客人——避免好幾位沒留電話的不同
 * 客人，因為都符合 `phone = ''` 這個查詢條件而被誤判成同一個人。
 */
export async function findOrCreateGuest(params: { name: string; phone: string }): Promise<string> {
  const supabase = createServiceRoleClient();
  const phone = params.phone.trim();

  if (phone) {
    const { data: existing, error: findError } = await supabase
      .from("guests")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();

    if (findError) {
      throw new Error(`查詢客人資料失敗：${findError.message}`);
    }
    if (existing) {
      return existing.id as string;
    }
  }

  const organizationId = await getSingleOrganizationId();

  const { data: created, error: createError } = await supabase
    .from("guests")
    .insert({ organization_id: organizationId, name: params.name, phone: phone || null })
    .select("id")
    .single();

  if (createError || !created) {
    throw new Error(`建立客人資料失敗：${createError?.message}`);
  }
  return created.id as string;
}

/** 報價紀錄列表用的精簡摘要 */
export interface QuoteSummary {
  id: string;
  quoteNo: string;
  guestName: string;
  guestPhone: string | null;
  propertyName: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  /** 房型配置摘要文字，例如「1 間四人套房、4 間降規四人套房」，從 quote_snapshot 算出來的 */
  roomSummary: string;
  totalAmount: number;
  status: string;
  createdAt: string;
}

/**
 * 查詢最近的報價紀錄。
 * - checkInDate：有給的話直接在資料庫層篩「入住日期＝這天」，這是
 *   最常用的查法（櫃檯通常記得客人問的是哪天，不會記得一長串報價
 *   單編號）
 * - search：客人姓名／電話／報價單編號的文字比對，用在還想用姓名/
 *   編號進一步縮小範圍的時候；沒有 checkInDate 時，就在最近 100 筆
 *   裡面用 JS 過濾——現階段三間民宿的量不大，這樣做最簡單，量大到
 *   需要伺服器端搜尋分頁時再改寫。
 */
/**
 * 給報價記錄查詢頁面的月曆用——查這個月哪些日期已經有報價單（不分
 * 狀態，草稿/已送出/已確認都算，讓職員一眼就看得出哪幾天已經有人
 * 問過），畫面上會把這些日期的格子填色。只查日期欄位，不查整筆
 * 報價內容，比 listRecentQuotes 精簡很多。
 */
export async function getQuoteCheckInDatesInRange(startDate: string, endDateExclusive: string): Promise<string[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("quotes")
    .select("check_in")
    .gte("check_in", startDate)
    .lt("check_in", endDateExclusive);

  if (error) {
    throw new Error(`查詢報價日期失敗：${error.message}`);
  }
  return Array.from(new Set(((data ?? []) as any[]).map((row) => row.check_in as string)));
}

/**
 * 刪除單一一張報價單——用於「報價記錄查詢」頁面，職員手動清掉重複/
 * 過時的個別報價（例如同一組客人因為調整需求，前後產生了好幾張
 * 報價，只想留最後定案的那張）。
 *
 * 不管報價單狀態是什麼都能刪，包含已確認訂房(accepted)的——
 * reservations.source_quote_id 參照到報價單，刪除時會自動變成
 * null（不會連 reservations 一起砍掉），已確認訂房的正式記錄本身
 * 不受影響，只是往回追溯到原始報價單的關聯會斷掉。是否要提醒
 * 使用者這一點，由呼叫端（quotes-search.tsx）決定要不要在刪除前
 * 顯示額外警示文字。
 */
export async function deleteQuote(quoteId: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("quotes").delete().eq("id", quoteId);
  if (error) {
    throw new Error(`刪除報價單失敗：${error.message}`);
  }
}

export async function listRecentQuotes(params?: { search?: string; checkInDate?: string }): Promise<QuoteSummary[]> {
  const supabase = createServiceRoleClient();

  let query = supabase
    .from("quotes")
    .select(
      "id, quote_no, check_in, check_out, adults, children, total_amount, status, created_at, quote_snapshot, guests(name, phone), properties(name)"
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (params?.checkInDate) {
    query = query.eq("check_in", params.checkInDate);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`查詢報價紀錄失敗：${error.message}`);
  }

  const rows: QuoteSummary[] = (data ?? []).map((row: any) => {
    const allocation = row.quote_snapshot?.roomAllocation as
      | { fourPersonSuiteCount: number; fourPersonDowngradeCount: number; doubleSuiteCount: number; doublePlainCount: number }
      | null
      | undefined;
    const roomSummary = allocation
      ? roomAllocationSummaryItems(allocation)
          .map((item) => item.text)
          .join("、")
      : "";

    return {
      id: row.id as string,
      quoteNo: row.quote_no as string,
      guestName: (row.guests?.name as string) ?? "",
      guestPhone: (row.guests?.phone as string) ?? null,
      propertyName: (row.properties?.name as string) ?? "",
      checkIn: row.check_in as string,
      checkOut: row.check_out as string,
      adults: Number(row.adults ?? 0),
      children: Number(row.children ?? 0),
      roomSummary,
      totalAmount: Number(row.total_amount),
      status: row.status as string,
      createdAt: row.created_at as string,
    };
  });

  const search = params?.search;
  if (!search || !search.trim()) return rows;

  const term = search.trim().toLowerCase();
  return rows.filter(
    (r) =>
      r.guestName.toLowerCase().includes(term) ||
      (r.guestPhone ?? "").includes(term) ||
      r.quoteNo.toLowerCase().includes(term)
  );
}

/** 讀回單一報價單的完整快照，供檢視或轉為訂房確認用 */
export async function getQuoteSnapshot(quoteId: string): Promise<{
  quote: Record<string, unknown>;
  request: Record<string, unknown>;
  status: string;
  propertyId: string;
  guestId: string;
  createdAt: string;
} | null> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("quotes")
    .select("quote_snapshot, request_snapshot, status, property_id, guest_id, created_at")
    .eq("id", quoteId)
    .maybeSingle();

  if (error) {
    throw new Error(`查詢報價單失敗：${error.message}`);
  }
  // 型別檢查繞過：見 getReservationDetail 裡 `as any` 的說明
  const row = data as any;
  if (!row || !row.quote_snapshot || !row.request_snapshot) return null;

  return {
    quote: row.quote_snapshot as Record<string, unknown>,
    request: row.request_snapshot as Record<string, unknown>,
    status: row.status as string,
    propertyId: row.property_id as string,
    guestId: row.guest_id as string,
    createdAt: row.created_at as string,
  };
}

/** 房號選項，給「加臨時床要放哪間房」的選單用 */
export interface ExtraBedRoomOption {
  id: string;
  code: string;
}

/**
 * 查某民宿裡「可以加床」的房間列表（rooms.allows_extra_bed = true）。
 * 訂房確認時要具體指定加臨時床放在哪個房號，方便房務人員知道要準備
 * 哪間房。
 */
export async function getExtraBedEligibleRooms(propertyId: string): Promise<ExtraBedRoomOption[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("rooms")
    .select("id, code")
    .eq("property_id", propertyId)
    .eq("allows_extra_bed", true)
    .order("code");

  if (error) {
    throw new Error(`查詢可加床房間失敗：${error.message}`);
  }
  return (data ?? []).map((row) => ({ id: row.id as string, code: row.code as string }));
}

/** 查一張已確認訂房的報價單，實際轉出來的訂房編號是什麼 */
export async function getReservationNoByQuoteId(quoteId: string): Promise<string | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("reservations")
    .select("reservation_no")
    .eq("source_quote_id", quoteId)
    .maybeSingle();

  if (error) {
    throw new Error(`查詢訂房記錄失敗：${error.message}`);
  }
  return (data?.reservation_no as string) ?? null;
}

/** 跟上面 getReservationNoByQuoteId 查的是同一筆資料，這個另外多回傳
 * id——複製訂房確認內容/轉圖片需要用 id 去查完整訂單詳情，只回傳
 * reservation_no 不夠用。刻意寫成新函式，不直接改上面那個舊函式的
 * 回傳型別，避免影響其他已經在用它、只需要 reservation_no 的地方。 */
export async function getReservationByQuoteId(quoteId: string): Promise<{ id: string; reservationNo: string } | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("reservations")
    .select("id, reservation_no")
    .eq("source_quote_id", quoteId)
    .maybeSingle();

  if (error) {
    throw new Error(`查詢訂房記錄失敗：${error.message}`);
  }
  if (!data) return null;
  return { id: (data as any).id as string, reservationNo: (data as any).reservation_no as string };
}

/** 查詢訂單列表用的精簡摘要 */
export interface ReservationSummary {
  id: string;
  reservationNo: string;
  guestName: string;
  guestPhone: string | null;
  propertyName: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  finalTotal: number;
  status: string;
  bookingSource: string;
  createdAt: string;
}

/**
 * 查詢訂單（reservations），依入住日期（資料庫層精準比對，最常用）
 * 或姓名／電話／訂房單編號（文字比對）搜尋，都留空回傳最近 100 筆。
 */
export async function listReservations(params?: {
  search?: string;
  checkInDate?: string;
}): Promise<ReservationSummary[]> {
  const supabase = createServiceRoleClient();

  let query = supabase
    .from("reservations")
    .select(
      "id, reservation_no, check_in, check_out, adults, children, final_total, status, booking_source, created_at, guests(name, phone), properties(name)"
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (params?.checkInDate) {
    query = query.eq("check_in", params.checkInDate);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`查詢訂單失敗：${error.message}`);
  }

  const rows: ReservationSummary[] = (data ?? []).map((row: any) => ({
    id: row.id as string,
    reservationNo: row.reservation_no as string,
    guestName: (row.guests?.name as string) ?? "",
    guestPhone: (row.guests?.phone as string) ?? null,
    propertyName: (row.properties?.name as string) ?? "",
    checkIn: row.check_in as string,
    checkOut: row.check_out as string,
    adults: Number(row.adults ?? 0),
    children: Number(row.children ?? 0),
    finalTotal: Number(row.final_total),
    status: row.status as string,
    bookingSource: row.booking_source as string,
    createdAt: row.created_at as string,
  }));

  const search = params?.search;
  if (!search || !search.trim()) return rows;

  const term = search.trim().toLowerCase();
  return rows.filter(
    (r) =>
      r.guestName.toLowerCase().includes(term) ||
      (r.guestPhone ?? "").includes(term) ||
      r.reservationNo.toLowerCase().includes(term)
  );
}

/** 訂單詳細內容：房型明細、加購項目、付款狀態都一起撈出來 */
export interface ReservationDetail {
  id: string;
  reservationNo: string;
  guestName: string;
  guestPhone: string | null;
  propertyId: string;
  /** 民宿代碼（zhici/moyin/shuijing），編輯訂單時查加床房號選項要用 */
  propertyCode: string;
  propertyName: string;
  propertyAddress: string | null;
  parkingInfo: string | null;
  mapUrl: string | null;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  infants: number;
  pets: number;
  visitors: number;
  finalTotal: number;
  status: string;
  paymentStatus: string;
  bookingSource: string;
  needsInvoice: boolean;
  invoiceTitle: string | null;
  invoiceTaxId: string | null;
  /** 結構化的房型數量，訂房確認單的「房型配置」（見
   * lib/pricing/reservation-message.ts 的 confirmationRoomAllocationLines）
   * 跟報價單各自有一套格式化邏輯，故意不共用同一個函式——兩邊的
   * 房型順序/文字格式本來就不一樣，見那個檔案開頭的說明 */
  roomAllocation: {
    fourPersonSuiteCount: number;
    fourPersonDowngradeCount: number;
    doubleSuiteCount: number;
    doublePlainCount: number;
  };
  roomLines: { quantity: number; notes: string | null }[];
  items: { itemType: string; description: string; quantity: number; amount: number; notes: string | null }[];
  payments: { paymentKind: string; amount: number; status: string; dueDate: string | null; paidAt: string | null }[];
}

export async function getReservationDetail(reservationId: string): Promise<ReservationDetail | null> {
  const supabase = createServiceRoleClient();

  const { data: rowData, error } = await supabase
    .from("reservations")
    .select(
      "id, reservation_no, property_id, check_in, check_out, adults, children, infants, pets, visitors, final_total, status, payment_status, booking_source, needs_invoice, invoice_title, invoice_tax_id, four_person_suite_count, four_person_downgrade_count, double_suite_count, double_plain_count, guests(name, phone), properties(code, name, property_settings(address, parking_info, map_url))"
    )
    .eq("id", reservationId)
    .maybeSingle();

  if (error) {
    throw new Error(`查詢訂單詳細內容失敗：${error.message}`);
  }
  if (!rowData) return null;

  // Vercel 上 `next build` 會跑完整的 tsc 型別檢查（本機 next dev 不會
  // 這麼嚴格），這裡整段用 any——專案裡有一份產生好的 Supabase
  // Database 型別檔案，是在 010/012 這兩次 migration（新增
  // booking_source 以外的發票/房型數量欄位）之前產生的，還不知道這些
  // 欄位存在，導致 select() 字串裡只要有一個型別檔案不認得的欄位，
  // supabase-js 整個查詢結果的型別推論就會整組垮成 never。這是編譯期
  // 的型別檢查問題，不是執行期的資料問題（資料庫欄位都在，值都對），
  // 用 any 繞過型別檢查即可解決建置失敗；真正根治的做法是重新產生
  // 那份型別檔案（例如執行 `npx supabase gen types typescript
  // --project-id 你的專案ID > 型別檔案路徑`，把它更新成包含最新的
  // schema），這裡沒辦法直接幫你執行。
  const row = rowData as any;

  const [{ data: roomLinesData }, { data: itemsData }, { data: paymentsData }] = await Promise.all([
    supabase.from("reservation_room_lines").select("quantity, notes").eq("reservation_id", reservationId),
    supabase.from("reservation_items").select("item_type, description, quantity, amount, notes").eq("reservation_id", reservationId),
    supabase
      .from("payments")
      .select("payment_kind, amount, status, due_date, paid_at")
      .eq("reservation_id", reservationId)
      .order("due_date"),
  ]);

  const propertySettings = row.properties?.property_settings;
  // Supabase 對一對一關聯有時候會回陣列有時候回物件，視實際外鍵設定而定，兩種都處理
  const settingsRow = Array.isArray(propertySettings) ? propertySettings[0] : propertySettings;

  return {
    id: row.id as string,
    reservationNo: row.reservation_no as string,
    guestName: (row.guests?.name as string) ?? "",
    guestPhone: (row.guests?.phone as string) ?? null,
    propertyId: row.property_id as string,
    propertyCode: (row.properties?.code as string) ?? "",
    propertyName: (row.properties?.name as string) ?? "",
    propertyAddress: (settingsRow?.address as string) ?? null,
    parkingInfo: (settingsRow?.parking_info as string) ?? null,
    mapUrl: (settingsRow?.map_url as string) ?? null,
    checkIn: row.check_in as string,
    checkOut: row.check_out as string,
    adults: Number(row.adults ?? 0),
    children: Number(row.children ?? 0),
    infants: Number(row.infants ?? 0),
    pets: Number(row.pets ?? 0),
    visitors: Number(row.visitors ?? 0),
    finalTotal: Number(row.final_total),
    status: row.status as string,
    paymentStatus: (row.payment_status as string) ?? "pending_deposit",
    bookingSource: row.booking_source as string,
    needsInvoice: Boolean(row.needs_invoice),
    invoiceTitle: (row.invoice_title as string) ?? null,
    invoiceTaxId: (row.invoice_tax_id as string) ?? null,
    roomAllocation: {
      fourPersonSuiteCount: Number(row.four_person_suite_count ?? 0),
      fourPersonDowngradeCount: Number(row.four_person_downgrade_count ?? 0),
      doubleSuiteCount: Number(row.double_suite_count ?? 0),
      doublePlainCount: Number(row.double_plain_count ?? 0),
    },
    roomLines: (roomLinesData ?? []).map((r: any) => ({ quantity: Number(r.quantity), notes: r.notes ?? null })),
    items: (itemsData ?? []).map((r: any) => ({
      itemType: r.item_type as string,
      description: r.description as string,
      quantity: Number(r.quantity ?? 1),
      amount: Number(r.amount),
      notes: r.notes ?? null,
    })),
    payments: (paymentsData ?? []).map((r: any) => ({
      paymentKind: r.payment_kind as string,
      amount: Number(r.amount),
      status: r.status as string,
      dueDate: r.due_date ?? null,
      paidAt: r.paid_at ?? null,
    })),
  };
}

/** 應收款列表用的精簡摘要（未收的訂金/尾款） */
export interface ReceivableSummary {
  paymentId: string;
  reservationId: string;
  reservationNo: string;
  guestName: string;
  guestPhone: string | null;
  propertyName: string;
  checkIn: string;
  paymentKind: string;
  amount: number;
  dueDate: string | null;
}

/**
 * 查詢還沒收到的款項（payments.status = 'pending'，方向是應收）。
 * 依到期日由近到遠排序，最急迫的排最前面。
 */
/**
 * 查詢還沒收到的款項（payments.status = 'pending'，方向是應收），
 * 只列出「到期日在未來 10 天內」的（含已經逾期的——逾期的更急迫，
 * 不該被這個篩選條件擋掉，只有還很久以後才到期、目前不急的才濾
 * 掉）。依到期日由近到遠排序，最急迫的排最前面。
 */
export async function listReceivables(): Promise<ReceivableSummary[]> {
  const supabase = createServiceRoleClient();

  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() + 10);
  const cutoffDateStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(
    cutoff.getDate()
  ).padStart(2, "0")}`;

  const { data, error } = await supabase
    .from("payments")
    .select(
      "id, amount, due_date, payment_kind, reservation_id, reservations(reservation_no, check_in, guests(name, phone), properties(name))"
    )
    .eq("status", "pending")
    .eq("direction", "receivable")
    // due_date 在 10 天內「或者根本沒填」都算——沒填不代表不急，
    // 用 .lte() 單獨篩選的話，SQL 對 NULL 的比較一律是 false，
    // due_date 是 NULL 的付款記錄會被整個排除、永遠不會出現在應收
    // 清單裡，不管它實際上有多急。歷史資料匯入那批（訂房記錄表
    // 匯入時透過 SQL 直接寫入，沒有經過這裡的確認訂房流程）就是
    // due_date 全部是 NULL 的例子，之前就是因為這樣才會查不到。
    .or(`due_date.lte.${cutoffDateStr},due_date.is.null`)
    .order("due_date", { ascending: true, nullsFirst: true });

  if (error) {
    throw new Error(`查詢應收款失敗：${error.message}`);
  }

  return (data ?? []).map((row: any) => ({
    paymentId: row.id as string,
    reservationId: row.reservation_id as string,
    reservationNo: (row.reservations?.reservation_no as string) ?? "",
    guestName: (row.reservations?.guests?.name as string) ?? "",
    guestPhone: (row.reservations?.guests?.phone as string) ?? null,
    propertyName: (row.reservations?.properties?.name as string) ?? "",
    checkIn: (row.reservations?.check_in as string) ?? "",
    paymentKind: row.payment_kind as string,
    amount: Number(row.amount),
    dueDate: row.due_date ?? null,
  }));
}

/** 把一筆應收款標記為已收款 */
export async function markPaymentPaid(paymentId: string): Promise<void> {
  const supabase = createServiceRoleClient();
  // 同樣的型別檢查問題，見 getReservationDetail 裡 `as any` 那段的說明
  const { error } = await (supabase.from("payments") as any)
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", paymentId);

  if (error) {
    throw new Error(`標記已收款失敗：${error.message}`);
  }
}

/**
 * 改整體付款狀況（reservations.payment_status），同時同步 payments
 * 表裡訂金/尾款兩筆記錄的實際狀態——這兩個原本是各自獨立、沒有互相
 * 連動的機制（見 lib/pricing/reservation-message.ts 開頭的說明），
 * 之前只改 reservations.payment_status 的話，payments 表那邊的
 * 訂金/尾款不會跟著變成「已收」，導致畫面上「付款狀況」跟底下
 * 訂金/尾款的收款狀態顯示不一致。這個函式讓改一個地方、兩邊都會
 * 對齊。
 *
 * 每種整體付款狀況，對應訂金/尾款各自該有的狀態：
 * - 待匯訂金：訂金未收、尾款未收
 * - 已匯訂金：訂金已收、尾款未收
 * - 已匯尾款：訂金已收、尾款已收
 * - 退還訂金：訂金已退款、尾款作廢（不會再收，訂單通常已取消）
 * - 沒收訂金：訂金已收（客人付的訂金民宿留下當作取消費）、尾款作廢
 */
export async function updateReservationPaymentStatus(reservationId: string, paymentStatus: string): Promise<void> {
  const supabase = createServiceRoleClient();

  const { error: reservationError } = await (supabase.from("reservations") as any)
    .update({ payment_status: paymentStatus })
    .eq("id", reservationId);
  if (reservationError) {
    throw new Error(`更新付款狀況失敗：${reservationError.message}`);
  }

  const statusMap: Record<string, { deposit: "pending" | "paid" | "void" | "refunded"; balance: "pending" | "paid" | "void" | "refunded" }> = {
    pending_deposit: { deposit: "pending", balance: "pending" },
    deposit_paid: { deposit: "paid", balance: "pending" },
    balance_paid: { deposit: "paid", balance: "paid" },
    deposit_refunded: { deposit: "refunded", balance: "void" },
    deposit_forfeited: { deposit: "paid", balance: "void" },
  };
  const target = statusMap[paymentStatus];
  if (!target) return; // 不認得的狀態值就不動 payments 表，只更新上面那個整體欄位

  const { data: paymentRows, error: fetchError } = await supabase
    .from("payments")
    .select("id, payment_kind, status, paid_at")
    .eq("reservation_id", reservationId)
    .in("payment_kind", ["deposit", "balance"]);
  if (fetchError) {
    throw new Error(`查詢付款記錄失敗：${fetchError.message}`);
  }

  const now = new Date().toISOString();
  for (const row of (paymentRows ?? []) as any[]) {
    const kind = row.payment_kind as "deposit" | "balance";
    const newStatus = target[kind];
    const shouldHavePaidAt = newStatus === "paid";
    const { error: updateError } = await (supabase.from("payments") as any)
      .update({
        status: newStatus,
        paid_at: shouldHavePaidAt ? (row.paid_at ?? now) : null,
      })
      .eq("id", row.id);
    if (updateError) {
      throw new Error(`同步${kind === "deposit" ? "訂金" : "尾款"}狀態失敗：${updateError.message}`);
    }
  }
}

/** 日曆檢視用的訂單摘要 */
export interface CalendarReservation {
  id: string;
  reservationNo: string;
  propertyCode: string;
  propertyName: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  status: string;
  /** 尾款(balance)是不是還沒收到（payments 表 payment_kind='balance' 且 status='pending'） */
  balanceUnpaid: boolean;
  /** 有沒有加購烤肉（reservation_items 表 item_type='bbq'），日曆色塊上顯示烤肉圖案用 */
  hasBbq: boolean;
}

/**
 * 查某個月份內、三間民宿「有重疊到這個月」的訂單（用於日曆檢視），
 * 條件是 check_in < 這個月的下個月第一天 且 check_out > 這個月第一天
 * ——這樣跨月的訂房（例如月底入住、下個月才退房）也會正確顯示在
 * 兩個月份的日曆裡。已取消的訂單不顯示。
 */
export async function getReservationsForMonthCalendar(
  monthStartInclusive: string,
  nextMonthStartExclusive: string
): Promise<CalendarReservation[]> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("reservations")
    .select("id, reservation_no, check_in, check_out, status, guests(name), properties(code, name)")
    .lt("check_in", nextMonthStartExclusive)
    .gt("check_out", monthStartInclusive)
    .neq("status", "cancelled");

  if (error) {
    throw new Error(`查詢日曆訂單失敗：${error.message}`);
  }

  const rows = data ?? [];
  const reservationIds = rows.map((row: any) => row.id as string);

  let unpaidBalanceIds = new Set<string>();
  let bbqIds = new Set<string>();
  if (reservationIds.length > 0) {
    const [{ data: balancePayments, error: paymentsError }, { data: bbqItems, error: bbqError }] = await Promise.all([
      supabase
        .from("payments")
        .select("reservation_id")
        .in("reservation_id", reservationIds)
        .eq("payment_kind", "balance")
        .eq("status", "pending"),
      supabase.from("reservation_items").select("reservation_id").in("reservation_id", reservationIds).eq("item_type", "bbq"),
    ]);

    if (paymentsError) {
      throw new Error(`查詢尾款狀態失敗：${paymentsError.message}`);
    }
    if (bbqError) {
      throw new Error(`查詢烤肉加購項目失敗：${bbqError.message}`);
    }
    unpaidBalanceIds = new Set((balancePayments ?? []).map((p: any) => p.reservation_id as string));
    bbqIds = new Set((bbqItems ?? []).map((r: any) => r.reservation_id as string));
  }

  return rows.map((row: any) => ({
    id: row.id as string,
    reservationNo: row.reservation_no as string,
    propertyCode: (row.properties?.code as string) ?? "",
    propertyName: (row.properties?.name as string) ?? "",
    guestName: (row.guests?.name as string) ?? "",
    checkIn: row.check_in as string,
    checkOut: row.check_out as string,
    status: row.status as string,
    balanceUnpaid: unpaidBalanceIds.has(row.id as string),
    hasBbq: bbqIds.has(row.id as string),
  }));
}

/**
 * 可編輯的訂單欄位。
 *
 * ⚠️ checkIn/checkOut/房型配置這幾個欄位改了，金額不會自動重算——
 * 系統目前只有存「最後結果」（final_total 這個總額數字），沒有存
 * 一份完整的原始 StayRequest（人數/加購/折扣/發票稅率等全部條件），
 * 沒辦法像 /quote 那邊一樣重新呼叫計價引擎算出正確金額。改了這些
 * 欄位之後，畫面上會提醒要自己確認總金額對不對，需要的話可以另外
 * 開 /quote 用同樣的條件重新試算一次，再把算出來的金額填回這裡的
 * 「總金額」欄位。
 */
export interface ReservationUpdateFields extends ReservationAddOnFields {
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  infants: number;
  pets: number;
  visitors: number;
  bookingSource: string;
  status: string;
  finalTotal: number;
  /** 訂金金額——可以直接改，尾款會用「總金額－這個新的訂金金額」
   * 重算，不是讀資料庫裡原本記錄的舊訂金金額 */
  depositAmount: number;
  needsInvoice: boolean;
  invoiceTitle: string | null;
  invoiceTaxId: string | null;
  fourPersonSuiteCount: number;
  fourPersonDowngradeCount: number;
  doubleSuiteCount: number;
  doublePlainCount: number;
}

export async function updateReservation(reservationId: string, fields: ReservationUpdateFields): Promise<void> {
  const supabase = createServiceRoleClient();
  // 同樣的型別檢查問題，見 getReservationDetail 裡 `as any` 那段的說明
  const { data: updatedRow, error } = await (supabase.from("reservations") as any)
    .update({
      check_in: fields.checkIn,
      check_out: fields.checkOut,
      adults: fields.adults,
      children: fields.children,
      infants: fields.infants,
      pets: fields.pets,
      visitors: fields.visitors,
      booking_source: fields.bookingSource,
      status: fields.status,
      final_total: fields.finalTotal,
      needs_invoice: fields.needsInvoice,
      invoice_title: fields.needsInvoice ? fields.invoiceTitle : null,
      invoice_tax_id: fields.needsInvoice ? fields.invoiceTaxId : null,
      four_person_suite_count: fields.fourPersonSuiteCount,
      four_person_downgrade_count: fields.fourPersonDowngradeCount,
      double_suite_count: fields.doubleSuiteCount,
      double_plain_count: fields.doublePlainCount,
    })
    .eq("id", reservationId)
    .select("property_id, payment_status")
    .single();

  if (error) {
    throw new Error(`更新訂單失敗：${error.message}`);
  }

  // 訂金/尾款金額重算——訂金直接用表單填的新金額寫入（不是讀資料庫
  // 裡原本的舊金額），尾款＝總金額－這次的訂金金額，確保兩者加總
  // 起來一定等於總金額。不管總金額/訂金金額實際上有沒有真的改變
  // 都重新算一次，反正結果一樣，比額外去判斷「這次有沒有改到」
  // 簡單、也不會有漏判的風險。
  const newBalanceAmount = fields.finalTotal - fields.depositAmount;

  const { error: depositUpdateError } = await (supabase.from("payments") as any)
    .update({ amount: fields.depositAmount })
    .eq("reservation_id", reservationId)
    .eq("payment_kind", "deposit");
  if (depositUpdateError) {
    throw new Error(`更新訂金金額失敗：${depositUpdateError.message}`);
  }

  const { error: balanceUpdateError } = await (supabase.from("payments") as any)
    .update({ amount: newBalanceAmount })
    .eq("reservation_id", reservationId)
    .eq("payment_kind", "balance");
  if (balanceUpdateError) {
    throw new Error(`更新尾款金額失敗：${balanceUpdateError.message}`);
  }

  // 加購項目：不逐項比對哪個改了、哪個沒改（加床房號這種欄位改起來
  // 不是簡單的「值變了就更新」），用「先把舊的全部刪掉、再依目前
  // 表單狀態整組重新寫入」最不容易漏掉異動，也是為什麼上面
  // buildAddOnItemLines() 要抽成共用函式——這裡實際套用的邏輯要跟
  // 新增訂單那邊完全一致。
  const propertyId = updatedRow?.property_id as string | undefined;
  if (propertyId) {
    const { error: deleteAddonError } = await supabase
      .from("reservation_items")
      .delete()
      .eq("reservation_id", reservationId)
      .in("item_type", ADDON_ITEM_TYPES);
    if (deleteAddonError) {
      throw new Error(`清除舊加購項目失敗：${deleteAddonError.message}`);
    }

    // 「加開房間」用 item_type='other'，用 description 額外篩選，
    // 避免誤刪未來可能存在、跟這裡無關的其他 'other' 類型項目
    const { error: deleteExtraRoomError } = await supabase
      .from("reservation_items")
      .delete()
      .eq("reservation_id", reservationId)
      .eq("item_type", "other")
      .eq("description", "加開房間");
    if (deleteExtraRoomError) {
      throw new Error(`清除舊加開房間項目失敗：${deleteExtraRoomError.message}`);
    }

    const itemLines = await buildAddOnItemLines(propertyId, reservationId, fields);
    if (itemLines.length > 0) {
      const { error: insertAddonError } = await (supabase.from("reservation_items") as any).insert(itemLines);
      if (insertAddonError) {
        throw new Error(`寫入加購項目失敗：${insertAddonError.message}`);
      }
    }
  }

  // 訂單取消後，訂金/尾款要歸零、不計入營收——但「沒收訂金」是刻意
  // 的例外：這種取消是客人的訂金被民宿留下當作取消費，金額維持
  // 原樣、還是要算進營收（getYearlyRevenueStats 已經處理這個例外，
  // 這裡只要避免同時把這個情況下的金額誤歸零就好）。用上面
  // reservations 更新時一併查出來的 payment_status（不是另外查一次）
  // 判斷是不是這個例外。
  const currentPaymentStatus = (updatedRow as any)?.payment_status as string | undefined;
  if (fields.status === "cancelled" && currentPaymentStatus !== "deposit_forfeited") {
    const { error: zeroOutError } = await (supabase.from("payments") as any)
      .update({ amount: 0, status: "void" })
      .eq("reservation_id", reservationId)
      .in("payment_kind", ["deposit", "balance"]);
    if (zeroOutError) {
      throw new Error(`訂單取消後歸零訂金/尾款失敗：${zeroOutError.message}`);
    }
  }
}

/**
 * 真正刪除一筆訂單（連同房型明細/加購項目/付款記錄一起刪掉），跟
 * 「把狀態改成已取消」是兩回事：
 *
 * - 客人真的取消預訂：應該用編輯訂單、把「訂單狀態」改成「已取消」
 *   就好——這樣訂單記錄還留著（保留歷史），而且系統裡所有查詢
 *   （房務排班的退房比對、營收統計、住房率）本來就都會排除已取消
 *   的訂單，不會影響任何計算。
 * - 測試訂單、建錯的訂單需要徹底清掉：才用這個函式，資料庫記錄會
 *   整個消失，無法復原。
 *
 * staff_assignments 不會被牽動——那張表是用 property_id + work_date
 * 對應，不是直接連到 reservation_id，所以刪訂單不會動到已經排好的
 * 房務班表；房務排班頁面的「退房訂單比對」之後查詢時，這筆訂單
 * 自然就不會再出現了。
 */
export async function deleteReservation(reservationId: string): Promise<void> {
  const supabase = createServiceRoleClient();

  // 先刪子表資料，避免外鍵設定不是 cascade 的話刪不掉主表那筆
  const { error: paymentsError } = await supabase.from("payments").delete().eq("reservation_id", reservationId);
  if (paymentsError) throw new Error(`刪除付款記錄失敗：${paymentsError.message}`);

  const { error: itemsError } = await supabase.from("reservation_items").delete().eq("reservation_id", reservationId);
  if (itemsError) throw new Error(`刪除加購項目失敗：${itemsError.message}`);

  const { error: roomLinesError } = await supabase
    .from("reservation_room_lines")
    .delete()
    .eq("reservation_id", reservationId);
  if (roomLinesError) throw new Error(`刪除房型明細失敗：${roomLinesError.message}`);

  const { error: reservationError } = await supabase.from("reservations").delete().eq("id", reservationId);
  if (reservationError) throw new Error(`刪除訂單失敗：${reservationError.message}`);
}

function generateReservationNo(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `R${y}${m}${d}-${rand}`;
}

/**
 * 直接建立訂單，跳過報價／訂房確認單那一整套流程——Airbnb 等 OTA
 * 平台上訂房的客人，房價、訂金/尾款收款都是平台在處理，民宿不需要
 * 再產生一次報價單或訂房確認單給客人，這裡讓櫃檯直接把訂單記錄
 * 建起來就好。
 *
 * 跟 confirmReservationFromQuoteAction（報價確認訂房那條路）不同的
 * 地方：這裡不會建立 payments 應收款記錄（訂金/尾款）——OTA 平台
 * 已經處理收款，不需要民宿這邊再追蹤一次應收，不然「查詢應收」頁面
 * 會顯示這筆其實已經收到錢的訂單還在等收款，造成誤導。
 */

/** 加購項目（加床/加開房間/烤肉/餐車/提前入住），新增訂單、編輯
 * 訂單兩個地方共用同一組欄位定義 */
export interface ReservationAddOnFields {
  extraBedFixedRoomCodes: string[];
  /** 加臨時床要放哪幾個房號 */
  extraBedTempRoomCodes: string[];
  extraRoomQty: number;
  bbq: boolean;
  foodTruck: boolean;
  earlyCheckin: boolean;
}

/** 加購項目在 reservation_items 表對應的 item_type，統一定義一次給
 * 建立/編輯共用，也給「編輯時要清掉哪些舊項目」用 */
const ADDON_ITEM_TYPES = ["extra_bed_fixed", "extra_bed_temporary", "bbq", "food_truck", "early_checkin"] as const;

/**
 * 把加購欄位轉成要寫進 reservation_items 的資料列——這幾項的單價用
 * services 表的固定牌價查出來記錄在每筆項目上，方便之後對帳看
 * 明細；但這不影響 reservations.final_total（那個數字是職員手動
 * 填的實收金額，不會因為這裡查到的牌價被覆蓋或加總回去）。
 * 新增訂單、編輯訂單都呼叫這個函式產生要寫入的項目列，避免兩邊各寫
 * 一份、之後改其中一邊忘記改另一邊。
 */
async function buildAddOnItemLines(
  propertyId: string,
  reservationId: string,
  fields: ReservationAddOnFields
): Promise<Record<string, unknown>[]> {
  const servicePrices = await getFlatServicePrices(propertyId);
  const itemLines: Record<string, unknown>[] = [];

  if (fields.extraBedFixedRoomCodes.length > 0) {
    const qty = fields.extraBedFixedRoomCodes.length;
    itemLines.push({
      reservation_id: reservationId,
      item_type: "extra_bed_fixed",
      description: "加固定床",
      quantity: qty,
      unit_price: servicePrices.extraBedFixed,
      amount: servicePrices.extraBedFixed * qty,
      notes: `房號：${fields.extraBedFixedRoomCodes.join("、")}`,
    });
  }
  if (fields.extraBedTempRoomCodes.length > 0) {
    const qty = fields.extraBedTempRoomCodes.length;
    itemLines.push({
      reservation_id: reservationId,
      item_type: "extra_bed_temporary",
      description: "加臨時床",
      quantity: qty,
      unit_price: servicePrices.extraBedTemp,
      amount: servicePrices.extraBedTemp * qty,
      notes: `房號：${fields.extraBedTempRoomCodes.join("、")}`,
    });
  }
  if (fields.extraRoomQty > 0) {
    itemLines.push({
      reservation_id: reservationId,
      item_type: "other",
      description: "加開房間",
      quantity: fields.extraRoomQty,
      unit_price: servicePrices.extraRoom,
      amount: servicePrices.extraRoom * fields.extraRoomQty,
    });
  }
  if (fields.bbq) {
    itemLines.push({
      reservation_id: reservationId,
      item_type: "bbq",
      description: "烤肉",
      quantity: 1,
      unit_price: servicePrices.bbq,
      amount: servicePrices.bbq,
    });
  }
  if (fields.foodTruck) {
    itemLines.push({
      reservation_id: reservationId,
      item_type: "food_truck",
      description: "餐車場地費",
      quantity: 1,
      unit_price: servicePrices.foodTruck,
      amount: servicePrices.foodTruck,
    });
  }
  if (fields.earlyCheckin) {
    itemLines.push({
      reservation_id: reservationId,
      item_type: "early_checkin",
      description: "提前入住",
      quantity: 1,
      unit_price: servicePrices.earlyCheckin,
      amount: servicePrices.earlyCheckin,
    });
  }
  return itemLines;
}

export interface CreateReservationFields extends ReservationAddOnFields {
  propertyCode: PropertyCode;
  guestName: string;
  guestPhone: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  infants: number;
  pets: number;
  visitors: number;
  bookingSource: string;
  finalTotal: number;
  paymentStatus: string;
  /** 訂金金額——預設從報價單金額帶入（呼叫端自己決定要帶什麼進來，
   * 這裡單純接收），沒有報價單可以參考的話，呼叫端會傳 0。用這個
   * 金額實際建立訂金/尾款應收款記錄，見下面的說明。 */
  depositAmount: number;
  needsInvoice: boolean;
  invoiceTitle: string | null;
  invoiceTaxId: string | null;
  fourPersonSuiteCount: number;
  fourPersonDowngradeCount: number;
  doubleSuiteCount: number;
  doublePlainCount: number;
}

/** 整體付款狀況(payment_status)，對應到訂金/尾款各自該有的狀態——
 * 跟 lib/pricing/queries.ts updateReservationPaymentStatus() 用同一套
 * 對照表，確保不管是新增訂單當下就填付款狀況、還是事後在訂單詳情
 * 頁面改，算出來的結果一致。 */
const PAYMENT_STATUS_TARGET_MAP: Record<
  string,
  { deposit: "pending" | "paid" | "void" | "refunded"; balance: "pending" | "paid" | "void" | "refunded" }
> = {
  pending_deposit: { deposit: "pending", balance: "pending" },
  deposit_paid: { deposit: "paid", balance: "pending" },
  balance_paid: { deposit: "paid", balance: "paid" },
  deposit_refunded: { deposit: "refunded", balance: "void" },
  deposit_forfeited: { deposit: "paid", balance: "void" },
};

export async function createReservationDirectly(
  fields: CreateReservationFields
): Promise<{ reservationId: string; reservationNo: string }> {
  const supabase = createServiceRoleClient();
  const organizationId = await getSingleOrganizationId();
  const propertyId = await getPropertyId(fields.propertyCode);
  const guestId = await findOrCreateGuest({ name: fields.guestName, phone: fields.guestPhone });
  const reservationNo = generateReservationNo();

  const { data: reservationRow, error: reservationError } = await (supabase.from("reservations") as any)
    .insert({
      organization_id: organizationId,
      property_id: propertyId,
      guest_id: guestId,
      source_quote_id: null, // 沒有經過報價流程
      reservation_no: reservationNo,
      booking_source: fields.bookingSource,
      status: "confirmed",
      payment_status: fields.paymentStatus,
      check_in: fields.checkIn,
      check_out: fields.checkOut,
      adults: fields.adults,
      children: fields.children,
      infants: fields.infants,
      pets: fields.pets,
      visitors: fields.visitors,
      quoted_total: fields.finalTotal,
      final_total: fields.finalTotal,
      currency: "TWD",
      needs_invoice: fields.needsInvoice,
      invoice_title: fields.needsInvoice ? fields.invoiceTitle : null,
      invoice_tax_id: fields.needsInvoice ? fields.invoiceTaxId : null,
      four_person_suite_count: fields.fourPersonSuiteCount,
      four_person_downgrade_count: fields.fourPersonDowngradeCount,
      double_suite_count: fields.doubleSuiteCount,
      double_plain_count: fields.doublePlainCount,
    })
    .select("id")
    .single();

  if (reservationError || !reservationRow) {
    throw new Error(`建立訂單失敗：${reservationError?.message}`);
  }
  const reservationId = reservationRow.id as string;

  // 房型明細（跟 confirmReservationFromQuoteAction 同樣的寫法，只記
  // 數量／說明，正式的金額 authoritative 來源是 reservations.final_total）
  const roomLines: Record<string, unknown>[] = [];
  if (fields.fourPersonSuiteCount > 0) {
    roomLines.push({ reservation_id: reservationId, line_role: "included", quantity: fields.fourPersonSuiteCount, notes: "四人套房" });
  }
  if (fields.fourPersonDowngradeCount > 0) {
    roomLines.push({
      reservation_id: reservationId,
      line_role: "included",
      quantity: fields.fourPersonDowngradeCount,
      beds_open: 1,
      notes: "降規四人套房（提供1床，以雙人套房計費）",
    });
  }
  if (fields.doubleSuiteCount > 0) {
    roomLines.push({ reservation_id: reservationId, line_role: "included", quantity: fields.doubleSuiteCount, notes: "雙人套房" });
  }
  if (fields.doublePlainCount > 0) {
    roomLines.push({ reservation_id: reservationId, line_role: "included", quantity: fields.doublePlainCount, notes: "雙人雅房" });
  }
  if (roomLines.length > 0) {
    const { error: roomLineError } = await (supabase.from("reservation_room_lines") as any).insert(roomLines);
    if (roomLineError) throw new Error(`寫入房型明細失敗：${roomLineError.message}`);
  }

  // 加購項目（加床/加開房間/烤肉/餐車/提前入住）——見
  // buildAddOnItemLines() 的說明，新增/編輯訂單共用同一份邏輯
  const itemLines = await buildAddOnItemLines(propertyId, reservationId, fields);
  if (itemLines.length > 0) {
    const { error: itemError } = await (supabase.from("reservation_items") as any).insert(itemLines);
    if (itemError) throw new Error(`寫入加購項目失敗：${itemError.message}`);
  }

  // 訂金/尾款應收款記錄——直接建立的訂單（Airbnb 等平台訂房，跳過
  // 報價流程）原本完全不會建立這兩筆記錄，導致「付款狀況」控制項
  // 改了狀態也沒有實際的記錄可以同步、「查詢應收」也查不到這筆
  // 訂單。現在用職員填的訂金金額（預設從報價單帶入，沒有的話是 0）
  // 實際建立這兩筆記錄，狀態依 fields.paymentStatus 對應決定。
  const paymentTarget = PAYMENT_STATUS_TARGET_MAP[fields.paymentStatus] ?? { deposit: "pending" as const, balance: "pending" as const };
  const now = new Date().toISOString();
  const balanceAmount = fields.finalTotal - fields.depositAmount;
  // 尾款到期日用「入住前 7 天」，跟這個系統其他地方（confirmReservationFromQuoteAction
  // 沒有報價單當初約定的天數可以參考時的預設值、reservation-message.ts 的提醒文字）
  // 採用同一個預設慣例
  const balanceDueDate = new Date(`${fields.checkIn}T00:00:00`);
  balanceDueDate.setDate(balanceDueDate.getDate() - 7);

  const { error: depositPaymentError } = await (supabase.from("payments") as any).insert({
    organization_id: organizationId,
    reservation_id: reservationId,
    payment_kind: "deposit",
    direction: "receivable",
    amount: fields.depositAmount,
    currency: "TWD",
    due_date: fields.checkIn,
    status: paymentTarget.deposit,
    paid_at: paymentTarget.deposit === "paid" ? now : null,
  });
  if (depositPaymentError) {
    throw new Error(`建立訂金應收款失敗：${depositPaymentError.message}`);
  }

  const { error: balancePaymentError } = await (supabase.from("payments") as any).insert({
    organization_id: organizationId,
    reservation_id: reservationId,
    payment_kind: "balance",
    direction: "receivable",
    amount: balanceAmount,
    currency: "TWD",
    due_date: balanceDueDate.toISOString().slice(0, 10),
    status: paymentTarget.balance,
    paid_at: paymentTarget.balance === "paid" ? now : null,
  });
  if (balancePaymentError) {
    throw new Error(`建立尾款應收款失敗：${balancePaymentError.message}`);
  }

  return { reservationId, reservationNo };
}

/** 民宿基本資料＋設定，編輯民宿資料頁面用 */
export interface PropertySettingsDetail {
  propertyId: string;
  code: string;
  name: string;
  bankName: string | null;
  bankBranch: string | null;
  bankAccountFull: string | null;
  accountName: string | null;
  address: string | null;
  parkingInfo: string | null;
  mapUrl: string | null;
}

export async function getAllPropertiesSettings(): Promise<PropertySettingsDetail[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("properties")
    .select(
      "id, code, name, property_settings(bank_name, bank_branch, bank_account_full, account_name, address, parking_info, map_url)"
    )
    .order("code");

  if (error) {
    throw new Error(`查詢民宿資料失敗：${error.message}`);
  }

  return ((data ?? []) as any[]).map((row) => {
    const settings = Array.isArray(row.property_settings) ? row.property_settings[0] : row.property_settings;
    return {
      propertyId: row.id as string,
      code: row.code as string,
      name: row.name as string,
      bankName: (settings?.bank_name as string) ?? null,
      bankBranch: (settings?.bank_branch as string) ?? null,
      bankAccountFull: (settings?.bank_account_full as string) ?? null,
      accountName: (settings?.account_name as string) ?? null,
      address: (settings?.address as string) ?? null,
      parkingInfo: (settings?.parking_info as string) ?? null,
      mapUrl: (settings?.map_url as string) ?? null,
    };
  });
}

export interface PropertySettingsFields {
  name: string;
  bankName: string | null;
  bankBranch: string | null;
  bankAccountFull: string | null;
  accountName: string | null;
  address: string | null;
  parkingInfo: string | null;
  mapUrl: string | null;
}

export async function updatePropertySettings(propertyId: string, fields: PropertySettingsFields): Promise<void> {
  const supabase = createServiceRoleClient();

  const { error: nameError } = await (supabase.from("properties") as any)
    .update({ name: fields.name })
    .eq("id", propertyId);
  if (nameError) throw new Error(`更新民宿名稱失敗：${nameError.message}`);

  const { error: settingsError } = await (supabase.from("property_settings") as any)
    .update({
      bank_name: fields.bankName,
      bank_branch: fields.bankBranch,
      bank_account_full: fields.bankAccountFull,
      account_name: fields.accountName,
      address: fields.address,
      parking_info: fields.parkingInfo,
      map_url: fields.mapUrl,
    })
    .eq("property_id", propertyId);
  if (settingsError) throw new Error(`更新民宿設定失敗：${settingsError.message}`);
}
