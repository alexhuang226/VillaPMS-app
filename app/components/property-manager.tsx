"use client";

/**
 * 編輯民宿資料頁面（已併入房價設定）
 *
 * 只有 3 間民宿，固定列出來，各自一張卡片。每張卡片有兩個獨立的
 * 編輯入口：
 * - 「編輯」：民宿基本資料（名稱/匯款帳號/地址/停車/導航連結）
 * - 「編輯房價」：這間民宿每種房型配置在平日/旺日/假日/節日/春節/
 *   跨年的價格（原本是獨立的 /pricing 頁面，併進來這裡，同一個
 *   畫面就能處理跟這間民宿有關的全部設定，不用再多開一個功能選單）
 *
 * 這兩個編輯區塊各自獨立展開/收合、互不影響。
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Fraunces, Work_Sans } from "next/font/google";
import { getAllPropertiesSettingsAction, updatePropertySettingsAction } from "@/app/actions/property";
import type { PropertySettingsDetail, PropertySettingsFields } from "@/lib/pricing/queries";
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
};

const PRICE_FIELDS: { key: keyof RoomConfigPricing; label: string }[] = [
  { key: "weekdayPrice", label: "平日" },
  { key: "peakPrice", label: "旺日" },
  { key: "holidayPrice", label: "假日" },
  { key: "festivalPrice", label: "節日" },
  { key: "lunarNewYearPrice", label: "春節" },
  { key: "newYearEvePrice", label: "跨年" },
];

function detailToFields(detail: PropertySettingsDetail): PropertySettingsFields {
  return {
    name: detail.name,
    bankName: detail.bankName ?? "",
    bankBranch: detail.bankBranch ?? "",
    bankAccountFull: detail.bankAccountFull ?? "",
    accountName: detail.accountName ?? "",
    address: detail.address ?? "",
    parkingInfo: detail.parkingInfo ?? "",
    mapUrl: detail.mapUrl ?? "",
  };
}

function toNullableFields(fields: PropertySettingsFields): PropertySettingsFields {
  return {
    name: fields.name.trim(),
    bankName: fields.bankName?.trim() || null,
    bankBranch: fields.bankBranch?.trim() || null,
    bankAccountFull: fields.bankAccountFull?.trim() || null,
    accountName: fields.accountName?.trim() || null,
    address: fields.address?.trim() || null,
    parkingInfo: fields.parkingInfo?.trim() || null,
    mapUrl: fields.mapUrl?.trim() || null,
  };
}

export function PropertyManager() {
  const [properties, setProperties] = useState<PropertySettingsDetail[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 民宿基本資料編輯
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fields, setFields] = useState<PropertySettingsFields | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 房價編輯（原 /pricing 頁面併過來的部分）——一次只會展開一間
  // 民宿的房價，用 propertyId 記錄目前展開的是哪一間
  const [pricingOpenId, setPricingOpenId] = useState<string | null>(null);
  const [pricingConfigs, setPricingConfigs] = useState<RoomConfigPricing[] | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [pricingEditedValues, setPricingEditedValues] = useState<Record<string, Partial<RoomConfigPricing>>>({});
  const [pricingSavingKey, setPricingSavingKey] = useState<string | null>(null);
  const [pricingSavedKey, setPricingSavedKey] = useState<string | null>(null);
  const [pricingSaveError, setPricingSaveError] = useState<string | null>(null);

  useEffect(() => {
    loadProperties();
  }, []);

  async function loadProperties() {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await getAllPropertiesSettingsAction();
      setProperties(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "讀取失敗，請稍後再試");
    } finally {
      setIsLoading(false);
    }
  }

  function startEdit(detail: PropertySettingsDetail) {
    setFields(detailToFields(detail));
    setSaveError(null);
    setEditingId(detail.propertyId);
  }

  function cancelEdit() {
    setEditingId(null);
    setSaveError(null);
  }

  function updateField<K extends keyof PropertySettingsFields>(key: K, value: PropertySettingsFields[K]) {
    setFields((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId || !fields) return;
    if (!fields.name.trim()) {
      setSaveError("請填寫民宿名稱");
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      await updatePropertySettingsAction(editingId, toNullableFields(fields));
      setEditingId(null);
      await loadProperties();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "儲存失敗，請稍後再試");
    } finally {
      setIsSaving(false);
    }
  }

  async function togglePricing(propertyId: string) {
    if (pricingOpenId === propertyId) {
      setPricingOpenId(null);
      return;
    }
    setPricingOpenId(propertyId);
    setPricingLoading(true);
    setPricingError(null);
    setPricingEditedValues({});
    setPricingSavedKey(null);
    try {
      const data = await getRoomConfigPricingAction(propertyId);
      setPricingConfigs(data);
    } catch (err) {
      setPricingError(err instanceof Error ? err.message : "讀取失敗，請稍後再試");
    } finally {
      setPricingLoading(false);
    }
  }

  function pricingConfigKey(c: RoomConfigPricing): string {
    return `${c.configLabel}|${c.roomTypeId}`;
  }

  function getPricingValue(c: RoomConfigPricing, field: keyof RoomConfigPricing): number {
    const edited = pricingEditedValues[pricingConfigKey(c)]?.[field];
    return typeof edited === "number" ? edited : (c[field] as number);
  }

  function updatePricingValue(c: RoomConfigPricing, field: keyof RoomConfigPricing, value: number) {
    const key = pricingConfigKey(c);
    setPricingEditedValues((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  }

  async function handleSavePricing(c: RoomConfigPricing) {
    if (!pricingOpenId) return;
    const key = pricingConfigKey(c);
    setPricingSavingKey(key);
    setPricingSaveError(null);
    setPricingSavedKey(null);
    try {
      await updateRoomConfigPricingAction({
        weekdayTierId: c.weekdayTierId,
        peakTierId: c.peakTierId,
        holidayTierId: c.holidayTierId,
        festivalTierId: c.festivalTierId,
        lunarNewYearTierId: c.lunarNewYearTierId,
        newYearEveTierId: c.newYearEveTierId,
        weekdayPrice: getPricingValue(c, "weekdayPrice"),
        peakPrice: getPricingValue(c, "peakPrice"),
        holidayPrice: getPricingValue(c, "holidayPrice"),
        festivalPrice: getPricingValue(c, "festivalPrice"),
        lunarNewYearPrice: getPricingValue(c, "lunarNewYearPrice"),
        newYearEvePrice: getPricingValue(c, "newYearEvePrice"),
      });
      setPricingSavedKey(key);
      const data = await getRoomConfigPricingAction(pricingOpenId);
      setPricingConfigs(data);
    } catch (err) {
      setPricingSaveError(err instanceof Error ? err.message : "儲存失敗，請稍後再試");
    } finally {
      setPricingSavingKey(null);
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
            民宿資料
          </h1>
        </header>

        {isLoading && (
          <p className="text-xs" style={{ color: colors.muted }}>
            讀取中…
          </p>
        )}
        {loadError && (
          <p role="alert" className="border-l-2 pl-3 text-xs leading-relaxed" style={{ borderColor: colors.alert, color: colors.alert }}>
            {loadError}
          </p>
        )}

        <div className="flex flex-col gap-3">
          {properties?.map((p) => (
            <div key={p.propertyId} className="border p-4" style={{ borderColor: colors.line }}>
              {editingId === p.propertyId && fields ? (
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                  <label className="flex flex-col gap-1">
                    <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                      民宿名稱
                    </span>
                    <input
                      type="text"
                      value={fields.name}
                      onChange={(e) => updateField("name", e.target.value)}
                      required
                      className="w-full border-b bg-transparent py-1 text-sm outline-none"
                      style={{ borderColor: colors.line, color: colors.ink }}
                    />
                  </label>

                  <p className="text-[11px] font-bold" style={{ color: colors.ink }}>
                    匯款帳號
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <label className="flex flex-col gap-1">
                      <span style={{ color: colors.muted }} className="text-[11px]">
                        銀行
                      </span>
                      <input
                        type="text"
                        value={fields.bankName ?? ""}
                        onChange={(e) => updateField("bankName", e.target.value)}
                        className="w-full border-b bg-transparent py-1 text-sm outline-none"
                        style={{ borderColor: colors.line, color: colors.ink }}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span style={{ color: colors.muted }} className="text-[11px]">
                        分行
                      </span>
                      <input
                        type="text"
                        value={fields.bankBranch ?? ""}
                        onChange={(e) => updateField("bankBranch", e.target.value)}
                        className="w-full border-b bg-transparent py-1 text-sm outline-none"
                        style={{ borderColor: colors.line, color: colors.ink }}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span style={{ color: colors.muted }} className="text-[11px]">
                        帳號
                      </span>
                      <input
                        type="text"
                        value={fields.bankAccountFull ?? ""}
                        onChange={(e) => updateField("bankAccountFull", e.target.value)}
                        className="w-full border-b bg-transparent py-1 text-sm outline-none"
                        style={{ borderColor: colors.line, color: colors.ink }}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span style={{ color: colors.muted }} className="text-[11px]">
                        戶名
                      </span>
                      <input
                        type="text"
                        value={fields.accountName ?? ""}
                        onChange={(e) => updateField("accountName", e.target.value)}
                        className="w-full border-b bg-transparent py-1 text-sm outline-none"
                        style={{ borderColor: colors.line, color: colors.ink }}
                      />
                    </label>
                  </div>

                  <p className="text-[11px] font-bold" style={{ color: colors.ink }}>
                    訂房確認單用資訊
                  </p>
                  <label className="flex flex-col gap-1">
                    <span style={{ color: colors.muted }} className="text-[11px]">
                      地址
                    </span>
                    <input
                      type="text"
                      value={fields.address ?? ""}
                      onChange={(e) => updateField("address", e.target.value)}
                      className="w-full border-b bg-transparent py-1 text-sm outline-none"
                      style={{ borderColor: colors.line, color: colors.ink }}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span style={{ color: colors.muted }} className="text-[11px]">
                      停車資訊
                    </span>
                    <input
                      type="text"
                      value={fields.parkingInfo ?? ""}
                      onChange={(e) => updateField("parkingInfo", e.target.value)}
                      className="w-full border-b bg-transparent py-1 text-sm outline-none"
                      style={{ borderColor: colors.line, color: colors.ink }}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span style={{ color: colors.muted }} className="text-[11px]">
                      導航連結
                    </span>
                    <input
                      type="text"
                      value={fields.mapUrl ?? ""}
                      onChange={(e) => updateField("mapUrl", e.target.value)}
                      className="w-full border-b bg-transparent py-1 text-sm outline-none"
                      style={{ borderColor: colors.line, color: colors.ink }}
                    />
                  </label>

                  {saveError && (
                    <p role="alert" className="text-xs leading-relaxed" style={{ color: colors.alert }}>
                      {saveError}
                    </p>
                  )}

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={cancelEdit}
                      disabled={isSaving}
                      className="flex-1 border py-2 text-xs tracking-wide disabled:opacity-50"
                      style={{ borderColor: colors.line, color: colors.ink }}
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="flex-1 py-2 text-xs tracking-wide disabled:opacity-50"
                      style={{ backgroundColor: colors.pine, color: colors.pineText }}
                    >
                      {isSaving ? "儲存中…" : "儲存"}
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="flex items-baseline justify-between">
                    <span className={`${display.className} text-xl italic`}>{p.name}</span>
                    <div className="flex gap-3">
                      <button type="button" onClick={() => startEdit(p)} className="text-xs" style={{ color: colors.blue }}>
                        編輯
                      </button>
                      <button type="button" onClick={() => togglePricing(p.propertyId)} className="text-xs" style={{ color: colors.blue }}>
                        {pricingOpenId === p.propertyId ? "收合房價" : "編輯房價"}
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-col gap-0.5 text-xs" style={{ color: colors.muted }}>
                    <p>
                      {p.bankName || "（未填銀行）"} {p.bankBranch}　{p.bankAccountFull || "（未填帳號）"}　{p.accountName}
                    </p>
                    <p>{p.address || "（未填地址）"}</p>
                    <p>{p.parkingInfo || "（未填停車資訊）"}</p>
                  </div>
                </>
              )}

              {pricingOpenId === p.propertyId && (
                <div className="mt-3 border-t pt-3" style={{ borderColor: colors.line }}>
                  {pricingLoading && (
                    <p className="text-xs" style={{ color: colors.muted }}>
                      讀取中…
                    </p>
                  )}
                  {pricingError && (
                    <p role="alert" className="text-xs leading-relaxed" style={{ color: colors.alert }}>
                      {pricingError}
                    </p>
                  )}
                  {!pricingLoading && pricingConfigs && pricingConfigs.length === 0 && (
                    <p className="text-xs" style={{ color: colors.muted }}>
                      這間民宿還沒有設定任何房型價格，需要先在資料庫建立 rate_rule_tiers（room_type_rate）才能在這裡編輯。
                    </p>
                  )}
                  <div className="flex flex-col gap-3">
                    {pricingConfigs?.map((c) => {
                      const key = pricingConfigKey(c);
                      return (
                        <div key={key} className="border p-3" style={{ borderColor: colors.line }}>
                          <p className={`${display.className} text-base italic`}>{c.configLabel}</p>
                          <div className="mt-2 grid grid-cols-2 gap-3">
                            {PRICE_FIELDS.map((f) => (
                              <label key={f.key} className="flex flex-col gap-1">
                                <span style={{ color: colors.muted }} className="text-[11px]">
                                  {f.label}
                                </span>
                                <input
                                  type="number"
                                  min={0}
                                  value={getPricingValue(c, f.key)}
                                  onChange={(e) => updatePricingValue(c, f.key, Number(e.target.value))}
                                  className="w-full border-b bg-transparent py-1 text-sm outline-none"
                                  style={{ borderColor: colors.line, color: colors.ink }}
                                />
                              </label>
                            ))}
                          </div>

                          {pricingSavingKey === key && pricingSaveError && (
                            <p role="alert" className="mt-2 text-[11px]" style={{ color: colors.alert }}>
                              {pricingSaveError}
                            </p>
                          )}

                          <button
                            type="button"
                            onClick={() => handleSavePricing(c)}
                            disabled={pricingSavingKey === key}
                            className="mt-3 w-full py-2 text-xs tracking-wide disabled:opacity-50"
                            style={{ backgroundColor: colors.pine, color: colors.pineText }}
                          >
                            {pricingSavingKey === key ? "儲存中…" : pricingSavedKey === key ? "已儲存 ✓" : "儲存"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
