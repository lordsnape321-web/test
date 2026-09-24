const B = process.env.BASE_URL || "http://127.0.0.1:3000";
let pass = 0, fail = 0;
const ok = (n, c, e = "") => { c ? (pass++, console.log("  PASS  " + n)) : (fail++, console.log("  FAIL  " + n + (e ? "  → " + e : ""))); };
const call = async (p, init) => {
  const r = await fetch(B + p, init ? { ...init, headers: { "Content-Type": "application/json", ...(init.headers || {}) } } : undefined);
  let b = null; try { b = await r.json(); } catch {}
  return { status: r.status, body: b };
};
const ledger = async (id) => (await call(`/api/bookings/${id}/ledger`)).body;

console.log("\n— a deposit booking: part online, the rest at the desk —");
const v = await call("/api/venues", { method: "POST", body: JSON.stringify({
  name: "Deposit Ground", address: "Test street", city: "Kathmandu", phone: "01-4455667",
  description: "A venue for the deposit flow", ownerId: 7 }) });
const vid = v.body?.venue?.id;
await call(`/api/venues/${vid}`, { method: "PATCH", body: JSON.stringify({ depositPercent: 50 }) });
const c = await call("/api/courts", { method: "POST", body: JSON.stringify({
  venueId: vid, name: "Dep Court", format: "5v5", surface: "Artificial Turf", pricePerHour: 2000, priceMorning: 1400 }) });
const cid = c.body?.court?.id;

const PLAYER = Number(process.env.D1 || 3);

// A deposit is only demanded once a player looks unreliable
// (depositDecision: cancelsThisMonth >= DEPOSIT_CANCEL_THRESHOLD, i.e. 2).
// That count is mutable per-player state, so the suite builds it itself
// instead of hoping a given user id happens to be over the line — guessing
// made this suite fail with eSewa charging the FULL price and a bogus
// "Cash at Venue" top-up on top of it.
for (let i = 0; i < 2; i++) {
  const burn = await call("/api/bookings", { method: "POST", body: JSON.stringify({
    courtId: cid, userId: PLAYER, date: `2026-10-2${i}`, startTime: "10:00", endTime: "11:00" }) });
  const burnId = burn.body?.booking?.id;
  if (burnId) await call(`/api/bookings/${burnId}`, { method: "PATCH", body: JSON.stringify({ status: "cancelled" }) });
}

const bk = await call("/api/bookings", { method: "POST", body: JSON.stringify({
  courtId: cid, userId: PLAYER, date: "2026-10-22", startTime: "18:00", endTime: "19:00" }) });
const bid = bk.body?.booking?.id;
const TOTAL = Number(bk.body?.booking?.totalPrice ?? 0);
const depReq = bk.body?.booking?.depositRequired;
const depAmt = Number(bk.body?.booking?.depositAmount ?? 0);
console.log(`   booking ${bid}: total ${TOTAL}, depositRequired=${depReq}, depositAmount=${depAmt}`);
ok("a deposit was requested", depReq === true && depAmt > 0 && depAmt < TOTAL,
   `required=${depReq} amount=${depAmt} total=${TOTAL} (pick a player with cancel headroom, D1=<id>)`);

const pay = await call("/api/payments/esewa/verify", { method: "POST", body: JSON.stringify({ bookingId: bid, mockApprove: true }) });
ok("the deposit is paid online", pay.status === 200, pay.status);
ok("the booking is marked deposit_paid", pay.body?.booking?.paymentStatus === "deposit_paid",
   String(pay.body?.booking?.paymentStatus));

let led = await ledger(bid);
ok("the ledger holds only the deposit", led?.totals?.paid === depAmt, `${led?.totals?.paid} vs ${depAmt}`);
ok("the rest is still owed", led?.totals?.balance === TOTAL - depAmt,
   `${led?.totals?.balance} expected ${TOTAL - depAmt}`);
ok("the medium is recorded as eSewa", led?.totals?.byMethod?.eSewa === depAmt, JSON.stringify(led?.totals?.byMethod));
ok("it is not treated as settled", led?.window?.settled === false);

console.log("\n— the balance is collected at the counter —");
const cash = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "addPayment", amount: TOTAL - depAmt, method: "Cash at Venue", note: "balance on arrival", actorId: 7 }) });
ok("the owner records the balance", cash.status === 200, cash.status);
ok("nothing is owed any more", cash.body?.ledger?.totals?.balance === 0, String(cash.body?.ledger?.totals?.balance));
ok("both mediums show side by side",
   cash.body?.ledger?.totals?.byMethod?.eSewa === depAmt &&
   cash.body?.ledger?.totals?.byMethod?.["Cash at Venue"] === TOTAL - depAmt,
   JSON.stringify(cash.body?.ledger?.totals?.byMethod));
ok("total received equals the court fee", cash.body?.ledger?.totals?.paid === TOTAL, String(cash.body?.ledger?.totals?.paid));

console.log("\n— settling the whole thing —");
const s = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({ action: "settle", actorId: 7 }) });
ok("it settles", s.status === 200 && s.body?.ledger?.window?.settled === true, s.status);
ok("the settle message names both mediums",
   String(s.body?.message).includes("eSewa") && String(s.body?.message).includes("Cash at Venue"),
   String(s.body?.message));
ok("paymentStatus becomes paid", s.body?.ledger?.paymentStatus === "paid", String(s.body?.ledger?.paymentStatus));

console.log("\n— a deposit replay must not double-count either —");
await call("/api/payments/esewa/verify", { method: "POST", body: JSON.stringify({ bookingId: bid, mockApprove: true }) });
led = await ledger(bid);
ok("the deposit is still one row", (led?.payments ?? []).filter((p) => p.method === "eSewa").length === 1,
   String((led?.payments ?? []).filter((p) => p.method === "eSewa").length));
ok("and the total is unchanged", led?.totals?.paid === TOTAL, String(led?.totals?.paid));

console.log(fail === 0 ? `\nALL PASS (${pass}/${pass})` : `\n${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
