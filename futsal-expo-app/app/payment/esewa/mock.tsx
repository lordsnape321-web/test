import { EsewaMockScreen } from "@/components/PaymentScreens";

/**
 * The eSewa demo checkout, inside the app.
 *
 * The route the Pay buttons open in demo mode (see `src/lib/checkout.ts`) and
 * the route the server names as `mockUrl`: sign in, MPIN, token, then the
 * confirmation screen with the demo wallet's balance and the Pay button. It
 * settles through `/api/payments/esewa/verify` with `mockApprove`, the same
 * call eSewa's own return page makes.
 */
export default EsewaMockScreen;
