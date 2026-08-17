"use client";

/**
 * 報價表單元件 — 意式極簡風格
 *
 * v3 修正紀錄（接續 v2 之後，寬度撐滿畫面／文字太淡的問題仍然存在）：
 *
 * 關鍵改變：顏色與「最大寬度／置中」這兩件事，全部改用 inline style
 * 直接寫在元素上，不再依賴 Tailwind 的 `bg-[#...]` / `text-[#...]` /
 * `max-w-sm` 這類 class。原因是：inline style 的 CSS 優先權
 * （specificity）比任何一般的 class 選擇器都高，不管專案的 Tailwind
 * content 掃描路徑有沒有含到這個檔案、或全域 globals.css 有沒有設定
 * 衝突的 body 文字顏色／寬度，inline style 都保證會蓋過去、正確顯示。
 * 版面用的 flex/grid/間距還是用 Tailwind class（這些沒被回報有問題，
 * 而且都是標準 utility，出問題機率低很多）。
 *
 * focus 狀態（輸入框聚焦時邊框變深綠）inline style 沒辦法直接寫
 * `:focus` 偽類，所以用一個小小的 <style> 標籤搭配專屬 class name
 * (.qf-input) 處理，一樣不依賴 Tailwind。
 *
 * 新增：報價結果算出來之後，多一個「複製報價內容」按鈕，把整段報價
 * 明細組成純文字複製到剪貼簿，方便貼到 LINE／簡訊給客人。
 */

import { useState } from "react";
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

const initialState: FormState = {
  propertyCode: "zhici",
  checkIn: "",
  checkOut: "",
  adults: 0,
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

/** 'YYYY-MM-DD' 字串加一天，回傳新的 'YYYY-MM-DD' 字串 */
function addOneDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
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

/** 把報價結果組成一段純文字，給複製到剪貼簿使用 */
function buildCopyText(quote: PackageQuote, propertyLabel: string): string {
  const { request } = quote;
  const lines: string[] = [];

  lines.push(`${propertyLabel}　${request.checkIn} ～ ${request.checkOut}（${quote.nights} 晚）`);
  lines.push(
    `大人 ${request.adults}・小孩 ${request.children}・嬰幼兒 ${request.infants ?? 0}・寵物 ${request.pets ?? 0}`
  );
  lines.push("");
  lines.push(`住宿費用　NT$ ${quote.accommodationTotal.toLocaleString()}`);
  if (quote.extraBedFee > 0) lines.push(`加床費用　NT$ ${quote.extraBedFee.toLocaleString()}`);
  if (quote.extraRoomFee > 0) lines.push(`加開房間　NT$ ${quote.extraRoomFee.toLocaleString()}`);
  if (quote.petCleaningFee > 0) lines.push(`寵物清潔費　NT$ ${quote.petCleaningFee.toLocaleString()}`);
  if (quote.addOnFee > 0) lines.push(`額外服務　NT$ ${quote.addOnFee.toLocaleString()}`);
  if (quote.visitorFee > 0) lines.push(`訪客費用　NT$ ${quote.visitorFee.toLocaleString()}`);
  if (quote.discountAmount > 0) lines.push(`優惠折扣　－NT$ ${quote.discountAmount.toLocaleString()}`);
  lines.push("");
  lines.push(`包棟總費用　NT$ ${quote.packageTotal.toLocaleString()}`);
  lines.push(`訂金　NT$ ${quote.deposit.toLocaleString()}`);
  lines.push(`尾款　NT$ ${quote.balanceDue.toLocaleString()}`);

  return lines.join("\n");
}

/** 緊湊型數字輸入：底線樣式，label 在上方，數字置中 */
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
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="qf-input w-full border-b bg-transparent py-1 text-center text-sm outline-none"
        style={{ borderColor: colors.line, color: colors.ink }}
      />
    </label>
  );
}

/** 藥丸型切換按鈕，用於單選（民宿）與複選（額外服務） */
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

/** 小型羅馬數字段落標題，做為版面的節奏標記 */
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

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleCheckInChange(newCheckIn: string) {
    setForm((prev) => {
      const shouldAutoAdvance = !prev.checkOut || prev.checkOut <= newCheckIn;
      return {
        ...prev,
        checkIn: newCheckIn,
        checkOut: newCheckIn && shouldAutoAdvance ? addOneDay(newCheckIn) : prev.checkOut,
      };
    });
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
    const propertyLabel =
      PROPERTY_OPTIONS.find((opt) => opt.value === quote.request.propertyCode)?.label ?? "";
    const text = buildCopyText(quote, propertyLabel);

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setWarning("複製失敗，請手動選取文字複製");
    }
  }

  return (
    <div
      className={`${body.className} qf-root flex min-h-screen w-full justify-center px-5 py-8`}
      style={{ backgroundColor: colors.canvas }}
    >
      {/* focus 狀態用 :focus 偽類處理，inline style 無法直接寫偽類，
          用 !important 蓋過元素本身的 inline borderColor */}
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
                <NumberField label="訪客人數" value={form.visitorQty} onChange={(v) => update("visitorQty", v)} />
                <NumberField label="加固定床" value={form.extraBedFixedQty} onChange={(v) => update("extraBedFixedQty", v)} />
                <NumberField label="加臨時床" value={form.extraBedTempQty} onChange={(v) => update("extraBedTempQty", v)} />
              </div>

              <NumberField label="加開房間數量" value={form.extraRoomQty} onChange={(v) => update("extraRoomQty", v)} />

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
            {isLoading ? "計算中" : "立即計算報價"}
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
            <p style={{ color: colors.muted }} className="text-[11px] tracking-wide">
              包棟總費用
            </p>
            <p className={`${display.className} text-4xl italic`} style={{ color: colors.ink }}>
              NT$ {quote.packageTotal.toLocaleString()}
            </p>

            <dl className="mt-4 flex flex-col gap-1.5 text-xs" style={{ color: colors.muted }}>
              <Row label="住宿費用" value={quote.accommodationTotal} />
              {quote.extraBedFee > 0 && <Row label="加床費用" value={quote.extraBedFee} />}
              {quote.extraRoomFee > 0 && <Row label="加開房間" value={quote.extraRoomFee} />}
              {quote.petCleaningFee > 0 && <Row label="寵物清潔費" value={quote.petCleaningFee} />}
              {quote.addOnFee > 0 && <Row label="額外服務" value={quote.addOnFee} />}
              {quote.visitorFee > 0 && <Row label="訪客費用" value={quote.visitorFee} />}
              {quote.discountAmount > 0 && <Row label="優惠折扣" value={-quote.discountAmount} />}
            </dl>

            <div className="mt-4 flex items-baseline justify-between border-t pt-3" style={{ borderColor: colors.line }}>
              <span style={{ color: colors.muted }} className="text-xs tracking-wide">
                訂金
              </span>
              <span style={{ color: colors.ink }} className="text-sm">
                NT$ {quote.deposit.toLocaleString()}
              </span>
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <span style={{ color: colors.muted }} className="text-xs tracking-wide">
                尾款
              </span>
              <span style={{ color: colors.ink }} className="text-sm">
                NT$ {quote.balanceDue.toLocaleString()}
              </span>
            </div>

            <button
              type="button"
              onClick={handleCopy}
              className="mt-5 w-full border py-2.5 text-xs tracking-wide transition-colors"
              style={
                copied
                  ? { borderColor: colors.pine, backgroundColor: colors.pine, color: colors.pineText }
                  : { borderColor: colors.line, backgroundColor: "transparent", color: colors.ink }
              }
            >
              {copied ? "已複製 ✓" : "複製報價內容"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between">
      <span>{label}</span>
      <span>
        {value < 0 ? "－" : ""}NT$ {Math.abs(value).toLocaleString()}
      </span>
    </div>
  );
}
