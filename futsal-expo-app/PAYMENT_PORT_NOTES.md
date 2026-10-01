# Payment gateways — the real test servers

The app pays on the **actual test servers** both providers hand out, not on a
local copy of them:

- **eSewa** — `https://rc-epay.esewa.com.np/api/epay/main/v2/form`, merchant
  `EPAYTEST`, and the published test login `9806800001` / `Nepal@123` / MPIN
  `1122` / token `123456`.
- **Khalti** — `https://dev.khalti.com/api/v2/epayment/*`, Khalti's published
  sandbox key by default (`KHALTI_SECRET_KEY` overrides it with your own from
  test-admin.khalti.com), test payer `9800000001` / MPIN `1111` / OTP `987654`.

`src/lib/gateway-plan.ts` decides what to do with the server's answer,
`src/lib/gateway.ts` opens the right surface (tab, form, or system browser), and
`src/lib/checkout.ts` is the one call every payment button makes.

## How a checkout runs

1. The screen taps **Pay** and calls `prepareGatewayTab()` — synchronously, while
   the tap is still live, because browsers only allow a scripted `window.open`
   during the gesture. It only reserves a tab when the app is framed (the Arena
   preview); a top-level page is simply replaced.
2. `POST /api/payments/{esewa,khalti}/initiate` builds the session and says where
   the browser should go:
   - eSewa → `handoffPath`, a page that POSTs the signed form (a browser can
     POST; `Linking.openURL` cannot);
   - Khalti → `payment_url`, the test-pay page.
3. The gateway returns the browser to `/payment/esewa/success` or
   `/payment/khalti/callback`, which calls `verify`. The server checks eSewa's
   HMAC plus its status API, or Khalti's lookup — the redirect itself never
   settles a payment.

## Falling back, and the simulator

`initiate` answers `mock: true` with a simulator URL when the test server cannot
be reached; the app then opens the local `/payment/{esewa,khalti}/mock` screens,
which verify with `mockApprove` on the identical server path. A refused session
(a played game, a paid share, the wrong amount) stays an error — it never turns
into a fake payment. The simulator is what happens *after* the real server
refuses to answer, never a mode the app starts in.

## When the test server is down

eSewa's UAT is regularly unavailable — its page says "Service is currently
unavailable. Please try again later.", which is its own wording for a backend
timeout, not a rejected payment. Two things keep that from being a dead end:

- before it hands the browser over, `initiate` checks that the gateway's host is
  answering (`Payments::reachable()`); if it is not, the server answers
  `mock: true` and the app runs the simulator instead. Any HTTP answer counts as
  up, so a real gateway that merely returns an error still gets the checkout;
- the failure screens offer **Try again**, which re-runs the session's last
  checkout in one tap (`rememberCheckout` / `retryLastCheckout` in
  `src/lib/checkout.ts`) — the return screens are a different route and cannot
  know which booking started the payment.

## Environment

| Variable | Meaning |
|---|---|
| `EXPO_PUBLIC_PAYMENT_MODE` | `simulator` forces the local mock everywhere — only for working offline, nothing sets it |
| `EXPO_PUBLIC_APP_ORIGIN` | Overrides where a device is returned to, e.g. `http://192.168.1.20:8081`. Not needed while developing: the app derives it from the Expo dev server it was loaded from, and the server falls back to `APP_WEB_URL` |

Nothing has to be configured for the test servers — the published sandbox
credentials are the defaults.

## League entry fees

Captains pay entry fees through the same checkout: `startLeagueCheckout` in
`src/lib/checkout.ts`, `initiateLeaguePayment` in `src/api/index.ts`, and the
league hand-off page `GET /api/payments/esewa/handoff/league` for a browser that
cannot POST eSewa's form. The reference (`LG-<league>-<team>-…`) is what the
return pages verify against, and every path — gateway, simulator, or the host
recording cash — settles through `App\Services\LeagueEntry`, so a squad's totals
and its invite acceptance are identical however the money arrived.
