const B = "http://127.0.0.1:3000";
let pass = 0, fail = 0;
const ok = (n, c, e = "") => { c ? (pass++, console.log("  PASS  " + n)) : (fail++, console.log("  FAIL  " + n + (e ? "  → " + e : ""))); };
const call = async (p, init) => {
  const r = await fetch(B + p, init ? { ...init, headers: { "Content-Type": "application/json", ...(init.headers || {}) } } : undefined);
  let b = null; try { b = await r.json(); } catch {}
  return { status: r.status, body: b };
};
const ledger = async (id) => (await call(`/api/bookings/${id}/ledger`)).body;

console.log("\n— online money must land in the ledger too —");
const v = await call("/api/venues", { method: "POST", body: JSON.stringify({
  name: "Gateway Ledger Ground", address: "Test street", city: "Kathmandu", phone: "01-4455667",
  description: "A test venue for gateway payments in the ledger", ownerId: 7 }) });
const vid = v.body?.venue?.id;
const c = await call("/api/courts", { method: "POST", body: JSON.stringify({
  venueId: vid, name: "GW Court", format: "5v5", surface: "Artificial Turf", pricePerHour: 1800, priceMorning: 1300 }) });
const cid = c.body?.court?.id;
ok("venue + court ready", !!vid && !!cid, JSON.stringify(v.body).slice(0, 100));

const bk = await call("/api/bookings", { method: "POST", body: JSON.stringify({
  courtId: cid, userId: Number(process.env.G1 || 8), date: "2026-10-14", startTime: "19:00", endTime: "20:00" }) });
const bid = bk.body?.booking?.id;
ok("booking made for Rs 1,800", !!bid && bk.body.booking.totalPrice === 1800, bk.status);

const pay = await call("/api/payments/esewa/verify", { method: "POST", body: JSON.stringify({ bookingId: bid, mockApprove: true }) });
ok("eSewa verify succeeds", pay.status === 200, pay.status);
let led = await ledger(bid);
ok("the ledger knows it was paid", led?.totals?.paid === 1800, String(led?.totals?.paid));
ok("and by which medium", led?.totals?.byMethod?.eSewa === 1800, JSON.stringify(led?.totals?.byMethod));
ok("exactly one instalment row", (led?.payments ?? []).length === 1, String((led?.payments ?? []).length));
ok("marked as a gateway payment", led?.payments?.[0]?.source === "gateway", String(led?.payments?.[0]?.source));
ok("carrying the gateway reference", String(led?.payments?.[0]?.reference).startsWith("MOCK-ESEWA-"),
   String(led?.payments?.[0]?.reference));
ok("nothing left to collect", led?.totals?.balance === 0, String(led?.totals?.balance));
ok("the payment desk would not say 'nothing received'", led?.totals?.paid > 0);

console.log("\n— a replayed callback must not double-count —");
const again = await call("/api/payments/esewa/verify", { method: "POST", body: JSON.stringify({ bookingId: bid, mockApprove: true }) });
led = await ledger(bid);
ok("the replay still succeeds", again.status === 200, again.status);
ok("but the total is unchanged", led?.totals?.paid === 1800, String(led?.totals?.paid));
ok("and no second row appeared", (led?.payments ?? []).length === 1, String((led?.payments ?? []).length));
await call("/api/payments/esewa/verify", { method: "POST", body: JSON.stringify({ bookingId: bid, mockApprove: true }) });
led = await ledger(bid);
ok("a third replay is still one row", (led?.payments ?? []).length === 1, String((led?.payments ?? []).length));

console.log("\n— Khalti does the same —");
const bk2 = await call("/api/bookings", { method: "POST", body: JSON.stringify({
  courtId: cid, userId: Number(process.env.G2 || 9), date: "2026-10-15", startTime: "19:00", endTime: "20:00" }) });
const bid2 = bk2.body?.booking?.id;
const kp = await call("/api/payments/khalti/verify", { method: "POST", body: JSON.stringify({ bookingId: bid2, pidx: "mock-gw-test", mockApprove: true }) });
let led2 = await ledger(bid2);
ok("Khalti verify succeeds", kp.status === 200, kp.status);
ok("the ledger shows Khalti", led2?.totals?.byMethod?.Khalti === 1800, JSON.stringify(led2?.totals?.byMethod));
await call("/api/payments/khalti/verify", { method: "POST", body: JSON.stringify({ bookingId: bid2, pidx: "mock-gw-test", mockApprove: true }) });
led2 = await ledger(bid2);
ok("and its replay doesn't duplicate either", (led2?.payments ?? []).length === 1 && led2?.totals?.paid === 1800,
   `${(led2?.payments ?? []).length} rows / ${led2?.totals?.paid}`);

console.log("\n— a gateway payment then cash at the desk is a normal split —");
const top = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "addExtra", label: "Water x6", amount: 180, actorId: 7 }) });
ok("the owner can still add extras on top", top.status === 200 && top.body?.ledger?.totals?.owed === 1980,
   String(top.body?.ledger?.totals?.owed));
ok("which reopens a small balance", top.body?.ledger?.totals?.balance === 180, String(top.body?.ledger?.totals?.balance));
const cash = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "addPayment", amount: 180, method: "Cash at Venue", note: "settled the water at the desk", actorId: 7 }) });
ok("the cash top-up closes it", cash.status === 200 && cash.body?.ledger?.totals?.balance === 0,
   String(cash.body?.ledger?.totals?.balance));
ok("both mediums now show", cash.body?.ledger?.totals?.byMethod?.eSewa === 1800 &&
   cash.body?.ledger?.totals?.byMethod?.["Cash at Venue"] === 180,
   JSON.stringify(cash.body?.ledger?.totals?.byMethod));
ok("total received is 1,980", cash.body?.ledger?.totals?.paid === 1980, String(cash.body?.ledger?.totals?.paid));

console.log(fail === 0 ? `\nALL PASS (${pass}/${pass})` : `\n${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
