"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  MapPin,
  Star,
  Phone,
  Clock,
  ChevronLeft,
  Check,
  BadgeCheck,
  Wallet,
  Users,
  Zap,
  Lock,
  Globe,
  PartyPopper,
  Minus,
  Plus,
  Shield,
  ShieldAlert,
  Ticket,
  Swords,
  Trophy,
  Search,
} from "lucide-react";
import { useUser } from "@/components/UserProvider";
import { ReceiptUploader, isOnlineMethod } from "@/components/ReceiptUploader";
import { ReviewsSection } from "@/components/Reviews";
import { validateTitle, validatePhone, validateNotes, validateCustomPrice, firstError } from "@/lib/validation";
import { normalizePromoCode } from "@/lib/promos";
import { depositDecision, depositAmountFor, parsePayments, ONLINE_PAYMENTS, TRUST_START, type PlayerStats } from "@/lib/loyalty";
import {
  formatNPR,
  next14Days,
  prettyDayShort,
  timeSlots,
  addHours,
  formatTime12,
  prettyDate,
  rangeSlots,
  gamePlayed,
} from "@/lib/futsal";
import { apiFetch } from "@/lib/api";

type Court = {
  id: number;
  venueId: number;
  name: string;
  format: string;
  surface: string;
  pricePerHour: number;
  priceMorning: number;
  imageUrl: string;
  isActive: boolean;
  features: string;
};

type Venue = {
  id: number;
  name: string;
  address: string;
  city: string;
  phone: string;
  description: string;
  imageUrl: string;
  rating: number;
  totalReviews: number;
  openingHour: number;
  closingHour: number;
  amenities: string;
  acceptedPayments?: string;
  depositPercent?: number;
  courts: Court[];
};

/** A squad the logged-in player belongs to — see `/api/teams?userId=`. */
type UserTeam = {
  id: number;
  name: string;
  memberCount: number;
  logoColor: string;
  level?: string;
  /** "captain" | "player" */
  role?: string;
};

/**
 * A league this player could book a fixture in — from
 * `/api/tournaments?viewerId=`. `teams` is the approved-squad list (the pool an
 * opponent can be picked from) and `viewer.myTeams` says which of this player's
 * squads actually hold a place.
 */
type MyLeague = {
  id: number;
  name: string;
  venueId: number | null;
  venueName: string;
  status: string;
  teams: Array<{ teamId: number; name: string; logoColor: string; teamCode: string }>;
  viewer: {
    isHost: boolean;
    myTeams: Array<{ teamId: number; teamName: string; status: string; isCaptain: boolean }>;
  } | null;
};

/** A squad an opponent can be picked from (all teams, or a league's squads). */
type OpponentOption = { teamId: number; name: string; logoColor: string; teamCode: string };

/** A code the venue advertises right now (tap to apply). */
type PromoAd = {
  id: number;
  code: string;
  title: string;
  summary: string;
  expiryLabel: string;
  expiresAt: string;
  minBookingAmount: number;
};

/** A code the server accepted for the current bill. */
type AppliedPromo = {
  id: number;
  code: string;
  title: string;
  summary: string;
  discount: number;
  expiryLabel: string;
};

const PAY_METHODS = ["eSewa", "Khalti", "Cash at Venue"];
const LEVEL_OPTIONS = [
  { name: "Beginner", emoji: "🌱", hint: "Just for fun" },
  { name: "Intermediate", emoji: "⚡", hint: "Decent game" },
  { name: "Advanced", emoji: "🔥", hint: "Bring skills" },
];

export default function VenueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useUser();
  const [venue, setVenue] = useState<Venue | null>(null);
  const [loading, setLoading] = useState(true);
  const [courtId, setCourtId] = useState<number | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [slot, setSlot] = useState<string | null>(null);
  const [hours, setHours] = useState(1);
  const [booked, setBooked] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [payMethod, setPayMethod] = useState(PAY_METHODS[0]);
  const [receipt, setReceipt] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public" | "competition">("private");
  const [myLeagues, setMyLeagues] = useState<MyLeague[]>([]);
  const [allTeams, setAllTeams] = useState<OpponentOption[]>([]);
  const [leagueChoice, setLeagueChoice] = useState("");
  const [opponentTeamId, setOpponentTeamId] = useState("");
  const [opponentQuery, setOpponentQuery] = useState("");
  const [matchTitle, setMatchTitle] = useState("");
  const [ourCrew, setOurCrew] = useState(5);
  const [openSpots, setOpenSpots] = useState(5);
  const [welcomeMode, setWelcomeMode] = useState<"any" | "specific">("any");
  const [welcomeLevels, setWelcomeLevels] = useState<string[]>([]);
  const [chargeMode, setChargeMode] = useState<"split" | "custom">("split");
  const [customPrice, setCustomPrice] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [userTeams, setUserTeams] = useState<UserTeam[]>([]);
  const [selectedTeam, setSelectedTeam] = useState("");
  const [booking, setBooking] = useState(false);
  const [payRedirect, setPayRedirect] = useState(false);
  const [success, setSuccess] = useState<null | { id: number; total: number; isPublic: boolean; freePlay: boolean; saved: number; promoCode: string; teamName: string; opponentName: string; leagueName: string }>(null);
  const [error, setError] = useState("");
  const [myVouchers, setMyVouchers] = useState<Array<{ id: number; code: string; status: string }>>([]);
  const [loyalty, setLoyalty] = useState<{ count: number; target: number; remaining: number } | null>(null);
  const [useFreePlay, setUseFreePlay] = useState(false);
  const [venuePromos, setVenuePromos] = useState<PromoAd[]>([]);
  const [promoCode, setPromoCode] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<AppliedPromo | null>(null);
  const [promoError, setPromoError] = useState("");
  const [promoChecking, setPromoChecking] = useState(false);
  const [myVenueBookings, setMyVenueBookings] = useState<Array<{ id: number; label: string }>>([]);
  const [myStats, setMyStats] = useState<PlayerStats | null>(null);
  const [myTrust, setMyTrust] = useState(TRUST_START);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(`/api/venues/${id}`);
        const data = await res.json();
        setVenue(data.venue ?? null);
        if (data.venue?.courts?.length > 0) setCourtId(data.venue.courts[0].id);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // Codes this venue is advertising — hidden ones stay unlisted but still work.
  useEffect(() => {
    (async () => {
      // Different venue -> drop any code carried over from the last one.
      setAppliedPromo(null);
      setPromoCode("");
      setPromoError("");
      try {
        const res = await apiFetch(`/api/promos?venueId=${id}`);
        const data = await res.json().catch(() => ({}));
        setVenuePromos(data.promos ?? []);
      } catch {
        setVenuePromos([]);
      }
    })();
  }, [id]);

  const loadLoyalty = useCallback(
    async (uid: number) => {
      try {
        const [vRes, bRes, sRes] = await Promise.all([
          apiFetch(`/api/vouchers?userId=${uid}`),
          apiFetch(`/api/bookings?userId=${uid}`),
          apiFetch(`/api/users/${uid}`),
        ]);
        const vData = await vRes.json();
        const bData = await bRes.json();
        const sData = await sRes.json().catch(() => ({}));
        if (sData?.stats) setMyStats(sData.stats as PlayerStats);
        if (sData?.user && typeof sData.user.trustScore === "number") setMyTrust(sData.user.trustScore);
        const allV = (vData.vouchers ?? []) as Array<{ id: number; code: string; status: string; venue: { id: number } | null }>;
        setMyVouchers(
          allV
            .filter((v) => v.status === "active" && v.venue?.id === Number(id))
            .map((v) => ({ id: v.id, code: v.code, status: v.status }))
        );
        const prog = ((vData.progress ?? []) as Array<{ venueId: number; count: number; target: number; remaining: number }>).find(
          (p) => p.venueId === Number(id)
        );
        setLoyalty(prog ? { count: prog.count, target: prog.target, remaining: prog.remaining } : { count: 0, target: 7, remaining: 7 });
        // Every game already played here. A player keeps one review per venue
        // and updates it after a new game, so an already-reviewed game is still
        // listed — that's the game the review gets rewritten from.
        const myBookings = (bData.bookings ?? []) as Array<{
          id: number;
          date: string;
          startTime: string;
          endTime: string;
          status: string;
          court?: { name: string };
          venue?: { id: number };
        }>;
        const eligible = myBookings
          .filter((b) => b.venue?.id === Number(id) && gamePlayed(b))
          .map((b) => ({
            id: b.id,
            label: `${prettyDate(b.date)} • ${b.court?.name ?? ""} • ${formatTime12(b.startTime)}`,
          }));
        setMyVenueBookings(eligible);
      } catch {}
    },
    [id]
  );

  useEffect(() => {
    if (user) {
      setPhone(user.phone || "");
      // Load my teams: they populate the squad picker under "Just our gang" and
      // let an open invite sync its crew size to the real squad.
      (async () => {
        try {
          // ?userId= returns only this player's squads, membership already
          // verified server-side, so there is nothing to filter here.
          const res = await apiFetch(`/api/teams?userId=${user.id}`);
          const data = await res.json();
          setUserTeams((data.teams ?? []) as UserTeam[]);
        } catch {
          // No teams (or the request failed) → the flow falls back to an
          // individual booking rather than showing an empty picker.
          setUserTeams([]);
        }
      })();
      // Leagues I could book a competitive fixture in. `viewerId` is what lets
      // a *private* league show up here at all — its host and its squads are
      // the only ones who ever receive it.
      (async () => {
        try {
          const res = await apiFetch(`/api/tournaments?viewerId=${user.id}&limit=60`);
          const data = await res.json();
          setMyLeagues((data.leagues ?? []) as MyLeague[]);
        } catch {
          setMyLeagues([]);
        }
      })();
      loadLoyalty(user.id);
    }
  }, [user, loadLoyalty]);

  // A competition game outside a league can be against anyone — so the full
  // squad list is fetched lazily, the first time that path is used.
  useEffect(() => {
    if (visibility !== "competition" || allTeams.length > 0) return;
    (async () => {
      try {
        const res = await apiFetch("/api/teams");
        const data = await res.json();
        setAllTeams(
          ((data.teams ?? []) as Array<{ id: number; name: string; logoColor: string }>).map((t) => ({
            teamId: t.id,
            name: t.name,
            logoColor: t.logoColor,
            teamCode: "",
          }))
        );
      } catch {
        setAllTeams([]);
      }
    })();
  }, [visibility, allTeams.length]);

  const court = useMemo(
    () => venue?.courts.find((c) => c.id === courtId) ?? venue?.courts[0],
    [venue, courtId]
  );

  const slots = useMemo(
    () => (venue ? timeSlots(venue.openingHour, venue.closingHour) : []),
    [venue]
  );

  const loadAvailability = useCallback(async () => {
    if (!court) return;
    setLoadingSlots(true);
    try {
      const res = await apiFetch(`/api/availability?courtId=${court.id}&date=${date}`);
      const data = await res.json();
      setBooked(data.booked ?? []);
    } finally {
      setLoadingSlots(false);
    }
  }, [court, date]);

  useEffect(() => {
    setSlot(null);
    loadAvailability();
  }, [loadAvailability]);

  // Multi-hour block: selecting a start highlights `hours` consecutive slots.
  const selectedRange = useMemo(() => rangeSlots(slots, slot, hours), [slots, slot, hours]);
  const rangeValid =
    !!slot && selectedRange.length === hours && !selectedRange.some((s) => booked.includes(s));
  const rangeOverflow = !!slot && selectedRange.length !== hours;
  const rangeHitsBooked =
    !!slot && !rangeOverflow && selectedRange.some((s) => booked.includes(s));

  function startBlocked(s: string) {
    const r = rangeSlots(slots, s, hours);
    return r.length !== hours || r.some((x) => booked.includes(x));
  }

  function pickSlot(s: string) {
    if (startBlocked(s)) return;
    setSlot(s);
    setError("");
  }

  function changeHours(h: number) {
    setHours(h);
    setError("");
    // Keep the start; the block preview updates in parallel automatically.
  }

  function pickTeam(teamId: string) {
    setSelectedTeam(teamId);
    // A competition game is tied to the squad that plays it, so switching
    // squads drops the opponent — and any league the new squad isn't in.
    setOpponentTeamId("");
    setOpponentQuery("");
    setLeagueChoice((prev) => {
      if (!prev) return prev;
      const id = Number(teamId) || 0;
      const stillIn = myLeagues.some(
        (l) =>
          String(l.id) === prev &&
          (l.viewer?.myTeams ?? []).some((m) => m.teamId === id && m.status === "approved")
      );
      return stillIn ? prev : "";
    });
    if (!teamId) return;
    const t = userTeams.find((x) => String(x.id) === teamId);
    if (t) {
      setOurCrew(Math.min(21, Math.max(1, t.memberCount || 1)));
    }
  }

  function toggleLevel(name: string) {
    setWelcomeLevels((prev) =>
      prev.includes(name) ? prev.filter((l) => l !== name) : [...prev, name]
    );
  }

  const totalPlayers = ourCrew + openSpots;
  /** Name of the squad this booking is for, or "" for an individual booking. */
  const competitionSquad = Number(selectedTeam) || 0;
  /** Leagues where the chosen squad holds an approved place — the only ones a
   *  booked fixture can count towards (the server checks both squads again). */
  const squadLeagues = useMemo(
    () =>
      myLeagues.filter((l) =>
        (l.viewer?.myTeams ?? []).some(
          (m) => m.teamId === competitionSquad && m.status === "approved"
        )
      ),
    [myLeagues, competitionSquad]
  );
  const chosenLeague = squadLeagues.find((l) => String(l.id) === leagueChoice) ?? null;
  /** Who can be played: the league's other squads, or any squad at all. */
  const opponentPool = useMemo(() => {
    const pool: OpponentOption[] = chosenLeague ? chosenLeague.teams : allTeams;
    return pool.filter((t) => t.teamId !== competitionSquad);
  }, [chosenLeague, allTeams, competitionSquad]);
  const opponentMatches = useMemo(() => {
    const q = opponentQuery.trim().toLowerCase();
    const list = q ? opponentPool.filter((t) => t.name.toLowerCase().includes(q)) : opponentPool;
    return list.slice(0, 8);
  }, [opponentPool, opponentQuery]);
  const chosenOpponent = opponentPool.find((t) => String(t.teamId) === opponentTeamId) ?? null;

  const selectedTeamName = useMemo(
    () => userTeams.find((t) => String(t.id) === selectedTeam)?.name ?? "",
    [userTeams, selectedTeam]
  );
  const matchLevelString =
    welcomeMode === "any" || welcomeLevels.length === 0
      ? "All Levels"
      : welcomeLevels.join(" + ");

  const rate = useMemo(() => {
    if (!court || !slot) return court?.pricePerHour ?? 0;
    return parseInt(slot.split(":")[0], 10) < 12 ? court.priceMorning : court.pricePerHour;
  }, [court, slot]);

  const fullTotal = rate * hours;
  const freePlayActive = useFreePlay && myVouchers.length > 0 && hours >= 1;
  // Loyalty free hour first, then the owner's promo code takes its cut.
  const afterFreePlay = freePlayActive ? Math.max(0, fullTotal - rate) : fullTotal;
  const promoDiscount = appliedPromo?.discount ?? 0;
  const total = Math.max(0, afterFreePlay - promoDiscount);

  /** Ask the server whether this code works on the current bill (never trust local maths). */
  async function applyPromoCode(raw?: string) {
    const code = normalizePromoCode(raw ?? promoCode);
    if (!venue || !code) {
      setPromoError("Type a promo code first 🎟️");
      return;
    }
    if (afterFreePlay <= 0) {
      setAppliedPromo(null);
      setPromoError("Your FREE hour already covers this game — nothing left to discount 🎁");
      return;
    }
    setPromoChecking(true);
    setPromoError("");
    try {
      const qs = new URLSearchParams({
        venueId: String(venue.id),
        code,
        amount: String(Math.round(afterFreePlay)),
      });
      if (user) qs.set("userId", String(user.id));
      const res = await apiFetch(`/api/promos?${qs.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.valid) throw new Error(data.error || `"${code}" didn't work 🎟️`);
      setAppliedPromo({
        id: data.promo.id,
        code: data.promo.code,
        title: data.promo.title ?? "",
        summary: data.promo.summary ?? "",
        discount: Number(data.discount) || 0,
        expiryLabel: data.promo.expiryLabel ?? "",
      });
      setPromoCode(data.promo.code);
    } catch (e) {
      setAppliedPromo(null);
      setPromoError(e instanceof Error ? e.message : "Couldn't check that code 🙏");
    } finally {
      setPromoChecking(false);
    }
  }

  // Court / slot / hours / free-hour changed -> the bill changed, so re-check the code.
  const promoBillKey = `${venue?.id ?? 0}|${afterFreePlay}|${user?.id ?? 0}`;
  useEffect(() => {
    if (!appliedPromo) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the bill changed, so the applied code must be re-checked (and cleared if it no longer fits)
    void applyPromoCode(appliedPromo.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promoBillKey]);
  const availableMethods = useMemo(
    () => parsePayments(venue?.acceptedPayments),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [venue?.id, (venue as { acceptedPayments?: string } | null)?.acceptedPayments]
  );
  const venueDepositPercent = Math.min(100, Math.max(0, Number(venue?.depositPercent ?? 30)));
  const depositPreview = useMemo(() => {
    if (!myStats || total <= 0 || venueDepositPercent <= 0) {
      return { required: false, percent: venueDepositPercent, amount: 0, reason: "" };
    }
    const d = depositDecision(
      { rating: myStats.rating, total: myStats.total, cancelsThisMonth: myStats.cancelsThisMonth },
      myTrust,
      venueDepositPercent
    );
    return { required: d.required, percent: d.percent, amount: depositAmountFor(total, d.percent), reason: d.reason };
  }, [myStats, myTrust, total, venueDepositPercent]);
  const depositOnlineOptions = availableMethods.filter((m) => ONLINE_PAYMENTS.includes(m));

  useEffect(() => {
    if (!availableMethods.includes(payMethod)) {
      setPayMethod(availableMethods[0] ?? PAY_METHODS[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue?.id, (venue as { acceptedPayments?: string } | null)?.acceptedPayments]);
  const autoPerPlayer = totalPlayers > 0 ? Math.round(total / totalPlayers) : 0;
  const customNum = customPrice === "" ? NaN : Number(customPrice);
  const perPlayer = chargeMode === "custom" && Number.isFinite(customNum) ? customNum : autoPerPlayer;
  const joinersTotal = chargeMode === "custom" && Number.isFinite(customNum) ? customNum * openSpots : autoPerPlayer * openSpots;
  const hostShare = total - joinersTotal;
  const hostPerCrew = ourCrew > 0 ? Math.round((hostShare / ourCrew) * 100) / 100 : 0;

  async function confirmBooking() {
    if (!court || !slot || !user) return;
    const errs: Record<string, string> = {};
    if (!rangeValid) {
      setError(
        rangeOverflow
          ? `Only ${slots.length - slots.indexOf(slot)} hour(s) left from there — pick an earlier start or fewer hours! 🙏`
          : "Oops — part of that block just got taken. Pick a fully green block! 🙏"
      );
      return;
    }
    const phoneErr = phone.trim() ? validatePhone(phone.trim(), { required: false }) : null;
    if (phoneErr) errs.phone = phoneErr;
    const notesErr = validateNotes(notes);
    if (notesErr) errs.notes = notesErr;
    if (!availableMethods.includes(payMethod)) {
      setError(`This venue accepts ${availableMethods.join(", ")} only — please pick one of those 💳`);
      return;
    }
    if (depositPreview.required) {
      if (depositOnlineOptions.length > 0 && !ONLINE_PAYMENTS.includes(payMethod)) {
        setError(`Fair-play shield 🛡️ — your ${formatNPR(depositPreview.amount)} deposit must be paid online via test gateway (${depositOnlineOptions.join(", ")}). Cash can't hold a deposit 🙂`);
        return;
      }
    }
    if (visibility === "competition") {
      if (!selectedTeam) {
        setError(
          "Pick which of your squads is playing — a competition game needs your team on it 🛡️"
        );
        return;
      }
      if (!opponentTeamId || !chosenOpponent) {
        setError("Pick the squad you're playing against 🆚");
        return;
      }
      if (Number(opponentTeamId) === Number(selectedTeam)) {
        setError("A squad can't play itself 🙂");
        return;
      }
    }
    if (visibility === "public") {
      if (ourCrew < 1) {
        setError("Tell us how many from your crew are coming 👥");
        return;
      }
      if (openSpots < 1) {
        setError("Open at least 1 spot for others to join 🙋");
        return;
      }
      if (totalPlayers < 4 || totalPlayers > 22) {
        setError("Total players must be between 4 and 22 🤝");
        return;
      }
      if (welcomeMode === "specific" && welcomeLevels.length === 0) {
        setError("Pick at least one level — or choose Anyone welcome 🌍");
        return;
      }
      if (matchTitle.trim()) {
        const tErr = validateTitle(matchTitle.trim(), { min: 3, max: 60, label: "Game title" });
        if (tErr) {
          errs.matchTitle = tErr;
          setFieldErrors(errs);
          setError(tErr);
          return;
        }
      }
      if (chargeMode === "custom") {
        const cErr = validateCustomPrice(customPrice === "" ? "" : Number(customPrice), { total, openSpots, max: 10000 });
        if (cErr) {
          errs.customPrice = cErr;
          setFieldErrors(errs);
          setError(cErr);
          return;
        }
      }
    }
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setError(firstError(...Object.values(errs)) ?? "Please fix the highlighted fields 🙏");
      return;
    }
    setFieldErrors({});
    setBooking(true);
    setError("");
    try {
      const res = await apiFetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courtId: court.id,
          userId: user.id,
          date,
          startTime: slot,
          endTime: addHours(slot, hours),
          durationHours: hours,
          paymentMethod: total === 0 ? "Free Play 🎁" : payMethod,
          paymentStatus: "pending",
          receiptUrl: isOnlineMethod(payMethod) && total > 0 ? receipt : "",
          useFreePlay: freePlayActive,
          promoCode: appliedPromo?.code ?? "",
          bookerName: user.name,
          bookerPhone: phone,
          notes,
          visibility,
          // 0 = individual booking ("Just me", or a player in no team).
          teamId: selectedTeam ? Number(selectedTeam) : 0,
          // Competition only: who we're playing, and (optionally) the league
          // this fixture counts towards. Both squads are re-checked server-side.
          opponentTeamId: visibility === "competition" ? Number(opponentTeamId) || 0 : 0,
          tournamentId:
            visibility === "competition" && chosenLeague ? chosenLeague.id : 0,
          playersNeeded: visibility === "public" ? totalPlayers : 0,
          ourCrew: visibility === "public" ? ourCrew : 1,
          openSpots: visibility === "public" ? openSpots : 0,
          matchTitle: matchTitle.trim() || `⚡ Friendly game at ${venue?.name ?? "futsal"}`,
          level: visibility === "public" ? matchLevelString : "All Levels",
          chargeMode: visibility === "public" ? chargeMode : "split",
          customPricePerPlayer: visibility === "public" && chargeMode === "custom" ? Number(customPrice) : 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Booking failed");
      const created = data.booking;
      const needsGateway =
        !freePlayActive &&
        created.totalPrice > 0 &&
        (payMethod === "eSewa" || payMethod === "Khalti");
      if (needsGateway) {
        setPayRedirect(true);
        try {
          if (payMethod === "eSewa") {
            const init = await apiFetch("/api/payments/esewa/initiate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ bookingId: created.id }),
            });
            const jd = await init.json();
            if (!init.ok) throw new Error(jd.error || "eSewa init failed");
            const form = document.createElement("form");
            form.method = "POST";
            form.action = jd.url;
            for (const [k, v] of Object.entries(jd.fields as Record<string, string>)) {
              const inp = document.createElement("input");
              inp.type = "hidden";
              inp.name = k;
              inp.value = String(v);
              form.appendChild(inp);
            }
            document.body.appendChild(form);
            form.submit();
            return;
          } else {
            const init = await apiFetch("/api/payments/khalti/initiate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ bookingId: created.id }),
            });
            const jd = await init.json();
            if (!init.ok) throw new Error(jd.error || "Khalti init failed");
            window.location.href = jd.payment_url;
            return;
          }
        } finally {
          setPayRedirect(false);
        }
      }
      setSuccess({
        id: created.id,
        total: created.totalPrice,
        isPublic: visibility === "public",
        freePlay: !!data.freePlayUsed,
        saved: Number(created.discountAmount) || 0,
        promoCode: String(created.promoCode ?? ""),
        // From the server's snapshot, not local state — it reflects what was
        // actually written after the membership check.
        teamName: String(created.teamName ?? ""),
        opponentName: String(data.competition?.opponentName ?? ""),
        leagueName: String(data.competition?.leagueName ?? ""),
      });
      setReceipt("");
      setUseFreePlay(false);
      setAppliedPromo(null);
      setPromoCode("");
      setPromoError("");
      loadAvailability();
      if (user) loadLoyalty(user.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Booking failed");
    } finally {
      setBooking(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#FFF9F0] dark:bg-slate-950">
        <div className="mx-auto max-w-7xl animate-pulse px-4 py-8 sm:px-6">
          <div className="h-72 rounded-[2rem] bg-white dark:bg-slate-900" />
          <div className="mt-4 h-10 w-64 rounded-xl bg-white dark:bg-slate-900" />
        </div>
      </main>
    );
  }

  if (!venue) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#FFF9F0] px-4 dark:bg-slate-950">
        <div className="text-center">
          <h1 className="text-2xl font-black text-stone-900 dark:text-slate-100">Hmm, this court seems to have moved 🏃</h1>
          <Link href="/venues" className="mt-3 inline-block text-sm font-bold text-emerald-600 dark:text-emerald-400">
            ← Back to all courts
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#FFF9F0] dark:bg-slate-950">
      {/* Cover */}
      <div className="relative h-64 sm:h-80">
        <img src={venue.imageUrl} alt={venue.name} className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-black/10" />
        <div className="absolute inset-x-0 top-0 mx-auto max-w-7xl px-4 pt-5 sm:px-6">
          <Link
            href="/venues"
            className="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-4 py-2 text-xs font-black text-stone-800 shadow backdrop-blur transition hover:bg-white dark:bg-slate-900/90 dark:text-slate-100 dark:hover:bg-slate-900"
          >
            <ChevronLeft className="h-4 w-4" /> All courts
          </Link>
        </div>
        <div className="absolute inset-x-0 bottom-0 mx-auto max-w-7xl px-4 pb-5 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 rounded-full bg-amber-400 px-2.5 py-1 text-xs font-black text-amber-950 shadow">
              <Star className="h-3 w-3 fill-amber-950" /> {venue.rating.toFixed(1)}
            </span>
            <span className="rounded-full bg-white/90 px-2.5 py-1 text-xs font-bold text-stone-700 shadow backdrop-blur dark:bg-slate-900/90 dark:text-slate-200">
              💬 {venue.totalReviews} happy reviews
            </span>
            <span className="flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-xs font-bold text-stone-700 shadow backdrop-blur dark:bg-slate-900/90 dark:text-slate-200">
              <Clock className="h-3 w-3" /> Open {venue.openingHour}:00 – {venue.closingHour}:00
            </span>
          </div>
          <h1 className="mt-2 text-3xl font-black text-white drop-shadow sm:text-4xl">{venue.name}</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-white/85">
            <MapPin className="h-4 w-4" /> {venue.address} • {venue.city}
            <span className="mx-1">•</span>
            <Phone className="h-3.5 w-3.5" /> {venue.phone}
          </p>
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[1fr_400px]">
        <div className="min-w-0 space-y-5">
          {/* About */}
          <section className="rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
            <h2 className="text-sm font-black uppercase tracking-widest text-orange-500 dark:text-orange-400">Get to know this place</h2>
            <p className="mt-2 text-sm leading-relaxed text-stone-600 dark:text-slate-400">{venue.description}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {venue.amenities.split(",").map((a) => (
                <span
                  key={a}
                  className="flex items-center gap-1 rounded-full bg-[#FFF6E9] px-3 py-1.5 text-[11px] font-bold text-stone-600 dark:bg-white/5 dark:text-slate-300"
                >
                  <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" /> {a.trim()}
                </span>
              ))}
            </div>
          </section>

          {/* Loyalty progress */}
          {user && loyalty && (
            <section className="rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-5 shadow-sm dark:border-violet-500/30 dark:from-violet-500/10 dark:to-fuchsia-500/10">
              <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-violet-600 dark:text-violet-300">
                🎁 Your loyalty here
              </h2>
              {myVouchers.length > 0 ? (
                <div className="mt-2 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 p-4 text-white shadow-md">
                  <p className="text-sm font-black">🎉 You have a FREE hour waiting!</p>
                  <p className="font-mono text-[11px] text-white/80">{myVouchers[0].code}</p>
                  <p className="mt-1 text-xs text-white/90">Toggle it on in your game plan → 1 hour goes free! ⚽</p>
                </div>
              ) : (
                <div className="mt-2">
                  <p className="text-xs font-bold text-stone-600 dark:text-slate-300">
                    Play {loyalty.count}/{loyalty.target} this month {loyalty.remaining > 0 ? `• ${loyalty.remaining} more for a FREE hour! 🔥` : "• reward incoming! 🎉"}
                  </p>
                  <div className="mt-2 flex gap-1">
                    {Array.from({ length: loyalty.target }).map((_, i) => (
                      <span
                        key={i}
                        className={`h-2.5 flex-1 rounded-full ${i < loyalty.count ? "bg-gradient-to-r from-violet-500 to-fuchsia-500" : "bg-stone-200 dark:bg-white/10"}`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Reviews */}
          <ReviewsSection
            venueId={venue.id}
            venueName={venue.name}
            eligibleBookings={myVenueBookings}
            onChanged={async () => {
              const res = await apiFetch(`/api/venues/${id}`);
              const data = await res.json();
              if (data.venue) {
                setVenue((v) => (v ? { ...v, rating: data.venue.rating, totalReviews: data.venue.totalReviews } : v));
              }
              if (user) loadLoyalty(user.id);
            }}
          />

          {/* Courts */}
          <section className="rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
            <h2 className="text-sm font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
              Step 1 • Pick your court
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {venue.courts.map((c) => {
                const active = court?.id === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setCourtId(c.id)}
                    className={`rounded-2xl border p-4 text-left transition ${
                      active
                        ? "border-emerald-500 bg-emerald-50 shadow-md dark:bg-emerald-500/10"
                        : "border-stone-200 bg-stone-50 hover:border-stone-300 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-stone-700 shadow-sm dark:bg-white/10 dark:text-slate-200">
                        <Users className="h-3 w-3" /> {c.format}
                      </span>
                      {active && (
                        <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-600">
                          <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-[15px] font-extrabold text-stone-900 dark:text-slate-100">{c.name}</p>
                    <p className="text-xs text-stone-500 dark:text-slate-400">{c.surface}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <p className="text-sm font-black text-emerald-700 dark:text-emerald-300">
                        {formatNPR(c.pricePerHour)}
                        <span className="text-[11px] font-bold text-stone-400 dark:text-slate-500">/hr</span>
                      </p>
                      <p className="text-[11px] font-bold text-stone-400 dark:text-slate-500">
                        ☀️ Mornings {formatNPR(c.priceMorning)}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Date */}
          <section className="rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
            <h2 className="text-sm font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
              Step 2 • Which day suits you?
            </h2>
            <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto pb-1">
              {next14Days().map((dISO) => {
                const p = prettyDayShort(dISO);
                const active = date === dISO;
                return (
                  <button
                    key={dISO}
                    onClick={() => setDate(dISO)}
                    className={`flex w-[68px] shrink-0 flex-col items-center rounded-2xl border py-2.5 transition ${
                      active
                        ? "border-emerald-600 bg-emerald-600 text-white shadow-md"
                        : "border-stone-200 bg-stone-50 text-stone-800 hover:border-emerald-300 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:border-emerald-500/50"
                    }`}
                  >
                    <span className={`text-[10px] font-black uppercase ${active ? "text-emerald-100" : "text-stone-400 dark:text-slate-500"}`}>
                      {p.dow}
                    </span>
                    <span className="text-xl font-black">{p.day}</span>
                    <span className={`text-[10px] font-bold ${active ? "text-emerald-100" : "text-stone-400 dark:text-slate-500"}`}>
                      {p.month}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Slots + duration */}
          <section className="rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
                Step 3 • How long + when?
              </h2>
              {loadingSlots && (
                <span className="animate-pulse text-xs font-bold text-stone-400 dark:text-slate-500">
                  Checking what&apos;s free…
                </span>
              )}
            </div>
            <p className="mt-1.5 text-xs text-stone-500 dark:text-slate-400">
              Pick 1, 2 or 3 hours first — then tap a start time and we&apos;ll light up the whole block together. ✨
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-black text-stone-800 dark:text-slate-200">I need:</span>
              {[1, 2, 3].map((h) => (
                <button
                  key={h}
                  onClick={() => changeHours(h)}
                  className={`rounded-full px-5 py-2.5 text-xs font-black transition ${
                    hours === h
                      ? "bg-emerald-600 text-white shadow-md"
                      : "border border-stone-200 bg-white text-stone-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
                  }`}
                >
                  {h} hr{h > 1 ? "s" : ""} • {h} slot{h > 1 ? "s" : ""}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] font-bold text-stone-500 dark:text-slate-400">
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-md bg-emerald-600" /> Your {hours}-hr block
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-md border border-stone-300 bg-white dark:border-white/20 dark:bg-transparent" /> Free start
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-md bg-stone-200 dark:bg-white/10" /> Can&apos;t start here
              </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {slots.map((s) => {
                const blocked = startBlocked(s);
                const inRange = selectedRange.includes(s);
                const pos = selectedRange.indexOf(s);
                return (
                  <button
                    key={s}
                    disabled={blocked}
                    onClick={() => pickSlot(s)}
                    title={
                      blocked
                        ? `Not enough free hours from ${formatTime12(s)} for a ${hours}-hr game`
                        : `Start at ${formatTime12(s)} for ${hours} hr`
                    }
                    className={`relative rounded-xl border px-2 py-2.5 text-xs font-extrabold transition ${
                      blocked
                        ? "cursor-not-allowed border-stone-100 bg-stone-100 text-stone-300 line-through dark:border-white/5 dark:bg-white/5 dark:text-slate-600"
                        : inRange
                          ? "border-emerald-600 bg-emerald-600 text-white shadow-md"
                          : "border-stone-200 bg-white text-stone-700 hover:border-emerald-400 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:border-emerald-500"
                    }`}
                  >
                    {formatTime12(s)}
                    {inRange && hours > 1 && (
                      <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-amber-400 text-[10px] font-black text-amber-950 shadow">
                        {pos + 1}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {slot && (
              <div
                className={`mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 text-xs font-bold ${
                  rangeValid
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                    : "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"
                }`}
              >
                <span>
                  {rangeValid ? "✅ Locked in:" : "⚠️ Heads up:"} {formatTime12(slot)} →{" "}
                  {formatTime12(addHours(slot, hours))} • {hours} hr{hours > 1 ? "s" : ""} •{" "}
                  {selectedRange.length} slot{selectedRange.length !== 1 ? "s" : ""}
                </span>
                <span>{formatNPR(total)} total</span>
              </div>
            )}
            {slot && rangeHitsBooked && (
              <p className="mt-2 text-[11px] font-bold text-red-500">
                Part of that block got booked — pick a fully green start time. 🙏
              </p>
            )}
          </section>

          {/* Match visibility */}
          <section className="rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
            <h2 className="text-sm font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
              Step 4 • Just your crew, an open invite, or a competition?
            </h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <button
                onClick={() => setVisibility("private")}
                className={`rounded-2xl border p-4 text-left transition ${
                  visibility === "private"
                    ? "border-emerald-500 bg-emerald-50 shadow-md dark:bg-emerald-500/10"
                    : "border-stone-200 bg-stone-50 hover:border-stone-300 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20"
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-black text-stone-900 dark:text-slate-100">
                  <Lock className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> Just our gang
                  {visibility === "private" && (
                    <span className="ml-auto grid h-5 w-5 place-items-center rounded-full bg-emerald-600">
                      <Check className="h-3 w-3 text-white" strokeWidth={3.5} />
                    </span>
                  )}
                </span>
                <span className="mt-1.5 block text-xs leading-relaxed text-stone-500 dark:text-slate-400">
                  A cosy private game. Only people you invite will know about it.
                </span>
              </button>
              <button
                onClick={() => setVisibility("public")}
                className={`rounded-2xl border p-4 text-left transition ${
                  visibility === "public"
                    ? "border-orange-400 bg-orange-50 shadow-md dark:border-orange-500/50 dark:bg-orange-500/10"
                    : "border-stone-200 bg-stone-50 hover:border-stone-300 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20"
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-black text-stone-900 dark:text-slate-100">
                  <Globe className="h-4 w-4 text-orange-500 dark:text-orange-400" /> Invite everyone!
                  {visibility === "public" && (
                    <span className="ml-auto grid h-5 w-5 place-items-center rounded-full bg-orange-500">
                      <Check className="h-3 w-3 text-white" strokeWidth={3.5} />
                    </span>
                  )}
                </span>
                <span className="mt-1.5 block text-xs leading-relaxed text-stone-500 dark:text-slate-400">
                  Short on players? Tell us your crew + open spots — we&apos;ll help fill the rest.
                </span>
              </button>
              <button
                onClick={() => setVisibility("competition")}
                className={`rounded-2xl border p-4 text-left transition ${
                  visibility === "competition"
                    ? "border-sky-500 bg-sky-50 shadow-md dark:border-sky-500/60 dark:bg-sky-500/10"
                    : "border-stone-200 bg-stone-50 hover:border-stone-300 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20"
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-black text-stone-900 dark:text-slate-100">
                  <Swords className="h-4 w-4 text-sky-600 dark:text-sky-400" /> Competition
                  {visibility === "competition" && (
                    <span className="ml-auto grid h-5 w-5 place-items-center rounded-full bg-sky-600">
                      <Check className="h-3 w-3 text-white" strokeWidth={3.5} />
                    </span>
                  )}
                </span>
                <span className="mt-1.5 block text-xs leading-relaxed text-stone-500 dark:text-slate-400">
                  Two squads, one result. The venue records the score and it counts on both
                  teams&apos; profiles.
                </span>
              </button>
            </div>

            {/* "Just our gang" — pick which of your squads this private game is for. */}
            {visibility === "private" && (
              <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-500/25 dark:bg-emerald-500/5">
                {userTeams.length > 0 ? (
                  <>
                    <TeamPicker
                      teams={userTeams}
                      selected={selectedTeam}
                      onPick={pickTeam}
                      idleLabel="Just me"
                      accent="emerald"
                      title="Which of your teams is this for? 🛡️"
                    />
                    <p className="mt-2 text-[11px] font-bold leading-relaxed text-emerald-700 dark:text-emerald-400">
                      {selectedTeam
                        ? `Booked for ${
                            userTeams.find((t) => String(t.id) === selectedTeam)?.name ??
                            "your team"
                          } — it shows up on your squad&apos;s fixtures. 🛡️`
                        : "Individual booking — no team attached. Tap a squad above to book for them instead. 👆"}
                    </p>
                  </>
                ) : (
                  <div>
                    <span className="block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">
                      Individual booking 🙋
                    </span>
                    <p className="mt-1 text-[11px] leading-relaxed text-stone-500 dark:text-slate-400">
                      You&apos;re not in a team yet, so this game is booked for you and whoever you
                      invite along.{" "}
                      <Link
                        href="/teams"
                        className="font-black text-emerald-700 underline decoration-emerald-400/50 underline-offset-2 dark:text-emerald-400"
                      >
                        Find a team to join
                      </Link>{" "}
                      and you&apos;ll be able to book for your squad right here.
                    </p>
                  </div>
                )}
              </div>
            )}

            {visibility === "public" && (
              <div className="mt-3 space-y-3 rounded-2xl border border-orange-200 bg-orange-50/60 p-4 dark:border-orange-500/25 dark:bg-orange-500/5">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">
                    Name your game (make it fun!)
                  </span>
                  <input
                    value={matchTitle}
                    onChange={(e) => {
                      setMatchTitle(e.target.value);
                      setFieldErrors((p) => ({ ...p, matchTitle: "" }));
                    }}
                    placeholder={`⚡ Friendly kickabout at ${venue.name}`}
                    maxLength={60}
                    className={`w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm font-semibold text-stone-900 placeholder:text-stone-400 focus:outline-none dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 ${
                      fieldErrors.matchTitle
                        ? "border-red-400 focus:border-red-400"
                        : "border-stone-200 focus:border-orange-400 dark:border-white/10 dark:focus:border-orange-500"
                    }`}
                  />
                  {fieldErrors.matchTitle ? (
                    <span className="mt-1 block text-[11px] font-bold text-red-500">{fieldErrors.matchTitle}</span>
                  ) : (
                    <span className="mt-1 block text-[11px] text-stone-400">{matchTitle.trim().length}/60 • 3+ characters if you type one ✨</span>
                  )}
                </label>

                {userTeams.length > 0 && (
                  <div>
                    <TeamPicker
                      teams={userTeams}
                      selected={selectedTeam}
                      onPick={pickTeam}
                      idleLabel="Just friends"
                      accent="orange"
                      title="Playing with one of your teams? 🛡️"
                    />
                    {selectedTeam && (
                      <p className="mt-1.5 text-[11px] font-bold text-orange-600 dark:text-orange-400">
                        Crew size synced to your team — tweak it below if not everyone&apos;s coming. 👇
                      </p>
                    )}
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-stone-200 bg-white p-3.5 dark:border-white/10 dark:bg-slate-950">
                    <span className="block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">
                      👥 Our crew coming
                    </span>
                    <span className="mt-0.5 block text-[11px] text-stone-400 dark:text-slate-500">
                      Including you — already counted in
                    </span>
                    <div className="mt-2.5 flex items-center justify-between gap-2">
                      <button
                        onClick={() => {
                          setOurCrew((v) => Math.max(1, v - 1));
                          setSelectedTeam("");
                        }}
                        className="grid h-9 w-9 place-items-center rounded-full border border-stone-200 text-stone-600 transition hover:bg-stone-100 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
                        aria-label="Fewer crew"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="text-3xl font-black text-stone-900 dark:text-slate-100">{ourCrew}</span>
                      <button
                        onClick={() => {
                          setOurCrew((v) => Math.min(21, v + 1));
                          setSelectedTeam("");
                        }}
                        className="grid h-9 w-9 place-items-center rounded-full bg-emerald-600 text-white shadow transition hover:bg-emerald-700"
                        aria-label="More crew"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-orange-300 bg-orange-50 p-3.5 dark:border-orange-500/40 dark:bg-orange-500/10">
                    <span className="block text-xs font-black uppercase tracking-wider text-orange-600 dark:text-orange-300">
                      🙋 Open spots for others
                    </span>
                    <span className="mt-0.5 block text-[11px] text-stone-400 dark:text-slate-500">
                      Listed publicly for joiners
                    </span>
                    <div className="mt-2.5 flex items-center justify-between gap-2">
                      <button
                        onClick={() => setOpenSpots((v) => Math.max(1, v - 1))}
                        className="grid h-9 w-9 place-items-center rounded-full border border-orange-300 text-orange-600 transition hover:bg-orange-100 dark:border-orange-500/40 dark:text-orange-300 dark:hover:bg-orange-500/20"
                        aria-label="Fewer open spots"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="text-3xl font-black text-orange-600 dark:text-orange-300">{openSpots}</span>
                      <button
                        onClick={() => setOpenSpots((v) => Math.min(21, v + 1))}
                        className="grid h-9 w-9 place-items-center rounded-full bg-orange-500 text-white shadow transition hover:bg-orange-600"
                        aria-label="More open spots"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl bg-white px-4 py-3 shadow-sm dark:bg-slate-950">
                  <div className="flex items-center justify-between text-xs font-black">
                    <span className="text-stone-500 dark:text-slate-400">
                      👥 {ourCrew} crew + 🙋 {openSpots} open = {totalPlayers} total
                    </span>
                    <span className={totalPlayers >= 4 && totalPlayers <= 22 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}>
                      {totalPlayers >= 4 && totalPlayers <= 22 ? "Perfect squad size ✓" : "Needs 4–22 total ⚠️"}
                    </span>
                  </div>
                  <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-stone-100 dark:bg-white/10">
                    <div
                      className="bg-emerald-500 transition-all"
                      style={{ width: `${(ourCrew / Math.max(1, totalPlayers)) * 100}%` }}
                    />
                    <div
                      className="bg-orange-400 transition-all"
                      style={{ width: `${(openSpots / Math.max(1, totalPlayers)) * 100}%` }}
                    />
                  </div>
                </div>

                <div>
                  <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">
                    Who&apos;s welcome? 💛
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setWelcomeMode("any")}
                      className={`rounded-2xl border p-3 text-left transition ${
                        welcomeMode === "any"
                          ? "border-emerald-500 bg-emerald-50 shadow dark:bg-emerald-500/10"
                          : "border-stone-200 bg-white dark:border-white/10 dark:bg-slate-950"
                      }`}
                    >
                      <span className="flex items-center gap-1.5 text-sm font-black text-stone-900 dark:text-slate-100">
                        🌍 Anyone!
                        {welcomeMode === "any" && (
                          <span className="ml-auto grid h-5 w-5 place-items-center rounded-full bg-emerald-600">
                            <Check className="h-3 w-3 text-white" strokeWidth={3.5} />
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block text-[11px] leading-snug text-stone-500 dark:text-slate-400">
                        All levels, maximum fun
                      </span>
                    </button>
                    <button
                      onClick={() => setWelcomeMode("specific")}
                      className={`rounded-2xl border p-3 text-left transition ${
                        welcomeMode === "specific"
                          ? "border-orange-400 bg-orange-50 shadow dark:border-orange-500/50 dark:bg-orange-500/10"
                          : "border-stone-200 bg-white dark:border-white/10 dark:bg-slate-950"
                      }`}
                    >
                      <span className="flex items-center gap-1.5 text-sm font-black text-stone-900 dark:text-slate-100">
                        🎯 Specific levels
                        {welcomeMode === "specific" && (
                          <span className="ml-auto grid h-5 w-5 place-items-center rounded-full bg-orange-500">
                            <Check className="h-3 w-3 text-white" strokeWidth={3.5} />
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block text-[11px] leading-snug text-stone-500 dark:text-slate-400">
                        Pick one or mix a few
                      </span>
                    </button>
                  </div>
                  {welcomeMode === "specific" && (
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {LEVEL_OPTIONS.map((l) => {
                        const on = welcomeLevels.includes(l.name);
                        return (
                          <button
                            key={l.name}
                            onClick={() => toggleLevel(l.name)}
                            className={`min-w-0 rounded-2xl border px-1.5 py-2.5 text-center transition ${
                              on
                                ? "border-orange-500 bg-orange-500 text-white shadow-md"
                                : "border-stone-200 bg-white dark:border-white/10 dark:bg-slate-950"
                            }`}
                          >
                            <span className="block text-lg leading-none">{l.emoji}</span>
                            <span className={`mt-1 block truncate text-[11px] font-black sm:text-xs ${on ? "text-white" : "text-stone-800 dark:text-slate-200"}`}>
                              {l.name}
                            </span>
                            <span className={`block truncate text-[10px] ${on ? "text-orange-100" : "text-stone-400"}`}>
                              {l.hint}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <p className="mt-1.5 text-[11px] font-bold text-stone-400 dark:text-slate-500">
                    Showing as: <span className="text-stone-600 dark:text-slate-300">{matchLevelString}</span>
                  </p>
                </div>

                <div className="rounded-xl bg-white p-3.5 shadow-sm dark:bg-slate-950">
                  <span className="mb-2 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">
                    What should joiners pay? 💰
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setChargeMode("split")}
                      className={`rounded-2xl border p-3 text-left transition ${
                        chargeMode === "split"
                          ? "border-emerald-500 bg-emerald-50 shadow dark:bg-emerald-500/10"
                          : "border-stone-200 dark:border-white/10"
                      }`}
                    >
                      <span className="flex items-center gap-1.5 text-[13px] font-black text-stone-900 dark:text-slate-100">
                        🤝 Fair split
                        {chargeMode === "split" && (
                          <span className="ml-auto grid h-5 w-5 place-items-center rounded-full bg-emerald-600">
                            <Check className="h-3 w-3 text-white" strokeWidth={3.5} />
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block text-[11px] leading-snug text-stone-500">
                        Default • total ÷ everyone
                      </span>
                      <span className="mt-1 block text-xs font-black text-emerald-700 dark:text-emerald-300">
                        {slot ? `${formatNPR(autoPerPlayer)} each` : "—"}
                      </span>
                    </button>
                    <button
                      onClick={() => {
                        setChargeMode("custom");
                        if (customPrice === "" && slot) setCustomPrice(String(autoPerPlayer));
                      }}
                      className={`rounded-2xl border p-3 text-left transition ${
                        chargeMode === "custom"
                          ? "border-violet-500 bg-violet-50 shadow dark:bg-violet-500/10"
                          : "border-stone-200 dark:border-white/10"
                      }`}
                    >
                      <span className="flex items-center gap-1.5 text-[13px] font-black text-stone-900 dark:text-slate-100">
                        ✨ Custom charge
                        {chargeMode === "custom" && (
                          <span className="ml-auto grid h-5 w-5 place-items-center rounded-full bg-violet-600">
                            <Check className="h-3 w-3 text-white" strokeWidth={3.5} />
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block text-[11px] leading-snug text-stone-500">
                        You set joiner price
                      </span>
                      <span className="mt-1 block text-xs font-black text-violet-700 dark:text-violet-300">
                        {chargeMode === "custom" && customPrice !== "" ? `${formatNPR(Number(customPrice) || 0)} each` : "Your call 💜"}
                      </span>
                    </button>
                  </div>

                  {chargeMode === "split" ? (
                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-50 px-4 py-3 dark:bg-emerald-500/10">
                      <span className="text-xs font-bold text-stone-500 dark:text-slate-400">
                        Everyone chips in fairly
                      </span>
                      <span className="text-sm font-black text-emerald-700 dark:text-emerald-300">
                        {slot
                          ? `${formatNPR(total)} ÷ ${totalPlayers} = ${formatNPR(autoPerPlayer)} each`
                          : "Pick a time to see the split"}
                      </span>
                    </div>
                  ) : (
                    <div className="mt-2.5 space-y-2.5 rounded-xl bg-violet-50 px-4 py-3 dark:bg-violet-500/10">
                      <div>
                        <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-violet-600 dark:text-violet-300">
                          Charge each joiner (Rs.)
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-black text-stone-400">Rs.</span>
                          <input
                            type="number"
                            min={0}
                            max={10000}
                            step={10}
                            value={customPrice}
                            onChange={(e) => {
                              setCustomPrice(e.target.value);
                              setFieldErrors((p) => ({ ...p, customPrice: "" }));
                            }}
                            placeholder={String(autoPerPlayer)}
                            className="w-full rounded-xl border border-violet-300 bg-white px-3.5 py-2.5 text-lg font-black text-stone-900 focus:border-violet-500 focus:outline-none dark:border-violet-500/40 dark:bg-slate-950 dark:text-slate-100"
                          />
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <button
                            onClick={() => setCustomPrice("0")}
                            className="rounded-full bg-emerald-100 px-3 py-1.5 text-[11px] font-black text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                          >
                            🎉 Free for joiners
                          </button>
                          <button
                            onClick={() => setCustomPrice(String(autoPerPlayer))}
                            className="rounded-full bg-white px-3 py-1.5 text-[11px] font-black text-stone-600 shadow-sm dark:bg-white/10 dark:text-slate-300"
                          >
                            ↩ Use fair split ({formatNPR(autoPerPlayer)})
                          </button>
                        </div>
                        {fieldErrors.customPrice && (
                          <p className="mt-1.5 text-[11px] font-bold text-red-500">{fieldErrors.customPrice}</p>
                        )}
                      </div>
                      {slot && customPrice !== "" && Number.isFinite(customNum) && (
                        <div className="space-y-1.5 rounded-xl bg-white px-4 py-3 text-xs font-bold dark:bg-slate-950">
                          <div className="flex justify-between">
                            <span className="text-stone-500">🙋 {openSpots} joiners × {formatNPR(customNum)}</span>
                            <span className="text-violet-700 dark:text-violet-300">{formatNPR(joinersTotal)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-stone-500">👥 Your crew covers</span>
                            <span className={hostShare < 0 ? "text-red-500" : "text-emerald-700 dark:text-emerald-300"}>
                              {formatNPR(hostShare)} {ourCrew > 0 && `(${formatNPR(Math.round(hostPerCrew))} each)`}
                            </span>
                          </div>
                          <div className="flex justify-between border-t border-dashed border-stone-200 pt-1.5 dark:border-white/10">
                            <span className="text-stone-500">Court total</span>
                            <span>{formatNPR(total)}</span>
                          </div>
                          {customNum === 0 && (
                            <p className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                              🎉 Generous host! Joiners play free — your crew covers {formatNPR(total)}.
                            </p>
                          )}
                          {hostShare < 0 && (
                            <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                              ⚠️ Joiners would pay {formatNPR(Math.abs(hostShare))} more than the court costs — lower the price to keep it friendly! 💛
                            </p>
                          )}
                          {hostShare >= 0 && customNum !== autoPerPlayer && (
                            <p className="text-[11px] text-stone-400">
                              {customNum < autoPerPlayer
                                ? `💜 Sweet deal — ${(autoPerPlayer - customNum) > 0 ? `joiners save ${formatNPR(autoPerPlayer - customNum)} each vs fair split!` : ""}`
                                : `Joiners pay ${formatNPR(customNum - autoPerPlayer)} more each vs fair split.`}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <p className="text-[11px] leading-relaxed text-stone-400 dark:text-slate-500">
                  Your invite goes out once the venue gives a thumbs-up — friends
                  pay their share to you at the court. Simple! 🤝
                </p>
              </div>
            )}

            {/* Competition: two named squads, a score the venue will record. */}
            {visibility === "competition" && (
              <div className="mt-3 space-y-3 rounded-2xl border border-sky-200 bg-sky-50/60 p-4 dark:border-sky-500/25 dark:bg-sky-500/5">
                {userTeams.length > 0 ? (
                  <TeamPicker
                    teams={userTeams}
                    selected={selectedTeam}
                    onPick={pickTeam}
                    idleLabel=""
                    accent="sky"
                    title="Your squad 🛡️"
                    hideIdle
                  />
                ) : (
                  <div>
                    <span className="block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">
                      A competition game needs a squad 🛡️
                    </span>
                    <p className="mt-1 text-[11px] leading-relaxed text-stone-500 dark:text-slate-400">
                      You&apos;re not in a team yet, so there&apos;s nobody to play for.{" "}
                      <Link
                        href="/teams"
                        className="font-black text-sky-700 underline decoration-sky-400/50 underline-offset-2 dark:text-sky-400"
                      >
                        Join or start a team
                      </Link>{" "}
                      and come back — the result then counts on your squad&apos;s profile.
                    </p>
                  </div>
                )}

                {selectedTeam && (
                  <>
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">
                        🏆 Does this count towards a league?
                      </span>
                      <select
                        value={leagueChoice}
                        onChange={(e) => {
                          setLeagueChoice(e.target.value);
                          setOpponentTeamId("");
                          setOpponentQuery("");
                        }}
                        className="w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-stone-900 focus:border-sky-400 focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
                      >
                        <option value="">Just a friendly — no league</option>
                        {squadLeagues.map((l) => (
                          <option key={l.id} value={String(l.id)}>
                            {l.name}
                            {l.venueName ? ` • ${l.venueName}` : ""}
                          </option>
                        ))}
                      </select>
                      <span className="mt-1 block text-[11px] text-stone-400 dark:text-slate-500">
                        {squadLeagues.length > 0
                          ? "Only leagues your squad is already accepted into can be picked."
                          : "Your squad isn't in a league yet, so this will be a standalone competition game."}
                      </span>
                    </label>

                    <div>
                      <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">
                        🆚 Who are you playing?
                      </span>
                      {chosenOpponent ? (
                        <div className="flex items-center gap-2 rounded-2xl border border-sky-300 bg-white px-3.5 py-3 dark:border-sky-500/40 dark:bg-slate-950">
                          <span
                            className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-white"
                            style={{ background: chosenOpponent.logoColor }}
                          >
                            <Shield className="h-3 w-3" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-black text-stone-900 dark:text-slate-100">
                              {selectedTeamName || "Your squad"} <span className="text-sky-600 dark:text-sky-400">vs</span>{" "}
                              {chosenOpponent.name}
                            </span>
                            <span className="block text-[11px] text-stone-400 dark:text-slate-500">
                              {chosenLeague ? `🏆 ${chosenLeague.name}` : "Friendly competition"} •{" "}
                              {chosenOpponent.teamCode ? `code ${chosenOpponent.teamCode}` : "squad"}
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setOpponentTeamId("");
                              setOpponentQuery("");
                            }}
                            className="rounded-full border border-stone-200 px-3 py-1.5 text-[11px] font-black text-stone-500 transition hover:bg-stone-100 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
                          >
                            Change
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                            <input
                              value={opponentQuery}
                              onChange={(e) => setOpponentQuery(e.target.value)}
                              placeholder={
                                chosenLeague ? `Search ${chosenLeague.name} squads…` : "Search squads by name…"
                              }
                              maxLength={40}
                              className="w-full rounded-xl border border-stone-200 bg-white py-2.5 pl-9 pr-3.5 text-sm font-semibold text-stone-900 placeholder:text-stone-400 focus:border-sky-400 focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                            />
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {opponentMatches.map((t) => (
                              <button
                                type="button"
                                key={t.teamId}
                                onClick={() => setOpponentTeamId(String(t.teamId))}
                                className="flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3.5 py-2 text-xs font-black text-stone-600 transition hover:border-sky-400 hover:text-sky-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:border-sky-500/50"
                              >
                                <span
                                  className="grid h-4 w-4 place-items-center rounded-full text-white"
                                  style={{ background: t.logoColor }}
                                >
                                  <Shield className="h-2.5 w-2.5" />
                                </span>
                                {t.name}
                              </button>
                            ))}
                            {opponentMatches.length === 0 && (
                              <span className="text-[11px] font-bold text-stone-400 dark:text-slate-500">
                                {opponentPool.length === 0
                                  ? "No other squads to play yet — invite a team first 🆚"
                                  : "No squad matches that name."}
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    <p className="rounded-xl bg-sky-100/70 px-3 py-2 text-[11px] font-semibold leading-relaxed text-sky-800 dark:bg-sky-500/10 dark:text-sky-300">
                      🏆 The venue owner enters the final score and it lands on both squads&apos; profiles
                      {chosenLeague ? ` plus the ${chosenLeague.name} table` : ""}. Only the two squads
                      involved (and the host) can ever see the result.
                    </p>
                  </>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Summary */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="overflow-hidden rounded-3xl border border-[#F0E3CC] bg-white shadow-[0_16px_40px_rgba(180,120,60,0.12)] dark:border-white/10 dark:bg-slate-900">
            <div className="flex items-center gap-2 border-b border-stone-100 bg-emerald-700 px-5 py-4 dark:border-white/5">
              <Zap className="h-4 w-4 text-amber-300" />
              <h2 className="text-sm font-black text-white">Your game plan</h2>
            </div>
            <div className="space-y-3 px-5 py-4 text-sm">
              <Row k="Court" v={court?.name ?? "—"} />
              <Row k="Day" v={prettyDate(date)} />
              <Row
                k="Time"
                v={
                  slot
                    ? `${formatTime12(slot)} → ${formatTime12(addHours(slot, hours))} (${hours} hr)`
                    : "Pick a time above"
                }
              />
              <Row k="Price" v={slot ? `${formatNPR(rate)}/hr${parseInt((slot ?? "13:00").split(":")[0], 10) < 12 ? " ☀️ morning deal" : ""}` : "—"} />
              <Row
                k="Game type"
                v={
                  visibility === "public"
                    ? `🌍 Open • 👥${ourCrew} + 🙋${openSpots}`
                    : visibility === "competition"
                      ? "🆚 Competition • venue scores it"
                      : "🔒 Just our gang"
                }
              />
              <Row
                k="Squad"
                v={selectedTeamName ? `🛡️ ${selectedTeamName}` : "🙋 Individual booking"}
              />
              {visibility === "competition" && (
                <Row
                  k="Opponent"
                  v={chosenOpponent ? `🆚 ${chosenOpponent.name}` : "Pick an opponent ☝️"}
                />
              )}
              {visibility === "competition" && chosenLeague && (
                <Row k="Counts towards" v={`🏆 ${chosenLeague.name}`} />
              )}
              {visibility === "public" && (
                <Row k="Welcome" v={matchLevelString} />
              )}
              {visibility === "public" && slot && (
                <Row
                  k={chargeMode === "custom" ? "Joiners pay ✨" : "Each pays"}
                  v={
                    chargeMode === "custom"
                      ? (customPrice === "" ? "Set price ☝️" : `${formatNPR(perPlayer)} (crew ${formatNPR(Math.max(0, Math.round(hostPerCrew)))})`)
                      : `${formatNPR(perPlayer)}`
                  }
                />
              )}
              {myVouchers.length > 0 && (
                <button
                  onClick={() => setUseFreePlay((v) => !v)}
                  className={`flex w-full items-center gap-2.5 rounded-2xl border-2 p-3 text-left transition ${
                    useFreePlay
                      ? "border-violet-500 bg-violet-50 shadow-md dark:bg-violet-500/10"
                      : "border-dashed border-violet-300 bg-violet-50/50 dark:border-violet-500/40 dark:bg-violet-500/5"
                  }`}
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-xl shadow">
                    🎁
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-black text-stone-900 dark:text-slate-100">
                      Use my FREE hour {useFreePlay ? "✓" : ""}
                    </span>
                    <span className="block font-mono text-[11px] text-violet-600 dark:text-violet-300">
                      {myVouchers[0].code} • saves {formatNPR(rate)}
                    </span>
                  </span>
                  <span
                    className={`relative h-6 w-11 shrink-0 rounded-full transition ${useFreePlay ? "bg-violet-500" : "bg-stone-300 dark:bg-white/15"}`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${useFreePlay ? "left-[22px]" : "left-0.5"}`}
                    />
                  </span>
                </button>
              )}
              {/* Promo code 🎟️ — owner-set discount with an expiry date */}
              {afterFreePlay > 0 && (
                <div className="rounded-2xl border border-dashed border-emerald-300 bg-emerald-50/50 p-3 dark:border-emerald-500/40 dark:bg-emerald-500/5">
                  <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">
                    <Ticket className="h-3.5 w-3.5" /> Promo code
                  </p>
                  {venuePromos.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {venuePromos.map((pr) => (
                        <button
                          key={pr.id}
                          type="button"
                          onClick={() => {
                            setPromoCode(pr.code);
                            void applyPromoCode(pr.code);
                          }}
                          className={`rounded-full border px-2.5 py-1.5 text-[11px] font-black transition ${
                            appliedPromo?.code === pr.code
                              ? "border-emerald-600 bg-emerald-600 text-white"
                              : "border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-transparent dark:text-emerald-300"
                          }`}
                        >
                          🎟️ {pr.code} • {pr.summary}
                        </button>
                      ))}
                    </div>
                  )}
                  {appliedPromo ? (
                    <div className="mt-2 flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2.5 text-white shadow">
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono text-[13px] font-black">{appliedPromo.code} ✓</span>
                        <span className="block text-[11px] font-bold text-emerald-100">
                          −{formatNPR(appliedPromo.discount)} on this bill • {appliedPromo.expiryLabel}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setAppliedPromo(null);
                          setPromoCode("");
                          setPromoError("");
                        }}
                        className="shrink-0 rounded-lg bg-white/20 px-2.5 py-1.5 text-[11px] font-black transition hover:bg-white/30"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div className="mt-2 flex gap-2">
                      <input
                        value={promoCode}
                        onChange={(e) => {
                          setPromoCode(normalizePromoCode(e.target.value));
                          setPromoError("");
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void applyPromoCode();
                          }
                        }}
                        placeholder="e.g. SAVE10"
                        maxLength={24}
                        autoCapitalize="characters"
                        spellCheck={false}
                        className="min-w-0 flex-1 rounded-xl border border-emerald-200 bg-white px-3 py-2.5 font-mono text-sm font-black uppercase tracking-wider text-stone-900 placeholder:font-sans placeholder:font-semibold placeholder:normal-case placeholder:tracking-normal placeholder:text-stone-400 focus:border-emerald-500 focus:outline-none dark:border-emerald-500/30 dark:bg-slate-950 dark:text-slate-100"
                      />
                      <button
                        type="button"
                        onClick={() => void applyPromoCode()}
                        disabled={promoChecking || !promoCode.trim()}
                        className="shrink-0 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white transition hover:bg-emerald-700 disabled:opacity-40"
                      >
                        {promoChecking ? "…" : "Apply"}
                      </button>
                    </div>
                  )}
                  {promoError ? (
                    <p className="mt-1.5 text-[11px] font-bold text-red-500">{promoError}</p>
                  ) : (
                    venuePromos.length === 0 &&
                    !appliedPromo && (
                      <p className="mt-1.5 text-[11px] text-stone-400">
                        Got a code from {venue?.name ?? "the venue"}? Type it in and we&apos;ll check it 💚
                      </p>
                    )
                  )}
                </div>
              )}
              <div className="border-t border-dashed border-stone-200 pt-3 dark:border-white/10">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-stone-500 dark:text-slate-400">Total</span>
                  <span className="text-right">
                    {total < fullTotal && (
                      <span className="mr-2 text-sm font-bold text-stone-400 line-through">
                        {formatNPR(fullTotal)}
                      </span>
                    )}
                    <span className="text-2xl font-black text-emerald-700 dark:text-emerald-300">
                      {slot ? (total === 0 ? "FREE 🎉" : formatNPR(total)) : formatNPR(0)}
                    </span>
                  </span>
                </div>
                {freePlayActive && (
                  <p className="mt-1 text-right text-[11px] font-bold text-violet-600 dark:text-violet-300">
                    🎁 1 free hour applied ({myVouchers[0]?.code})
                  </p>
                )}
                {promoDiscount > 0 && appliedPromo && (
                  <p className="mt-1 text-right text-[11px] font-black text-emerald-600 dark:text-emerald-300">
                    🎟️ {appliedPromo.code} — you save {formatNPR(promoDiscount)}
                  </p>
                )}
              </div>
              {total > 0 ? (
                <>
                  <div>
                    <p className="mb-2 text-xs font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">
                      Pay your way — {venue?.name ?? "venue"} accepts
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {availableMethods.map((m) => (
                        <button
                          key={m}
                          onClick={() => setPayMethod(m)}
                          className={`flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-extrabold transition ${
                            payMethod === m
                              ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                              : "border-stone-200 bg-stone-50 text-stone-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400"
                          }`}
                        >
                          <Wallet className="h-3.5 w-3.5" /> {m}
                          {m === "eSewa" ? " 💚" : m === "Khalti" ? " 💜" : ""}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[11px] text-stone-400">
                      Online = real test gateway redirect. Cash = pay at venue.
                    </p>
                  </div>
                  {depositPreview.required && (
                    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3.5 text-xs dark:border-amber-500/40 dark:bg-amber-500/10">
                      <p className="flex items-center gap-1.5 font-black text-amber-800 dark:text-amber-200">
                        <ShieldAlert className="h-4 w-4" /> Fair-play deposit: {formatNPR(depositPreview.amount)} ({depositPreview.percent}%)
                      </p>
                      <p className="mt-1 leading-relaxed text-amber-700 dark:text-amber-300">{depositPreview.reason}</p>
                      <p className="mt-1 font-bold text-amber-800 dark:text-amber-200">
                        You&apos;ll pay {formatNPR(depositPreview.amount)} now via {payMethod} test • rest {formatNPR(Math.max(0, total - depositPreview.amount))} later • non-refundable if you cancel 😢
                      </p>
                    </div>
                  )}
                  {isOnlineMethod(payMethod) && (
                    <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3.5 text-xs dark:border-sky-500/30 dark:bg-sky-500/10">
                      <p className="font-black text-sky-800 dark:text-sky-200">
                        {payMethod === "eSewa" ? "💚 eSewa TEST (UAT) checkout" : "💜 Khalti TEST checkout"}
                      </p>
                      <p className="mt-1 leading-relaxed text-sky-700 dark:text-sky-300">
                        {payMethod === "eSewa"
                          ? "After Request, you'll jump to rc-epay.esewa.com.np. Test ID 9806800001 • pw 123456 • MPIN 1122 • token 123456."
                          : "After Request, you'll jump to Khalti test-pay (or local simulator if no key). Test 9800000001 • MPIN 1111 • OTP 987654."}
                      </p>
                      <p className="mt-1 font-bold">Amount charged now: {formatNPR(depositPreview.required ? depositPreview.amount : total)}</p>
                    </div>
                  )}
                  {isOnlineMethod(payMethod) && (
                    <details className="rounded-2xl border border-stone-200 p-3 dark:border-white/10">
                      <summary className="cursor-pointer text-[11px] font-black text-stone-500">
                        Paid manually already? Attach screenshot instead (optional) 🧾
                      </summary>
                      <div className="mt-2">
                        <ReceiptUploader value={receipt} onChange={setReceipt} compact />
                      </div>
                    </details>
                  )}
                </>
              ) : (
                <p className="rounded-xl bg-violet-500/10 px-3.5 py-2.5 text-center text-xs font-black text-violet-700 dark:text-violet-300">
                  {freePlayActive && promoDiscount > 0
                    ? "🎁 Free hour + 🎟️ promo — nothing left to pay!"
                    : promoDiscount > 0
                      ? `🎟️ ${appliedPromo?.code ?? "Promo"} covers the whole bill — nothing to pay!`
                      : "🎁 Fully covered by your FREE hour — no payment needed!"}
                </p>
              )}
              <label className="block">
                <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">
                  Your number (so the venue can reach you)
                </span>
                <input
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setFieldErrors((p) => ({ ...p, phone: "" }));
                  }}
                  placeholder="98XXXXXXXX"
                  maxLength={16}
                  className={`w-full rounded-xl border bg-[#FFF6E9] px-3.5 py-2.5 text-sm font-semibold text-stone-900 placeholder:text-stone-400 focus:outline-none dark:bg-white/5 dark:text-slate-100 dark:placeholder:text-slate-500 ${
                    fieldErrors.phone ? "border-red-400 focus:border-red-400" : "border-stone-200 focus:border-emerald-500 dark:border-white/10"
                  }`}
                />
                {fieldErrors.phone && <span className="mt-1 block text-[11px] font-bold text-red-500">{fieldErrors.phone}</span>}
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">
                  Anything we should know? (optional)
                </span>
                <textarea
                  value={notes}
                  onChange={(e) => {
                    setNotes(e.target.value);
                    setFieldErrors((p) => ({ ...p, notes: "" }));
                  }}
                  placeholder="Birthday game, need extra balls…"
                  rows={2}
                  maxLength={500}
                  className={`w-full resize-none rounded-xl border bg-[#FFF6E9] px-3.5 py-2.5 text-sm font-semibold text-stone-900 placeholder:text-stone-400 focus:outline-none dark:bg-white/5 dark:text-slate-100 dark:placeholder:text-slate-500 ${
                    fieldErrors.notes ? "border-red-400 focus:border-red-400" : "border-stone-200 focus:border-emerald-500 dark:border-white/10"
                  }`}
                />
                {fieldErrors.notes ? (
                  <span className="mt-1 block text-[11px] font-bold text-red-500">{fieldErrors.notes}</span>
                ) : (
                  <span className="mt-1 block text-[11px] text-stone-400">{notes.trim().length}/500</span>
                )}
              </label>
              {error && (
                <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-xs font-bold text-red-500 dark:bg-red-500/10 dark:text-red-400">
                  {error}
                </p>
              )}
              {!user ? (
                <Link
                  href="/login"
                  className="block w-full rounded-2xl bg-emerald-600 py-3.5 text-center text-sm font-black text-white shadow-md transition hover:bg-emerald-700"
                >
                  Log in to book your game
                </Link>
              ) : (
                <button
                  onClick={confirmBooking}
                  disabled={!slot || !rangeValid || booking || payRedirect}
                  className="w-full rounded-2xl bg-emerald-600 py-3.5 text-sm font-black text-white shadow-md transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {booking || payRedirect
                    ? payRedirect
                      ? `Opening ${payMethod} test… 💳`
                      : "Sending your request…"
                    : !slot
                      ? "Pick a time first ☝️"
                      : !rangeValid
                        ? "Pick a fully free block 🙏"
                        : payMethod === "eSewa" && total > 0
                          ? `Request + Pay ${formatNPR(depositPreview.required ? depositPreview.amount : total)} via eSewa 💚`
                          : payMethod === "Khalti" && total > 0
                            ? `Request + Pay ${formatNPR(depositPreview.required ? depositPreview.amount : total)} via Khalti 💜`
                            : `Request ${hours} hr • ${formatNPR(total)}`}
                </button>
              )}
              <p className="flex items-center justify-center gap-1.5 text-[11px] font-semibold text-stone-400 dark:text-slate-500">
                <BadgeCheck className="h-3.5 w-3.5" /> Life happens — cancel free up to 6 hrs before
              </p>
            </div>
          </div>
        </aside>
      </div>

      {/* Success modal */}
      {success && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-stone-900/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-[2rem] border border-stone-200 bg-white p-8 text-center shadow-2xl dark:border-white/10 dark:bg-slate-900">
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-600 shadow-lg">
              <PartyPopper className="h-8 w-8 text-white" />
            </span>
            <h3 className="mt-4 text-xl font-black text-stone-900 dark:text-slate-100">Request sent! 🥳</h3>
            <p className="mt-1.5 text-sm text-stone-500 dark:text-slate-400">
              {court?.name} • {prettyDate(date)} • {slot ? `${formatTime12(slot)} (${hours} hr)` : ""}
            </p>
            <p className="mt-1 text-sm font-bold text-emerald-700 dark:text-emerald-300">
              {success.total === 0
                ? success.freePlay
                  ? "FREE with your loyalty hour! 🎁"
                  : "FREE with your promo code! 🎟️"
                : `${formatNPR(success.total)} via ${success.freePlay ? `${payMethod} (1hr free 🎁)` : payMethod}`}
            </p>
            {success.saved > 0 && (
              <p className="mx-auto mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                🎟️ {success.promoCode} saved you {formatNPR(success.saved)}
              </p>
            )}
            {success.teamName ? (
              <p className="mx-auto mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                <Shield className="h-3.5 w-3.5" /> Booked for {success.teamName}
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-stone-400 dark:text-slate-500">
                🙋 Individual booking — no squad attached
              </p>
            )}
            <p className="mt-1 text-[11px] text-stone-400 dark:text-slate-500">Booking ref: #FN-{success.id}</p>
            <p className="mx-auto mt-3 max-w-[280px] rounded-xl bg-amber-50 px-3 py-2.5 text-xs font-bold leading-relaxed text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              ⏳ The lovely folks at the venue are reviewing it — we&apos;ll
              notify you the second they confirm!
            </p>
            {success.isPublic && (
              <p className="mx-auto mt-2 max-w-[280px] rounded-xl bg-emerald-50 px-3 py-2.5 text-xs font-bold leading-relaxed text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                🌍 Your open invite (👥 {ourCrew} crew + 🙋 {openSpots} spots) goes live once confirmed.
              </p>
            )}
            {success.opponentName && (
              <p className="mx-auto mt-2 max-w-[280px] rounded-xl bg-sky-50 px-3 py-2.5 text-xs font-bold leading-relaxed text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
                🆚 {success.teamName || "Your squad"} vs {success.opponentName}
                {success.leagueName ? ` • 🏆 ${success.leagueName}` : ""} — the venue owner records
                the score, and it shows on both squads&apos; profiles.
              </p>
            )}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                onClick={() => setSuccess(null)}
                className="rounded-2xl border border-stone-200 py-3 text-sm font-black text-stone-700 dark:border-white/10 dark:text-slate-200"
              >
                Book another
              </button>
              <Link
                href="/bookings"
                className="rounded-2xl bg-emerald-600 py-3 text-sm font-black text-white"
              >
                Track it
              </Link>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[13px] font-semibold text-stone-400 dark:text-slate-500">{k}</span>
      <span className="truncate text-[13px] font-extrabold text-stone-900 dark:text-slate-100">{v}</span>
    </div>
  );
}

/**
 * Squad chips, shared by both game types: "Just our gang" books the court for a
 * team the player belongs to, and "Invite everyone" uses the same list to sync
 * the crew size to the real squad.
 *
 * `idleLabel` is the no-team chip — "Just me" for a private game, "Just friends"
 * for an open invite. Callers only render this when `teams` is non-empty; a
 * player in no team gets the individual-booking fallback instead, because an
 * empty picker with one dead chip is worse than no picker at all.
 */
function TeamPicker({
  teams,
  selected,
  onPick,
  idleLabel,
  accent,
  title,
  hideIdle = false,
}: {
  teams: UserTeam[];
  selected: string;
  onPick: (teamId: string) => void;
  idleLabel: string;
  accent: "emerald" | "orange" | "sky";
  title: string;
  /** Competition bookings must name a squad, so the "no team" chip is dropped. */
  hideIdle?: boolean;
}) {
  const activeChip =
    accent === "emerald"
      ? "bg-emerald-600 text-white shadow-md"
      : accent === "sky"
        ? "bg-sky-600 text-white shadow-md"
        : "bg-orange-500 text-white shadow-md";
  return (
    <div>
      <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">
        {title}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {!hideIdle && (
          <button
            type="button"
            onClick={() => onPick("")}
            className={`rounded-full px-3.5 py-2 text-xs font-black transition ${
              selected === ""
                ? "bg-stone-800 text-white dark:bg-white dark:text-slate-900"
                : "border border-stone-200 bg-white text-stone-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
            }`}
          >
            {idleLabel}
          </button>
        )}
        {teams.map((t) => (
          <button
            type="button"
            key={t.id}
            onClick={() => onPick(String(t.id))}
            title={
              t.role === "captain"
                ? `You captain ${t.name}`
                : `${t.memberCount} players • ${t.level ?? "All Levels"}`
            }
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-black transition ${
              selected === String(t.id)
                ? activeChip
                : "border border-stone-200 bg-white text-stone-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
            }`}
          >
            <span
              className="grid h-4 w-4 place-items-center rounded-full text-[8px] font-black text-white"
              style={{ background: t.logoColor }}
            >
              <Shield className="h-2.5 w-2.5" />
            </span>
            {t.name} ({t.memberCount})
            {t.role === "captain" && <span aria-hidden>★</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
