/**
 * 房價編輯查詢層
 *
 * 編輯的是 rate_rule_tiers（tier_type='room_type_rate'）裡每一筆的
 * amount——這是報價引擎實際拿來計算住宿費用的價格來源（不是
 * rate_rules.base_price，那個欄位目前整個系統都是 0，沒有被計價
 * 邏輯使用）。
 *
 * 資料結構：每間民宿有 6 筆 rate_rules（一個 day_type 一筆：weekday／
 * peak／holiday／festival／lunar_new_year／new_year_eve），每筆
 * rate_rule 底下，每種房型配置（config_label，例如「四人套房」「降規
 * 雙人套房」）各有一筆 rate_rule_tiers 記錄實際價格。
 *
 * 平日（weekday）／旺日（peak）目前雖然設定成同一個價格（見
 * db/001b_schema_patch_part1_enums.sql 的說明：拆成兩個 day_type
 * 最初只是因為「基本人數」不同），但這裡刻意讓兩者在編輯介面上各自
 * 獨立、分開儲存——方便之後如果要讓平日／旺日價格不同，不需要再
 * 改一次這個編輯功能。
 */

import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface RoomConfigPricing {
  configLabel: string;
  roomTypeId: string;
  weekdayPrice: number;
  peakPrice: number;
  holidayPrice: number;
  festivalPrice: number;
  lunarNewYearPrice: number;
  newYearEvePrice: number;
  // 這幾個 tier id 不顯示在畫面上，儲存時用來對應要更新哪一筆
  // rate_rule_tiers，避免用 (property, day_type, config_label) 重新
  // 查一次才能定位要更新的那一列
  weekdayTierId: string;
  peakTierId: string;
  holidayTierId: string;
  festivalTierId: string;
  lunarNewYearTierId: string;
  newYearEveTierId: string;
}

export async function getRoomConfigPricing(propertyId: string): Promise<RoomConfigPricing[]> {
  const supabase = createServiceRoleClient();

  const { data: rulesData, error: rulesError } = await supabase
    .from("rate_rules")
    .select("id, day_type, rate_plans!inner(property_id)")
    .eq("rate_plans.property_id", propertyId);
  if (rulesError) {
    throw new Error(`查詢定價規則失敗：${rulesError.message}`);
  }

  const rules = (rulesData ?? []) as any[];
  const ruleIds = rules.map((r) => r.id as string);
  const dayTypeByRuleId = new Map(rules.map((r) => [r.id as string, r.day_type as string]));
  if (ruleIds.length === 0) return [];

  const { data: tiersData, error: tiersError } = await supabase
    .from("rate_rule_tiers")
    .select("id, rate_rule_id, config_label, room_type_id, amount")
    .eq("tier_type", "room_type_rate")
    .in("rate_rule_id", ruleIds);
  if (tiersError) {
    throw new Error(`查詢房價明細失敗：${tiersError.message}`);
  }

  const map = new Map<string, RoomConfigPricing>();
  for (const row of (tiersData ?? []) as any[]) {
    const key = `${row.config_label}|${row.room_type_id}`;
    let entry = map.get(key);
    if (!entry) {
      entry = {
        configLabel: row.config_label as string,
        roomTypeId: row.room_type_id as string,
        weekdayPrice: 0,
        peakPrice: 0,
        holidayPrice: 0,
        festivalPrice: 0,
        lunarNewYearPrice: 0,
        newYearEvePrice: 0,
        weekdayTierId: "",
        peakTierId: "",
        holidayTierId: "",
        festivalTierId: "",
        lunarNewYearTierId: "",
        newYearEveTierId: "",
      };
      map.set(key, entry);
    }
    const dayType = dayTypeByRuleId.get(row.rate_rule_id as string);
    const amount = Number(row.amount ?? 0);
    const tierId = row.id as string;
    if (dayType === "weekday") {
      entry.weekdayPrice = amount;
      entry.weekdayTierId = tierId;
    } else if (dayType === "peak") {
      entry.peakPrice = amount;
      entry.peakTierId = tierId;
    } else if (dayType === "holiday") {
      entry.holidayPrice = amount;
      entry.holidayTierId = tierId;
    } else if (dayType === "festival") {
      entry.festivalPrice = amount;
      entry.festivalTierId = tierId;
    } else if (dayType === "lunar_new_year") {
      entry.lunarNewYearPrice = amount;
      entry.lunarNewYearTierId = tierId;
    } else if (dayType === "new_year_eve") {
      entry.newYearEvePrice = amount;
      entry.newYearEveTierId = tierId;
    }
  }

  return Array.from(map.values()).sort((a, b) => a.configLabel.localeCompare(b.configLabel, "zh-Hant"));
}

export interface RoomConfigPriceUpdate {
  weekdayTierId: string;
  peakTierId: string;
  holidayTierId: string;
  festivalTierId: string;
  lunarNewYearTierId: string;
  newYearEveTierId: string;
  weekdayPrice: number;
  peakPrice: number;
  holidayPrice: number;
  festivalPrice: number;
  lunarNewYearPrice: number;
  newYearEvePrice: number;
}

export async function updateRoomConfigPricing(update: RoomConfigPriceUpdate): Promise<void> {
  const supabase = createServiceRoleClient();

  const updates = [
    { id: update.weekdayTierId, amount: update.weekdayPrice },
    { id: update.peakTierId, amount: update.peakPrice },
    { id: update.holidayTierId, amount: update.holidayPrice },
    { id: update.festivalTierId, amount: update.festivalPrice },
    { id: update.lunarNewYearTierId, amount: update.lunarNewYearPrice },
    { id: update.newYearEveTierId, amount: update.newYearEvePrice },
  ].filter((u) => u.id);

  for (const u of updates) {
    const { error } = await (supabase.from("rate_rule_tiers") as any).update({ amount: u.amount }).eq("id", u.id);
    if (error) {
      throw new Error(`更新房價失敗：${error.message}`);
    }
  }
}
