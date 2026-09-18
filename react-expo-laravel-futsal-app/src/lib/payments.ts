import { createHmac, randomUUID } from "node:crypto";

export const ESEWA_TEST_PRODUCT_CODE = "EPAYTEST";
export const ESEWA_TEST_SECRET = "8gBm/:&EnhH.1/q";
export const ESEWA_FORM_URL_DEFAULT = "https://rc-epay.esewa.com.np/api/epay/main/v2/form";
export const ESEWA_STATUS_URL_DEFAULT = "https://rc-epay.esewa.com.np/api/epay/transaction/status/";

export const KHALTI_INITIATE_URL_DEFAULT = "https://dev.khalti.com/api/v2/epayment/initiate/";
export const KHALTI_LOOKUP_URL_DEFAULT = "https://dev.khalti.com/api/v2/epayment/lookup/";

export function getEsewaConfig() {
  return {
    productCode: process.env.ESEWA_MERCHANT_CODE?.trim() || ESEWA_TEST_PRODUCT_CODE,
    secretKey: process.env.ESEWA_SECRET_KEY?.trim() || ESEWA_TEST_SECRET,
    formUrl: process.env.ESEWA_FORM_URL?.trim() || ESEWA_FORM_URL_DEFAULT,
    statusUrl: process.env.ESEWA_STATUS_URL?.trim() || ESEWA_STATUS_URL_DEFAULT,
  };
}

export function getKhaltiConfig() {
  return {
    secretKey: process.env.KHALTI_SECRET_KEY?.trim() || "",
    initiateUrl: process.env.KHALTI_INITIATE_URL?.trim() || KHALTI_INITIATE_URL_DEFAULT,
    lookupUrl: process.env.KHALTI_LOOKUP_URL?.trim() || KHALTI_LOOKUP_URL_DEFAULT,
  };
}

export function getAppOrigin(reqUrl: string, req?: Request) {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim();
  if (envUrl) {
    try {
      return new URL(envUrl).origin;
    } catch {
      // fall through
    }
  }
  try {
    if (req) {
      const h = req.headers;
      const forwardedHost = h.get("x-forwarded-host")?.split(",")[0]?.trim();
      const forwardedProto =
        h.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
        (forwardedHost && !forwardedHost.startsWith("localhost") && !forwardedHost.startsWith("127.")
          ? "https"
          : undefined);
      const host = forwardedHost || h.get("host") || "";
      if (host && !host.startsWith("0.0.0.0")) {
        const proto = forwardedProto || (host.includes("localhost") || host.startsWith("127.") ? "http" : "https");
        return `${proto}://${host}`;
      }
      const origin = h.get("origin")?.trim();
      if (origin && !origin.includes("0.0.0.0")) return new URL(origin).origin;
      const referer = h.get("referer")?.trim();
      if (referer) {
        const r = new URL(referer).origin;
        if (!r.includes("0.0.0.0")) return r;
      }
    }
    const u = new URL(reqUrl);
    if (!u.host.startsWith("0.0.0.0")) return u.origin;
    return "http://localhost:3000";
  } catch {
    return "http://localhost:3000";
  }
}

export function makeEsewaUuid(bookingId: number) {
  const rand = randomUUID().replace(/-/g, "").slice(0, 8);
  return `FN-${bookingId}-${Date.now().toString(36)}-${rand}`;
}

export function signEsewaMessage(message: string, secretKey: string) {
  return createHmac("sha256", secretKey).update(message).digest("base64");
}

export function buildEsewaFields(opts: {
  amount: number;
  transactionUuid: string;
  productCode: string;
  secretKey: string;
  successUrl: string;
  failureUrl: string;
}) {
  const total = String(opts.amount);
  const signed_field_names = "total_amount,transaction_uuid,product_code";
  const message = `total_amount=${total},transaction_uuid=${opts.transactionUuid},product_code=${opts.productCode}`;
  const signature = signEsewaMessage(message, opts.secretKey);
  return {
    amount: total,
    tax_amount: "0",
    total_amount: total,
    transaction_uuid: opts.transactionUuid,
    product_code: opts.productCode,
    product_service_charge: "0",
    product_delivery_charge: "0",
    success_url: opts.successUrl,
    failure_url: opts.failureUrl,
    signed_field_names,
    signature,
  };
}

export type EsewaCallbackData = {
  transaction_code?: string;
  status?: string;
  total_amount?: string;
  transaction_uuid?: string;
  product_code?: string;
  signed_field_names?: string;
  signature?: string;
  [k: string]: unknown;
};

export function decodeEsewaData(dataB64: string): EsewaCallbackData {
  const json = Buffer.from(dataB64, "base64").toString("utf-8");
  return JSON.parse(json) as EsewaCallbackData;
}

export function verifyEsewaSignature(payload: EsewaCallbackData, secretKey: string): boolean {
  try {
    const fields = String(payload.signed_field_names || "total_amount,transaction_uuid,product_code")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const message = fields
      .map((f) => `${f}=${String((payload as Record<string, unknown>)[f] ?? "")}`)
      .join(",");
    const expected = signEsewaMessage(message, secretKey);
    return expected === String(payload.signature || "");
  } catch {
    return false;
  }
}

export function parseBookingIdFromEsewaUuid(uuid: string): number | null {
  const m = /^FN-(\d+)-/.exec(uuid || "");
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function makeKhaltiOrderId(bookingId: number) {
  const rand = randomUUID().replace(/-/g, "").slice(0, 6);
  return `FN-${bookingId}-${Date.now().toString(36)}-${rand}`;
}

export function parseBookingIdFromKhaltiOrder(orderId: string): number | null {
  const m = /^FN-(\d+)-/.exec(orderId || "");
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/* ------------------------------------------------- league entry references */

/**
 * A league entry is paid by a *squad in a league*, not by a booking, so its
 * gateway reference carries both ids — and a different prefix, so a league
 * callback can never be mistaken for a booking one.
 */
export function makeLeagueEsewaUuid(leagueId: number, teamId: number) {
  const rand = randomUUID().replace(/-/g, "").slice(0, 8);
  return `LG-${leagueId}-${teamId}-${Date.now().toString(36)}-${rand}`;
}

export function makeLeagueKhaltiOrder(leagueId: number, teamId: number) {
  const rand = randomUUID().replace(/-/g, "").slice(0, 6);
  return `LG-${leagueId}-${teamId}-${Date.now().toString(36)}-${rand}`;
}

/** `LG-4-2-…` -> `{ leagueId: 4, teamId: 2 }`, or null for anything else. */
export function parseLeagueRef(ref: string): { leagueId: number; teamId: number } | null {
  const m = /^LG-(\d+)-(\d+)-/.exec(ref || "");
  if (!m) return null;
  const leagueId = Number(m[1]);
  const teamId = Number(m[2]);
  return Number.isInteger(leagueId) && leagueId > 0 && Number.isInteger(teamId) && teamId > 0
    ? { leagueId, teamId }
    : null;
}

export async function khaltiInitiate(opts: {
  secretKey: string;
  initiateUrl: string;
  returnUrl: string;
  websiteUrl: string;
  amountPaisa: number;
  orderId: string;
  orderName: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
}) {
  const res = await fetch(opts.initiateUrl, {
    method: "POST",
    headers: {
      Authorization: `Key ${opts.secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      return_url: opts.returnUrl,
      website_url: opts.websiteUrl,
      amount: opts.amountPaisa,
      purchase_order_id: opts.orderId,
      purchase_order_name: opts.orderName,
      customer_info: {
        name: opts.customerName || "Futsal Player",
        email: opts.customerEmail || "player@futsal.np",
        phone: opts.customerPhone || "9800000000",
      },
    }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg =
      (data?.detail as string) ||
      (data?.error as string) ||
      (data?.message as string) ||
      `Khalti initiate failed (${res.status})`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(data).slice(0, 300));
  }
  const pidx = String(data.pidx || "");
  const paymentUrl = String(data.payment_url || "");
  if (!pidx || !paymentUrl) throw new Error("Khalti did not return payment_url");
  return { pidx, payment_url: paymentUrl, raw: data };
}

export async function khaltiLookup(opts: { secretKey: string; lookupUrl: string; pidx: string }) {
  const res = await fetch(opts.lookupUrl, {
    method: "POST",
    headers: {
      Authorization: `Key ${opts.secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ pidx: opts.pidx }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg =
      (data?.detail as string) ||
      (data?.error as string) ||
      `Khalti lookup failed (${res.status})`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(data).slice(0, 300));
  }
  return data as {
    status?: string;
    transaction_id?: string;
    pidx?: string;
    total_amount?: number;
    [k: string]: unknown;
  };
}

export async function esewaStatusCheck(opts: {
  statusUrl: string;
  productCode: string;
  transactionUuid: string;
  totalAmount: number | string;
}) {
  const url = new URL(opts.statusUrl);
  url.searchParams.set("product_code", opts.productCode);
  url.searchParams.set("transaction_uuid", opts.transactionUuid);
  url.searchParams.set("total_amount", String(opts.totalAmount));
  const res = await fetch(url.toString(), { method: "GET" });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`eSewa status check failed (${res.status})`);
  }
  return data as { status?: string; transaction_code?: string; [k: string]: unknown };
}
