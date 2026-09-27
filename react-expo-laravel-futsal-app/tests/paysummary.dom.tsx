import { dom } from "./domsetup.mjs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { BookingPaymentSummary } from "@/components/BookingPaymentSummary";

let fetches = 0;
const LEDGER = {
  totals: {
    courtPrice: 1700, extrasTotal: 300, owed: 2000, paid: 2000, balance: 0, surplus: 0,
    byMethod: { eSewa: 700, Khalti: 500, "Cash at Venue": 800 }, settled: true,
  },
  payments: [
    { id: 1, amount: 700, method: "eSewa", reference: "MOCK-ESEWA-33", note: "", voidedAt: null },
    { id: 2, amount: 500, method: "Khalti", reference: "MOCK-gw-test", note: "", voidedAt: null },
    { id: 3, amount: 800, method: "Cash at Venue", reference: "", note: "handed over at the counter", voidedAt: null },
    { id: 4, amount: 9999, method: "Cash at Venue", reference: "", note: "mistyped", voidedAt: "2026-09-22T00:00:00.000Z" },
  ],
  extras: [
    { id: 5, label: "Water x10", amount: 300, voidedAt: null },
    { id: 6, label: "Struck through", amount: 5000, voidedAt: "2026-09-22T00:00:00.000Z" },
  ],
};

(globalThis as Record<string, unknown>).fetch = (async (url: string) => {
  fetches++;
  return new Response(JSON.stringify(LEDGER), { status: 200, headers: { "Content-Type": "application/json" } });
}) as unknown as typeof fetch;

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  → " + extra : "")); }
};

const container = dom.window.document.getElementById("root")!;
const root = createRoot(container as never);
await act(async () => { root.render(<BookingPaymentSummary bookingId={33} />); });
await act(async () => { await new Promise((r) => setTimeout(r, 40)); });

const txt = () => container.textContent ?? "";
const toggle = () => [...container.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Payment details"));

ok("the expander is offered", !!toggle());
ok("nothing is fetched until it's opened", fetches === 0, String(fetches));
ok("the breakdown is hidden", !txt().includes("Court fee"));

await act(async () => { toggle()!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 60)); });

ok("opening fetches the ledger once", fetches === 1, String(fetches));
ok("the court fee shows", txt().includes("Court fee") && txt().includes("Rs. 1,700"));
ok("the extras show", txt().includes("Extras") && txt().includes("Rs. 300"));
ok("the total is court + extras", txt().includes("Total") && txt().includes("Rs. 2,000"));
ok("the paid figure shows", txt().includes("Paid"));
ok("no outstanding balance is shown", !txt().includes("still to pay"));

const rows = [...container.querySelectorAll("li")].map((li) => li.textContent ?? "");
ok("all three mediums are itemised",
   rows.some((r) => r.includes("eSewa")) && rows.some((r) => r.includes("Khalti")) && rows.some((r) => r.includes("Cash at venue")),
   JSON.stringify(rows));
ok("the gateway reference is shown", rows.some((r) => r.includes("MOCK-ESEWA-33")), JSON.stringify(rows));
ok("a note is shown when there's no reference", rows.some((r) => r.includes("handed over at the counter")));
ok("the voided instalment is NOT shown", !rows.some((r) => r.includes("mistyped")), JSON.stringify(rows));
ok("the voided extra is NOT shown", !txt().includes("Struck through"));
ok("the extra line item is shown", txt().includes("Water x10"));

// Collapse and reopen — must not refetch.
await act(async () => { toggle()!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
ok("it collapses", !txt().includes("Court fee"));
await act(async () => { toggle()!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
ok("reopening reuses the cached data", fetches === 1, String(fetches));
ok("and shows the breakdown again", txt().includes("Court fee"));

console.log(fail === 0 ? `\nALL PASS (${pass}/${pass})` : `\n${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
