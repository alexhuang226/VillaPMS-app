/**
 * Supabase 資料查詢層
 *
 * 這裡假設專案已經有 lib/supabase/server.ts 匯出一個
 * `createClient(): Promise<SupabaseClient>` 的 async helper（Next.js
 * App Router + @supabase/ssr 的常見寫法，因為要 await cookies()）。
 * 如果你的專案路徑不同，請調整下面的 import path。
 */

import { createClient } from "@/lib/supabase/server";
import type {
  DayType,
  FlatServicePrices,
  NightlyRateTable,
  PropertyCode,
  PropertyRoomCounts,
} from "./types";
import type { HolidayCategory, HolidayMap } from "./day-type";

/** 依 property code 取得 property_id（可自行加上快取層） */
export async function getPropertyId(propertyCode: PropertyCode): Promise<string> {
  const supabase = await createClient();
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
  priceCategory: "regular" | "holiday" | "festival" | "lunar_new_year" | "new_year_eve"
): Promise<NightlyRateTable> {
  const supabase = await createClient();
  const dbDayType = priceCategory === "regular" ? "weekday" : priceCategory;

  const { data, error } = await supabase
    .from("rate_rule_tiers")
    .select(
      `
        amount,
        config_label,
        rate_rules!inner (
          day_type,
          rate_plans!inner ( property_id )
        )
      `
    )
    .eq("rate_rules.day_type", dbDayType)
    .eq("rate_rules.rate_plans.property_id", propertyId);

  if (error) {
    throw new Error(`查詢每晚房價失敗：${error.message}`);
  }

  const table: NightlyRateTable = {
    fourPersonSuite: 0,
    downgradeDoubleSuite: 0,
    doubleSuite: 0,
    doublePlain: 0,
  };

  for (const row of data ?? []) {
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
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("services")
    .select("code, default_price")
    .eq("property_id", propertyId);

  if (error) {
    throw new Error(`查詢加購服務價格失敗：${error.message}`);
  }

  const priceByCode = new Map<string, number>();
  for (const row of data ?? []) {
    priceByCode.set(row.code as string, Number(row.default_price));
  }

  return {
    extraBedFixed: priceByCode.get("extra_bed_fixed") ?? 0,
    extraBedTemp: priceByCode.get("extra_bed_temp") ?? 0,
    extraRoom: priceByCode.get("extra_room") ?? 0,
    petCleaning: priceByCode.get("pet_cleaning") ?? 0,
    bbq: priceByCode.get("bbq") ?? 0,
    foodTruck: priceByCode.get("food_truck") ?? 0,
    earlyCheckin: priceByCode.get("early_checkin") ?? 0,
    visitor: priceByCode.get("visitor") ?? 0,
  };
}

/**
 * 取得該民宿的固定房型數量（獨立雙人套房／雙人雅房實際房間數，
 * 以及免費寵物數量上限）。四人套房實體房間總數目前的計價公式不需要
 * 直接使用（allocateFourPersonRooms 已經內建各民宿的房間總數），
 * 但仍一併回傳方便前端顯示或做人數上限校驗。
 */
export async function getPropertyRoomCounts(propertyId: string): Promise<PropertyRoomCounts> {
  const supabase = await createClient();

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
  const supabase = await createClient();
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
  const supabase = await createClient();
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
