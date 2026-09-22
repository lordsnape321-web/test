const B = process.env.BASE_URL || "http://127.0.0.1:3000";
const PG = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/app_db";
let pass = 0, fail = 0;
const ok = (n, c, e = "") => { c ? (pass++, console.log("  PASS  " + n)) : (fail++, console.log("  FAIL  " + n + (e ? "  → " + e : ""))); };
const call = async (path, init) => {
  const res = await fetch(B + path, init ? { ...init, headers: { "Content-Type": "application/json", ...(init.headers || {}) } } : undefined);
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
};
const OWNER = 7, PLAYER = Number(process.env.PLAYER || 6);

import { createRequire } from "node:module";
// Resolve `pg` from the app, wherever the checkout lives.
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const pg = new Client({ connectionString: PG });
await pg.connect();

console.log("\n— setup —");
const v = await call("/api/venues", { method: "POST", body: JSON.stringify({
  name: "Ledger Test Ground", address: "Test street", city: "Kathmandu", phone: "01-4455667",
  description: "A test venue for the payment ledger", ownerId: OWNER,
}) });
const vid = v.body?.venue?.id;
ok("venue created", !!vid, v.status + " " + JSON.stringify(v.body).slice(0, 120));

await call(`/api/venues/${vid}`, { method: "PATCH", body: JSON.stringify({
  acceptedPayments: "eSewa,Khalti,Cash at Venue", defaultExtraFee: 200, defaultExtraFeeNote: "Water and refreshments",
}) });

const c = await call("/api/courts", { method: "POST", body: JSON.stringify({
  venueId: vid, name: "Ledger Court", format: "5v5", surface: "Artificial Turf", pricePerHour: 1700, priceMorning: 1200,
}) });
const cid = c.body?.court?.id;
ok("court added", !!cid, c.status);

const bk = await call("/api/bookings", { method: "POST", body: JSON.stringify({
  courtId: cid, userId: PLAYER, date: "2026-10-08", startTime: "18:00", endTime: "19:00",
}) });
const bid = bk.body?.booking?.id;
ok("booking made for Rs 1,700", !!bid && bk.body.booking.totalPrice === 1700, bk.status + " " + JSON.stringify(bk.body).slice(0, 160));

console.log("\n— the ledger read —");
const g0 = await call(`/api/bookings/${bid}/ledger`);
ok("ledger loads", g0.status === 200, g0.status);
ok("it knows the court price", g0.body?.courtPrice === 1700, String(g0.body?.courtPrice));
ok("nothing owed has been received", g0.body?.totals.paid === 0, String(g0.body?.totals.paid));
ok("the full court fee is outstanding", g0.body?.totals.balance === 1700, String(g0.body?.totals.balance));
ok("it lists the mediums the venue takes",
   JSON.stringify([...(g0.body?.acceptedMethods ?? [])].sort()) === JSON.stringify([...["Cash at Venue", "eSewa", "Khalti"]].sort()),
   JSON.stringify(g0.body?.acceptedMethods));
ok("the venue's default extra fee is passed down", g0.body?.defaultExtraFee === 200, String(g0.body?.defaultExtraFee));
ok("and its description", g0.body?.defaultExtraFeeNote === "Water and refreshments", String(g0.body?.defaultExtraFeeNote));
ok("an unsettled booking is editable", g0.body?.window.editable === true);

console.log("\n— ownership —");
const str = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "addPayment", amount: 500, method: "Cash at Venue", actorId: PLAYER }) });
ok("a player can't write to the ledger", str.status === 403, str.status + " " + JSON.stringify(str.body));
ok("the refusal says why", String(str.body?.error ?? "").includes("owner"), JSON.stringify(str.body));
const badAction = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "mintMoney", actorId: OWNER }) });
ok("an unknown action is refused", badAction.status === 400, badAction.status);
const noBooking = await call("/api/bookings/999999/ledger", { method: "POST", body: JSON.stringify({
  action: "addPayment", amount: 100, method: "eSewa", actorId: OWNER }) });
ok("an unknown booking 404s", noBooking.status === 404, noBooking.status);

console.log("\n— the user's own example: 1700 = 700 eSewa + 500 Khalti + 500 cash —");
const p1 = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "addPayment", amount: 700, method: "eSewa", note: "paid from phone", actorId: OWNER }) });
ok("700 by eSewa recorded", p1.status === 200, p1.status + " " + JSON.stringify(p1.body).slice(0, 140));
ok("1000 still owed after it", p1.body?.ledger?.totals?.balance === 1000, String(p1.body?.ledger?.totals?.balance));
ok("the message says what's left", String(p1.body?.message).includes("1,000"), String(p1.body?.message));

const p2 = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "addPayment", amount: 500, method: "Khalti", actorId: OWNER }) });
ok("500 by Khalti recorded", p2.status === 200 && p2.body.ledger.totals.balance === 500, String(p2.body?.ledger?.totals?.balance));

const badMethod = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "addPayment", amount: 500, method: "Bitcoin", actorId: OWNER }) });
ok("a medium the venue doesn't take is refused", badMethod.status === 400, badMethod.status + " " + JSON.stringify(badMethod.body));

const badAmt = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "addPayment", amount: 0, method: "Cash at Venue", actorId: OWNER }) });
ok("a zero instalment is refused", badAmt.status === 400, badAmt.status);
const decAmt = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "addPayment", amount: 100.5, method: "Cash at Venue", actorId: OWNER }) });
ok("a decimal instalment is refused", decAmt.status === 400, decAmt.status);

const p3 = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "addPayment", amount: 500, method: "Cash at Venue", note: "handed over at the counter", actorId: OWNER }) });
ok("500 cash settles it exactly", p3.status === 200 && p3.body.ledger.totals.balance === 0,
   String(p3.body?.ledger?.totals?.balance));
ok("the message says fully paid", String(p3.body?.message).includes("fully paid"), String(p3.body?.message));
ok("each medium is tracked separately",
   JSON.stringify(p3.body?.ledger?.totals?.byMethod) === JSON.stringify({ eSewa: 700, Khalti: 500, "Cash at Venue": 500 }),
   JSON.stringify(p3.body?.ledger?.totals?.byMethod));
ok("three instalment rows exist", (p3.body?.ledger?.payments ?? []).length === 3,
   String((p3.body?.ledger?.payments ?? []).length));

console.log("\n— the DB itself is the source of truth —");
const rows = await pg.query(
  "select amount, method, note, source, recorded_by from booking_payments where booking_id=$1 order by id", [bid]);
ok("three rows are in the database", rows.rowCount === 3, String(rows.rowCount));
ok("they carry the medium each came by",
   JSON.stringify(rows.rows.map((r) => [r.amount, r.method])) ===
   JSON.stringify([[700, "eSewa"], [500, "Khalti"], [500, "Cash at Venue"]]),
   JSON.stringify(rows.rows));
ok("the owner is recorded against each", rows.rows.every((r) => r.recorded_by === OWNER && r.source === "owner"));
ok("the notes survived", rows.rows[0].note === "paid from phone", String(rows.rows[0].note));

console.log("\n— extra charges (the water bought during the match) —");
const x1 = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "addExtra", label: "Water x10", amount: 300, actorId: OWNER }) });
ok("an extra charge can be added", x1.status === 200, x1.status + " " + JSON.stringify(x1.body).slice(0, 140));
ok("it raises what's owed", x1.body?.ledger?.totals?.owed === 2000, String(x1.body?.ledger?.totals?.owed));
ok("and reopens a balance", x1.body?.ledger?.totals?.balance === 300, String(x1.body?.ledger?.totals?.balance));
ok("the message names the item", String(x1.body?.message).includes("Water x10"), String(x1.body?.message));

const noLabel = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "addExtra", label: "", amount: 300, actorId: OWNER }) });
ok("an undescribed charge is refused", noLabel.status === 400, noLabel.status + " " + JSON.stringify(noLabel.body));
const noAmt = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "addExtra", label: "Water", amount: "", actorId: OWNER }) });
ok("a charge with no amount is refused", noAmt.status === 400, noAmt.status);
const zeroExtra = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "addExtra", label: "Water", amount: 0, actorId: OWNER }) });
ok("a zero charge is refused", zeroExtra.status === 400, zeroExtra.status);

console.log("\n— overpaying (\"sometimes more money also comes\") —");
const p4 = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "addPayment", amount: 500, method: "Cash at Venue", note: "handed over a 2000 note", actorId: OWNER }) });
ok("overpaying is accepted", p4.status === 200, p4.status);
ok("the surplus is reported", p4.body?.ledger?.totals?.surplus === 200, String(p4.body?.ledger?.totals?.surplus));
ok("and nothing is owed", p4.body?.ledger?.totals?.balance === 0, String(p4.body?.ledger?.totals?.balance));
ok("the message mentions the change", String(p4.body?.message).includes("change"), String(p4.body?.message));

console.log("\n— corrections void rather than delete —");
const extraId = x1.body?.ledger?.extras?.[0]?.id;
const vx = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "voidExtra", extraId, actorId: OWNER }) });
ok("an extra charge can be removed", vx.status === 200, vx.status);
ok("it no longer counts towards owed", vx.body?.ledger?.totals?.owed === 1700, String(vx.body?.ledger?.totals?.owed));
ok("but the row is still listed, struck through",
   (vx.body?.ledger?.extras ?? []).some((e) => e.id === extraId && e.voidedAt), JSON.stringify(vx.body?.ledger?.extras));
const vx2 = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "voidExtra", extraId, actorId: OWNER }) });
ok("removing it twice is a no-op", vx2.body?.alreadyVoided === true, JSON.stringify(vx2.body).slice(0, 100));
const wrongBooking = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "voidExtra", extraId: 999999, actorId: OWNER }) });
ok("a charge that isn't on this booking 404s", wrongBooking.status === 404, wrongBooking.status);

const payId = p4.body?.ledger?.payments?.at(-1)?.id;
const vp = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "voidPayment", paymentId: payId, actorId: OWNER }) });
ok("an instalment can be undone", vp.status === 200, vp.status);
ok("the surplus goes with it", vp.body?.ledger?.totals?.surplus === 0, String(vp.body?.ledger?.totals?.surplus));
ok("the row stays in the history", (vp.body?.ledger?.payments ?? []).some((p) => p.id === payId && p.voidedAt));
const kept = await pg.query("select count(*)::int as n from booking_payments where booking_id=$1", [bid]);
ok("nothing was deleted from the database", kept.rows[0].n === 4, String(kept.rows[0].n));

console.log("\n— settling starts the clock —");
const notYet = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "settle", actorId: PLAYER }) });
ok("a player can't settle", notYet.status === 403, notYet.status);

const s1 = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "settle", actorId: OWNER }) });
ok("the owner can settle", s1.status === 200, s1.status + " " + JSON.stringify(s1.body).slice(0, 140));
ok("settlement is stamped", !!s1.body?.ledger?.settledAt, JSON.stringify(s1.body?.ledger?.settledAt));
ok("the window is open", s1.body?.ledger?.window?.editable === true);
ok("and lasts five minutes", s1.body?.editWindowMs === 300000, String(s1.body?.editWindowMs));
ok("the message warns about the lock", String(s1.body?.message).includes("5 minutes"), String(s1.body?.message));
ok("the booking's paymentStatus follows", s1.body?.ledger?.paymentStatus === "paid", String(s1.body?.ledger?.paymentStatus));
const paidCol = await pg.query("select paid_amount, settled_by from bookings where id=$1", [bid]);
ok("paidAmount is synced from the ledger", paidCol.rows[0].paid_amount === 1700, String(paidCol.rows[0].paid_amount));
ok("and who settled it is recorded", paidCol.rows[0].settled_by === OWNER, String(paidCol.rows[0].settled_by));

const s2 = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "settle", actorId: OWNER }) });
ok("settling twice is a no-op", s2.body?.alreadySettled === true, JSON.stringify(s2.body).slice(0, 100));

console.log("\n— inside the window a mistake can still be fixed —");
const fix = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "addExtra", label: "Water x10", amount: 300, actorId: OWNER }) });
ok("an extra can still be added", fix.status === 200, fix.status + " " + JSON.stringify(fix.body).slice(0, 120));
const undo = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "unsettle", actorId: OWNER }) });
ok("settlement can be undone", undo.status === 200 && undo.body?.ledger?.settledAt === null,
   JSON.stringify(undo.body?.ledger?.settledAt));
ok("the ledger is open again", undo.body?.ledger?.window?.editable === true);
const re = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "settle", actorId: OWNER }) });
ok("and it can be settled again", re.status === 200 && re.body?.ledger?.window?.settled === true);

console.log("\n— after five minutes it locks —");
await pg.query("update bookings set settled_at = now() - interval '6 minutes' where id=$1", [bid]);
const lockedAdd = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "addPayment", amount: 100, method: "Cash at Venue", actorId: OWNER }) });
ok("a late instalment is refused", lockedAdd.status === 409, lockedAdd.status + " " + JSON.stringify(lockedAdd.body).slice(0, 120));
ok("the refusal names the lock", lockedAdd.body?.reason === "ledger_locked", JSON.stringify(lockedAdd.body).slice(0, 120));
const lockedExtra = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "addExtra", label: "Late water", amount: 100, actorId: OWNER }) });
ok("a late extra is refused", lockedExtra.status === 409, lockedExtra.status);
const lockedVoid = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "voidPayment", paymentId: payId, actorId: OWNER }) });
ok("a late correction is refused", lockedVoid.status === 409, lockedVoid.status);
const lockedUnsettle = await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "unsettle", actorId: OWNER }) });
ok("it can't be reopened either", lockedUnsettle.status === 409, lockedUnsettle.status);
const gLocked = await call(`/api/bookings/${bid}/ledger`);
ok("the read still works when locked", gLocked.status === 200);
ok("and reports it as not editable", gLocked.body?.window?.editable === false);
ok("the locked total is unchanged", gLocked.body?.totals?.paid === 1700, String(gLocked.body?.totals?.paid));

console.log("\n— settling with nothing recorded —");
const bk2 = await call("/api/bookings", { method: "POST", body: JSON.stringify({
  courtId: cid, userId: Number(process.env.PLAYER2 || 5), date: "2026-10-09", startTime: "18:00", endTime: "19:00",
}) });
const bid2 = bk2.body?.booking?.id;
const emptySettle = await call(`/api/bookings/${bid2}/ledger`, { method: "POST", body: JSON.stringify({
  action: "settle", actorId: OWNER }) });
ok("you can't settle a booking with no payments", emptySettle.status === 400,
   emptySettle.status + " " + JSON.stringify(emptySettle.body));

await pg.end();
console.log(fail === 0 ? `\nALL PASS (${pass}/${pass})` : `\n${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
