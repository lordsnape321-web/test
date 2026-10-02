/**
 * Web/mobile parity guards: the web-only bugs fixed in this round, plus the
 * brand and the copy the app greets people with.
 *
 * Every one of these is a bug a phone could not show and a browser could: a
 * native-only `Alert` that silently does nothing on react-native-web (the
 * booking desk's **Decline**), a label drawn twice, a row of swatches one dot
 * wider than the screen, a delete cue parked on the side of the row that hides
 * it, a white-on-white cue in light mode, and an owner with no way to close an
 * account. None of it is measurable here, so what is pinned is the shape of the
 * source that made each one impossible, straight from the files.
 *
 * Run: node scripts/parity.test.mjs
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const repoRoot = join(appRoot, "..");

/** Whitespace-insensitive: the assertions are about what is written, not wrapping. */
function flat(path) {
  return readFileSync(path, "utf8").replace(/\s+/g, " ");
}

function walk(dir, files = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".expo" || name === "dist" || name === ".tmp") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.tsx?$/.test(name)) files.push(full);
  }
  return files;
}

let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\n=== web / mobile parity (this round's six) ===\n");

/* ── 1. Alerts that work on the web ─────────────────────────────────────── */

const confirmPath = join(appRoot, "src", "lib", "confirm.ts");
check("the cross-platform confirm helper exists", existsSync(confirmPath));

const helper = flat(confirmPath);
check(
  "the helper uses the browser's own dialog on web",
  /Platform\.OS === "web"/.test(helper) && /window\.confirm\(/.test(helper),
);
check("and a real Alert on the native platforms", /Alert\.alert\(/.test(helper));

// The whole class of bug: a screen asking through `Alert.alert`, which is a
// no-op on react-native-web (`static alert() {}`), so the answer never arrives.
const offenders = [];
for (const dir of ["app", "src"]) {
  for (const file of walk(join(appRoot, dir))) {
    if (file.endsWith(join("src", "lib", "confirm.ts"))) continue;
    if (/Alert\.alert\(/.test(readFileSync(file, "utf8"))) offenders.push(file);
  }
}
check(
  "no screen calls Alert.alert directly any more",
  offenders.length === 0,
  offenders.join(", "),
);

const requests = flat(join(appRoot, "app", "admin", "requests.tsx"));
check(
  "owner-console Decline confirms through the helper",
  /confirmAction\(/.test(requests) && /void runDecide\(id, false\)/.test(requests),
);
check(
  "owner-console Decline still keeps its confirm copy",
  /Decline this booking request\?/.test(requests) && /Keep pending/.test(requests),
);

const desk = flat(join(appRoot, "app", "admin", "bookings.tsx"));
check(
  "the booking desk asks before Decline and Cancel on both platforms",
  /confirmStatus\(b, "rejected", "Decline"\)/.test(desk) &&
    /confirmStatus\(b, "cancelled", "Cancel"\)/.test(desk) &&
    /confirmAction\(/.test(desk),
);
check(
  "and a refused status change is surfaced, not swallowed",
  /Could not mark #FN-\$\{id\}/.test(desk),
);

/* ── 2. Labels that are printed once ───────────────────────────────────── */

const picker = flat(join(appRoot, "src", "components", "ImagePicker.tsx"));
check(
  "the image picker only draws its heading when it has one",
  /\{label \? <Text style=\{\[styles\.label, \{ color: c\.textFaint \}\]\}>\{label\}<\/Text> : null\}/.test(
    picker,
  ),
);

const venues = flat(join(appRoot, "app", "admin", "venues.tsx"));
check(
  "no double 'Cover photo' label on either venue form",
  (venues.match(/Cover photo 📸/g) ?? []).length === 2 &&
    (venues.match(/ImagePicker value=\{(e|f)Image\} onChange=\{set[EF]Image\} label="" \//g) ?? [])
      .length === 2,
);
check(
  "nor a double 'Court photo' label",
  /<FieldLabel>Court photo 📸<\/FieldLabel> <ImagePicker value=\{cImage\} onChange=\{setCImage\} label="" \/>/.test(
    venues,
  ),
);
check(
  "'What it's for' is a full-width field on both venue forms",
  (venues.match(/Full width on purpose: this is a sentence, not a number\./g) ?? []).length === 2 &&
    (venues.match(/<FieldLabel>What it&apos;s for<\/FieldLabel>/g) ?? []).length === 2 &&
    /<FieldLabel>What it&apos;s for<\/FieldLabel> <TextInput value=\{eExtraNote\}/.test(venues) &&
    /<FieldLabel>What it&apos;s for<\/FieldLabel> <TextInput value=\{fExtraNote\}/.test(venues),
);

const leagueForm = flat(join(appRoot, "src", "components", "LeagueForm.tsx"));
check(
  "the league banner label is not doubled either",
  /<ImagePicker value=\{bannerUrl\} onChange=\{setBannerUrl\} label="" \/>/.test(leagueForm),
);

/* ── 3. The colour swatches fit ─────────────────────────────────────────── */

const profile = flat(join(appRoot, "app", "profile.tsx"));
check(
  "the swatch row wraps instead of overflowing",
  /swatches: \{ flexDirection: "row", flexWrap: "wrap", gap: space\[2\] \}/.test(profile),
);

/* ── 4. Owners can close their account ──────────────────────────────────── */

const ownerProfile = flat(join(appRoot, "app", "admin", "profile.tsx"));
check(
  "Owner Studio → My profile offers the same emailed-code delete flow",
  /requestAccountDeleteCode\(user\.id\)/.test(ownerProfile) &&
    /deleteAccount\(user\.id, deleteCode\.trim\(\)\)/.test(ownerProfile) &&
    /await signOut\(\)/.test(ownerProfile) &&
    /router\.replace\("\/login"\)/.test(ownerProfile),
);
check(
  "and the copy says what happens to the venues",
  /venues you run are retired/.test(ownerProfile),
);

const deletion = flat(join(repoRoot, "laravel", "app", "Services", "AccountDeletion.php"));
check(
  "closing an owner's account retires their venues server-side",
  /private static function retireVenues\(int \$userId\): void/.test(deletion) &&
    /Venue::where\('owner_id', \$userId\)/.test(deletion),
);
check(
  "their courts go dark and waiting requests are withdrawn",
  /Court::whereIn\('id', \$courtIds\)->update\(\['is_active' => false\]\)/.test(deletion) &&
    /where\('status', 'pending'\) ->update\(\['status' => 'cancelled'/.test(deletion),
);

/* ── 5. The swipe cue follows the finger, and stays visible ─────────────── */

const swipe = flat(join(appRoot, "src", "components", "SwipeNotificationRow.tsx"));
check(
  "one cue is drawn, on the side the swipe uncovers",
  /const revealed = offset > 8 \? "left" : offset < -8 \? "right" : null;/.test(swipe) &&
    /revealed === "left" && !n\.isRead/.test(swipe) &&
    /revealed === "right" \?/.test(swipe),
);
check(
  "the delete cue is pinned to the revealed edge, not spread apart",
  /cueRight: \{ marginLeft: "auto" \}/.test(swipe) &&
    !/justifyContent: "space-between"/.test(swipe),
);
check(
  "the underlay is a solid colour in both themes, and the cue contrast follows it",
  /backgroundColor: isDark \? colors\.slate700 : colors\.stone100/.test(swipe) &&
    /const danger = isDark \? colors\.red400 : colors\.red600;/.test(swipe) &&
    !/backgroundColor: c\.inset/.test(swipe),
);

/* ── 6. The name, and copy that fits everybody ─────────────────────────── */

const appJson = JSON.parse(readFileSync(join(appRoot, "app.json"), "utf8")).expo;
check(
  "the app is called Futsal Mate, in the places a device reads",
  appJson.name === "Futsal Mate" &&
    appJson.slug === "futsal-mate" &&
    appJson.scheme === "futsalmate" &&
    appJson.android.package === "com.futsalmate.app" &&
    appJson.ios.bundleIdentifier === "com.futsalmate.app",
);

// The old name must be gone from everything a person can see. The password and
// email-code salts still spell it on purpose: they are credential material,
// and renaming them would lock every existing account out. They live in
// laravel/app, which this scan does not touch.
const oldName = [];
for (const dir of ["app", "src"]) {
  for (const file of walk(join(appRoot, dir))) {
    if (/Futsal ?Nepal/i.test(readFileSync(file, "utf8"))) oldName.push(file);
  }
}
check("nothing user-facing still says the old name", oldName.length === 0, oldName.join(", "));

const login = flat(join(appRoot, "app", "login.tsx"));
const signup = flat(join(appRoot, "app", "signup.tsx"));
const home = flat(join(appRoot, "app", "(app)", "index.tsx"));
check(
  "sign-in greets nobody in particular",
  /Sign in 👋/.test(login) &&
    !/Welcome back,/.test(login) &&
    !/Welcome back,/.test(home) &&
    !/user\.name\.split/.test(home),
);
check(
  "and neither sign-in nor signup assumes who is holding the phone",
  !/join the family|the family\?/i.test(login) &&
    !/join the family/i.test(signup) &&
    /Create your account ⚽/.test(signup),
);
check(
  "an installed build can be pointed at a backend without being rebuilt",
  /savedApiBase/.test(readFileSync(join(appRoot, "src", "lib", "api.ts"), "utf8")) &&
    /Server address/.test(login),
);
check(
  "and the release build allows the plain-http LAN backend it points at",
  JSON.stringify(appJson.plugins ?? []).includes("expo-build-properties") &&
    (appJson.plugins ?? []).some(
      (plugin) =>
        Array.isArray(plugin) &&
        plugin[0] === "expo-build-properties" &&
        plugin[1]?.android?.usesCleartextTraffic === true,
    ),
);
check(
  "the cleartext wall is named in the error, not left as the platform's wording",
  /cleartext|network security policy/i.test(readFileSync(join(appRoot, "src", "lib", "api.ts"), "utf8")),
);

console.log(
  failed === 0 ? "\nparity: all assertions passed\n" : `\nparity: ${failed} failed\n`,
);

process.exit(failed === 0 ? 0 : 1);
