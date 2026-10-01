# Payment gateways — the real test servers

The app pays on the **actual test servers** both providers hand out, not on a
local copy of them:

- **eSewa** — `https://rc-epay.esewa.com.np/api/epay/main/v2/form`, merchant
  `EPAYTEST`, and the test login its docs list today: `9711111111` (also
  `9711111112`/`9711111113`) / password `Test@123` / MPIN `1122` / token
  `123456`. The older `9806800001–5` / `Nepal@123` set still appears in eSewa's
  ePay v2 walkthrough and may work — the wallets are shared, so a spent or
  locked one looks exactly like a broken integration.
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

   **Where it returns to** is the client's call (`paymentReturnUrl`): a browser
   comes back to its own origin, and a device comes back *into the app* — a deep
   link (`exp://host:8081/--/…` in Expo Go, `futsalnepal://…` in a built app),
   because the Expo web build is not the app and a player sent there would be
   stranded in a browser with no record of the checkout. The server validates
   what it is given (`Payments::isUsableReturnUrl`: http/https or an app scheme,
   never `javascript:`/`data:`/`file:`, and no query of its own).

## If the player comes back without finishing

Paying happens in another app, so coming back is the normal case, not the edge
one. The checkout that was started is kept as a small serializable record
(`PendingRecord` in `src/lib/checkout.ts`) in AsyncStorage, so it survives a
reload or a cold start, and the screens a player returns to show a **Payment in
progress** card (`PaymentPendingBanner`): what the payment was for, a *Check
payment* button that asks the gateway, and a *Finish on the simulator* button
when the gateway could not be reached. Bringing the app to the foreground checks
by itself (at most once every 20 seconds), so a payment that actually went
through settles without the player doing anything. A record older than six hours
is dropped — the gateway session is long gone by then.

## If eSewa says the payment failed

Two different things can be going on, and they need different answers:

- **Their server was unavailable.** eSewa answers `{"code":0,"error_message":
  "Service is currently unavailable"}` and shows "Service is currently
  unavailable. Please try again later." when their backend times out. Nothing
  can be verified from that page, so `initiate` checks the host first and the
  simulator takes over instead (see below).
- **The transaction failed after login.** That is eSewa's own decision, and the
  usual causes are a wrong MPIN/token, a spent test wallet, or an amount above
  what the shared wallet holds. `Payments::esewaTestLoginHint()` prints the
  current login and the alternates on the checkout page for exactly this.

Because eSewa can also show a failure *after* taking the money, the failure
screen offers **Check with eSewa**: the server looks up the transaction it
started (`recoverSession`, using the stored uuid) and settles it through the
normal path if eSewa's status API says COMPLETE. And a status that lags —
PENDING, AMBIGUOUS, even NOT_FOUND moments after completion — no longer blocks a
signed COMPLETE payment; only CANCELED and the refunds do.

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
