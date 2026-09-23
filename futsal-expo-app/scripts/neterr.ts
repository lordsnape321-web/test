/**
 * Proves the network-failure path in apiJson: when fetch throws (no HTTP
 * response), the error must be an ApiError with status 0 whose message names the
 * unreachable URL and, for localhost/127.0.0.1, explains the device-vs-machine
 * trap. Run against a port nothing listens on.
 */
import { ApiError, apiJson } from "@/lib/api";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  console.log("\n=== network-failure message test ===\n");
  try {
    // Port 59999 — nothing listens here, so fetch rejects before any response.
    await apiJson("/api/auth/login", { method: "POST", json: { email: "a@b.c", password: "x" } });
    check("fetch threw", false, "expected a throw, got a response");
  } catch (e) {
    check("error is an ApiError", e instanceof ApiError, e instanceof ApiError ? "yes" : String(e));
    if (e instanceof ApiError) {
      check("status is 0 (no HTTP response)", e.status === 0, `status=${e.status}`);
      check("message names the URL", e.message.includes("/api/auth/login"), "");
      check(
        "message explains the localhost device trap",
        e.message.includes("this device itself") || e.message.includes("LAN IP"),
        "",
      );
      console.log(`\n  message:\n  ${e.message}\n`);
    }
  }
  console.log(`=== ${pass} passed, ${fail} failed ===\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("TEST ERROR:", e instanceof Error ? e.message : e);
  process.exit(1);
});
