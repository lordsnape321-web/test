import { KhaltiMockScreen } from "@/components/PaymentScreens";

/**
 * The Khalti demo checkout, inside the app.
 *
 * Same route and same shape as the eSewa one — mobile number, MPIN, OTP, then
 * the confirmation screen with the demo wallet's balance and the Pay button —
 * settling through `/api/payments/khalti/verify` with `mockApprove`.
 */
export default KhaltiMockScreen;
