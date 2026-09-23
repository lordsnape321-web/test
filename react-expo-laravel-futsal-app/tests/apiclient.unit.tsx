import { spawnSync } from "node:child_process";
import { apiFetch, apiUrl, isRemoteApi } from "@/lib/api";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  → " + extra : "")); }
};
const eq = (name: string, got: unknown, want: unknown) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const REMOTE = "https://api.example.com";

/*
 * Re-invoked as a child with NEXT_PUBLIC_API_BASE set, to prove the same code
 * resolves to a different origin. The base is read once at module load, so the
 * remote case cannot be exercised in this process.
 */
if (process.env.__API_REMOTE_CHECK__ === "1") {
  console.log(JSON.stringify({ url: apiUrl("/api/bookings"), remote: isRemoteApi }));
  process.exit(0);
}

console.log("\n— with no API base configured (how it runs today) —");
// This is the load-bearing assertion: the refactor must not change behaviour.
eq("isRemoteApi is false", isRemoteApi, false);
eq("an /api path is returned unchanged", apiUrl("/api/bookings"), "/api/bookings");
eq("a query string survives", apiUrl("/api/bookings?userId=7"), "/api/bookings?userId=7");

console.log("\n— url normalisation —");
eq("a missing leading slash is added", apiUrl("api/venues"), "/api/venues");
eq("an absolute http url is never prefixed", apiUrl("https://other.test/x"), "https://other.test/x");
eq("an absolute https url is never prefixed", apiUrl(REMOTE + "/api/x"), REMOTE + "/api/x");

console.log("\n— apiFetch is a transparent wrapper —");
{
  const seen: Array<[string, RequestInit | undefined]> = [];
  const real = globalThis.fetch;
  globalThis.fetch = ((input: string, init?: RequestInit) => {
    seen.push([input, init]);
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;

  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ a: 1 }),
  };
  await apiFetch("/api/bookings", init);
  globalThis.fetch = real;

  eq("one request was made", seen.length, 1);
  eq("the url is the relative path", seen[0][0], "/api/bookings");
  eq("init is forwarded untouched", seen[0][1], init);
}

console.log("\n— with NEXT_PUBLIC_API_BASE set (the Expo + Laravel target) —");
{
  const r = spawnSync(process.execPath, [process.argv[1]], {
    encoding: "utf8",
    env: { ...process.env, __API_REMOTE_CHECK__: "1", NEXT_PUBLIC_API_BASE: REMOTE + "/" },
  });
  ok("the child exited cleanly", r.status === 0, r.stderr?.slice(0, 200));
  let out: { url: string; remote: boolean } | null = null;
  try { out = JSON.parse((r.stdout || "").trim().split("\n").pop() || "null"); } catch { /* ignore */ }
  ok("the child reported a result", out !== null, (r.stdout || "").slice(0, 200));
  if (out) {
    eq("isRemoteApi is true", out.remote, true);
    eq("the base is prefixed onto the path", out.url, REMOTE + "/api/bookings");
    // Strip the protocol first: "//api" otherwise matches the slashes in
    // "https://api.example.com" and reports a false failure.
    ok("the trailing slash was trimmed, not doubled",
       !out.url.replace(/^https?:\/\//, "").includes("//"), out.url);
  }
}

console.log(fail === 0 ? `\nALL PASS (${pass}/${pass + fail})` : `\n${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
