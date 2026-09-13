"use client";

/**
 * Shared client helpers for launching eSewa / Khalti test checkouts.
 *
 * Why this exists: the app often runs inside an embedded preview iframe.
 * Navigating the *same* tab/frame to rc-epay.esewa.com.np can show
 * "refused to connect" (sandboxed iframe / blocked top navigation).
 * Opening the gateway in a fresh tab escapes the frame and is also how
 * real users pay on mobile anyway.
 *
 * Popup blockers only allow window.open() during the direct click gesture,
 * so callers must call openGatewayTab() synchronously inside onClick,
 * BEFORE awaiting the initiate API.
 */

export function openGatewayTab(): Window | null {
  try {
    const win = window.open("about:blank", "_blank", "noopener");
    if (win) {
      try {
        win.document.write(
          `<!doctype html><html><head><title>Opening secure payment…</title><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f5f5f4;color:#44403c"><div style="text-align:center;padding:24px"><div style="font-size:40px">💳</div><h2>Opening secure test payment…</h2><p>Hold tight — contacting the gateway.</p></div></body></html>`
        );
        win.document.close();
      } catch {
        // cross-origin write can throw after navigation starts; harmless
      }
    }
    return win;
  } catch {
    return null;
  }
}

export function navigateTab(win: Window | null, url: string): boolean {
  if (!win || win.closed) return false;
  try {
    win.location.href = url;
    try {
      win.focus();
    } catch {}
    return true;
  } catch {
    return false;
  }
}

export function submitEsewaFormToTab(
  url: string,
  fields: Record<string, string>,
  win: Window | null
): boolean {
  try {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = url;
    form.acceptCharset = "UTF-8";
    if (win && !win.closed) {
      // Submit directly into the pre-opened tab (popup-safe).
      const targetName = win.name || `esewa-${Date.now()}`;
      try {
        win.name = targetName;
      } catch {}
      form.target = targetName;
    } else {
      form.target = "_blank";
    }
    for (const [k, v] of Object.entries(fields)) {
      const inp = document.createElement("input");
      inp.type = "hidden";
      inp.name = k;
      inp.value = String(v);
      form.appendChild(inp);
    }
    document.body.appendChild(form);
    form.submit();
    // Clean up; navigation happens in the other tab (or same tab fallback).
    setTimeout(() => form.remove(), 4000);
    return true;
  } catch {
    return false;
  }
}

export function submitEsewaFormSameTab(url: string, fields: Record<string, string>) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = url;
  form.acceptCharset = "UTF-8";
  for (const [k, v] of Object.entries(fields)) {
    const inp = document.createElement("input");
    inp.type = "hidden";
    inp.name = k;
    inp.value = String(v);
    form.appendChild(inp);
  }
  document.body.appendChild(form);
  form.submit();
}

export type PendingGateway = {
  method: "eSewa" | "Khalti";
  bookingId: number;
  amount: number;
  paymentUrl?: string;
  pidx?: string;
  esewaUrl?: string;
  esewaFields?: Record<string, string>;
};
