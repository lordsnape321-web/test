import { useLocalSearchParams, useRouter } from "expo-router";
import {
  BadgeCheck,
  Banknote,
  Check,
  ChevronLeft,
  Clock,
  Globe,
  Lock,
  MapPin,
  Minus,
  PartyPopper,
  Phone,
  Plus,
  Search,
  Shield,
  ShieldAlert,
  Star,
  Swords,
  Ticket,
  Trophy,
  Users,
  Wallet,
  X,
  Zap,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ReviewsSection } from "@/components/Reviews";
import { ReceiptUploader, isOnlineMethod } from "@/components/ReceiptUploader";
import { Button, Notice } from "@/components/ui";
import {
  createBooking,
  fetchAvailability,
  fetchBookings,
  fetchCourts,
  fetchLeagues,
  fetchPromos,
  fetchTeams,
  fetchUserStats,
  fetchUserTeams,
  fetchVouchers,
  fetchVenue,
} from "@/api";
import { apiJson, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import {
  depositAmountFor,
  depositDecision,
  ONLINE_PAYMENTS,
  parsePayments,
  TRUST_START,
  type PlayerStats,
} from "@/lib/loyalty";
import {
  addHours,
  formatNPR,
  formatTime12,
  gamePlayed,
  next14Days,
  prettyDate,
  prettyDayShort,
  rangeSlots,
  timeSlots,
  todayISO,
} from "@/lib/futsal";
import { normalizePromoCode } from "@/lib/promos";
import { validateCustomPrice, validateNotes, validatePhone, validateTitle } from "@/lib/validation";
import type { Court, LeagueSummary, UserTeamLite, Venue } from "@/lib/types";
import { colors, fontSize, radius, space } from "@/theme";

/**
 * Native venue detail and booking flow.
 *
 * This screen deliberately follows the web venue page's steps instead of the
 * old short "pick a slot and immediately book" version: court, day, block,
 * game type, squad/open-game settings, loyalty, promo, payment method, phone,
 * notes and receipt all make the same server-backed booking request.
 */
type Visibility = "private" | "public" | "competition";
type ChargeMode = "split" | "custom";
type CompetitionPaymentMode = "split" | "loser_pays";

type PromoAd = {
  id: number;
  code: string;
  title: string;
  summary: string;
  expiryLabel: string;
};

type AppliedPromo = PromoAd & { discount: number };
type Opponent = { id: number; name: string; logoColor: string; teamCode: string };

type BookingSuccess = {
  id: number;
  total: number;
  saved: number;
  promoCode: string;
  freePlay: boolean;
  visibility: Visibility;
  teamName: string;
  opponentName: string;
  competitionPaymentMode: CompetitionPaymentMode;
};

export default function VenueDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const venueId = Number(id);
  const { colors: c, isDark } = useTheme();
  const { user } = useAuth();
  const router = useRouter();

  const [venue, setVenue] = useState<Venue | null>(null);
  const [courts, setCourts] = useState<Court[]>([]);
  const [courtId, setCourtId] = useState<number | null>(null);
  const [date, setDate] = useState(todayISO());
  const [start, setStart] = useState<string | null>(null);
  const [hours, setHours] = useState(1);
  const [bookedSlots, setBookedSlots] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [busy, setBusy] = useState(false);
  const [payRedirect, setPayRedirect] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<BookingSuccess | null>(null);
  const [eligibleBookings, setEligibleBookings] = useState<Array<{ id: number; label: string }>>([]);

  const [userTeams, setUserTeams] = useState<UserTeamLite[]>([]);
  const [opponentTeams, setOpponentTeams] = useState<Opponent[]>([]);
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);
  const [selectedTeam, setSelectedTeam] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [matchTitle, setMatchTitle] = useState("");
  const [ourCrew, setOurCrew] = useState(5);
  const [openSpots, setOpenSpots] = useState(5);
  const [welcomeMode, setWelcomeMode] = useState<"any" | "specific">("any");
  const [welcomeLevels, setWelcomeLevels] = useState<string[]>([]);
  const [chargeMode, setChargeMode] = useState<ChargeMode>("split");
  const [competitionPaymentMode, setCompetitionPaymentMode] = useState<CompetitionPaymentMode>("split");
  const [customPrice, setCustomPrice] = useState("");
  const [opponentQuery, setOpponentQuery] = useState("");
  const [opponentTeamId, setOpponentTeamId] = useState("");
  const [leagueId, setLeagueId] = useState("");

  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [receipt, setReceipt] = useState("");
  const [payMethod, setPayMethod] = useState("eSewa");
  const [myStats, setMyStats] = useState<PlayerStats | null>(null);
  const [trustScore, setTrustScore] = useState(TRUST_START);
  const [freeVouchers, setFreeVouchers] = useState<Array<{ id: number; code: string }>>([]);
  const [loyalty, setLoyalty] = useState<{ count: number; target: number; remaining: number } | null>(null);
  const [useFreePlay, setUseFreePlay] = useState(false);
  const [venuePromos, setVenuePromos] = useState<PromoAd[]>([]);
  const [promoCode, setPromoCode] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<AppliedPromo | null>(null);
  const [promoError, setPromoError] = useState("");
  const [promoChecking, setPromoChecking] = useState(false);

  useEffect(() => {
    if (!Number.isFinite(venueId)) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [v, activeCourts] = await Promise.all([fetchVenue(venueId), fetchCourts(venueId)]);
        if (cancelled) return;
        setVenue(v);
        setCourts(activeCourts);
        setCourtId(activeCourts[0]?.id ?? null);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Could not load this venue.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [venueId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchPromos({ venueId });
        if (cancelled) return;
        setVenuePromos(
          rows.map((p) => ({
            id: Number(p.id),
            code: String(p.code ?? ""),
            title: String(p.title ?? ""),
            summary: String(p.summary ?? ""),
            expiryLabel: String(p.expiryLabel ?? ""),
          })),
        );
      } catch {
        if (!cancelled) setVenuePromos([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [venueId]);

  useEffect(() => {
    if (!user) return;
    setPhone(user.phone ?? "");
    let cancelled = false;
    (async () => {
      try {
        const [mine, all, leagueRows, vouchers, stats, bookings] = await Promise.all([
          fetchUserTeams(user.id),
          fetchTeams(),
          fetchLeagues(user.id),
          fetchVouchers(user.id),
          fetchUserStats(user.id),
          fetchBookings({ userId: user.id, refresh: true }),
        ]);
        if (cancelled) return;
        setUserTeams(mine);
        setOpponentTeams(
          all.teams.map((team) => ({
            id: team.id,
            name: team.name,
            logoColor: team.logoColor,
            teamCode: team.teamCode,
          })),
        );
        setLeagues(leagueRows.filter((league) => !league.venueId || league.venueId === venueId));
        setMyStats(stats);
        setTrustScore(stats?.trustScore ?? user.trustScore ?? TRUST_START);
        const venueVouchers = vouchers.vouchers
          .filter((v) => v.status === "active" && v.venue?.id === venueId)
          .map((v) => ({ id: v.id, code: v.code }));
        setFreeVouchers(venueVouchers);
        const progress = vouchers.progress.find((p) => p.venueId === venueId);
        setLoyalty(
          progress
            ? { count: progress.count, target: progress.target, remaining: progress.remaining }
            : { count: 0, target: 7, remaining: 7 },
        );
        setEligibleBookings(
          bookings
            .filter((booking) => booking.venue?.id === venueId && gamePlayed(booking))
            .map((booking) => ({
              id: booking.id,
              label: `${prettyDate(booking.date)} • ${booking.court?.name ?? ""} • ${formatTime12(booking.startTime)}`,
            })),
        );
      } catch {
        // The booking form still works for an individual game if optional data is unavailable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, venueId]);

  const court = useMemo(() => courts.find((item) => item.id === courtId) ?? null, [courts, courtId]);
  const days = useMemo(() => next14Days(), []);
  const slots = useMemo(
    () => (venue ? timeSlots(venue.openingHour, venue.closingHour) : []),
    [venue],
  );
  const availableMethods = useMemo(() => parsePayments(venue?.acceptedPayments), [venue?.acceptedPayments]);

  useEffect(() => {
    if (!availableMethods.includes(payMethod)) setPayMethod(availableMethods[0] ?? "eSewa");
  }, [availableMethods, payMethod]);

  useEffect(() => {
    setStart(null);
    if (!courtId) return;
    let cancelled = false;
    setLoadingSlots(true);
    fetchAvailability(courtId, date)
      .then(({ booked }) => {
        if (!cancelled) setBookedSlots(booked);
      })
      .catch(() => {
        if (!cancelled) setBookedSlots([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingSlots(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courtId, date]);

  const selectedRange = useMemo(() => rangeSlots(slots, start, hours), [slots, start, hours]);
  const rangeValid = Boolean(start) && selectedRange.length === hours && !selectedRange.some((s) => bookedSlots.includes(s));
  const rangeOverflow = Boolean(start) && selectedRange.length !== hours;
  const rangeHitsBooked = Boolean(start) && !rangeOverflow && selectedRange.some((s) => bookedSlots.includes(s));

  const rate = useMemo(() => {
    if (!court) return 0;
    const morning = court.priceMorning ?? 0;
    return start && Number(start.split(":")[0]) < 12 && morning > 0 ? morning : court.pricePerHour;
  }, [court, start]);
  const fullTotal = rate * hours;
  const freePlayActive = useFreePlay && freeVouchers.length > 0 && hours >= 1;
  const afterFreePlay = freePlayActive ? Math.max(0, fullTotal - rate) : fullTotal;
  const promoDiscount = appliedPromo?.discount ?? 0;
  const total = Math.max(0, afterFreePlay - promoDiscount);

  const depositPercent = Math.min(100, Math.max(0, Number(venue?.depositPercent ?? 30)));
  const depositPreview = useMemo(() => {
    if (!myStats || total <= 0 || depositPercent <= 0) {
      return { required: false, percent: depositPercent, amount: 0, reason: "" };
    }
    const decision = depositDecision(
      { rating: myStats.rating, total: myStats.total, cancelsThisMonth: myStats.cancelsThisMonth },
      trustScore,
      depositPercent,
    );
    return {
      required: decision.required,
      percent: decision.percent,
      amount: depositAmountFor(total, decision.percent),
      reason: decision.reason,
    };
  }, [depositPercent, myStats, total, trustScore]);
  const depositOnlineOptions = availableMethods.filter((method) => ONLINE_PAYMENTS.includes(method));

  const selectedTeamName = userTeams.find((team) => String(team.id) === selectedTeam)?.name ?? "";
  const filteredOpponents = useMemo(() => {
    const query = opponentQuery.trim().toLowerCase();
    return opponentTeams
      .filter((team) => String(team.id) !== selectedTeam)
      .filter((team) => !query || team.name.toLowerCase().includes(query))
      .slice(0, 12);
  }, [opponentQuery, opponentTeams, selectedTeam]);
  const opponent = opponentTeams.find((team) => String(team.id) === opponentTeamId) ?? null;
  const chosenLeague = leagues.find((league) => String(league.id) === leagueId) ?? null;
  const matchLevel = welcomeMode === "any" || welcomeLevels.length === 0 ? "All Levels" : welcomeLevels.join(" + ");
  const totalPlayers = ourCrew + openSpots;
  const autoPerPlayer = totalPlayers > 0 ? Math.round(total / totalPlayers) : 0;
  const customValue = customPrice === "" ? NaN : Number(customPrice);
  const perPlayer = chargeMode === "custom" && Number.isFinite(customValue) ? customValue : autoPerPlayer;
  const hostShare = total - perPlayer * openSpots;

  const applyPromo = useCallback(
    async (raw?: string) => {
      const code = normalizePromoCode(raw ?? promoCode);
      if (!code) {
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
        const query = new URLSearchParams({
          venueId: String(venueId),
          code,
          amount: String(Math.round(afterFreePlay)),
        });
        if (user) query.set("userId", String(user.id));
        const checked = await apiJson<{
          valid: boolean;
          promo?: { id: number; code: string; title?: string; summary?: string; expiryLabel?: string };
          discount?: number;
          error?: string;
        }>(`/api/promos?${query.toString()}`);
        if (!checked.valid || !checked.promo) throw new Error(checked.error || "That promo did not apply 🎟️");
        setAppliedPromo({
          id: checked.promo.id,
          code: checked.promo.code,
          title: checked.promo.title ?? "",
          summary: checked.promo.summary ?? "",
          expiryLabel: checked.promo.expiryLabel ?? "",
          discount: Number(checked.discount) || 0,
        });
        setPromoCode(checked.promo.code);
      } catch (e) {
        setAppliedPromo(null);
        setPromoError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Could not check that code 🙏");
      } finally {
        setPromoChecking(false);
      }
    },
    [afterFreePlay, promoCode, user, venueId],
  );

  useEffect(() => {
    if (!appliedPromo) return;
    void applyPromo(appliedPromo.code);
    // The server must re-check the promo whenever the bill changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [afterFreePlay]);

  function startBlocked(slot: string) {
    const range = rangeSlots(slots, slot, hours);
    return range.length !== hours || range.some((item) => bookedSlots.includes(item));
  }

  function pickTeam(next: string) {
    setSelectedTeam(next);
    setOpponentTeamId("");
    setLeagueId("");
    if (next) {
      const team = userTeams.find((item) => String(item.id) === next);
      if (team) setOurCrew(Math.min(21, Math.max(1, team.memberCount || 1)));
    }
  }

  function toggleLevel(level: string) {
    setWelcomeLevels((current) =>
      current.includes(level) ? current.filter((item) => item !== level) : [...current, level],
    );
  }

  async function book() {
    setError("");
    const nextErrors: Record<string, string> = {};
    if (!user) {
      router.push("/login");
      return;
    }
    if (!court || !start || !rangeValid) {
      setError(
        rangeOverflow
          ? "That duration runs past closing — choose an earlier time or fewer hours."
          : rangeHitsBooked
            ? "Part of that block was just booked — choose a fully free block."
            : "Pick a fully free start time first.",
      );
      return;
    }
    const phoneError = phone.trim() ? validatePhone(phone.trim(), { required: false }) : null;
    if (phoneError) nextErrors.phone = phoneError;
    const notesError = validateNotes(notes);
    if (notesError) nextErrors.notes = notesError;
    if (depositPreview.required && depositOnlineOptions.length > 0 && !ONLINE_PAYMENTS.includes(payMethod)) {
      setError(`Your ${formatNPR(depositPreview.amount)} deposit must be paid online via ${depositOnlineOptions.join(", ")}.`);
      return;
    }
    if (visibility === "public") {
      if (totalPlayers < 4 || totalPlayers > 22) setError("Open games need between 4 and 22 players.");
      if (welcomeMode === "specific" && welcomeLevels.length === 0) setError("Pick at least one welcome level.");
      if (matchTitle.trim()) {
        const titleError = validateTitle(matchTitle.trim(), { min: 3, max: 60, label: "Game title" });
        if (titleError) nextErrors.matchTitle = titleError;
      }
      if (chargeMode === "custom") {
        const priceError = validateCustomPrice(customPrice === "" ? "" : customValue, {
          total,
          openSpots,
          max: 10000,
        });
        if (priceError) nextErrors.customPrice = priceError;
      }
    }
    if (visibility === "competition" && (!selectedTeam || !opponentTeamId || !opponent)) {
      setError("Choose your squad and the opponent for this competition game.");
      return;
    }
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setError(Object.values(nextErrors)[0]);
      return;
    }

    setFieldErrors({});
    setBusy(true);
    try {
      const response = await createBooking({
        courtId: court.id,
        userId: user.id,
        date,
        startTime: start,
        endTime: addHours(start, hours),
        durationHours: hours,
        paymentMethod: total === 0 ? "Free Play 🎁" : payMethod,
        paymentStatus: "pending",
        receiptUrl: visibility !== "competition" && isOnlineMethod(payMethod) && total > 0 ? receipt : "",
        useFreePlay: freePlayActive,
        promoCode: appliedPromo?.code ?? "",
        bookerName: user.name,
        bookerPhone: phone.trim(),
        notes: notes.trim(),
        visibility,
        teamId: selectedTeam ? Number(selectedTeam) : 0,
        opponentTeamId: visibility === "competition" ? Number(opponentTeamId) : 0,
        tournamentId: visibility === "competition" && chosenLeague ? chosenLeague.id : 0,
        playersNeeded: visibility === "public" ? totalPlayers : 0,
        ourCrew: visibility === "public" ? ourCrew : 1,
        openSpots: visibility === "public" ? openSpots : 0,
        matchTitle: matchTitle.trim() || `⚡ Friendly game at ${venue?.name ?? "futsal"}`,
        level: visibility === "public" ? matchLevel : "All Levels",
        chargeMode: visibility === "public" ? chargeMode : "split",
        competitionPaymentMode: visibility === "competition" ? competitionPaymentMode : "split",
        customPricePerPlayer: visibility === "public" && chargeMode === "custom" ? customValue : 0,
      });
      const created = response.booking;
      const serverTotal = Number(created.totalPrice ?? total);
      // Competition requests wait for the opposition captain before money is
      // captured. The later My Games card opens the same gateway after the
      // request is accepted and released to the venue owner.
      const needsGateway = visibility !== "competition" && serverTotal > 0 && isOnlineMethod(payMethod);
      if (needsGateway) {
        setPayRedirect(true);
        const params = `bookingId=${created.id}&amount=${Math.round(depositPreview.required ? depositPreview.amount : serverTotal)}`;
        router.replace(`/payment/${payMethod === "eSewa" ? "esewa" : "khalti"}/mock?${params}`);
        return;
      }
      setSuccess({
        id: created.id,
        total: serverTotal,
        saved: Number(created.discountAmount ?? 0),
        promoCode: String(created.promoCode ?? appliedPromo?.code ?? ""),
        freePlay: Boolean(response.freePlayUsed ?? freePlayActive),
        visibility,
        teamName: String(created.teamName ?? selectedTeamName),
        opponentName: opponent?.name ?? "",
        competitionPaymentMode,

      });
      setReceipt("");
      setUseFreePlay(false);
      setAppliedPromo(null);
      setPromoCode("");
      setPromoError("");
      const availability = await fetchAvailability(court.id, date);
      setBookedSlots(availability.booked);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Booking failed. Nothing was saved.");
    } finally {
      setBusy(false);
      setPayRedirect(false);
    }
  }

  if (loading) return <LoadingVenue />;
  if (!venue) {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: c.bg }]}>
        <View style={styles.pad}>
          <Notice message={error || "Venue not found."} />
          <Button label="Back to courts" onPress={() => router.replace("/venues")} variant="ghost" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: c.bg }]} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.replace("/venues")} style={styles.backLink} accessibilityRole="button">
            <ChevronLeft size={16} color={c.textMuted} />
            <Text style={[styles.backText, { color: c.textMuted }]}>All courts</Text>
          </Pressable>

          <View style={[styles.cover, { backgroundColor: c.surface, borderColor: c.border }]}>
            {venue.imageUrl ? <Image source={{ uri: venue.imageUrl }} style={styles.coverImage} resizeMode="cover" /> : null}
            <View style={styles.coverShade} />
            <View style={styles.coverCopy}>
              <View style={styles.badges}>
                <View style={styles.ratingBadge}><Star size={12} color="#451A03" fill="#451A03" /><Text style={styles.ratingText}>{venue.rating.toFixed(1)}</Text></View>
                <Text style={styles.coverBadge}>💬 {venue.totalReviews} reviews</Text>
                <Text style={styles.coverBadge}><Clock size={12} color="#FFFFFF" /> {venue.openingHour}:00 – {venue.closingHour}:00</Text>
              </View>
              <Text style={styles.coverTitle}>{venue.name}</Text>
              <Text style={styles.coverMeta}><MapPin size={13} color="#FFFFFF" /> {venue.address} • {venue.city}</Text>
              {venue.phone ? <Text style={styles.coverMeta}><Phone size={13} color="#FFFFFF" /> {venue.phone}</Text> : null}
            </View>
          </View>

          <SectionCard title="Get to know this place" accent="orange">
            <Text style={[styles.body, { color: c.textMuted }]}>{venue.description}</Text>
            <View style={styles.wrapRow}>
              {parseAmenities(venue.amenities).map((amenity) => (
                <View key={amenity} style={[styles.amenity, { backgroundColor: c.inset }]}>
                  <Check size={12} color={colors.emerald600} />
                  <Text style={[styles.smallStrong, { color: c.textMuted }]}>{amenity}</Text>
                </View>
              ))}
            </View>
          </SectionCard>

          {user && loyalty ? (
            <SectionCard title="🎁 Your loyalty here" accent="violet">
              {freeVouchers.length > 0 ? (
                <View style={styles.rewardCard}>
                  <Text style={styles.rewardTitle}>🎉 You have a FREE hour waiting!</Text>
                  <Text style={styles.rewardCode}>{freeVouchers[0].code}</Text>
                  <Text style={styles.rewardBody}>Toggle it on in your game plan — one hour goes free! ⚽</Text>
                </View>
              ) : (
                <>
                  <Text style={[styles.smallStrong, { color: c.textMuted }]}>Play {loyalty.count}/{loyalty.target} this month • {loyalty.remaining} more for a FREE hour! 🔥</Text>
                  <View style={styles.progressRow}>{Array.from({ length: loyalty.target }).map((_, i) => <View key={i} style={[styles.progress, { backgroundColor: i < loyalty.count ? colors.violet500 : c.border }]} />)}</View>
                </>
              )}
            </SectionCard>
          ) : null}

          <ReviewsSection
            venueId={venue.id}
            venueName={venue.name}
            eligibleBookings={eligibleBookings}
            onChanged={() => void fetchVenue(venueId).then(setVenue).catch(() => undefined)}
          />

          <SectionCard title="Step 1 • Pick your court" accent="emerald">
            <View style={styles.courtGrid}>
              {courts.map((item) => {
                const active = item.id === courtId;
                return (
                  <Pressable key={item.id} onPress={() => { setCourtId(item.id); setStart(null); }} style={[styles.courtCard, { backgroundColor: active ? c.activeSoft : c.inset, borderColor: active ? colors.emerald500 : c.border }]} accessibilityState={{ selected: active }}>
                    <View style={styles.rowBetween}><View style={[styles.formatPill, { backgroundColor: c.surface }]}><Users size={12} color={c.textMuted} /><Text style={[styles.tinyStrong, { color: c.textMuted }]}>{item.format ?? "Futsal"}</Text></View>{active ? <View style={styles.checkCircle}><Check size={13} color="#FFFFFF" strokeWidth={3} /></View> : null}</View>
                    <Text style={[styles.courtName, { color: c.text }]}>{item.name}</Text>
                    <Text style={[styles.small, { color: c.textMuted }]}>{item.surface ?? "Indoor turf"}</Text>
                    <View style={styles.rowBetween}><Text style={[styles.price, { color: isDark ? colors.emerald300 : colors.emerald700 }]}>{formatNPR(item.pricePerHour)}<Text style={styles.priceSmall}>/hr</Text></Text><Text style={[styles.tiny, { color: c.textFaint }]}>☀️ {formatNPR(item.priceMorning ?? item.pricePerHour)}</Text></View>
                  </Pressable>
                );
              })}
            </View>
          </SectionCard>

          <SectionCard title="Step 2 • Which day suits you?" accent="emerald">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalContent}>
              {days.map((day) => {
                const p = prettyDayShort(day);
                const active = date === day;
                return <Pressable key={day} onPress={() => { setDate(day); setStart(null); }} style={[styles.dayChip, { backgroundColor: active ? colors.emerald600 : c.inset, borderColor: active ? colors.emerald600 : c.border }]}><Text style={[styles.dayDow, { color: active ? colors.emerald100 : c.textFaint }]}>{p.dow}</Text><Text style={[styles.dayNumber, { color: active ? "#FFFFFF" : c.text }]}>{p.day}</Text><Text style={[styles.dayMonth, { color: active ? colors.emerald100 : c.textFaint }]}>{p.month}</Text></Pressable>;
              })}
            </ScrollView>
          </SectionCard>

          <SectionCard title="Step 3 • How long + when?" accent="emerald">
            <Text style={[styles.small, { color: c.textMuted }]}>Pick 1, 2 or 3 hours first, then choose a start time. The whole block must be free.</Text>
            <View style={styles.wrapRow}>
              {[1, 2, 3].map((value) => <Choice key={String(value)} label={`${value} hr${value > 1 ? "s" : ""} • ${value} slot${value > 1 ? "s" : ""}`} active={hours === value} onPress={() => { setHours(value); setStart(null); }} />)}
            </View>
            <View style={styles.legend}><Legend color={colors.emerald600} label={`Your ${hours}-hr block`} /><Legend color={c.surface} border={c.border} label="Free start" /><Legend color={c.inset} label="Can't start here" /></View>
            {loadingSlots ? <Text style={[styles.smallStrong, { color: c.textFaint }]}>Checking what's free…</Text> : null}
            <View style={styles.slotGrid}>
              {slots.map((slot) => {
                const blocked = startBlocked(slot);
                const inRange = selectedRange.includes(slot);
                const position = selectedRange.indexOf(slot);
                return <Pressable key={slot} onPress={() => { if (!blocked) { setStart(slot); setError(""); } }} disabled={blocked} style={[styles.slot, { backgroundColor: blocked ? c.inset : inRange ? colors.emerald600 : c.surface, borderColor: inRange ? colors.emerald600 : c.border, opacity: blocked ? 0.5 : 1 }]}><Text style={[styles.slotText, { color: blocked ? c.textFaint : inRange ? "#FFFFFF" : c.text }]}>{formatTime12(slot)}</Text>{inRange && hours > 1 ? <Text style={styles.slotIndex}>{position + 1}</Text> : null}</Pressable>;
              })}
            </View>
            {start ? <View style={[styles.rangeNotice, { backgroundColor: rangeValid ? c.activeSoft : isDark ? "rgba(239,68,68,0.12)" : colors.red50 }]}><Text style={[styles.smallStrong, { color: rangeValid ? (isDark ? colors.emerald300 : colors.emerald700) : colors.red500 }]}>{rangeValid ? "✅ Locked in:" : "⚠️ Heads up:"} {formatTime12(start)} → {formatTime12(addHours(start, hours))} • {hours} hr{hours > 1 ? "s" : ""}</Text><Text style={[styles.smallStrong, { color: c.text }]}>{formatNPR(total)}</Text></View> : null}
          </SectionCard>

          <SectionCard title="Step 4 • Just your crew, an open invite, or a competition?" accent="emerald">
            <View style={styles.visibilityGrid}>
              <VisibilityChoice icon={<Lock size={17} color={colors.emerald600} />} title="Just our gang" text="Private game for your crew." active={visibility === "private"} onPress={() => setVisibility("private")} />
              <VisibilityChoice icon={<Globe size={17} color={colors.orange500} />} title="Invite everyone!" text="Open spots for new players." active={visibility === "public"} onPress={() => setVisibility("public")} />
              <VisibilityChoice icon={<Swords size={17} color={colors.sky500} />} title="Competition" text="Two squads, one result." active={visibility === "competition"} onPress={() => setVisibility("competition")} />
            </View>
            {visibility === "private" ? <TeamPicker teams={userTeams} selected={selectedTeam} onPick={pickTeam} idleLabel="Just me" title="Which of your teams is this for? 🛡️" accent="emerald" /> : null}
            {visibility === "public" ? <PublicGameForm /> : null}
            {visibility === "competition" ? <CompetitionForm /> : null}
          </SectionCard>

          <SectionCard title="Your game plan" accent="emerald" highlighted>
            <SummaryRow label="Court" value={court?.name ?? "—"} />
            <SummaryRow label="Day" value={prettyDate(date)} />
            <SummaryRow label="Time" value={start ? `${formatTime12(start)} → ${formatTime12(addHours(start, hours))} (${hours} hr)` : "Pick a time above"} />
            <SummaryRow label="Game type" value={visibility === "public" ? `🌍 Open • ${ourCrew} crew + ${openSpots} spots` : visibility === "competition" ? "🆚 Competition" : "🔒 Just our gang"} />
            <SummaryRow label="Squad" value={selectedTeamName ? `🛡️ ${selectedTeamName}` : "🙋 Individual booking"} />
            {visibility === "competition" ? <SummaryRow label="Opponent" value={opponent ? `🆚 ${opponent.name}` : "Pick an opponent"} /> : null}
            {visibility === "competition" ? <SummaryRow label="Payment" value={competitionPaymentMode === "loser_pays" ? "🏁 Loser pays" : "🤝 Fair split"} /> : null}
            {visibility === "public" ? <SummaryRow label={chargeMode === "custom" ? "Joiners pay" : "Each pays"} value={start ? formatNPR(perPlayer) : "Pick a time"} /> : null}

            {freeVouchers.length > 0 ? <Pressable onPress={() => setUseFreePlay((value) => !value)} style={[styles.freeRow, { backgroundColor: useFreePlay ? (isDark ? "rgba(139,92,246,0.15)" : "#F5F3FF") : c.inset, borderColor: isDark ? "rgba(139,92,246,0.35)" : "#C4B5FD" }]}><Text style={styles.freeEmoji}>🎁</Text><View style={styles.grow}><Text style={[styles.smallStrong, { color: c.text }]}>Use my FREE hour {useFreePlay ? "✓" : ""}</Text><Text style={[styles.tiny, { color: isDark ? colors.violet300 : colors.violet700 }]}>{freeVouchers[0].code} • saves {formatNPR(rate)}</Text></View><Text style={styles.toggle}>{useFreePlay ? "ON" : "OFF"}</Text></Pressable> : null}

            {afterFreePlay > 0 ? <PromoBox promos={venuePromos} code={promoCode} applied={appliedPromo} error={promoError} checking={promoChecking} onCode={(value) => { setPromoCode(normalizePromoCode(value)); setPromoError(""); }} onApply={() => void applyPromo()} onQuickApply={(code) => { setPromoCode(code); void applyPromo(code); }} onRemove={() => { setAppliedPromo(null); setPromoCode(""); setPromoError(""); }} /> : null}

            <View style={[styles.totalRow, { borderTopColor: c.border }]}><Text style={[styles.totalLabel, { color: c.textMuted }]}>Total</Text><View><Text style={[styles.totalValue, { color: isDark ? colors.emerald300 : colors.emerald700 }]}>{start ? total === 0 ? "FREE 🎉" : formatNPR(total) : formatNPR(0)}</Text>{total < fullTotal ? <Text style={[styles.strike, { color: c.textFaint }]}>{formatNPR(fullTotal)}</Text> : null}</View></View>
            {freePlayActive ? <Text style={[styles.discountNote, { color: isDark ? colors.violet300 : colors.violet700 }]}>🎁 1 free hour applied ({freeVouchers[0]?.code})</Text> : null}
            {promoDiscount > 0 ? <Text style={[styles.discountNote, { color: isDark ? colors.emerald300 : colors.emerald700 }]}>🎟️ {appliedPromo?.code} — you save {formatNPR(promoDiscount)}</Text> : null}

            {total > 0 ? <PaymentBox competition={visibility === "competition"} methods={availableMethods} selected={payMethod} onSelect={setPayMethod} deposit={depositPreview} amount={depositPreview.required ? depositPreview.amount : total} receipt={receipt} onReceipt={setReceipt} /> : <Text style={[styles.freeMessage, { color: isDark ? colors.violet300 : colors.violet700 }]}>{promoDiscount > 0 ? "🎟️ Promo covers the whole bill — nothing to pay!" : "🎁 Fully covered — no payment needed!"}</Text>}

            <Text style={[styles.label, { color: c.textFaint }]}>Your number (so the venue can reach you)</Text>
            <TextInput value={phone} onChangeText={(value) => { setPhone(value); setFieldErrors((old) => ({ ...old, phone: "" })); }} placeholder="98XXXXXXXX" placeholderTextColor={c.textFaint} maxLength={16} keyboardType="phone-pad" style={[styles.input, { backgroundColor: c.inset, borderColor: fieldErrors.phone ? colors.red400 : c.border, color: c.text }]} />
            {fieldErrors.phone ? <Text style={styles.error}>{fieldErrors.phone}</Text> : null}
            <Text style={[styles.label, { color: c.textFaint }]}>Anything we should know? (optional)</Text>
            <TextInput value={notes} onChangeText={(value) => { setNotes(value); setFieldErrors((old) => ({ ...old, notes: "" })); }} placeholder="Birthday game, need extra balls…" placeholderTextColor={c.textFaint} maxLength={500} multiline style={[styles.input, styles.notes, { backgroundColor: c.inset, borderColor: fieldErrors.notes ? colors.red400 : c.border, color: c.text }]} />
            <Text style={[styles.tiny, { color: c.textFaint }]}>{notes.trim().length}/500</Text>
            {fieldErrors.notes ? <Text style={styles.error}>{fieldErrors.notes}</Text> : null}
            {error ? <Notice message={error} /> : null}
            {!user ? <Button label="Log in to book your game" onPress={() => router.push("/login")} /> : <Button label={busy || payRedirect ? (payRedirect ? `Opening ${payMethod} test…` : "Sending your request…") : !start ? "Pick a time first ☝️" : !rangeValid ? "Pick a fully free block 🙏" : visibility === "competition" ? `Request ${hours} hr • ${formatNPR(total)} • captain approval first` : payMethod === "eSewa" && total > 0 ? `Request + Pay ${formatNPR(depositPreview.required ? depositPreview.amount : total)} via eSewa 💚` : payMethod === "Khalti" && total > 0 ? `Request + Pay ${formatNPR(depositPreview.required ? depositPreview.amount : total)} via Khalti 💜` : `Request ${hours} hr • ${formatNPR(total)}`} onPress={() => void book()} loading={busy} disabled={!start || !rangeValid || payRedirect} />}
            <Text style={[styles.hint, { color: c.textFaint }]}><BadgeCheck size={13} color={c.textFaint} /> Life happens — cancel free up to 6 hrs before</Text>
          </SectionCard>
        </ScrollView>
      </KeyboardAvoidingView>
      <SuccessModal success={success} venue={venue} court={court} date={date} start={start} hours={hours} onClose={() => setSuccess(null)} onTrack={() => router.replace("/bookings")} />
    </SafeAreaView>
  );

  function PublicGameForm() {
    return (
      <View style={[styles.subPanel, { backgroundColor: isDark ? "rgba(249,115,22,0.06)" : colors.orange50, borderColor: isDark ? "rgba(249,115,22,0.25)" : colors.orange100 }]}>
        <Text style={[styles.label, { color: c.textFaint }]}>Name your game</Text>
        <TextInput value={matchTitle} onChangeText={setMatchTitle} placeholder={`⚡ Friendly kickabout at ${venue?.name ?? "futsal"}`} placeholderTextColor={c.textFaint} maxLength={60} style={[styles.input, { backgroundColor: c.surface, borderColor: fieldErrors.matchTitle ? colors.red400 : c.border, color: c.text }]} />
        {userTeams.length > 0 ? <TeamPicker teams={userTeams} selected={selectedTeam} onPick={pickTeam} idleLabel="Just friends" title="Playing with one of your teams? 🛡️" accent="orange" /> : null}
        <View style={styles.twoCol}><Counter title="Our crew coming" value={ourCrew} min={1} max={21} onChange={(value) => { setOurCrew(value); setSelectedTeam(""); }} tone="emerald" /><Counter title="Open spots" value={openSpots} min={1} max={21} onChange={setOpenSpots} tone="orange" /></View>
        <Text style={[styles.smallStrong, { color: c.textMuted }]}>{ourCrew} crew + {openSpots} open = {totalPlayers} total {totalPlayers >= 4 && totalPlayers <= 22 ? "✓" : "⚠️ needs 4–22"}</Text>
        <Text style={[styles.label, { color: c.textFaint }]}>Who&apos;s welcome?</Text>
        <View style={styles.twoCol}><MiniChoice title="🌍 Anyone" active={welcomeMode === "any"} onPress={() => setWelcomeMode("any")} /><MiniChoice title="🎯 Specific levels" active={welcomeMode === "specific"} onPress={() => setWelcomeMode("specific")} /></View>
        {welcomeMode === "specific" ? <View style={styles.wrapRow}>{["Beginner", "Intermediate", "Advanced"].map((level) => <Choice key={level} label={level} active={welcomeLevels.includes(level)} onPress={() => toggleLevel(level)} />)}</View> : null}
        <Text style={[styles.label, { color: c.textFaint }]}>What should joiners pay?</Text>
        <View style={styles.twoCol}><MiniChoice title={`🤝 Fair split (${formatNPR(autoPerPlayer)})`} active={chargeMode === "split"} onPress={() => setChargeMode("split")} /><MiniChoice title="✨ Custom charge" active={chargeMode === "custom"} onPress={() => { setChargeMode("custom"); if (!customPrice && start) setCustomPrice(String(autoPerPlayer)); }} /></View>
        {chargeMode === "custom" ? <><TextInput value={customPrice} onChangeText={setCustomPrice} keyboardType="numeric" placeholder={String(autoPerPlayer)} placeholderTextColor={c.textFaint} style={[styles.input, { backgroundColor: c.surface, borderColor: c.border, color: c.text }]} /><Text style={[styles.tiny, { color: c.textFaint }]}>Joiners pay {Number.isFinite(customValue) ? formatNPR(customValue) : "a custom amount"} each • your crew covers {formatNPR(Math.max(0, hostShare))}</Text></> : null}
      </View>
    );
  }

  function CompetitionForm() {
    return (
      <View style={[styles.subPanel, { backgroundColor: isDark ? "rgba(14,165,233,0.07)" : "#F0F9FF", borderColor: isDark ? "rgba(14,165,233,0.3)" : "#BAE6FD" }]}>
        <TeamPicker teams={userTeams} selected={selectedTeam} onPick={pickTeam} idleLabel="" title="Your squad 🛡️" accent="sky" hideIdle />
        {selectedTeam ? <><Text style={[styles.label, { color: c.textFaint }]}>Counts towards a league?</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalContent}><MiniChoice title="Friendly" active={!leagueId} onPress={() => setLeagueId("")} />{leagues.map((league) => <MiniChoice key={league.id} title={league.name} active={leagueId === String(league.id)} onPress={() => setLeagueId(String(league.id))} />)}</ScrollView><Text style={[styles.label, { color: c.textFaint }]}>Who are you playing?</Text><TextInput value={opponentQuery} onChangeText={setOpponentQuery} placeholder="Search squads by name…" placeholderTextColor={c.textFaint} style={[styles.input, { backgroundColor: c.surface, borderColor: c.border, color: c.text }]} /><View style={styles.wrapRow}>{filteredOpponents.map((team) => <Pressable key={team.id} onPress={() => setOpponentTeamId(String(team.id))} style={[styles.opponentChip, { backgroundColor: opponentTeamId === String(team.id) ? colors.sky500 : c.surface, borderColor: opponentTeamId === String(team.id) ? colors.sky500 : c.border }]}><Shield size={12} color={opponentTeamId === String(team.id) ? "#FFFFFF" : team.logoColor} /><Text style={[styles.smallStrong, { color: opponentTeamId === String(team.id) ? "#FFFFFF" : c.text }]}>{team.name}</Text></Pressable>)}</View><Text style={[styles.small, { color: c.textMuted }]}>{opponent ? `${selectedTeamName} vs ${opponent.name}` : "Pick an opponent"}</Text><Text style={[styles.label, { color: c.textFaint }]}>Competition payment policy</Text><View style={styles.twoCol}><MiniChoice title="🤝 Fair split" active={competitionPaymentMode === "split"} onPress={() => setCompetitionPaymentMode("split")} /><MiniChoice title="🏁 Loser pays" active={competitionPaymentMode === "loser_pays"} onPress={() => setCompetitionPaymentMode("loser_pays")} /></View><Text style={[styles.tiny, { color: c.textMuted }]}>{competitionPaymentMode === "loser_pays" ? "The losing squad covers the full court bill after the venue records the score. A draw falls back to a fair split." : "Both squads share the court cost equally."}</Text><View style={styles.infoBox}><Trophy size={15} color={colors.sky500} /><Text style={[styles.small, { color: c.textMuted }]}>The venue records the final score and it appears on both squads&apos; profiles.</Text></View></> : <Text style={[styles.small, { color: c.textMuted }]}>Join or create a squad first — competition bookings need two named squads.</Text>}
      </View>
    );
  }
}

function parseAmenities(value: Venue["amenities"]): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function LoadingVenue() {
  const { colors: c } = useTheme();
  return <SafeAreaView style={[styles.flex, { backgroundColor: c.bg }]}><View style={styles.loading}><ActivityIndicator size="large" color={c.primary} /><Text style={[styles.body, { color: c.textMuted }]}>Loading venue…</Text></View></SafeAreaView>;
}

function SectionCard({ title, accent, highlighted, children }: { title: string; accent: "orange" | "emerald" | "violet"; highlighted?: boolean; children: React.ReactNode }) {
  const { colors: c, isDark } = useTheme();
  const accentColor = accent === "orange" ? colors.orange500 : accent === "violet" ? colors.violet500 : colors.emerald600;
  return <View style={[styles.sectionCard, { backgroundColor: highlighted ? (isDark ? "rgba(15,23,42,0.96)" : c.surface) : c.surface, borderColor: c.border }]}><Text style={[styles.sectionTitle, { color: accentColor }]}>{title}</Text>{children}</View>;
}

function Choice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors: c } = useTheme();
  return <Pressable onPress={onPress} style={[styles.choice, { backgroundColor: active ? c.primary : c.surface, borderColor: active ? c.primary : c.border }]}><Text style={[styles.choiceText, { color: active ? c.primaryText : c.text }]}>{label}</Text></Pressable>;
}

function MiniChoice({ title, active, onPress }: { title: string; active: boolean; onPress: () => void }) {
  const { colors: c } = useTheme();
  return <Pressable onPress={onPress} style={[styles.miniChoice, { backgroundColor: active ? c.activeSoft : c.surface, borderColor: active ? c.primary : c.border }]}><Text style={[styles.smallStrong, { color: active ? c.activeText : c.text }]}>{title}{active ? " ✓" : ""}</Text></Pressable>;
}

function VisibilityChoice({ icon, title, text, active, onPress }: { icon: React.ReactNode; title: string; text: string; active: boolean; onPress: () => void }) {
  const { colors: c } = useTheme();
  return <Pressable onPress={onPress} style={[styles.visibility, { backgroundColor: active ? c.activeSoft : c.inset, borderColor: active ? c.primary : c.border }]}>{icon}<View style={styles.grow}><Text style={[styles.smallStrong, { color: c.text }]}>{title}{active ? " ✓" : ""}</Text><Text style={[styles.tiny, { color: c.textMuted }]}>{text}</Text></View></Pressable>;
}

function TeamPicker({ teams, selected, onPick, idleLabel, title, accent, hideIdle = false }: { teams: UserTeamLite[]; selected: string; onPick: (id: string) => void; idleLabel: string; title: string; accent: "emerald" | "orange" | "sky"; hideIdle?: boolean }) {
  const { colors: c } = useTheme();
  const accentColor = accent === "orange" ? colors.orange500 : accent === "sky" ? colors.sky500 : colors.emerald600;
  return <View style={styles.teamPicker}><Text style={[styles.label, { color: c.textFaint }]}>{title}</Text><View style={styles.wrapRow}>{!hideIdle ? <Choice label={idleLabel} active={selected === ""} onPress={() => onPick("")} /> : null}{teams.map((team) => <Pressable key={team.id} onPress={() => onPick(String(team.id))} style={[styles.teamChip, { backgroundColor: selected === String(team.id) ? accentColor : c.surface, borderColor: selected === String(team.id) ? accentColor : c.border }]}><Shield size={12} color={selected === String(team.id) ? "#FFFFFF" : team.logoColor} /><Text style={[styles.smallStrong, { color: selected === String(team.id) ? "#FFFFFF" : c.text }]}>{team.name} ({team.memberCount})</Text></Pressable>)}</View></View>;
}

function Counter({ title, value, min, max, onChange, tone }: { title: string; value: number; min: number; max: number; onChange: (value: number) => void; tone: "emerald" | "orange" }) {
  const { colors: c } = useTheme();
  const accent = tone === "orange" ? colors.orange500 : colors.emerald600;
  return <View style={[styles.counter, { backgroundColor: c.surface, borderColor: c.border }]}><Text style={[styles.tinyStrong, { color: c.textFaint }]}>{title}</Text><View style={styles.rowBetween}><Pressable onPress={() => onChange(Math.max(min, value - 1))} style={[styles.counterBtn, { borderColor: c.border }]}><Minus size={16} color={c.textMuted} /></Pressable><Text style={[styles.counterValue, { color: accent }]}>{value}</Text><Pressable onPress={() => onChange(Math.min(max, value + 1))} style={[styles.counterBtn, { backgroundColor: accent, borderColor: accent }]}><Plus size={16} color="#FFFFFF" /></Pressable></View></View>;
}

function Legend({ color, label, border }: { color: string; label: string; border?: string }) {
  const { colors: c } = useTheme();
  return <View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: color, borderColor: border ?? color }]} /><Text style={[styles.tiny, { color: c.textMuted }]}>{label}</Text></View>;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  const { colors: c } = useTheme();
  return <View style={styles.summaryRow}><Text style={[styles.small, { color: c.textMuted }]}>{label}</Text><Text style={[styles.smallStrong, { color: c.text }]} numberOfLines={2}>{value}</Text></View>;
}

function PromoBox({ promos, code, applied, error, checking, onCode, onApply, onQuickApply, onRemove }: { promos: PromoAd[]; code: string; applied: AppliedPromo | null; error: string; checking: boolean; onCode: (value: string) => void; onApply: () => void; onQuickApply: (code: string) => void; onRemove: () => void }) {
  const { colors: c, isDark } = useTheme();
  return <View style={[styles.promoBox, { backgroundColor: isDark ? "rgba(16,185,129,0.06)" : colors.emerald50, borderColor: isDark ? "rgba(16,185,129,0.35)" : colors.emerald300 }]}><Text style={[styles.label, { color: c.textFaint }]}><Ticket size={13} color={c.textFaint} /> Promo code</Text>{promos.length > 0 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalContent}>{promos.map((promo) => <Pressable key={promo.id} onPress={() => onQuickApply(promo.code)} style={[styles.promoChip, { backgroundColor: applied?.code === promo.code ? colors.emerald600 : c.surface, borderColor: applied?.code === promo.code ? colors.emerald600 : c.border }]}><Text style={[styles.tinyStrong, { color: applied?.code === promo.code ? "#FFFFFF" : c.text }]}>{promo.code}{promo.summary ? ` • ${promo.summary}` : ""}</Text></Pressable>)}</ScrollView> : null}{applied ? <View style={styles.appliedPromo}><View style={styles.grow}><Text style={styles.appliedCode}>{applied.code} ✓</Text><Text style={styles.appliedSub}>−{formatNPR(applied.discount)} on this bill • {applied.expiryLabel}</Text></View><Pressable onPress={onRemove} style={styles.removePromo}><X size={14} color="#FFFFFF" /><Text style={styles.removeText}>Remove</Text></Pressable></View> : <View style={styles.promoInputRow}><TextInput value={code} onChangeText={onCode} placeholder="e.g. SAVE10" placeholderTextColor={c.textFaint} autoCapitalize="characters" style={[styles.promoInput, { backgroundColor: c.surface, borderColor: c.border, color: c.text }]} /><Pressable onPress={onApply} disabled={checking || !code} style={[styles.applyButton, { backgroundColor: colors.emerald600, opacity: checking || !code ? 0.5 : 1 }]}><Text style={styles.applyText}>{checking ? "…" : "Apply"}</Text></Pressable></View>}{error ? <Text style={styles.error}>{error}</Text> : promos.length === 0 && !applied ? <Text style={[styles.tiny, { color: c.textFaint }]}>Got a code from the venue? Type it in and we&apos;ll check it 💚</Text> : null}</View>;
}

function PaymentBox({ competition = false, methods, selected, onSelect, deposit, amount, receipt, onReceipt }: { competition?: boolean; methods: string[]; selected: string; onSelect: (value: string) => void; deposit: { required: boolean; percent: number; amount: number; reason: string }; amount: number; receipt: string; onReceipt: (value: string) => void }) {
  const { colors: c, isDark } = useTheme();
  return (
    <View style={styles.paymentBox}>
      <Text style={[styles.label, { color: c.textFaint }]}><Wallet size={13} color={c.textFaint} /> Pay your way</Text>
      <View style={styles.paymentGrid}>
        {methods.map((method) => (
          <Pressable key={method} onPress={() => onSelect(method)} style={[styles.paymentMethod, { backgroundColor: selected === method ? c.activeSoft : c.inset, borderColor: selected === method ? c.primary : c.border }]}>
            <Wallet size={15} color={selected === method ? c.primary : c.textMuted} />
            <Text style={[styles.smallStrong, { color: selected === method ? c.activeText : c.textMuted }]}>{method}{method === "eSewa" ? " 💚" : method === "Khalti" ? " 💜" : ""}</Text>
            {selected === method ? <Check size={14} color={c.primary} /> : null}
          </Pressable>
        ))}
      </View>
      <Text style={[styles.tiny, { color: c.textFaint }]}>
        {competition
          ? "Competition payment starts after the opposition captain accepts and the venue confirms. You can pay from My Games then."
          : "Online uses the server-backed test gateway. Cash is paid at the venue."}
      </Text>
      {deposit.required ? <View style={[styles.depositBox, { backgroundColor: isDark ? "rgba(245,158,11,0.12)" : colors.amber300, borderColor: colors.amber400 }]}><Text style={[styles.smallStrong, { color: isDark ? colors.amber300 : "#78350F" }]}><ShieldAlert size={14} color={isDark ? colors.amber300 : "#78350F"} /> Fair-play deposit: {formatNPR(deposit.amount)} ({deposit.percent}%)</Text><Text style={[styles.tiny, { color: isDark ? colors.amber300 : "#92400E" }]}>{deposit.reason}</Text></View> : null}
      {!competition && isOnlineMethod(selected) ? <View style={[styles.gatewayInfo, { backgroundColor: isDark ? "rgba(14,165,233,0.10)" : "#F0F9FF", borderColor: isDark ? "rgba(14,165,233,0.3)" : "#BAE6FD" }]}><Text style={[styles.smallStrong, { color: isDark ? colors.sky300 : colors.sky700 }]}>{selected === "eSewa" ? "💚 eSewa TEST checkout" : "💜 Khalti TEST checkout"}</Text><Text style={[styles.tiny, { color: c.textMuted }]}>After Request, the app opens the server-backed test gateway and verifies the payment in the database.</Text><Text style={[styles.tinyStrong, { color: c.text }]}>Amount charged now: {formatNPR(amount)}</Text></View> : null}
      {!competition && isOnlineMethod(selected) ? <View style={[styles.receiptBox, { borderColor: c.border }]}><ReceiptUploader value={receipt} onChange={onReceipt} compact /></View> : null}
    </View>
  );
}

function SuccessModal({ success, venue, court, date, start, hours, onClose, onTrack }: { success: BookingSuccess | null; venue: Venue; court: Court | null; date: string; start: string | null; hours: number; onClose: () => void; onTrack: () => void }) {
  const { colors: c, isDark } = useTheme();
  if (!success) return null;
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}><Pressable style={styles.modalBackdrop} onPress={onClose}><View onStartShouldSetResponder={() => true} style={[styles.successCard, { backgroundColor: c.surface, borderColor: c.border }]}><Pressable onPress={onClose} style={styles.closeSuccess}><X size={17} color={c.textMuted} /></Pressable><View style={styles.successIcon}><PartyPopper size={30} color="#FFFFFF" /></View><Text style={[styles.successTitle, { color: c.text }]}>Request sent! 🥳</Text><Text style={[styles.body, { color: c.textMuted }]}>{court?.name} • {prettyDate(date)} • {start ? `${formatTime12(start)} (${hours} hr)` : ""}</Text><Text style={[styles.successPayment, { color: isDark ? colors.emerald300 : colors.emerald700 }]}>{success.total === 0 ? success.freePlay ? "FREE with your loyalty hour! 🎁" : "FREE with your promo code! 🎟️" : success.visibility === "competition" ? `${formatNPR(success.total)} held with the request — payment opens after captain acceptance` : `${formatNPR(success.total)} payment request recorded`}</Text>{success.saved > 0 ? <Text style={[styles.discountNote, { color: isDark ? colors.emerald300 : colors.emerald700 }]}>🎟️ {success.promoCode} saved you {formatNPR(success.saved)}</Text> : null}{success.teamName ? <Text style={[styles.smallStrong, { color: c.textMuted }]}>🛡️ Booked for {success.teamName}</Text> : null}<Text style={[styles.tiny, { color: c.textFaint }]}>Booking ref: #FN-{success.id}</Text>{success.visibility === "competition" ? <Text style={[styles.successNotice, { backgroundColor: isDark ? "rgba(245,158,11,0.12)" : "#FFFBEB", color: isDark ? colors.amber300 : "#92400E" }]}>🆚 {success.competitionPaymentMode === "loser_pays" ? "Loser pays" : "Fair split"} policy saved. The opposition captain must accept before the venue owner is notified.</Text> : <Text style={[styles.successNotice, { backgroundColor: isDark ? "rgba(245,158,11,0.12)" : "#FFFBEB", color: isDark ? colors.amber300 : "#92400E" }]}>⏳ The venue is reviewing it — you&apos;ll be notified when it is confirmed.</Text>}<View style={styles.twoCol}><Pressable onPress={onClose} style={[styles.secondaryAction, { borderColor: c.border }]}><Text style={[styles.smallStrong, { color: c.text }]}>Book another</Text></Pressable><Pressable onPress={onTrack} style={styles.primaryAction}><Text style={styles.primaryActionText}>Track it</Text></Pressable></View></View></Pressable></Modal>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  pad: { padding: space[4], gap: space[3] },
  scroll: { padding: space[4], paddingBottom: space[16], gap: space[4] },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: space[3] },
  backLink: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 40 },
  backText: { fontSize: fontSize.sm, fontWeight: "900" },
  cover: { height: 250, borderRadius: radius["3xl"], borderWidth: 1, overflow: "hidden", position: "relative" },
  coverImage: { width: "100%", height: "100%" },
  coverShade: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.42)" },
  coverCopy: { position: "absolute", left: space[5], right: space[5], bottom: space[5], gap: 6 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  ratingBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: colors.amber400, borderRadius: radius.full, paddingHorizontal: 9, paddingVertical: 4 },
  ratingText: { color: "#451A03", fontSize: fontSize.xs, fontWeight: "900" },
  coverBadge: { color: "#FFFFFF", backgroundColor: "rgba(15,23,42,0.72)", borderRadius: radius.full, paddingHorizontal: 9, paddingVertical: 4, fontSize: fontSize.xs, fontWeight: "800" },
  coverTitle: { color: "#FFFFFF", fontSize: fontSize["3xl"], fontWeight: "900" },
  coverMeta: { color: "rgba(255,255,255,0.9)", fontSize: fontSize.sm, fontWeight: "700" },
  sectionCard: { borderRadius: radius["3xl"], borderWidth: 1, padding: space[5], gap: space[3] },
  sectionTitle: { fontSize: fontSize.sm, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.3 },
  body: { fontSize: fontSize.base, lineHeight: 21 },
  small: { fontSize: fontSize.sm, lineHeight: 18 },
  smallStrong: { fontSize: fontSize.sm, fontWeight: "800", lineHeight: 18 },
  tiny: { fontSize: fontSize.xs, lineHeight: 16 },
  tinyStrong: { fontSize: fontSize.xs, fontWeight: "900", lineHeight: 16 },
  label: { fontSize: fontSize.xs, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
  wrapRow: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2] },
  twoCol: { flexDirection: "row", gap: space[2] },
  amenity: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 6 },
  rewardCard: { borderRadius: radius["2xl"], padding: space[4], backgroundColor: colors.violet500, gap: 3 },
  rewardTitle: { color: "#FFFFFF", fontSize: fontSize.base, fontWeight: "900" },
  rewardCode: { color: "rgba(255,255,255,0.85)", fontSize: fontSize.xs, fontWeight: "800" },
  rewardBody: { color: "rgba(255,255,255,0.9)", fontSize: fontSize.xs, lineHeight: 17 },
  progressRow: { flexDirection: "row", gap: 4 },
  progress: { height: 9, flex: 1, borderRadius: radius.full },
  courtGrid: { gap: space[3] },
  courtCard: { borderWidth: 1, borderRadius: radius["2xl"], padding: space[4], gap: 5 },
  formatPill: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 4 },
  courtName: { fontSize: fontSize.md, fontWeight: "900" },
  checkCircle: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.emerald600, alignItems: "center", justifyContent: "center" },
  price: { fontSize: fontSize.base, fontWeight: "900" },
  priceSmall: { fontSize: fontSize.xs, fontWeight: "700" },
  horizontalContent: { gap: space[2], paddingRight: space[4] },
  dayChip: { width: 68, minHeight: 76, borderWidth: 1, borderRadius: radius["2xl"], alignItems: "center", justifyContent: "center", gap: 1 },
  dayDow: { fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  dayNumber: { fontSize: fontSize.xl, fontWeight: "900" },
  dayMonth: { fontSize: 10, fontWeight: "800" },
  choice: { minHeight: 42, borderWidth: 1, borderRadius: radius.full, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  choiceText: { fontSize: fontSize.sm, fontWeight: "900" },
  miniChoice: { flex: 1, minHeight: 48, borderWidth: 1, borderRadius: radius.xl, paddingHorizontal: 10, alignItems: "center", justifyContent: "center" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendSwatch: { width: 12, height: 12, borderRadius: 4, borderWidth: 1 },
  slotGrid: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  slot: { position: "relative", minWidth: 88, minHeight: 44, flexGrow: 1, borderWidth: 1, borderRadius: radius.xl, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  slotText: { fontSize: fontSize.sm, fontWeight: "900" },
  slotIndex: { position: "absolute", top: -7, right: -5, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.amber400, color: "#451A03", textAlign: "center", fontSize: 10, fontWeight: "900", paddingTop: 3 },
  rangeNotice: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, borderRadius: radius.xl, paddingHorizontal: 12, paddingVertical: 10 },
  visibilityGrid: { gap: space[2] },
  visibility: { flexDirection: "row", alignItems: "flex-start", gap: space[2], borderWidth: 1, borderRadius: radius["2xl"], padding: space[3] },
  subPanel: { borderWidth: 1, borderRadius: radius["2xl"], padding: space[4], gap: space[3] },
  teamPicker: { gap: space[2] },
  teamChip: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: radius.full, paddingHorizontal: 11, paddingVertical: 8 },
  counter: { flex: 1, borderWidth: 1, borderRadius: radius.xl, padding: space[3], gap: 8 },
  counterBtn: { width: 34, height: 34, borderWidth: 1, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  counterValue: { fontSize: fontSize["2xl"], fontWeight: "900" },
  counterValueSmall: { fontSize: fontSize.xl, fontWeight: "900" },
  counterTitle: { fontSize: fontSize.xs, fontWeight: "900" },
  tinyStrongUnused: { fontSize: fontSize.xs, fontWeight: "900" },
  opponentChip: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 8 },
  infoBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: radius.xl, padding: 10, backgroundColor: "rgba(14,165,233,0.10)" },
  summaryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  freeRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: radius["2xl"], padding: space[3] },
  freeEmoji: { fontSize: 24 },
  toggle: { color: colors.violet500, fontSize: fontSize.xs, fontWeight: "900" },
  promoBox: { borderWidth: 1, borderStyle: "dashed", borderRadius: radius["2xl"], padding: space[3], gap: space[2] },
  promoChip: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 7, marginRight: 4 },
  promoInputRow: { flexDirection: "row", gap: space[2] },
  promoInput: { flex: 1, minWidth: 0, minHeight: 44, borderWidth: 1, borderRadius: radius.xl, paddingHorizontal: 12, fontSize: fontSize.base, fontWeight: "900" },
  applyButton: { minWidth: 72, minHeight: 44, borderRadius: radius.xl, alignItems: "center", justifyContent: "center" },
  applyText: { color: "#FFFFFF", fontSize: fontSize.sm, fontWeight: "900" },
  appliedPromo: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.emerald600, borderRadius: radius.xl, padding: 10 },
  appliedCode: { color: "#FFFFFF", fontSize: fontSize.base, fontWeight: "900" },
  appliedSub: { color: colors.emerald100, fontSize: fontSize.xs, fontWeight: "700" },
  removePromo: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(255,255,255,0.20)", borderRadius: radius.lg, paddingHorizontal: 8, paddingVertical: 6 },
  removeText: { color: "#FFFFFF", fontSize: fontSize.xs, fontWeight: "900" },
  totalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, paddingTop: space[3] },
  totalLabel: { fontSize: fontSize.base, fontWeight: "800" },
  totalValue: { fontSize: fontSize["2xl"], fontWeight: "900", textAlign: "right" },
  strike: { textDecorationLine: "line-through", fontSize: fontSize.xs, textAlign: "right" },
  discountNote: { fontSize: fontSize.xs, fontWeight: "900", textAlign: "right" },
  paymentBox: { gap: space[2] },
  paymentGrid: { gap: space[2] },
  paymentMethod: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderRadius: radius.xl, paddingHorizontal: 11 },
  depositBox: { borderWidth: 1, borderRadius: radius.xl, padding: space[3], gap: 5 },
  gatewayInfo: { borderWidth: 1, borderRadius: radius.xl, padding: space[3], gap: 4 },
  receiptBox: { borderWidth: 1, borderRadius: radius.xl, padding: space[2] },
  input: { minHeight: 46, borderWidth: 1, borderRadius: radius.xl, paddingHorizontal: 12, paddingVertical: 10, fontSize: fontSize.base, fontWeight: "600" },
  notes: { minHeight: 82, textAlignVertical: "top" },
  error: { color: colors.red500, fontSize: fontSize.xs, fontWeight: "800" },
  freeMessage: { borderRadius: radius.xl, padding: 10, textAlign: "center", backgroundColor: "rgba(139,92,246,0.10)", fontSize: fontSize.sm, fontWeight: "900" },
  hint: { flexDirection: "row", alignItems: "center", textAlign: "center", fontSize: fontSize.xs, fontWeight: "700" },
  modalBackdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: space[4], backgroundColor: "rgba(2,6,23,0.70)" },
  successCard: { width: "100%", maxWidth: 430, borderWidth: 1, borderRadius: radius["3xl"], padding: space[6], alignItems: "center", gap: space[2] },
  closeSuccess: { position: "absolute", right: 14, top: 14, width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(148,163,184,0.14)" },
  successIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.emerald600, alignItems: "center", justifyContent: "center" },
  successTitle: { fontSize: fontSize["2xl"], fontWeight: "900" },
  successPayment: { fontSize: fontSize.base, fontWeight: "900", textAlign: "center" },
  successNotice: { borderRadius: radius.xl, padding: 10, fontSize: fontSize.xs, fontWeight: "800", textAlign: "center" },
  secondaryAction: { flex: 1, minHeight: 46, borderWidth: 1, borderRadius: radius.xl, alignItems: "center", justifyContent: "center" },
  primaryAction: { flex: 1, minHeight: 46, borderRadius: radius.xl, backgroundColor: colors.emerald600, alignItems: "center", justifyContent: "center" },
  primaryActionText: { color: "#FFFFFF", fontSize: fontSize.sm, fontWeight: "900" },
});
