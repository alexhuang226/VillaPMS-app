"use client";

/**
 * 編輯民宿資料頁面
 *
 * 只有 3 間民宿，固定列出來，各自一張卡片，點「編輯」展開表單。
 * 涵蓋的欄位：民宿名稱、匯款帳號（銀行/分行/帳號/戶名）、地址、
 * 停車資訊、導航連結——這些都是報價單/訂房確認單會實際用到的
 * 資料，不含房型/價格設定（那些牽涉到計價引擎，改動風險高很多，
 * 不在這個頁面開放編輯）。
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Fraunces, Work_Sans } from "next/font/google";
import { getAllPropertiesSettingsAction, updatePropertySettingsAction } from "@/app/actions/property";
import type { PropertySettingsDetail, PropertySettingsFields } from "@/lib/pricing/queries";

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

  const [editingId, setEditingId] = useState<string | null>(null);
  const [fields, setFields] = useState<PropertySettingsFields | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
                    <button type="button" onClick={() => startEdit(p)} className="text-xs" style={{ color: colors.blue }}>
                      編輯
                    </button>
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
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
