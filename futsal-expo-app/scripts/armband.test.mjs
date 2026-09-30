/**
 * The hand-over row in the captain's panel — a layout regression guard.
 *
 * "Choose the next captain" showed and the Transfer button did not. The cause
 * was the row itself, not the button: the picker's label is a whole name plus
 * level and position, React Native's `flexShrink` defaults to 0 (unlike CSS),
 * and the picked control inside is `width: "100%"`, so the picker claimed the
 * full line and pushed its sibling past the card's edge — off the screen.
 *
 * Nothing here can measure a device, so this asserts the three properties that
 * make the squeeze impossible, straight from the source: the picker gives up
 * width, the button refuses to, and below `sm` the two stack instead of
 * fighting over one line. It also pins the resting state, because a 40%-opacity
 * amber pill with white text was the second half of "there is no button here".
 *
 * Run: node scripts/armband.test.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "src", "components", "TeamManager.tsx"), "utf8");
// Whitespace-insensitive: the assertions are about which styles are used, not
// how the file is wrapped.
const flat = source.replace(/\s+/g, " ");

let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\n=== armband hand-over row ===\n");

// 1. The picker and the button are rendered by the same block.
check(
  "picker and Transfer button share the hand-over section",
  /Hand over the armband/.test(flat) &&
    /styles\.transferRow/.test(flat) &&
    /styles\.transferBtn/.test(flat) &&
    /styles\.pickerWrap/.test(flat),
);

// 2. Above `sm` the picker is the flexible one — it truncates, the button does not move.
check(
  "picker takes the leftover width above sm",
  /sm \? styles\.pickerWrapFluid : styles\.pickerWrapFull/.test(flat) &&
    /pickerWrapFluid: \{ flex: 1, minWidth: 0 \}/.test(flat),
);

// 3. Below `sm` the two stack, so neither can be pushed out of the card.
check(
  "row stacks below sm",
  /styles\.transferRow, sm \? null : styles\.transferRowStack/.test(flat) &&
    /transferRowStack: \{ flexDirection: "column", alignItems: "stretch" \}/.test(flat),
);

// 4. The button is never the thing that shrinks.
check("button refuses to shrink", /transferBtn: \{[^}]*flexShrink: 0/.test(flat));

// 5. Resting state reads as a button: outlined pill with muted text, not a fade.
check(
  "resting state is an outlined pill, not a faded amber one",
  /canTransfer \? null : \{ backgroundColor: c\.inset, borderWidth: 1, borderColor: c\.border,? \}/.test(flat) &&
    /const canTransfer = newCaptainId !== "" && busy !== "transfer";/.test(flat),
);

console.log(failed === 0 ? "\narmband: all assertions passed\n" : `\narmband: ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
