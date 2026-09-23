import { dom } from "./domsetup.mjs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { UserProvider } from "@/components/UserProvider";
import OwnerBookingsPage from "@/app/admin/bookings/page";

/**
 * The Amend affordance has to be visible in the bookings row, not only inside
 * the payment desk: an owner scanning the list needs to see which settled
 * games are still fixable and how long is left, without opening each one.
 *
 * Three rows, one per state the window can be in.
 */

const SETTLED_FRESH = new Date(Date.now() - 60_000).toISOString(); // 4:00 left
const SETTLED_OLD = new Date(Date.now() - 10 * 60_000).toISOString(); // locked

const mk = (id: number, settledAt: string | null, extra = {}) => ({
  id,
  date: "2026-10-05",
  startTime: "18:00",
  endTime: "19:00",
  totalPrice: 1700,
  status: "completed",
  paymentStatus: settledAt ? "paid" : "pending",
  paymentMethod: settledAt ? "Cash at Venue" : "",
  bookerName: `Player ${id}`,
  bookerPhone: "9800000000",
  teamName: "",
  receiptUrl: "",
  isFreePlay: false,
  promoCode: "",
  discountAmount: 0,
  priceBeforeDiscount: 1700,
  depositRequired: false,
  depositAmount: 0,
  depositStatus: "none",
  paidAmount: settledAt ? 1700 : 0,
  gatewayTxnId: "",
  settledAt,
  settledBy: settledAt ? 7 : null,
  visibility: "private",
  competition: null,
  court: { id: 1, name: "Court A" },
  venue: { id: 1, name: "Test Venue" },
  user: { name: `Player ${id}` },
  ...extra,
});

const BOOKINGS = [mk(11, SETTLED_FRESH), mk(12, SETTLED_OLD), mk(13, null)];

// The panel refetches the ledger when the desk opens.
const ledgerPayload = {
  bookingId: 11,
  status: "completed",
  paymentStatus: "paid",
  courtPrice: 1700,
  totals: { courtPrice: 1700, extrasTotal: 0, owed: 1700, paid: 1700, balance: 0, surplus: 0, byMethod: { "Cash at Venue": 1700 }, settled: true },
  window: { settled: true, editable: true, msLeft: 240_000, locksAt: Date.now() + 240_000 },
  editWindowMs: 300_000,
  settledAt: SETTLED_FRESH,
  settledBy: 7,
  acceptedMethods: ["eSewa", "Khalti", "Cash at Venue"],
  defaultExtraFee: 0,
  defaultExtraFeeNote: "",
  extras: [],
  payments: [{ id: 1, amount: 1700, method: "Cash at Venue", note: "", source: "owner", voidedAt: null, createdAt: SETTLED_FRESH }],
};

const seen: string[] = [];

(globalThis as Record<string, unknown>).fetch = (async (url: string) => {
  const path = String(url);
  seen.push(path);
  const json = (o: unknown, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
  if (path.startsWith("/api/users")) {
    return json({ users: [{ id: 7, name: "Ganesh Rai", role: "owner", email: "g@x.np", phone: "9800000007", avatarUrl: "", defaultCity: "Kathmandu" }] });
  }
  if (path.startsWith("/api/venues")) return json({ venues: [{ id: 1, ownerId: 7, name: "Test Venue" }] });
  if (path.startsWith("/api/bookings/11/ledger")) return json(ledgerPayload);
  if (path.startsWith("/api/bookings")) return json({ bookings: BOOKINGS });
  return json({ ok: true });
}) as unknown as typeof fetch;

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => {
  c ? (pass++, console.log("  PASS  " + n)) : (fail++, console.log("  FAIL  " + n + (e ? "  → " + e : "")));
};

const doc = dom.window.document;
dom.window.localStorage.setItem("futsal_session_user_id", "7");

const root = createRoot(doc.getElementById("root")!);
await act(async () => {
  root.render(
    <UserProvider>
      <OwnerBookingsPage />
    </UserProvider>
  );
});
await act(async () => {});

const text = () => doc.getElementById("root")!.textContent ?? "";
const rows = () => [...doc.querySelectorAll("tbody tr")];
const rowFor = (id: number) => rows().find((r) => r.textContent?.includes(`#FN-${id}`));

console.log("\n— the Amend option lives in the row, not only in the desk —");
ok("the table rendered three bookings", rows().length === 3, `${rows().length} rows`);

const fresh = rowFor(11);
ok("the freshly settled row shows an Amend button",
   Boolean(fresh?.querySelector("button")?.textContent?.includes("Amend")) ||
   Boolean([...(fresh?.querySelectorAll("button") ?? [])].some((b) => b.textContent?.includes("Amend"))),
   fresh?.textContent?.slice(0, 160));

const amend = [...(fresh?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.includes("Amend"));
ok("it shows the countdown, so the owner knows the window is closing",
   /\d:\d\d/.test(amend?.textContent ?? ""), JSON.stringify(amend?.textContent));
ok("the countdown is 4:00 for a booking settled a minute ago",
   (amend?.textContent ?? "").includes("4:00"), JSON.stringify(amend?.textContent));

// The countdown used to resize every second: "4:32" and "4:09" are different
// pixel widths in a proportional font, so the button changed width on each
// tick and shoved the rest of the row sideways — the PAID badge appeared to
// fluctuate. jsdom has no layout engine, so pixel width can't be measured
// here; what is asserted is the mechanism that keeps the width constant.
const countdown = amend?.querySelector("span.tabular-nums");
ok("the countdown uses tabular figures, so every digit is the same width",
   Boolean(countdown), amend?.innerHTML ?? "no tabular span");
ok("and reserves a fixed width regardless of the value",
   /min-w-/.test(countdown?.className ?? ""), countdown?.className ?? "");
ok("the button itself can't be squeezed or stretched by the row",
   /shrink-0/.test(amend?.className ?? ""), amend?.className ?? "");

const old = rowFor(12);
ok("a settled-and-locked row shows Locked instead",
   Boolean(old?.textContent?.includes("Locked")), old?.textContent?.slice(0, 160));
ok("and offers no Amend button",
   ![...(old?.querySelectorAll("button") ?? [])].some((b) => b.textContent?.includes("Amend")));

const open = rowFor(13);
ok("an unsettled row shows neither Amend nor Locked",
   !open?.textContent?.includes("Amend") && !open?.textContent?.includes("Locked"),
   open?.textContent?.slice(0, 160));

console.log("\n— clicking Amend opens the payment desk —");
const deskOpenBefore = text().includes("Payments");
await act(async () => {
  amend!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
});
await act(async () => {});
ok("the desk was not open beforehand", !deskOpenBefore);
ok("the desk is open now", text().includes("Payments"), text().slice(0, 120));
ok("and it fetched that booking's ledger", seen.some((p) => p.includes("/api/bookings/11/ledger")), seen.join(" "));

console.log(fail === 0 ? `\nALL PASS (${pass}/${pass})` : `\n${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
