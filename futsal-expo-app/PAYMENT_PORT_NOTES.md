# Payment routes — intentional React Native substitution

The Next.js source has `/payment/esewa` and `/payment/khalti` gateway
redirect/callback pages (plus deep-link return handling). React Native has no
browser navigation stack for those hosted test gateways, so this app keeps the
same server contract without porting those pages 1:1:

- `initiateEsewa` / `verifyEsewa` and `initiateKhalti` / `verifyKhalti` are the
  only steps the player booking flow needs (same API routes as web).
- Against the sandbox gateways the app verifies with `mockApprove`, which walks
  the identical server path (signature check skipped, ledger row appended,
  statuses updated).
- Web-only form-post redirects and `window.location` returns are replaced by
  inline Pay buttons on the booking card / booking detail screen.

If deep-link parity with the hosted eSewa/Khalti test pages is ever demanded,
port `src/app/payment/*` next and wire `expo-linking` handlers.
