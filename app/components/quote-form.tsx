"use client";

import { useState, useRef } from "react";
import { toPng } from "html-to-image";
import { Fraunces, Work_Sans } from "next/font/google";
import { calculateQuoteAction } from "@/app/actions/quote";
import type { PackageQuote, PropertyCode, RoomAllocationOverride, StayRequest } from "@/lib/pricing/types";

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
  pineText: "#FFFFFF",
  alert: "#A23E2D",
};

const PROPERTY_OPTIONS: { value: PropertyCode; label: string }[] = [
  { value: "zhici", label: "只此清綠" },
  { value: "moyin", label: "陌隱" },
  { value: "shuijing", label: "水景璞堤" },
];

interface FormState {
  propertyCode: PropertyCode;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  infants: number;
  pets: number;
  extraBedFixedQty: number;
  extraBedTempQty: number;
  extraRoomQty: number;
  visitorQty: number;
  discountAmount: number;
  bbq: boolean;
  foodTruck: boolean;
  earlyCheckin: boolean;
  needsInvoice: boolean;
  invoiceTitle: string;
  invoiceTaxId: string;
  useRoomOverride: boolean;
  overrideFourPersonSuiteCount: number;
  overrideFourPersonDowngradeCount: number;
  overrideDoubleSuiteCount: number;
  overrideDoublePlainCount: number;
}

/** 使用 UTC 計算，避免 toISOString 時區偏差 */
function addOneDay(dateStr: string): string {
  if (!dateStr) return "";
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + 1));
  return d.toISOString().slice(0, 10);
}

function getInitialDates() {
  const today = new Date();
  today.setMonth(today.getMonth() + 1);
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const checkIn = `${yyyy}-${mm}-${dd}`;
  const checkOut = addOneDay(checkIn);
  return { checkIn, checkOut };
}

const initialDates = getInitialDates();

const initialState: FormState = {
  propertyCode: "zhici",
  checkIn: initialDates.checkIn,
  checkOut: initialDates.checkOut,
  adults: 10,
  children: 0,
  infants: 0,
  pets: 0,
  extraBedFixedQty: 0,
  extraBedTempQty: 0,
  extraRoomQty: 0,
  visitorQty: 0,
  discountAmount: 0,
  bbq: false,
  foodTruck: false,
  earlyCheckin: false,
  needsInvoice: false,
  invoiceTitle: "",
  invoiceTaxId: "",
  useRoomOverride: false,
  overrideFourPersonSuiteCount: 0,
  overrideFourPersonDowngradeCount: 0,
  overrideDoubleSuiteCount: 0,
  overrideDoublePlainCount: 0,
};

function getChineseWeekday(dateStr: string): string {
  if (!dateStr) return "";
  const days = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
  const date = new Date(`${dateStr}T00:00:00`);
  return days[date.getDay()] || "";
}

function formatDateWithWeekday(dateStr: string): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  const weekday = getChineseWeekday(dateStr);
  return `${y}/${m}/${d} (${weekday})`;
}

function calculateNightsAndDays(checkIn: string, checkOut: string) {
  if (!checkIn || !checkOut) return "2天1夜";
  const d1 = new Date(`${checkIn}T00:00:00`);
  const d2 = new Date(`${checkOut}T00:00:00`);
  const diffTime = d2.getTime() - d1.getTime();
  const nights = Math.max(1, Math.round(diffTime / (1000 * 3600 * 24)));
  const days = nights + 1;
  return `${days}天${nights}夜`;
}

function formatGuests(form: FormState): string {
  const parts = [];
  if (form.adults > 0) parts.push(`${form.adults}大`);
  if (form.children > 0) parts.push(`${form.children}小`);
  if (form.infants > 0) parts.push(`${form.infants}幼`);
  if (form.pets > 0) parts.push(`${form.pets}寵`);
  return parts.join(" ") || "0人";
}

/** 1. 抓取計算後的房型配置數值 */
function formatRoomAllocation(quote: PackageQuote, form: FormState): string {
  const alloc = (quote as any).roomAllocation || (quote as any).rooms || (quote as any).allocatedRooms;

  let fourSuite = 0;
  let fourDowngrade = 0;
  let doubleSuite = 0;
  let doublePlain = 0;

  if (alloc) {
    fourSuite = alloc.fourPersonSuiteCount ?? alloc.fourSuite ?? 0;
    fourDowngrade = alloc.fourPersonDowngradeCount ?? alloc.fourDowngrade ?? 0;
    doubleSuite = alloc.doubleSuiteCount ?? alloc.doubleSuite ?? 0;
    doublePlain = alloc.doublePlainCount ?? alloc.doublePlain ?? 0;
  } else if (form.useRoomOverride) {
    fourSuite = form.overrideFourPersonSuiteCount;
    fourDowngrade = form.overrideFourPersonDowngradeCount;
    doubleSuite = form.overrideDoubleSuiteCount;
    doublePlain = form.overrideDoublePlainCount;
  } else {
    // 預設或備用計算推算
    fourSuite = (quote as any).fourPersonSuiteCount ?? 1;
    fourDowngrade = (quote as any).fourPersonDowngradeCount ?? 4;
  }

  const lines: string[] = [];
  if (fourSuite > 0) lines.push(`  └ ${fourSuite} 間四人套房`);
  if (fourDowngrade > 0) lines.push(`  └ ${fourDowngrade} 間四人套房(提供1床，以雙人套房計費)`);
  if (doubleSuite > 0) lines.push(`  └ ${doubleSuite} 間雙人套房`);
  if (doublePlain > 0) lines.push(`  └ ${doublePlain} 間雙人雅房`);

  return lines.length > 0 ? `• 房型配置：\n${lines.join("\n")}` : "• 房型配置：依現場安排";
}

/** 2. 根據入住日期自動判斷平日、旺日或假日資料 */
function getDayTypeRules(checkInStr: string, quote?: PackageQuote) {
  if (quote && (quote as any).dayTypeRule) {
    return (quote as any).dayTypeRule;
  }

  if (!checkInStr) {
    return {
      label: "旺日(週五/日/假日前)",
      minGuests: 16,
      doublePrice: "3,000",
      quadPrice: "5,200",
    };
  }

  const day = new Date(`${checkInStr}T00:00:00`).getDay(); // 0: 週日, 5: 週五, 6: 週六

  if (day === 6) {
    // 週六 (假日)
    return {
      label: "假日(週六/國定假日)",
      minGuests: (quote as any)?.minGuests ?? 22,
      doublePrice: "3,800",
      quadPrice: "6,600",
    };
  } else if (day === 5 || day === 0) {
    // 週五、週日 (旺日)
    return {
      label: "旺日(週五/日/假日前)",
      minGuests: (quote as any)?.minGuests ?? 16,
      doublePrice: "3,000",
      quadPrice: "5,200",
    };
  } else {
    // 週一至週四 (平日)
    return {
      label: "平日(週一至週四)",
      minGuests: (quote as any)?.minGuests ?? 10,
      doublePrice: "3,000",
      quadPrice: "5,200",
    };
  }
}

/** 產出動態格式化報價單 */
function buildFormattedQuoteText(quote: PackageQuote, form: FormState): string {
  const propertyName = PROPERTY_OPTIONS.find((opt) => opt.value === form.propertyCode)?.label || "只此清綠";
  const checkInFormatted = formatDateWithWeekday(form.checkIn);
  const checkOutFormatted = formatDateWithWeekday(form.checkOut);
  const durationStr = calculateNightsAndDays(form.checkIn, form.checkOut);
  const guestsStr = formatGuests(form);
  const roomAllocationStr = formatRoomAllocation(quote, form);
  const rules = getDayTypeRules(form.checkIn, quote);

  return `以下是根據您的需求，為您整理的 ${propertyName} 專屬包棟方案：

🏨 【${propertyName}包棟報價單】
━━━━━━━━━━━━━━
📅 預訂資訊
• 入住日期：${checkInFormatted}
• 退房日期：${checkOutFormatted}
• 預訂天數：${durationStr}
• 入住人數：${guestsStr}
${roomAllocationStr}
━━━━━━━━━━━━━━
💰 費用明細
┌────────────┐
 💰 住宿總金額：$${quote.packageTotal.toLocaleString()} 元
 🔹 訂金(3成)：$${quote.deposit.toLocaleString()} 元
 🔥 剩餘尾款：$${quote.balanceDue.toLocaleString()} 元
 ⏰ 請於入住前7天匯尾款。
└────────────┘
━━━━━━━━━━━━━━
🏦 匯款帳號
• 銀行：586 羅東農會
• 分行：本會
• 帳號：5860-11170-15325
• 戶名：黃祥峰
⚠️ 匯款後請告知，以便核對並保留房期！
━━━━━━━━━━━━━━
📝 預訂須知
👥 包棟基本人數(未達以低消計)：
 • ${rules.label}：${rules.minGuests} 人
 (*3歲以下幼童不算佔床)
🏷️ 房型訂價：
    ▸ ${rules.label}：
      • 雙人套房 $${rules.doublePrice} 元
      • 四人套房 $${rules.quadPrice} 元
🛏️ 房型調整：如需增開床位或變更房型，請再告知以方便重新報價。
🔄 人數結算：入住前 1 週根據最終人數結算尾款。
📌 退改政策：如需延期或取消，請於入住前 30 天通知。住宿當天因宜蘭颱風、地震等天災因素宜蘭縣政府宣佈停班時，全數退還住宿費用。`;
}

function buildStayRequest(form: FormState): StayRequest {
  const roomOverride: RoomAllocationOverride | undefined = form.useRoomOverride
    ? {
        fourPersonSuiteCount: form.overrideFourPersonSuiteCount,
        fourPersonDowngradeCount: form.overrideFourPersonDowngradeCount,
        doubleSuiteCount: form.overrideDoubleSuiteCount,
        doublePlainCount: form.overrideDoublePlainCount,
      }
    : undefined;

  return {
    propertyCode: form.propertyCode,
    checkIn: form.checkIn,
    checkOut: form.checkOut,
    adults: form.adults,
    children: form.children,
    infants: form.infants,
    pets: form.pets,
    extraBedFixedQty: form.extraBedFixedQty,
    extraBedTempQty: form.extraBedTempQty,
    extraRoomQty: form.extraRoomQty,
    visitorQty: form.visitorQty,
    discountAmount: form.discountAmount,
    addOns: { bbq: form.bbq, foodTruck: form.foodTruck, earlyCheckin: form.earlyCheckin },
    invoice: {
      required: form.needsInvoice,
      title: form.needsInvoice ? form.invoiceTitle : undefined,
      taxId: form.needsInvoice ? form.invoiceTaxId : undefined,
    },
    roomOverride,
  };
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
        {label}
      </span>
      <input
        type="number"
        min={0}
        inputMode="numeric"
        value={value === 0 ? "" : value}
        placeholder="0"
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const val = e.target.value;
          onChange(val === "" ? 0 : Number(val));
        }}
        className="qf-input w-full border-b bg-transparent py-1 text-center text-sm outline-none"
        style={{ borderColor: colors.line, color: colors.ink }}
      />
    </label>
  );
}

function PillToggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border px-3 py-1.5 text-xs transition-colors"
      style={
        active
          ? { borderColor: colors.pine, backgroundColor: colors.pine, color: colors.pineText }
          : { borderColor: colors.line, backgroundColor: "transparent", color: colors.ink }
      }
    >
      {label}
    </button>
  );
}

function SectionMark({ index, title }: { index: string; title: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <span className={`${display.className} text-sm italic`} style={{ color: colors.pine }}>
        {index}
      </span>
      <span style={{ color: colors.muted }} className="text-xs tracking-wide">
        {title}
      </span>
      <span className="h-px flex-1" style={{ backgroundColor: colors.line }} />
    </div>
  );
}

export function QuoteForm() {
  const [form, setForm] = useState<FormState>(initialState);
  const [quote, setQuote] = useState<PackageQuote | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedImage, setCopiedImage] = useState(false);
  const [isExporting, setIsExporting] = useState(false);  
  const quoteCardRef = useRef<HTMLDivElement>(null);

/** 將 DOM 轉為 PNG Blob 物件 */
  async function generateImageBlob(): Promise<{ blob: Blob; fileName: string } | null> {
    if (!quoteCardRef.current) return null;
    
    const dataUrl = await toPng(quoteCardRef.current, {
      cacheBust: true,
      backgroundColor: "#FAF8F4",
      pixelRatio: 2,
    });

    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const propertyName = PROPERTY_OPTIONS.find((opt) => opt.value === form.propertyCode)?.label || "報價單";
    const fileName = `${propertyName}_包棟報價單_${form.checkIn}.png`;

    return { blob, fileName };
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleCheckInChange(newCheckIn: string) {
    setForm((prev) => ({
      ...prev,
      checkIn: newCheckIn,
      checkOut: newCheckIn ? addOneDay(newCheckIn) : prev.checkOut,
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    setWarning(null);
    setQuote(null);
    setCopied(false);

    try {
      const result = await calculateQuoteAction(buildStayRequest(form));

      if (result.minimumGuestsWarning) {
        setWarning(result.minimumGuestsWarning);
        return;
      }
      if (result.roomConfigWarning) {
        setWarning(result.roomConfigWarning);
        return;
      }
      if (result.capacityWarning) {
        setWarning(result.capacityWarning);
        return;
      }
      setQuote(result);
    } catch (err) {
      setWarning(err instanceof Error ? err.message : "報價計算失敗，請稍後再試");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCopy() {
    if (!quote) return;
    const text = buildFormattedQuoteText(quote, form);

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setWarning("複製失敗，請手動選取文字複製");
    }
  }

  /** 方法一：複製圖片到剪貼簿（可在 LINE 貼上） */
  async function handleCopyImage() {
    setIsExporting(true);
    try {
      const imageData = await generateImageBlob();
      if (!imageData) return;

      // 使用 Web Clipboard API 寫入圖片
      const item = new ClipboardItem({ "image/png": imageData.blob });
      await navigator.clipboard.write([item]);

      setCopiedImage(true);
      setTimeout(() => setCopiedImage(false), 2000);
    } catch (err) {
      console.error("複製圖片失敗:", err);
      setWarning("您的瀏覽器不支援直接複製圖片，請改用「分享圖片」或「複製文字」");
    } finally {
      setIsExporting(false);
    }
  }

  /** 方法二：手機原生分享（直接傳給 LINE 好友，不存相簿） */
  async function handleShareImage() {
    setIsExporting(true);
    try {
      const imageData = await generateImageBlob();
      if (!imageData) return;

      const file = new File([imageData.blob], imageData.fileName, { type: "image/png" });

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "包棟報價單",
        });
      } else {
        // 不支援 Web Share 時退回到複製圖片
        await handleCopyImage();
      }
    } catch (err) {
      // 使用者取消分享不跳錯誤 Warning
      if ((err as Error).name !== "AbortError") {
        setWarning("分享失敗，請重試");
      }
    } finally {
      setIsExporting(false);
    }
  }

  const formattedQuoteText = quote ? buildFormattedQuoteText(quote, form) : "";

  return (
    <div
      className={`${body.className} qf-root flex min-h-screen w-full justify-center px-5 py-8`}
      style={{ backgroundColor: colors.canvas }}
    >
      <style>{`
        .qf-root .qf-input:focus { border-color: ${colors.pine} !important; }
      `}</style>

      <div className="w-full" style={{ maxWidth: "24rem", color: colors.ink }}>
        <header className="mb-6">
          <p style={{ color: colors.muted }} className="text-[11px] tracking-[0.2em]">
            宜蘭・包棟民宿
          </p>
          <h1 className={`${display.className} text-2xl italic`} style={{ color: colors.ink }}>
            報價試算
          </h1>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <section>
            <SectionMark index="Ⅰ" title="民宿與日期" />

            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                {PROPERTY_OPTIONS.map((opt) => (
                  <PillToggle
                    key={opt.value}
                    label={opt.label}
                    active={form.propertyCode === opt.value}
                    onClick={() => update("propertyCode", opt.value)}
                  />
                ))}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <label className="flex flex-col gap-1">
                  <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                    入住
                  </span>
                  <input
                    type="date"
                    value={form.checkIn}
                    onChange={(e) => handleCheckInChange(e.target.value)}
                    required
                    className="qf-input w-full border-b bg-transparent py-1 text-sm outline-none"
                    style={{ borderColor: colors.line, color: colors.ink }}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                    退房
                  </span>
                  <input
                    type="date"
                    value={form.checkOut}
                    min={form.checkIn || undefined}
                    onChange={(e) => update("checkOut", e.target.value)}
                    required
                    className="qf-input w-full border-b bg-transparent py-1 text-sm outline-none"
                    style={{ borderColor: colors.line, color: colors.ink }}
                  />
                </label>
              </div>
            </div>
          </section>

          <section>
            <SectionMark index="Ⅱ" title="入住人數" />
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-4">
                <NumberField label="大人" value={form.adults} onChange={(v) => update("adults", v)} />
                <NumberField label="小孩" value={form.children} onChange={(v) => update("children", v)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <NumberField label="嬰幼兒" value={form.infants} onChange={(v) => update("infants", v)} />
                <NumberField label="寵物" value={form.pets} onChange={(v) => update("pets", v)} />
              </div>
            </div>
          </section>

          <section>
            <SectionMark index="Ⅲ" title="額外服務" />
            <div className="flex flex-wrap gap-2">
              <PillToggle label="烤肉" active={form.bbq} onClick={() => update("bbq", !form.bbq)} />
              <PillToggle label="餐車" active={form.foodTruck} onClick={() => update("foodTruck", !form.foodTruck)} />
              <PillToggle
                label="提前入住"
                active={form.earlyCheckin}
                onClick={() => update("earlyCheckin", !form.earlyCheckin)}
              />
            </div>
          </section>

          <details className="group">
            <summary
              style={{ color: colors.muted }}
              className="cursor-pointer list-none text-xs tracking-wide"
            >
              <span className="inline-flex items-center gap-1">
                進階選項 — 訪客・加床加房・折扣・發票・房型調整
                <span className="transition-transform group-open:rotate-180">⌄</span>
              </span>
            </summary>

            <div className="mt-4 flex flex-col gap-6 border-t pt-4" style={{ borderColor: colors.line }}>
              <div className="grid grid-cols-3 gap-3">
                <NumberField label="加固定床" value={form.extraBedFixedQty} onChange={(v) => update("extraBedFixedQty", v)} />
                <NumberField label="加臨時床" value={form.extraBedTempQty} onChange={(v) => update("extraBedTempQty", v)} />
              </div>
              <div>
                <NumberField label="加開房間數量" value={form.extraRoomQty} onChange={(v) => update("extraRoomQty", v)} />
                <NumberField label="訪客人數" value={form.visitorQty} onChange={(v) => update("visitorQty", v)} />
              </div>

              <NumberField label="優惠折扣金額" value={form.discountAmount} onChange={(v) => update("discountAmount", v)} />

              <div>
                <label className="flex items-center gap-2 text-xs" style={{ color: colors.ink }}>
                  <input
                    type="checkbox"
                    checked={form.needsInvoice}
                    onChange={(e) => update("needsInvoice", e.target.checked)}
                    className="h-3.5 w-3.5"
                    style={{ accentColor: colors.pine }}
                  />
                  需要開立發票
                </label>
                {form.needsInvoice && (
                  <div className="mt-3 grid grid-cols-2 gap-4">
                    <label className="flex flex-col gap-1">
                      <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                        發票抬頭
                      </span>
                      <input
                        type="text"
                        value={form.invoiceTitle}
                        onChange={(e) => update("invoiceTitle", e.target.value)}
                        className="qf-input w-full border-b bg-transparent py-1 text-sm outline-none"
                        style={{ borderColor: colors.line, color: colors.ink }}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span style={{ color: colors.muted }} className="text-[11px] tracking-wide">
                        統一編號
                      </span>
                      <input
                        type="text"
                        value={form.invoiceTaxId}
                        onChange={(e) => update("invoiceTaxId", e.target.value)}
                        className="qf-input w-full border-b bg-transparent py-1 text-sm outline-none"
                        style={{ borderColor: colors.line, color: colors.ink }}
                      />
                    </label>
                  </div>
                )}
              </div>

              <div>
                <label className="flex items-center gap-2 text-xs" style={{ color: colors.ink }}>
                  <input
                    type="checkbox"
                    checked={form.useRoomOverride}
                    onChange={(e) => update("useRoomOverride", e.target.checked)}
                    className="h-3.5 w-3.5"
                    style={{ accentColor: colors.pine }}
                  />
                  手動調整房型（加開房間／變更房型）
                </label>
                {form.useRoomOverride && (
                  <div className="mt-3 grid grid-cols-2 gap-4">
                    <NumberField
                      label="四人套房（全額）"
                      value={form.overrideFourPersonSuiteCount}
                      onChange={(v) => update("overrideFourPersonSuiteCount", v)}
                    />
                    <NumberField
                      label="降規雙人套房"
                      value={form.overrideFourPersonDowngradeCount}
                      onChange={(v) => update("overrideFourPersonDowngradeCount", v)}
                    />
                    <NumberField
                      label="獨立雙人套房"
                      value={form.overrideDoubleSuiteCount}
                      onChange={(v) => update("overrideDoubleSuiteCount", v)}
                    />
                    <NumberField
                      label="獨立雙人雅房"
                      value={form.overrideDoublePlainCount}
                      onChange={(v) => update("overrideDoublePlainCount", v)}
                    />
                  </div>
                )}
              </div>
            </div>
          </details>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 text-sm tracking-wide transition-opacity disabled:opacity-50"
            style={{ backgroundColor: colors.pine, color: colors.pineText }}
          >
            {isLoading ? "計算中..." : "立即計算報價"}
          </button>
        </form>

        {warning && (
          <p
            role="alert"
            className="mt-6 border-l-2 pl-3 text-xs leading-relaxed"
            style={{ borderColor: colors.alert, color: colors.alert }}
          >
            {warning}
          </p>
        )}

        {quote && !warning && (
          <div className="mt-6 border-t pt-5" style={{ borderColor: colors.line }}>
            <div className="mb-3 flex items-center justify-between">
              <span style={{ color: colors.muted }} className="text-xs font-bold tracking-wide">
                報價明細產出
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="border px-3 py-1 text-xs transition-colors"
                style={
                  copied
                    ? { borderColor: colors.pine, backgroundColor: colors.pine, color: colors.pineText }
                    : { borderColor: colors.line, backgroundColor: "transparent", color: colors.ink }
                }
              >
                {copied ? "已複製報價單 ✓" : "複製報價單內容"}
              </button>

              {/* 2. 複製圖片 (貼上用) */}
              <button
                type="button"
                onClick={handleCopyImage}
                disabled={isExporting}
                className="border px-2.5 py-1 text-xs transition-colors disabled:opacity-50"
                style={{ borderColor: colors.line, backgroundColor: "transparent", color: colors.ink }}
              >
                {copiedImage ? "已複製圖片 ✓" : "複製圖片 📋"}
              </button>

              {/* 3. 手機直接分享 (不佔相簿空間) */}
              <button
                type="button"
                onClick={handleShareImage}
                disabled={isExporting}
                className="border px-2.5 py-1 text-xs transition-colors disabled:opacity-50"
                style={{ borderColor: colors.pine, backgroundColor: colors.pine, color: colors.pineText }}
              >
                {isExporting ? "處理中..." : "分享圖片 📤"}
              </button>
            </div>

          {/* 報價單卡片內容 */}
          <div
            ref={quoteCardRef}
            className="rounded-lg p-4 border"
            style={{
              backgroundColor: "#FAF8F4",
              borderColor: colors.line,
            }}
          >
            <pre
              className="w-full whitespace-pre-wrap text-xs leading-relaxed"
              style={{
                color: colors.ink,
                fontFamily: "monospace",
              }}
            >
              {formattedQuoteText}
            </pre>
          </div>
          </div>
        )}
      </div>
    </div>
  );
}