// app/quote/page.tsx
import QuoteCalculator from "./QuoteCalculator";

export default function QuotePage() {
  return (
    <main style={{ padding: "20px 15px", backgroundColor: "#f5f5f7", minHeight: "100vh" }}>
      <QuoteCalculator />
    </main>
  );
}