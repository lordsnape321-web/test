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
into a fake payment.

## Environment

| Variable | Meaning |
|---|---|
| `EXPO_PUBLIC_PAYMENT_MODE` | `simulator` forces the local mock everywhere; unset means the real test servers |
| `EXPO_PUBLIC_APP_ORIGIN` | A native build's return origin, e.g. `http://192.168.1.20:8081`. Without it a device keeps using the simulator, since a return URL that points nowhere would strand the payment in the system browser |

## Not wired yet

League entry fees still run on the simulator: the league verify branch records
`MOCK-…` receipts by design and has no signature/lookup path, so pointing it at
the real gateway needs a server-side verification branch first.
