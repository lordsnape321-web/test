/**
 * Types for the slice of the API this app uses.
 *
 * Every field here was read off a live response from the Next.js API rather
 * than copied from the Drizzle schema, because the routes reshape rows before
 * returning them (a booking carries a nested `venue` and `court`, for example).
 *
 * Only the fields the UI actually renders are declared. The API returns more;
 * leaving the rest out keeps this readable and stops the app depending on
 * fields it never uses.
 */

export type PaymentMethod = "eSewa" | "Khalti" | "Cash at Venue" | "Bank Transfer";

export type Court = {
  id: number;
  venueId: number;
  name: string;
  pricePerHour: number;
  /** Some venues price mornings differently; absent when they don't. */
  priceMorning?: number | null;
  surface?: string | null;
  format?: string | null;
  features?: string[] | null;
  imageUrl?: string | null;
  isActive?: boolean;
  deletedAt?: string | null;
};

export type Venue = {
  id: number;
  name: string;
  address: string;
  city: string;
  description: string;
  phone: string;
  imageUrl?: string | null;
  openingHour: number;
  closingHour: number;
  rating: number;
  totalReviews: number;
  isFeatured?: boolean;
  amenities?: string[] | null;
  /**
   * Comma-separated list, e.g. "eSewa,Khalti,Cash at Venue" — the API returns a
   * string, not an array. Split on "," and trim before comparing.
   */
  acceptedPayments?: string | null;
  /** Denormalised by the API for list rendering. */
  courtCount: number;
  minPrice: number;
  depositPercent?: number;
  defaultExtraFee?: number | null;
  defaultExtraFeeNote?: string | null;
  courts?: Court[] | null;
  /** Soft-delete marker; the list screens filter these out. */
  deletedAt?: string | null;
};

export type User = {
  id: number;
  name: string;
  email: string;
  phone: string;
  role: "player" | "owner" | "admin";
  level?: string;
  position?: string;
  avatarUrl?: string | null;
  matchesPlayed?: number;
  rating?: number;
  trustScore?: number;
};

export type BookingStatus = "pending" | "confirmed" | "cancelled" | "completed";
export type PaymentStatus = "unpaid" | "deposit_paid" | "paid" | "overpaid";

export type Booking = {
  id: number;
  userId: number;
  courtId: number;
  venueId?: number;
  date: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  totalPrice: number;
  paidAmount: number;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  paymentMethod?: PaymentMethod | null;
  bookerName: string;
  bookerPhone: string;
  notes?: string | null;
  createdAt: string;
  settledAt?: string | null;
  /** Nested by the API so a booking list can render without extra requests. */
  venue?: Pick<Venue, "id" | "name" | "address" | "city" | "imageUrl" | "phone"> | null;
  court?: Pick<Court, "id" | "name" | "pricePerHour" | "surface" | "format"> | null;
  user?: Pick<User, "id" | "name" | "email" | "phone"> | null;
};

/** GET /api/bookings/:id/ledger */
export type LedgerPayment = {
  id: number;
  amount: number;
  method: string;
  note?: string | null;
  source?: string | null;
  voidedAt?: string | null;
  createdAt: string;
};

export type LedgerExtra = {
  id: number;
  label: string;
  amount: number;
  createdAt: string;
};

export type Ledger = {
  bookingId: number;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  courtPrice: number;
  totals: {
    owed: number;
    paid: number;
    balance: number;
    surplus: number;
  };
  window: {
    settled: boolean;
    editable: boolean;
    msLeft: number;
    locksAt: number | null;
  };
  editWindowMs: number;
  settledAt: string | null;
  settledBy: number | null;
  acceptedMethods: string[];
  defaultExtraFee?: number | null;
  defaultExtraFeeNote?: string | null;
  extras: LedgerExtra[];
  payments: LedgerPayment[];
};
