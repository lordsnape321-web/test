import {
  ledgerTotals,
  settleWindow,
  formatWindowLeft,
  validateExtraLine,
  validateInstalment,
  SETTLE_EDIT_WINDOW_MS,
} from "@/lib/booking-ledger";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  → " + extra : "")); }
};
const eq = (name: string, got: unknown, want: unknown) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

console.log("\n— ledgerTotals —");
// The user's own example: Rs 1,700 paid 700 eSewa + 500 Khalti + 500 cash.
const split = ledgerTotals({
  courtPrice: 1700,
  extras: [],
  payments: [
    { id: 1, amount: 700, method: "eSewa" },
    { id: 2, amount: 500, method: "Khalti" },
    { id: 3, amount: 500, method: "Cash at Venue" },
  ],
});
eq("1700 split three ways leaves nothing owed", split.balance, 0);
eq("the total received is 1700", split.paid, 1700);
eq("each medium is tracked separately", split.byMethod, { eSewa: 700, Khalti: 500, "Cash at Venue": 500 });
eq("no surplus when it lands exactly", split.surplus, 0);

const part = ledgerTotals({
  courtPrice: 1700,
  extras: [],
  payments: [{ id: 1, amount: 700, method: "eSewa" }],
});
eq("a part payment shows what's left", part.balance, 1000);
eq("a part payment isn't over", part.surplus, 0);

const over = ledgerTotals({
  courtPrice: 1700,
  extras: [],
  payments: [{ id: 1, amount: 2000, method: "Cash at Venue" }],
});
eq("overpaying shows the change due", over.surplus, 300);
eq("overpaying leaves no balance", over.balance, 0);

const withExtras = ledgerTotals({
  courtPrice: 1700,
  extras: [
    { id: 1, label: "Water x10", amount: 300 },
    { id: 2, label: "Extra ball", amount: 100 },
  ],
  payments: [{ id: 1, amount: 1700, method: "Cash at Venue" }],
});
eq("extras add to what's owed", withExtras.owed, 2100);
eq("extras total is reported", withExtras.extrasTotal, 400);
eq("the court payment no longer covers it", withExtras.balance, 400);

const voided = ledgerTotals({
  courtPrice: 1700,
  extras: [
    { id: 1, label: "Water x10", amount: 300 },
    { id: 2, label: "Mistyped", amount: 3000, voidedAt: new Date() },
  ],
  payments: [
    { id: 1, amount: 700, method: "eSewa" },
    { id: 2, amount: 9999, method: "Cash at Venue", voidedAt: new Date() },
  ],
});
eq("a voided extra doesn't count", voided.owed, 2000);
eq("a voided instalment doesn't count", voided.paid, 700);
eq("the balance follows both", voided.balance, 1300);

eq("nothing paid yet", ledgerTotals({ courtPrice: 1700, extras: [], payments: [] }).paid, 0);
eq("a negative court price is floored", ledgerTotals({ courtPrice: -50, extras: [], payments: [] }).owed, 0);
eq("a missing method groups under Unspecified",
  ledgerTotals({ courtPrice: 100, extras: [], payments: [{ id: 1, amount: 50, method: "" }] }).byMethod,
  { Unspecified: 50 });

console.log("\n— settleWindow —");
const t0 = Date.now();
eq("an unsettled booking is always editable", settleWindow(null, t0).editable, true);
eq("an unsettled booking isn't settled", settleWindow(null, t0).settled, false);
eq("an undefined settle time behaves the same", settleWindow(undefined, t0).editable, true);
eq("a bogus date doesn't lock anything", settleWindow("not a date", t0).editable, true);

const justSettled = settleWindow(new Date(t0 - 1000).toISOString(), t0);
eq("freshly settled is editable", justSettled.editable, true);
eq("freshly settled reports time left", justSettled.msLeft > 0 && justSettled.msLeft <= SETTLE_EDIT_WINDOW_MS, true);
eq("locksAt is 5 minutes after settling", justSettled.locksAt, t0 - 1000 + SETTLE_EDIT_WINDOW_MS);

const edge = settleWindow(new Date(t0 - SETTLE_EDIT_WINDOW_MS).toISOString(), t0);
eq("exactly at 5 minutes it has locked", edge.editable, false);
eq("exactly at 5 minutes nothing is left", edge.msLeft, 0);

const after = settleWindow(new Date(t0 - SETTLE_EDIT_WINDOW_MS - 1).toISOString(), t0);
eq("a second past the window it's locked", after.editable, false);

const before = settleWindow(new Date(t0 - SETTLE_EDIT_WINDOW_MS + 1000).toISOString(), t0);
eq("a second inside the window it's open", before.editable, true);

eq("the window is five minutes", SETTLE_EDIT_WINDOW_MS, 300000);

console.log("\n— formatWindowLeft —");
eq("5:00 for the full window", formatWindowLeft(300000), "5:00");
eq("pads single seconds", formatWindowLeft(65000), "1:05");
eq("rounds up a partial second", formatWindowLeft(1000), "0:01");
eq("never goes negative", formatWindowLeft(-5000), "0:00");

console.log("\n— validateInstalment —");
eq("a normal amount passes", validateInstalment(700, "eSewa"), null);
eq("cash is accepted", validateInstalment(500, "Cash at Venue"), null);
eq("zero is refused", validateInstalment(0, "eSewa") !== null, true);
eq("a negative is refused", validateInstalment(-100, "eSewa") !== null, true);
eq("decimals are refused", validateInstalment(100.5, "eSewa") !== null, true);
eq("a blank is refused", validateInstalment("", "eSewa") !== null, true);
eq("a medium the venue doesn't take is refused",
  String(validateInstalment(100, "Bitcoin")).includes("doesn't take"), true);
eq("an unknown medium names the alternatives",
  String(validateInstalment(100, "")).includes("eSewa"), true);
eq("the venue's own list is honoured",
  validateInstalment(100, "Khalti", { allowed: ["Cash at Venue"] }) !== null, true);
eq("over the cap is refused", validateInstalment(999999, "eSewa", { max: 100000 }) !== null, true);
eq("overpaying is NOT an error (surplus handles it)", validateInstalment(5000, "Cash at Venue"), null);

console.log("\n— validateExtraLine —");
eq("a described charge passes", validateExtraLine("Water x10", 300), null);
eq("no description is refused", validateExtraLine("", 300) !== null, true);
eq("a blank description says why", String(validateExtraLine("   ", 300)).includes("what the extra charge is for"), true);
eq("no amount is refused", validateExtraLine("Water", "") !== null, true);
eq("zero is refused", validateExtraLine("Water", 0) !== null, true);
eq("decimals are refused", validateExtraLine("Water", 10.5) !== null, true);
eq("an over-long description is refused", validateExtraLine("x".repeat(121), 100) !== null, true);
eq("120 characters is fine", validateExtraLine("x".repeat(120), 100), null);
eq("whitespace in the label is fine", validateExtraLine("  Water  ", 100), null);
eq("over the cap is refused", validateExtraLine("Water", 999999) !== null, true);

console.log(fail === 0 ? `\nALL PASS (${pass}/${pass})` : `\n${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
