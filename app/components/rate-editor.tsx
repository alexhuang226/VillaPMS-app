"use client";

/**
 * 房價編輯頁面
 *
 * 選一間民宿，底下列出這間民宿每一種房型配置（例如「四人套房」
 * 「降規雙人套房」），各自可以編輯 5 個價格欄位：平旺日、假日、
 * 節日、春節、跨年。
 *
 * 「平旺日」是平日跟旺日共用的同一個價格（見
 * lib/pricing/rate-editor.ts 開頭的說明：這是資料庫設計上刻意的
 * 決定，不是這裡少做了一個欄位），儲存時會同時更新兩筆底層資料，
 * 畫面上只需要填一次。
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Fraunces, Work_Sans } from "next/font/google";
import { getRoomConfigPricingAction, updateRoomConfigPricingAction } from "@/app/actions/pricing";
import type { RoomConfigPricing } from "@/lib/pricing/rate-editor";

const display = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  variable: "--font-display",
});
const body = Work_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
});

const colors = {
  canvas: "#FAF8F4",
  ink: "#221F1B",
  muted: "#57514A",
  line: "#D9D1C4",
  pine: "#33422E",
  pineSoft: "#E7EAE1",
  pineText: "#FFFFFF",
  alert: "#A23E2D",
  blue: "#2455A4",
  gold: "#A67C3D",
};

const PROPERTIES = [
  { id: "0a16233a-9846-421e-b6d6-ccced85792b4", code: "zhici", label: "只此清綠", color: "#5C7A4A" },
  { id: "c4fe9189-051f-4a3f-aa43-9f04b0043723", code: "moyin", label: "陌隱", color: colors.gold },
  { id: "146fe8ae-84b5-4170-8747-dd15afc4e722", code: "shuijing", label: "水景璞堤", color: colors.blue },
];

const PRICE_FIELDS: { key: keyof RoomConfigPricing; label: string }[] = [
  { key: "weekdayPrice", label: "平日" },
  { key: "peakPrice", label: "旺日" },
  { key: "holidayPrice", label: "假日" },
  { key: "festivalPrice", label: "節日" },
  { key: "lunarNewYearPrice", label: "春節" },
  { key: "newYearEvePrice", label: "跨年" },
];

export function RateEditor() {
  const [propertyId, setPropertyId] = useState(PROPERTIES[0].id);
  const [configs, setConfigs] = useState<RoomConfigPricing[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 每個房型配置各自獨立編輯／儲存，key 用 configLabel+roomTypeId
  const [editedValues, setEditedValues] = useState<Record<string, Partial<RoomConfigPricing>>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    loadPricing(propertyId);
  }, [propertyId]);

  async function loadPricing(pid: string) {
    setIsLoading(true);
    setError(null);
    setEditedValues({});
    setSavedKey(null);
    try {
      const data = await getRoomConfigPricingAction(pid);
      setConfigs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "讀取失敗，請稍後再試");
    } finally {
      setIsLoading(false);
    }
  }

  function configKey(c: RoomConfigPricing): string {
    return `${c.configLabel}|${c.roomTypeId}`;
  }

  function getValue(c: RoomConfigPricing, field: keyof RoomConfigPricing): number {
    const edited = editedValues[configKey(c)]?.[field];
    return typeof edited === "number" ? edited : (c[field] as number);
  }

  function updateValue(c: RoomConfigPricing, field: keyof RoomConfigPricing, value: number) {
    const key = configKey(c);
    setEditedValues((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  }

  async function handleSave(c: RoomConfigPricing) {
    const key = configKey(c);
    setSavingKey(key);
    setSaveError(null);
    setSavedKey(null);
    try {
      await updateRoomConfigPricingAction({
        weekdayTierId: c.weekdayTierId,
        peakTierId: c.peakTierId,
        holidayTierId: c.holidayTierId,
        festivalTierId: c.festivalTierId,
        lunarNewYearTierId: c.lunarNewYearTierId,
        newYearEveTierId: c.newYearEveTierId,
        weekdayPrice: getValue(c, "weekdayPrice"),
        peakPrice: getValue(c, "peakPrice"),
        holidayPrice: getValue(c, "holidayPrice"),
        festivalPrice: getValue(c, "festivalPrice"),
        lunarNewYearPrice: getValue(c, "lunarNewYearPrice"),
        newYearEvePrice: getValue(c, "newYearEvePrice"),
      });
      setSavedKey(key);
      await loadPricing(propertyId);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "儲存失敗，請稍後再試");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className={`${body.className} flex min-h-screen w-full justify-center px-5 py-8`} style={{ backgroundColor: colors.canvas }}>
      <div className="w-full" style={{ maxWidth: "24rem", color: colors.ink }}>
        <Link href="/" className="text-xs" style={{ color: colors.blue }}>
          ← 返回首頁
        </Link>
        <header className="mb-6 text-center">
          <p style={{ color: colors.muted }} className="text-[11px] tracking-[0.2em]">
            宜蘭・包棟民宿
          </p>
          <h1 className={`${display.className} text-4xl italic`} style={{ color: colors.ink }}>
            房價設定
          </h1>
        </header>

        <div className="mb-4 flex flex-wrap justify-center gap-2">
          {PROPERTIES.map((p) => {
            const active = propertyId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPropertyId(p.id)}
                className="rounded-full border px-3 py-1.5 text-xs transition-colors"
                style={
                  active
                    ? { borderColor: p.color, backgroundColor: p.color, color: "#FFFFFF" }
                    : { borderColor: colors.line, backgroundColor: "transparent", color: colors.ink }
                }
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {isLoading && (
          <p className="text-xs" style={{ color: colors.muted }}>
            讀取中…
          </p>
        )}
        {error && (
          <p role="alert" className="border-l-2 pl-3 text-xs leading-relaxed" style={{ borderColor: colors.alert, color: colors.alert }}>
            {error}
          </p>
        )}
        {!isLoading && configs && configs.length === 0 && (
          <p className="text-xs" style={{ color: colors.muted }}>
            這間民宿還沒有設定任何房型價格，需要先在資料庫建立 rate_rule_tiers（room_type_rate）才能在這裡編輯。
          </p>
        )}

        <div className="flex flex-col gap-3">
          {configs?.map((c) => {
            const key = configKey(c);
            return (
              <div key={key} className="border p-4" style={{ borderColor: colors.line }}>
                <p className={`${display.className} text-lg italic`}>{c.configLabel}</p>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  {PRICE_FIELDS.map((f) => (
                    <label key={f.key} className="flex flex-col gap-1">
                      <span style={{ color: colors.muted }} className="text-[11px]">
                        {f.label}
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={getValue(c, f.key)}
                        onChange={(e) => updateValue(c, f.key, Number(e.target.value))}
                        className="w-full border-b bg-transparent py-1 text-sm outline-none"
                        style={{ borderColor: colors.line, color: colors.ink }}
                      />
                    </label>
                  ))}
                </div>

                {savingKey === key && saveError && (
                  <p role="alert" className="mt-2 text-[11px]" style={{ color: colors.alert }}>
                    {saveError}
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => handleSave(c)}
                  disabled={savingKey === key}
                  className="mt-3 w-full py-2 text-xs tracking-wide disabled:opacity-50"
                  style={{ backgroundColor: colors.pine, color: colors.pineText }}
                >
                  {savingKey === key ? "儲存中…" : savedKey === key ? "已儲存 ✓" : "儲存"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
