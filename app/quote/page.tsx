import { QuoteForm } from "@/app/components/quote-form";

export default function QuotePage() {
  return (
    <main className="min-h-screen bg-slate-200 py-8 px-4 flex justify-center items-start font-sans text-slate-950">
      {/* 限制全頁最大寬度為 448px (max-w-md) 並自動居中 */}
      <div className="w-full max-w-md mx-auto">
        <QuoteForm />
      </div>
    </main>
  );
}