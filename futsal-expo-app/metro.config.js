const http = require("node:http");
const https = require("node:https");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

/**
 * Expo web uses same-origin `/api/*` URLs so a browser never tries to call
 * localhost directly. During development Metro forwards those requests to the
 * existing Next.js app. Native builds still use EXPO_PUBLIC_API_BASE directly.
 *
 * Set EXPO_WEB_API_PROXY when the API is not on the default local port, for
 * example `https://api.example.com` or `http://127.0.0.1:3000`.
 */
const proxyOrigin = process.env.EXPO_WEB_API_PROXY || "http://127.0.0.1:3000";
let proxyTarget;
try {
  proxyTarget = new URL(proxyOrigin);
} catch {
  proxyTarget = new URL("http://127.0.0.1:3000");
}

const upstreamRequest = proxyTarget.protocol === "https:" ? https.request : http.request;
const previousEnhance = config.server?.enhanceMiddleware;

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware, server) => {
    const base = previousEnhance ? previousEnhance(middleware, server) : middleware;
    return (req, res, next) => {
      const pathname = String(req.url || "");
      if (!pathname.startsWith("/api/") && pathname !== "/api") {
        return base(req, res, next);
      }

      const headers = { ...req.headers, host: proxyTarget.host };
      // The API receives this as a server-to-server request; browser CORS is not
      // involved because the browser only contacted its own Expo origin.
      delete headers.origin;

      const upstream = upstreamRequest(
        {
          protocol: proxyTarget.protocol,
          hostname: proxyTarget.hostname,
          port: proxyTarget.port || undefined,
          method: req.method,
          path: pathname,
          headers,
        },
        (upstreamRes) => {
          res.statusCode = upstreamRes.statusCode || 502;
          for (const [key, value] of Object.entries(upstreamRes.headers)) {
            if (value !== undefined && key.toLowerCase() !== "transfer-encoding") {
              res.setHeader(key, value);
            }
          }
          upstreamRes.pipe(res);
        },
      );

      upstream.on("error", (error) => {
        if (res.headersSent) {
          res.end();
          return;
        }
        res.statusCode = 502;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: `API proxy unavailable: ${error.message}` }));
      });
      req.pipe(upstream);
      return undefined;
    };
  },
};

module.exports = config;
