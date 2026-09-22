const B = "http://127.0.0.1:3000";
let pass = 0, fail = 0;
const ok = (n, c, e = "") => { c ? (pass++, console.log("  PASS  " + n)) : (fail++, console.log("  FAIL  " + n + (e ? "  → " + e : ""))); };
const call = async (p, init) => {
  const r = await fetch(B + p, init ? { ...init, headers: { "Content-Type": "application/json", ...(init.headers || {}) } } : undefined);
  let b = null; try { b = await r.json(); } catch {}
  return { status: r.status, body: b };
};

console.log("\n— creating a venue can set the default extra fee —");
const v = await call("/api/venues", { method: "POST", body: JSON.stringify({
  name: "Default Fee Ground", address: "Test street", city: "Kathmandu", phone: "01-4455667",
  description: "A venue created with a default extra fee", ownerId: 7,
  defaultExtraFee: 250, defaultExtraFeeNote: "Water and refreshments",
}) });
const vid = v.body?.venue?.id;
ok("venue created", !!vid, v.status + " " + JSON.stringify(v.body).slice(0, 140));
ok("the default fee was stored", v.body?.venue?.defaultExtraFee === 250, String(v.body?.venue?.defaultExtraFee));
ok("and its description", v.body?.venue?.defaultExtraFeeNote === "Water and refreshments",
   String(v.body?.venue?.defaultExtraFeeNote));

console.log("\n— it flows through to the payment desk —");
const c = await call("/api/courts", { method: "POST", body: JSON.stringify({
  venueId: vid, name: "Fee Court", format: "5v5", surface: "Artificial Turf", pricePerHour: 1600, priceMorning: 1100 }) });
const cid = c.body?.court?.id;
const bk = await call("/api/bookings", { method: "POST", body: JSON.stringify({
  courtId: cid, userId: Number(process.env.V1 || 4), date: "2026-10-16", startTime: "17:00", endTime: "18:00" }) });
const bid = bk.body?.booking?.id;
const led = await call(`/api/bookings/${bid}/ledger`);
ok("the ledger carries the venue default fee", led.body?.defaultExtraFee === 250, String(led.body?.defaultExtraFee));
ok("and the description to prefill", led.body?.defaultExtraFeeNote === "Water and refreshments",
   String(led.body?.defaultExtraFeeNote));

console.log("\n— a venue created without one defaults to zero —");
const v2 = await call("/api/venues", { method: "POST", body: JSON.stringify({
  name: "No Fee Ground", address: "Test street", city: "Kathmandu", phone: "01-4455667",
  description: "A venue created with no default extra fee", ownerId: 7 }) });
ok("venue created", !!v2.body?.venue?.id, v2.status);
ok("the default fee is 0", v2.body?.venue?.defaultExtraFee === 0, String(v2.body?.venue?.defaultExtraFee));
ok("and the description is blank", v2.body?.venue?.defaultExtraFeeNote === "",
   JSON.stringify(v2.body?.venue?.defaultExtraFeeNote));

console.log("\n— an absurd default is refused —");
const v3 = await call("/api/venues", { method: "POST", body: JSON.stringify({
  name: "Bad Fee Ground", address: "Test street", city: "Kathmandu", phone: "01-4455667",
  description: "A venue with an absurd default extra fee", ownerId: 7, defaultExtraFee: 999999 }) });
ok("a default over the cap is refused", v3.status === 400, v3.status + " " + JSON.stringify(v3.body).slice(0, 120));
ok("the refusal names the field", String(v3.body?.error ?? "").includes("Default extra fee"), JSON.stringify(v3.body));

console.log(fail === 0 ? `\nALL PASS (${pass}/${pass})` : `\n${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
