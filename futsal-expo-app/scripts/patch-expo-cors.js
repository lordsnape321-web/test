#!/usr/bin/env node
/**
 * Patch @expo/cli CorsMiddleware so any Origin is allowed.
 *
 * Without this, Expo's dev server 500s entry.bundle when the Arena preview
 * (or a browser extension) sends a foreign Origin / `Origin: null`, and the
 * web app fails with "MIME type is not executable".
 *
 * Re-run via `npm run postinstall`.
 */
const fs = require("fs");
const path = require("path");

const candidates = [
  path.join(
    __dirname,
    "..",
    "node_modules",
    "expo",
    "node_modules",
    "@expo",
    "cli",
    "build",
    "src",
    "start",
    "server",
    "middleware",
    "CorsMiddleware.js",
  ),
  path.join(
    __dirname,
    "..",
    "node_modules",
    "@expo",
    "cli",
    "build",
    "src",
    "start",
    "server",
    "middleware",
    "CorsMiddleware.js",
  ),
];

const ALLOW_SNIPPET = "const isAllowedHost = true; // allow every origin for the sandbox preview";

let patched = 0;
for (const file of candidates) {
  if (!fs.existsSync(file)) continue;
  let src = fs.readFileSync(file, "utf8");
  if (src.includes(ALLOW_SNIPPET)) {
    console.log("[patch-expo-cors] already patched:", file);
    continue;
  }

  // Replace the whole middleware body after createCorsMiddleware returns.
  const startMarker = "return (req, res, next)=>{";
  const endMarker = "function maybePreventMetroResetCorsHeader";
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker);
  if (start < 0 || end < 0 || end <= start) {
    console.warn("[patch-expo-cors] unexpected source shape, skip:", file);
    continue;
  }

  const replacement = `${startMarker}
        // Patched: allow any Origin (Arena preview, extensions, null).
        if (typeof req.headers.origin === 'string') {
            let originHost = '';
            let originHostname = '';
            try {
                const parsed = new URL(req.headers.origin);
                originHost = parsed.host;
                originHostname = parsed.hostname;
            } catch  {
                originHost = '';
                originHostname = '';
            }
            const isSameOrigin = originHost !== '' && originHost === req.headers.host;
            const isLocalhost = originHostname === '' ? false : _isLocalHostname(originHostname);
            const isAllowedHost = true; // allow every origin for the sandbox preview
            if (!isSameOrigin && !isAllowedHost) {
                next(new Error(\`Unauthorized request from \${req.headers.origin}. \` + 'This may happen because of a conflicting browser extension to intercept HTTP requests. ' + 'Disable browser extensions or use incognito mode and try again.'));
                return;
            } else {
                res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
                res.setHeader('Access-Control-Allow-Credentials', 'true');
                res.setHeader('Vary', 'Origin');
            }
            maybePreventMetroResetCorsHeader(req, res);
        }
        res.setHeader('X-Content-Type-Options', 'nosniff');
        next();
    };
${endMarker}`;

  src = src.slice(0, start) + replacement + src.slice(end + endMarker.length);
  // endMarker was re-included in replacement — fix double definition
  // Actually replacement ends with endMarker name without body; original body follows from `end`.
  // We sliced from `end` which is start of "function maybePrevent..." so we need the rest after the marker only once.
  // Current: replacement includes "function maybePreventMetroResetCorsHeader" then we append from end+len which is AFTER the marker text — so body is preserved and marker appears once. Good if replacement includes the full function name as prefix of original.

  fs.writeFileSync(file, src);
  console.log("[patch-expo-cors] patched:", file);
  patched++;
}

if (patched === 0 && candidates.every((c) => !fs.existsSync(c))) {
  console.warn("[patch-expo-cors] CorsMiddleware.js not found (expo not installed yet?)");
}
