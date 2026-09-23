const B = process.env.BASE_URL || "http://127.0.0.1:3000";
const U = Number(process.env.U || 1);
let pass = 0, fail = 0;
const ok = (n, c, e = "") => { c ? (pass++, console.log("  PASS  " + n)) : (fail++, console.log("  FAIL  " + n + (e ? "  → " + e : ""))); };
const call = async (path, init) => {
  const res = await fetch(B + path, init ? { ...init, headers: { "Content-Type": "application/json", ...(init.headers || {}) } } : undefined);
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
};
const venueOf = async (id, qs = "") => {
  const r = await call(`/api/venues?includeDeleted=1${qs}`);
  return (r.body?.venues ?? []).find((v) => v.id === id);
};

console.log("\n— court retire —");
const v = await call("/api/venues", { method: "POST", body: JSON.stringify({
  name: "Court Delete Ground", address: "Test street", city: "Kathmandu", phone: "01-4455667",
  description: "A test venue for the court retire flow", ownerId: 7,
}) });
const vid = v.body?.venue?.id;
ok("venue created", !!vid, v.status + " " + JSON.stringify(v.body).slice(0, 140));

const mkCourt = (name, price) => call("/api/courts", { method: "POST", body: JSON.stringify({
  venueId: vid, name, format: "5v5", surface: "Artificial Turf", pricePerHour: price, priceMorning: Math.round(price * 0.8),
}) });
const cheap = await mkCourt("Cheap Pitch", 900);
const dear = await mkCourt("Premium Pitch", 2500);
const cheapId = cheap.body?.court?.id, dearId = dear.body?.court?.id;
ok("two courts added", !!cheapId && !!dearId, cheap.status + "/" + dear.status);

let row = await venueOf(vid);
ok("venue reports 2 courts", row?.courtCount === 2, String(row?.courtCount));
ok("minPrice is the cheaper court", row?.minPrice === 900, String(row?.minPrice));

const stranger = await call(`/api/courts/${cheapId}`, { method: "DELETE", body: JSON.stringify({ ownerId: 1 }) });
ok("a stranger is refused", stranger.status === 403, stranger.status + " " + JSON.stringify(stranger.body));
ok("refusal explains itself", String(stranger.body?.error ?? "").includes("owner"), JSON.stringify(stranger.body));

const noOwner = await call(`/api/courts/${cheapId}`, { method: "DELETE", body: JSON.stringify({}) });
ok("no owner id is refused", noOwner.status === 403, noOwner.status);

const unknown = await call("/api/courts/999999", { method: "DELETE", body: JSON.stringify({ ownerId: 7 }) });
ok("unknown court 404s", unknown.status === 404, unknown.status);

const badId = await call("/api/courts/abc", { method: "DELETE", body: JSON.stringify({ ownerId: 7 }) });
ok("a junk id 400s", badId.status === 400, badId.status);

const bk = await call("/api/bookings", { method: "POST", body: JSON.stringify({
  courtId: cheapId, userId: U, date: "2026-10-05", startTime: "18:00", endTime: "19:00",
}) });
const bid = bk.body?.booking?.id;
ok("booking placed on the cheap court", !!bid, bk.status + " " + JSON.stringify(bk.body).slice(0, 140));

const blocked = await call(`/api/courts/${cheapId}`, { method: "DELETE", body: JSON.stringify({ ownerId: 7 }) });
ok("court with a future booking is refused", blocked.status === 409, blocked.status + " " + JSON.stringify(blocked.body).slice(0, 180));
ok("refusal names upcoming bookings", blocked.body?.reason === "upcoming_bookings", JSON.stringify(blocked.body).slice(0, 180));
ok("refusal counts them", blocked.body?.upcoming === 1, JSON.stringify(blocked.body).slice(0, 180));
row = await venueOf(vid);
ok("blocked court is still counted", row?.courtCount === 2, String(row?.courtCount));

await call(`/api/bookings/${bid}`, { method: "PATCH", body: JSON.stringify({ status: "cancelled", userId: U }) });
const del = await call(`/api/courts/${cheapId}`, { method: "DELETE", body: JSON.stringify({ ownerId: 7 }) });
ok("after cancelling, the delete succeeds", del.status === 200, del.status + " " + JSON.stringify(del.body).slice(0, 180));
ok("the court comes back deactivated", del.body?.court?.isActive === false, JSON.stringify(del.body?.court)?.slice(0, 140));
ok("deletedAt is stamped", !!del.body?.court?.deletedAt, JSON.stringify(del.body?.court)?.slice(0, 140));

row = await venueOf(vid);
ok("retired court leaves the court list", !(row?.courts ?? []).some((c) => c.id === cheapId));
ok("courtCount drops to 1", row?.courtCount === 1, String(row?.courtCount));
ok("minPrice moves to the surviving court", row?.minPrice === 2500, String(row?.minPrice));

const seen = await venueOf(vid, "&includeDeletedCourts=1");
const ghost = (seen?.courts ?? []).find((c) => c.id === cheapId);
ok("still retrievable with includeDeletedCourts", !!ghost && !!ghost.deletedAt, JSON.stringify(ghost)?.slice(0, 140));
ok("courtCount counts them when asked", seen?.courtCount === 2, String(seen?.courtCount));

const rebook = await call("/api/bookings", { method: "POST", body: JSON.stringify({
  courtId: cheapId, userId: U, date: "2026-10-06", startTime: "18:00", endTime: "19:00",
}) });
ok("a retired court can't be booked", rebook.status === 409, rebook.status + " " + JSON.stringify(rebook.body).slice(0, 160));
ok("the refusal says it's retired", String(rebook.body?.error ?? "").includes("retired"), JSON.stringify(rebook.body));

const stillBookable = await call("/api/bookings", { method: "POST", body: JSON.stringify({
  courtId: dearId, userId: U, date: "2026-10-06", startTime: "18:00", endTime: "19:00",
}) });
ok("the sibling court still books fine", stillBookable.status === 201 || stillBookable.status === 200,
   stillBookable.status + " " + JSON.stringify(stillBookable.body).slice(0, 140));

const hist = await call(`/api/bookings?userId=${U}`);
ok("the cancelled booking survives in history", (hist.body?.bookings ?? []).some((b) => b.id === bid));

const again = await call(`/api/courts/${cheapId}`, { method: "DELETE", body: JSON.stringify({ ownerId: 7 }) });
ok("a second delete says it's already gone", again.body?.alreadyDeleted === true,
   again.status + " " + JSON.stringify(again.body).slice(0, 140));

// The venue itself must still retire cleanly with a retired court inside it.
await call(`/api/bookings/${stillBookable.body?.booking?.id ?? stillBookable.body?.id}`, { method: "PATCH", body: JSON.stringify({ status: "cancelled", userId: U }) });
const vd = await call(`/api/venues/${vid}`, { method: "DELETE", body: JSON.stringify({ ownerId: 7 }) });
ok("the venue still retires afterwards", vd.status === 200, vd.status + " " + JSON.stringify(vd.body).slice(0, 160));

console.log(fail === 0 ? `\nALL PASS (${pass}/${pass})` : `\n${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
