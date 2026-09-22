const B = "http://127.0.0.1:3000";
let pass = 0, fail = 0;
const ok = (n, c, e = "") => { c ? (pass++, console.log("  PASS  " + n)) : (fail++, console.log("  FAIL  " + n + (e ? "  → " + e : ""))); };
const call = async (p, init) => {
  const r = await fetch(B + p, init ? { ...init, headers: { "Content-Type": "application/json", ...(init.headers || {}) } } : undefined);
  let b = null; try { b = await r.json(); } catch {}
  return { status: r.status, body: b };
};
import { createRequire } from "node:module";
const require = createRequire("/home/user/test/react-expo-laravel-futsal-app/");
const { Client } = require("pg");
const pg = new Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:5432/app_db" });
await pg.connect();

const v = await call("/api/venues", { method: "POST", body: JSON.stringify({
  name: "Bypass Ground", address: "Test street", city: "Kathmandu", phone: "01-4455667",
  description: "A test venue for the settlement bypass", ownerId: 7 }) });
const vid = v.body?.venue?.id;
const c = await call("/api/courts", { method: "POST", body: JSON.stringify({
  venueId: vid, name: "BP Court", format: "5v5", surface: "Artificial Turf", pricePerHour: 1500, priceMorning: 1000 }) });
const cid = c.body?.court?.id;
const bk = await call("/api/bookings", { method: "POST", body: JSON.stringify({
  courtId: cid, userId: Number(process.env.P1 || 2), date: "2026-10-18", startTime: "17:00", endTime: "18:00" }) });
const bid = bk.body?.booking?.id;

await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({
  action: "addPayment", amount: 1500, method: "Cash at Venue", actorId: 7 }) });
await call(`/api/bookings/${bid}/ledger`, { method: "POST", body: JSON.stringify({ action: "settle", actorId: 7 }) });
await pg.query("update bookings set settled_at = now() - interval '10 minutes' where id=$1", [bid]);

const led = await call(`/api/bookings/${bid}/ledger`);
ok("the ledger is locked", led.body?.window?.editable === false);

console.log("\n— side door: PATCH /api/bookings/[id] —");
const p1 = await call(`/api/bookings/${bid}`, { method: "PATCH", body: JSON.stringify({
  paymentStatus: "pending", actor: "owner" }) });
ok("PATCH can't reopen a locked settlement", p1.status === 409 || p1.body?.booking?.paymentStatus === "paid",
   p1.status + " paymentStatus=" + p1.body?.booking?.paymentStatus);

const after = await pg.query("select payment_status, paid_amount from bookings where id=$1", [bid]);
ok("the database still says paid", after.rows[0].payment_status === "paid",
   "payment_status=" + after.rows[0].payment_status);
ok("and paidAmount is untouched", after.rows[0].paid_amount === 1500, String(after.rows[0].paid_amount));

const p2 = await call(`/api/bookings/${bid}`, { method: "PATCH", body: JSON.stringify({
  paymentMethod: "Khalti", actor: "owner" }) });
const after2 = await pg.query("select payment_method from bookings where id=$1", [bid]);
ok("PATCH can't rewrite the medium on a locked booking either", after2.rows[0].payment_method !== "Khalti" || p2.status === 409,
   "method=" + after2.rows[0].payment_method + " status=" + p2.status);

console.log("\n— inside the window the correction path still works —");
const bk2 = await call("/api/bookings", { method: "POST", body: JSON.stringify({
  courtId: cid, userId: Number(process.env.P2 || 4), date: "2026-10-19", startTime: "17:00", endTime: "18:00" }) });
const bid2 = bk2.body?.booking?.id;
await call(`/api/bookings/${bid2}/ledger`, { method: "POST", body: JSON.stringify({
  action: "addPayment", amount: 1500, method: "Cash at Venue", actorId: 7 }) });
const s2 = await call(`/api/bookings/${bid2}/ledger`, { method: "POST", body: JSON.stringify({ action: "settle", actorId: 7 }) });
ok("settled", s2.status === 200 && s2.body?.ledger?.window?.editable === true);

// Immediately after settling the window is open, so PATCH must still work.
const pIn = await call(`/api/bookings/${bid2}`, { method: "PATCH", body: JSON.stringify({
  paymentMethod: "Khalti", actor: "owner" }) });
ok("PATCH still works inside the window", pIn.status === 200, pIn.status + " " + JSON.stringify(pIn.body).slice(0, 100));
const m = await pg.query("select payment_method from bookings where id=$1", [bid2]);
ok("and the change actually landed", m.rows[0].payment_method === "Khalti", m.rows[0].payment_method);

const pBack = await call(`/api/bookings/${bid2}`, { method: "PATCH", body: JSON.stringify({
  paymentStatus: "pending", actor: "owner" }) });
ok("paymentStatus is editable inside the window too", pBack.status === 200, pBack.status);

console.log("\n— and an unsettled booking is never blocked —");
const bk3 = await call("/api/bookings", { method: "POST", body: JSON.stringify({
  courtId: cid, userId: Number(process.env.P3 || 6), date: "2026-10-20", startTime: "17:00", endTime: "18:00" }) });
const bid3 = bk3.body?.booking?.id;
const pUn = await call(`/api/bookings/${bid3}`, { method: "PATCH", body: JSON.stringify({
  paymentStatus: "paid", actor: "owner" }) });
ok("an unsettled booking can still be marked paid", pUn.status === 200, pUn.status);
const st = await call(`/api/bookings/${bid3}`, { method: "PATCH", body: JSON.stringify({
  status: "cancelled", actor: "owner" }) });
ok("and non-money fields are never blocked", st.status === 200, st.status);

console.log("\n— a locked booking can still have its game status changed —");
const nonMoney = await call(`/api/bookings/${bid}`, { method: "PATCH", body: JSON.stringify({
  status: "completed", actor: "owner" }) });
ok("the lock only covers money, not the game status", nonMoney.status === 200, nonMoney.status);

await pg.end();
console.log(fail === 0 ? `\nALL PASS (${pass}/${pass})` : `\n${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
