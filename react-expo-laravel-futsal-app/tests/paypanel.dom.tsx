import { dom } from "./domsetup.mjs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { BookingLedgerPanel } from "@/components/BookingLedgerPanel";

type Pay = { id: number; amount: number; method: string; note: string; source: string; voidedAt: string | null; createdAt: string | null };
type Ex = { id: number; label: string; amount: number; voidedAt: string | null; createdAt: string | null };

let payments: Pay[] = [];
let extras: Ex[] = [];
let settledAt: string | null = null;
let nextId = 1;

const COURT = 1700;
const live = <T extends { voidedAt: string | null }>(rows: T[]) => rows.filter((r) => !r.voidedAt);
const totals = () => {
  const paid = live(payments).reduce((t, p) => t + p.amount, 0);
  const extrasTotal = live(extras).reduce((t, x) => t + x.amount, 0);
  const owed = COURT + extrasTotal;
  const byMethod: Record<string, number> = {};
  for (const p of live(payments)) byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount;
  return {
    courtPrice: COURT, extrasTotal, owed, paid,
    balance: paid < owed ? owed - paid : 0,
    surplus: paid > owed ? paid - owed : 0,
    byMethod, settled: Boolean(settledAt),
  };
};

const calls: { action: string; [k: string]: unknown }[] = [];
(globalThis as Record<string, unknown>).fetch = (async (url: string, init?: RequestInit) => {
  const json = (o: unknown, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
  const payload = () => ({
    bookingId: 42, status: "confirmed", paymentStatus: settledAt ? "paid" : "pending",
    courtPrice: COURT, totals: totals(),
    window: { settled: Boolean(settledAt), editable: true, msLeft: settledAt ? 290000 : 0,
              locksAt: settledAt ? Date.now() + 290000 : null },
    editWindowMs: 300000, settledAt, settledBy: settledAt ? 7 : null,
    acceptedMethods: ["eSewa", "Khalti", "Cash at Venue"],
    defaultExtraFee: 200, defaultExtraFeeNote: "Water and refreshments",
    extras, payments,
  });
  if (init?.method === "POST") {
    const body = JSON.parse(String(init.body));
    // Record the url too. The component reaches the network through apiFetch,
    // so this is the only place that proves the seam resolves the path a real
    // component asks for — apiclient.unit.tsx covers apiUrl() in isolation.
    calls.push({ ...body, __url: url });
    if (body.action === "addPayment") {
      payments = [...payments, { id: nextId++, amount: Number(body.amount), method: body.method,
        note: String(body.note ?? ""), source: "owner", voidedAt: null, createdAt: new Date().toISOString() }];
      return json({ ok: true, ledger: payload(), message: "recorded" });
    }
    if (body.action === "voidPayment") {
      payments = payments.map((p) => (p.id === Number(body.paymentId) ? { ...p, voidedAt: new Date().toISOString() } : p));
      return json({ ok: true, ledger: payload(), message: "undone" });
    }
    if (body.action === "addExtra") {
      extras = [...extras, { id: nextId++, label: String(body.label), amount: Number(body.amount),
        voidedAt: null, createdAt: new Date().toISOString() }];
      return json({ ok: true, ledger: payload(), message: "added" });
    }
    if (body.action === "voidExtra") {
      extras = extras.map((x) => (x.id === Number(body.extraId) ? { ...x, voidedAt: new Date().toISOString() } : x));
      return json({ ok: true, ledger: payload(), message: "removed" });
    }
    if (body.action === "settle") { settledAt = new Date().toISOString(); return json({ ok: true, ledger: payload(), editWindowMs: 300000, message: "settled" }); }
    if (body.action === "unsettle") { settledAt = null; return json({ ok: true, ledger: payload(), message: "reopened" }); }
    return json({ error: "unknown" }, 400);
  }
  return json(payload());
}) as unknown as typeof fetch;

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  → " + extra : "")); }
};

const container = dom.window.document.getElementById("root")!;
const root = createRoot(container as never);
await act(async () => {
  root.render(<BookingLedgerPanel bookingId={42} bookingLabel="8 Oct • 6:00 PM • Ledger Test Ground • Rs. 1,700" ownerId={7} onClose={() => {}} />);
});
await act(async () => { await new Promise((r) => setTimeout(r, 60)); });

const txt = () => container.textContent ?? "";
const click = async (el: Element | null | undefined) => {
  await act(async () => { el!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
};
const setVal = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
const setSel = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!;
const inputs = () => [...container.querySelectorAll("input")] as HTMLInputElement[];
const selects = () => [...container.querySelectorAll("select")] as HTMLSelectElement[];
const btn = (label: string) =>
  [...container.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim().includes(label));

const typeInto = async (el: HTMLInputElement, v: string) => {
  await act(async () => { setVal.call(el, v); el.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
};

ok("the panel opens with the booking label", txt().includes("Ledger Test Ground"));
ok("it shows the court fee", txt().includes("Rs. 1,700"));
ok("nothing has been received yet", txt().includes("Received") && txt().includes("Rs. 0"));
ok("the whole fee is outstanding", txt().includes("1,700 still to collect"));
ok("the venue's default extra fee is prefilled",
   inputs().some((i) => i.value === "Water and refreshments"), JSON.stringify(inputs().map((i) => i.value)));
ok("and its default amount", inputs().some((i) => i.value === "200"));
ok("settle is blocked with nothing recorded", (btn("Record a payment first") as HTMLButtonElement)?.disabled === true);
ok("all three mediums are offered", selects()[0]?.options.length === 3, String(selects()[0]?.options.length));

// The user's example: 700 eSewa + 500 Khalti + 500 cash.
const amountBox = () => inputs().find((i) => i.placeholder === "1700" || i.type === "number" && i.closest("div")?.querySelector("select")) as HTMLInputElement;
await typeInto(amountBox(), "700");
await click(btn("Add"));
ok("the first instalment is sent", calls.at(-1)?.action === "addPayment" && calls.at(-1)?.amount === 700,
   JSON.stringify(calls.at(-1)));
ok("it is sent to the ledger route through the API seam",
   calls.at(-1)?.__url === "/api/bookings/42/ledger", String(calls.at(-1)?.__url));
ok("eSewa is the default medium", calls.at(-1)?.method === "eSewa", String(calls.at(-1)?.method));
ok("the balance falls to 1,000", txt().includes("1,000 still to collect"), txt().slice(0, 400));
ok("the medium chip appears", txt().includes("eSewa • Rs. 700"));

await act(async () => { setSel.call(selects()[0], "Khalti"); selects()[0].dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
await typeInto(amountBox(), "500");
await click(btn("Add"));
ok("Khalti can be picked", calls.at(-1)?.method === "Khalti", String(calls.at(-1)?.method));
ok("the balance falls to 500", txt().includes("500 still to collect"));
ok("both chips are shown", txt().includes("eSewa • Rs. 700") && txt().includes("Khalti • Rs. 500"));

await act(async () => { setSel.call(selects()[0], "Cash at Venue"); selects()[0].dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
await typeInto(amountBox(), "500");
await click(btn("Add"));
ok("cash closes it exactly", txt().includes("Fully paid"), txt().slice(0, 300));
ok("three instalments are listed", container.querySelectorAll("li").length >= 3,
   String(container.querySelectorAll("li").length));
ok("the amount box cleared itself", (amountBox().value === ""));

// Extra charge
const labelBox = () => inputs().find((i) => i.placeholder === "Water x10") as HTMLInputElement;
const extraBox = () => inputs().find((i) => i.placeholder === "Rs.") as HTMLInputElement;
await typeInto(labelBox(), "Water x10");
await typeInto(extraBox(), "300");
const addExtra = container.querySelector('button[title="Add this extra charge"]');
await click(addExtra);
ok("the extra charge is sent with its description",
   calls.at(-1)?.action === "addExtra" && calls.at(-1)?.label === "Water x10" && calls.at(-1)?.amount === 300,
   JSON.stringify(calls.at(-1)));
ok("the total owed rises to 2,000", txt().includes("Rs. 2,000"));
ok("a balance reopens", txt().includes("300 still to collect"));
ok("the extra amount resets to the venue default", extraBox().value === "200", extraBox().value);

// Void an instalment
const undoBtn = container.querySelector('button[title="Undo this instalment"]');
ok("instalments can be undone", !!undoBtn);
await click(undoBtn);
ok("the void is sent for that row", calls.at(-1)?.action === "voidPayment" && !!calls.at(-1)?.paymentId,
   JSON.stringify(calls.at(-1)));
ok("the row is struck through, not gone", txt().includes("undone"));
ok("the total received drops back to 1,000", txt().includes("ReceivedRs. 1,000") || txt().includes("Received Rs. 1,000"),
   (txt().match(/Received[^%]{0,40}/) ?? [""])[0]);

// Settle
const settle = btn("Settle with");
ok("settle is offered once something is recorded", !!settle && (settle as HTMLButtonElement).disabled === false,
   settle?.textContent);
await click(settle);
ok("settle is sent", calls.at(-1)?.action === "settle");
ok("the countdown appears", txt().includes("editable for"), txt().slice(0, 200));
ok("undo settlement is offered", !!btn("Undo settlement"));

await click(btn("Undo settlement"));
ok("unsettle is sent", calls.at(-1)?.action === "unsettle");

// Close
const closeCalls = calls.length;
await click(btn("Close"));
ok("Close sends nothing", calls.length === closeCalls);

console.log(fail === 0 ? `\nALL PASS (${pass}/${pass})` : `\n${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
