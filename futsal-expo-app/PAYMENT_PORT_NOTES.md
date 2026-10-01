# Payment gateways — the real test servers

The app pays on the **actual test servers** both providers hand out, not on a
local copy of them:

- **eSewa** — `https://rc-epay.esewa.com.np/api/epay/main/v2/form`, merchant
  `EPAYTEST`, and the test login its docs list today: `9711111111` (also
  `9711111112`/`9711111113`) / password `Test@123` / MPIN `1122` / token
  `123456`. The older `9806800001–5` / `Nepal@123` set still appears in eSewa's
  ePay v2 walkthrough and may work — the wallets are shared, so a spent or
  locked one looks exactly like a broken integration. If a payment dies at the
  debit step, see *If eSewa says the payment failed* below.
- **Khalti** — `https://dev.khalti.com/api/v2/epayment/*`, Khalti's published
  sandbox key by default (`KHALTI_SECRET_KEY` overrides it with your own from
  test-admin.khalti.com), test payer `9800000001` / MPIN `1111` / OTP `987654`.

`src/lib/gateway-plan.ts` decides what to do with the server's answer,
`src/lib/gateway.ts` opens the right surface (tab, form, or system browser), and
`src/lib/checkout.ts` is the one call every payment button makes.

## Setup note

The in-app checkout needs one extra library: **`react-native-webview`** (it is
in `package.json`, and Expo Go already bundles the native side). After pulling,
run

```bash
cd futsal-expo-app && npm install
```

once. Metro cannot resolve a module that is not installed, so `npx expo start`
would fail on the import until this has run.

## How a checkout runs

1. The screen taps **Pay**. On the web `prepareGatewayTab()` runs first,
   synchronously, because browsers only allow a scripted `window.open` during
   the gesture (and only while the app is framed). On a phone there is no tab to
   reserve: the gateway page opens inside the app, in `GatewaySheet`.
2. `POST /api/payments/{esewa,khalti}/initiate` builds the session and says where
   the browser should go:
   - eSewa → `handoffPath`, a page that POSTs the signed form (a browser can
     POST; `Linking.openURL` cannot);
   - Khalti → `payment_url`, the test-pay page.
3. Or the caller asked for the **demo checkout** (`demo: true`), in which case
   no gateway is contacted at all and the answer points at the replica page
   (`/api/payments/{esewa,khalti}/demo`) — see *The demo checkout* below.
4. The gateway returns the browser to `/payment/esewa/success` or
   `/payment/khalti/callback`, which calls `verify`. The server checks eSewa's
   HMAC plus its status API, or Khalti's lookup — the redirect itself never
   settles a payment.

   **Where it returns to** is the client's call (`paymentReturnUrl`), and it is
   always an http(s) URL — custom schemes are an unusual redirect target for a
   gateway, and one that dislikes them fails the checkout before anything can be
   paid. On a phone that URL is the *mobile web* origin (`paymentWebOrigin()`:
   the Expo dev server the app was loaded from, `http://192.168.x.x:8081`), whose
   Metro proxies `/api` back to Laravel, so the return screen can verify the
   payment. The server validates what it is given
   (`Payments::isUsableReturnUrl`: http/https, never `javascript:`/`data:`/
   `file:`, and no query of its own).

   On a phone the WebView intercepts that URL before it loads
   (`isReturnUrl` in `src/lib/inapp-gateway.ts`), closes the sheet, and pushes
   the *same* in-app route a browser would have reached — `/payment/esewa/success?data=…`,
   `/payment/esewa/failure`, `/payment/khalti/callback?pidx=…`. Verification is
   one implementation, reached two ways.

## If the player comes back without finishing

Paying happens in another app, so coming back is the normal case, not the edge
one. The checkout that was started is kept as a small serializable record
(`PendingRecord` in `src/lib/checkout.ts`) in AsyncStorage, so it survives a
reload or a cold start, and the screens a player returns to show a **Payment in
progress** card (`PaymentPendingBanner`): what the payment was for, a *Check
payment* button that asks the gateway — offered only for a real session, since a
demo has no gateway to ask — and a *Finish on the demo checkout* button that
reopens the replica page when one was started. Bringing the app to the foreground checks
by itself (at most once every 20 seconds), so a payment that actually went
through settles without the player doing anything. A record older than six hours
is dropped — the gateway session is long gone by then.

## Inside the app, and outside it

| Surface | eSewa | Khalti |
|---|---|---|
| Web (browser) | the signed form is POSTed from the page, or the hand-off page opens in a tab | `payment_url` in a tab |
| Phone (Expo Go, dev build, installed) | `GatewaySheet` POSTs the signed form in a WebView | the sheet loads `payment_url` |

The hand-off page (`/api/payments/esewa/handoff`) is still there for the one
surface that cannot POST a form — a system browser — but it is the fallback now,
not the route a phone takes: `planCheckout` prefers the signed fields whenever
the client can use them.

The sheet's header carries three things a payer can check against what the
gateway's own page asks for: the amount (`detail`, taken from the initiate
response), the gateway's reference for this attempt
(`fields.transaction_uuid`), and the caution that matters — for eSewa, that the
test session ends about five minutes after login.

## If eSewa says the payment failed

Two different things can be going on, and they need different answers:

- **Their server was unavailable.** eSewa answers `{"code":0,"error_message":
  "Service is currently unavailable"}` and shows "Service is currently
  unavailable. Please try again later." when their backend times out. Nothing
  can be verified from that page, so `initiate` checks the host first and the
  replica page takes over instead (see below).
- **It keeps failing.** There is a replica for exactly this: *Use the demo
  checkout* on the failure screen, or the switch in settings. It runs the same
  three steps, settles through the same verify endpoint, and does not depend on
  anybody's sandbox.

### If it still fails

- **The transaction failed after login.** If the token verifies and the confirm
  screen appears, the credentials were fine — the *debit* is what failed, and
  eSewa's status API says so in one word: `FAILED` (a session it never saw is
  `NOT_FOUND` instead, which is a different bug). Two things cause it:

  1. **The shared test wallet cannot cover the amount.** The docs promise
     "adequate balance will be updated to test user account", but the wallets
     are shared between every integrator and a real booking amount (hundreds or
     thousands of rupees) can exceed what is in them. Pay a *small* amount — a
     teammate's share or a small payment request with eSewa — or another wallet
     (`9711111111`–`9711111114`; `9806800001`–`9806800005` are older but
     sometimes funded).
  2. **The login session sat for about five minutes.** eSewa's own docs: if the
     payment is not made within five minutes of logging in, the transaction
     fails and must be reinitiated. Logging in again and paying straight away is
     the whole fix; the sheet's header says so while the payer is on the page.

  `Payments::esewaTestLoginHint()` prints the current login and the alternates
  on the checkout page for exactly this.

The app says all of this on the failure screen itself. The server hands back
what eSewa answered — status, amount, transaction uuid (`'esewa' => [… ]` in
`recoverSession`) — and the screen spells it out
(`describeCheck` in `src/lib/checkout.ts`), so "it failed" arrives with the
amount and the reference worth quoting.

Because eSewa can also show a failure *after* taking the money, the failure
screen asks eSewa itself, on arrival (`Check with eSewa again` repeats it): the
server looks up the transaction it started (`recoverSession`, using the stored
uuid) and settles it through the normal path if eSewa's status API says
COMPLETE. And a status that lags — PENDING, AMBIGUOUS, even NOT_FOUND moments
after completion — no longer blocks a signed COMPLETE payment; only CANCELED and
the refunds do.

### When one gateway refuses, try the other one

The two test servers are independent: eSewa's shared wallets failing says
nothing about Khalti's sandbox (test payer `9800000001`, MPIN `1111`, OTP
`987654`), and vice versa. So both failure screens offer the *other* gateway as
their second button, and `switchLastCheckoutGateway` in `src/lib/checkout.ts`
carries it out: it saves the choice the way the booking cards do
(`chooseBookingPayment`, `chooseBookingTeamPayment`, `chooseBookingPaymentRequest`
— both gateways refuse a target marked for the other one), drops the old session
id and the other gateway's page, and starts the new checkout in place. The payer never has
to go back and find the booking again.

## The demo checkout (the replica)

eSewa's test wallets are shared between every integrator ("adequate balance will
be updated to test user account" is a promise, not a standing balance), Khalti's
sandbox locks accounts, and neither is reachable from wherever a demo might
happen. So the backend serves a replica of both gateway pages:

- **`laravel/public/demo-esewa.html`** and **`demo-khalti.html`** are plain
  pages: eSewa's green header, Khalti's purple one, the merchant row and the
  amount, and the whole flow — sign in → confirm with the MPIN → the token
  (eSewa) or the OTP (Khalti), with the published test credentials accepted and
  a *Fill demo credentials* button. A wrong value at any step gets that step's
  own message, a *Cancel payment* hands the payer back as a failure, and the
  page says at the bottom that it is a replica and not affiliated with either
  provider.
  They are served at **`GET /api/payments/{esewa,khalti}/demo`**, not beside the
  app's own routes: the web build reaches this backend only through its `/api`
  proxy, and a page at `/demo-esewa.html` lands on the app's router instead
  ("Unmatched Route"). From the API path the page's own `/api/...` posts stay
  relative to whichever host opened it, on a device and in a browser alike.
- **The app opens it exactly like a real gateway page.** `Payments::demoGatewayUrl()`
  builds the URL on the host the client reached the API on, and every initiate
  answer carries it as `demoUrl` — the replica when the mode asked for it, and
  also on a real answer, so a failure screen can still switch sides. It travels
  in the same in-app sheet (`GatewaySheet`) a real checkout uses, so the header,
  the amount, the reference and the return-URL interception are one
  implementation.
- **It settles through the same verify endpoint.** The page POSTs
  `/api/payments/{esewa,khalti}/verify` (or `/api/tournaments/:id/payments` for
  a league entry) with `mockApprove: true` and then hands the payer to the app's
  own return URL, so the booking states, ledger, amounts, notifications and
  league settlement are the real code paths. Only the gateway is pretend.
- **It is the default.** `src/lib/payment-mode.ts` leads with the replica; the
  switch in *Settings → Help and about → Use the real eSewa and Khalti test
  servers* turns the providers on, and `EXPO_PUBLIC_PAYMENT_MODE=real` does the
  same for a build (`demo` and the older `simulator` spell the default out). The
  choice is read at checkout time, so it takes effect on the next payment.
- **A demo is never checked against a gateway.** The pending card keeps the
  demo's page so it can be reopened (the sheet again, not a browser tab), and it
  offers no *Check payment* button: nothing at eSewa knows about a payment eSewa
  never saw, and asking used to answer "eSewa has no completed payment for this
  booking" about a booking that was already settled.

The mode is sent **with the request** (`demo: true`), and the server builds the
page from the booking it priced — never from the client's own numbers. A refused
session (a played game, a paid share, the wrong amount) stays an error: neither
the replica nor the fallback turns it into a fake payment.

The old native mock screens (`app/payment/{esewa,khalti}/mock.tsx` and
`GatewayMock` in `src/components/PaymentScreens.tsx`) are gone. A page cannot
drift from the flow it copies the way a second implementation does, and there is
now one checkout path in the app instead of two.

## When the test server is down

eSewa's UAT is regularly unavailable — its page says "Service is currently
unavailable. Please try again later.", which is its own wording for a backend
timeout, not a rejected payment. Two things keep that from being a dead end:

- before it hands the browser over, `initiate` checks that the gateway's host is
  answering (`Payments::reachable()`); if it is not, the server answers with the
  replica page instead and the payment can still be made (`fallback=…` carries
  the gateway's own complaint). Any HTTP answer counts as up, so a real gateway
  that merely returns an error still gets the checkout;
- the failure screens offer **Try again**, which re-runs the session's last
  checkout in one tap (`rememberCheckout` / `retryLastCheckout` in
  `src/lib/checkout.ts`) — the return screens are a different route and cannot
  know which booking started the payment.

## Environment

| Variable | Meaning |
|---|---|
| `EXPO_PUBLIC_PAYMENT_MODE` | `real` makes the providers' test servers the default; `demo` (or the older `simulator`) says the replica default out loud. Unset means the replica |
| `EXPO_PUBLIC_APP_ORIGIN` | Overrides where a device is returned to, e.g. `http://192.168.1.20:8081`. Not needed while developing: the app derives it from the Expo dev server it was loaded from, and the server falls back to `APP_WEB_URL` |

Nothing has to be configured for the test servers — the published sandbox
credentials are the defaults.

## League entry fees

Captains pay entry fees through the same checkout: `startLeagueCheckout` in
`src/lib/checkout.ts`, `initiateLeaguePayment` in `src/api/index.ts`, and the
league hand-off page `GET /api/payments/esewa/handoff/league` for a browser that
cannot POST eSewa's form. The reference (`LG-<league>-<team>-…`) is what the
return pages verify against, and every path — gateway, replica, or the host
recording cash — settles through `App\Services\LeagueEntry`, so a squad's totals
and its invite acceptance are identical however the money arrived.
