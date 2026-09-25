import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import Slider from "@react-native-community/slider";
import { Picker } from "@/components/ThemedPicker";
import {
  Building2,
  MapPin,
  Pencil,
 Power,
  Plus,
  ShieldCheck,
  Star,
  Trash2,
  Wallet,
} from "lucide-react-native";
import { Avatar } from "@/components/Avatar";
import { ImagePicker } from "@/components/ImagePicker";
import { PromoManager } from "@/components/PromoManager";
import { Stars } from "@/components/Reviews";
import {
  createCourt,
  createVenue,
  deleteCourt,
  deleteVenue,
  fetchReviews,
  fetchVenues,
  updateCourt,
  updateVenue,
} from "@/api";
import { ReviewRow } from "@/api";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { formatNPR } from "@/lib/futsal";
import { useBreakpoints } from "@/lib/responsive";
import { PAYMENT_OPTIONS } from "@/lib/loyalty";
import type { Court, Venue } from "@/lib/types";
import {
  firstError,
  validateAddress,
  validateCourtName,
  validateDepositPercent,
  validateDescription,
  validateHoursRange,
  validateMoney,
  validatePaymentMethods,
  validatePhone,
  validateVenueName,
} from "@/lib/validation";
import { colors, fontSize, radius, space } from "@/theme";

const AMENITY_OPTIONS = [
  "Parking",
  "Changing Room",
  "Shower",
  "WiFi",
  "Cafeteria",
  "First Aid",
  "Locker",
  "Live Scoreboard",
  "Music System",
  "Rooftop View",
  "Kids Zone",
  "Equipment Rental",
  "Gym",
  "Physio",
  "Night Lights",
];

const FEATURE_OPTIONS = [
  "Floodlights",
  "FIFA Turf",
  "Nets Provided",
  "Match Balls",
  "Drinking Water",
  "Referee Available",
  "Video Recording",
  "Heated Floor",
];

const SURFACES = [
  "Artificial Turf",
  "FIFA Artificial Turf",
  "Futsal Mat",
  "Grass Hybrid",
  "Indoor Court",
];
const FORMATS = ["5v5", "6v6", "7v7", "8v8"];
const CITY_LIST = ["Kathmandu", "Lalitpur", "Bhaktapur", "Pokhara", "Chitwan"];

function ChipPicker({
  options,
  selected,
  onToggle,
  allowCustom = false,
  customLabel = "Add custom option",
}: {
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
  allowCustom?: boolean;
  customLabel?: string;
}) {
  const { colors: c } = useTheme();
  const [customText, setCustomText] = useState("");
  // Existing owner-created values must remain visible when a form is edited,
  // even though they are not part of the predefined chip list.
  const visibleOptions = [...options, ...selected.filter((value) => !options.includes(value))];

  function addCustom() {
    const value = customText.trim().replace(/,/g, " ").replace(/\s+/g, " ").slice(0, 48);
    if (!value) return;
    const existing = visibleOptions.find((option) => option.toLowerCase() === value.toLowerCase());
    if (!existing) onToggle(value);
    setCustomText("");
  }

  return (
    <View style={styles.chipPicker}>
      {visibleOptions.map((o) => {
        const on = selected.includes(o);
        return (
          <Pressable
            key={o}
            onPress={() => onToggle(o)}
            style={[
              styles.pickChip,
              on
                ? { backgroundColor: colors.emerald600, borderColor: colors.emerald600 }
                : { backgroundColor: "transparent", borderColor: c.border },
            ]}
          >
            <Text
              style={[
                styles.pickChipText,
                { color: on ? "#FFFFFF" : c.textMuted },
              ]}
            >
              {on ? "✓ " : ""}
              {o}
            </Text>
          </Pressable>
        );
      })}
      {allowCustom ? (
        <View style={styles.customChipRow}>
          <TextInput
            value={customText}
            onChangeText={setCustomText}
            onSubmitEditing={addCustom}
            placeholder={customLabel}
            placeholderTextColor={c.textFaint}
            maxLength={48}
            returnKeyType="done"
            style={[styles.customChipInput, { color: c.text, backgroundColor: c.inset, borderColor: c.border }]}
            accessibilityLabel={customLabel}
          />
          <Pressable
            onPress={addCustom}
            disabled={!customText.trim()}
            accessibilityRole="button"
            accessibilityLabel={customLabel}
            style={[styles.customChipButton, { borderColor: c.border, opacity: customText.trim() ? 1 : 0.55 }]}
          >
            <Plus size={13} color={c.text} />
            <Text style={[styles.customChipButtonText, { color: c.text }]}>{customLabel}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  const { colors: c } = useTheme();
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

/**
 * Owner Studio → My venues — master/detail: venue list, hero, courts /
 * reviews / promos tabs, Modal forms for add/edit venue & court, delete with
 * type-the-name confirm, deposit slider, price drafts.
 */
export default function OwnerVenues() {
  const { user } = useAuth();
  const { colors: c, isDark } = useTheme();
  const { xl } = useBreakpoints();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [tab, setTab] = useState<"courts" | "reviews" | "promos">("courts");
  const [reviews, setReviews] = useState<ReviewRow[]>([]);

  // Add venue
  const [showAdd, setShowAdd] = useState(false);
  const [fName, setFName] = useState("");
  const [fAddr, setFAddr] = useState("");
  const [fCity, setFCity] = useState("Kathmandu");
  const [fPhone, setFPhone] = useState("");
  const [fDesc, setFDesc] = useState("");
  const [fImage, setFImage] = useState("");
  const [fOpen, setFOpen] = useState(6);
  const [fClose, setFClose] = useState(22);
  const [fAmen, setFAmen] = useState<string[]>(["Parking", "Changing Room", "Shower", "WiFi"]);
  const [fPrice, setFPrice] = useState(1500);
  const [fPay, setFPay] = useState<string[]>([...PAYMENT_OPTIONS]);
  const [fDeposit, setFDeposit] = useState(30);
  const [fExtraFee, setFExtraFee] = useState(0);
  const [fExtraNote, setFExtraNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState("");

  // Edit venue
  const [showEditVenue, setShowEditVenue] = useState(false);
  const [eVenue, setEVenue] = useState<Venue | null>(null);
  const [eName, setEName] = useState("");
  const [eAddr, setEAddr] = useState("");
  const [eCity, setECity] = useState("");
  const [ePhone, setEPhone] = useState("");
  const [eDesc, setEDesc] = useState("");
  const [eImage, setEImage] = useState("");
  const [eOpen, setEOpen] = useState(6);
  const [eClose, setEClose] = useState(22);
  const [eAmen, setEAmen] = useState<string[]>([]);
  const [ePay, setEPay] = useState<string[]>([...PAYMENT_OPTIONS]);
  const [eDeposit, setEDeposit] = useState(30);
  const [eExtraFee, setEExtraFee] = useState(0);
  const [eExtraNote, setEExtraNote] = useState("");
  const [savingVenue, setSavingVenue] = useState(false);
  const [editError, setEditError] = useState("");

  // Retire venue / court (type-the-name)
  const [deleteTarget, setDeleteTarget] = useState<Venue | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const [courtDeleteTarget, setCourtDeleteTarget] = useState<Court | null>(null);
  const [courtDeleteConfirm, setCourtDeleteConfirm] = useState("");
  const [deletingCourt, setDeletingCourt] = useState(false);
  const [courtDeleteError, setCourtDeleteError] = useState("");

  // Add / edit court
  const [showCourt, setShowCourt] = useState(false);
  const [editingCourt, setEditingCourt] = useState<Court | null>(null);
  const [cName, setCName] = useState("");
  const [cFormat, setCFormat] = useState("5v5");
  const [cSurface, setCSurface] = useState(SURFACES[0]);
  const [cPrice, setCPrice] = useState(1500);
  const [cMorning, setCMorning] = useState(1200);
  const [cImage, setCImage] = useState("");
  const [cFeat, setCFeat] = useState<string[]>(["Floodlights", "Nets Provided", "Match Balls"]);
  const [savingCourt, setSavingCourt] = useState(false);
  const [courtError, setCourtError] = useState("");

  const [priceDrafts, setPriceDrafts] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    const v = await fetchVenues();
    setVenues(v);
  }, []);

  async function confirmDeleteVenue() {
    if (!deleteTarget || !user) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await deleteVenue(deleteTarget.id, user.id);
      setDeleteTarget(null);
      setDeleteConfirm("");
      await load();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Couldn't retire the venue 🙏");
    } finally {
      setDeleting(false);
    }
  }

  async function confirmDeleteCourt() {
    if (!courtDeleteTarget || !user) return;
    setDeletingCourt(true);
    setCourtDeleteError("");
    try {
      await deleteCourt(courtDeleteTarget.id, user.id);
      setCourtDeleteTarget(null);
      setCourtDeleteConfirm("");
      await load();
    } catch (e) {
      setCourtDeleteError(e instanceof Error ? e.message : "Couldn't retire that court 🙏");
    } finally {
      setDeletingCourt(false);
    }
  }

  const loadReviews = useCallback(async (venueId: number) => {
    try {
      setReviews(await fetchReviews({ venueId }));
    } catch {
      /* empty list */
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await load();
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  const myVenues = useMemo(
    () => venues.filter((v) => user && v.ownerId === user.id),
    [venues, user],
  );

  useEffect(() => {
    if (selected === null && myVenues.length > 0) setSelected(myVenues[0].id);
  }, [myVenues, selected]);

  const active = myVenues.find((v) => v.id === selected) ?? myVenues[0] ?? null;

  useEffect(() => {
    if (active) void loadReviews(active.id);
  }, [active?.id, loadReviews]);

  function toggle(list: string[], v: string, set: (x: string[]) => void) {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  }

  function resetAddForm() {
    setFName("");
    setFAddr("");
    setFCity("Kathmandu");
    setFPhone(user?.phone || "");
    setFDesc("");
    setFImage("");
    setFOpen(6);
    setFClose(22);
    setFAmen(["Parking", "Changing Room", "Shower", "WiFi"]);
    setFPrice(1500);
    setFPay([...PAYMENT_OPTIONS]);
    setFDeposit(30);
    setFExtraFee(0);
    setFExtraNote("");
  }

  async function addVenue() {
    if (!user) return;
    const err = firstError(
      validateVenueName(fName),
      validateAddress(fAddr),
      fPhone.trim() ? validatePhone(fPhone, { required: false }) : null,
      fDesc.trim() ? validateDescription(fDesc, { required: false, max: 1000 }) : null,
      validateHoursRange(fOpen, fClose),
      validateMoney(fPrice, { min: 100, max: 20000, label: "Starting price" }),
      validatePaymentMethods(fPay),
      validateDepositPercent(fDeposit),
    );
    if (err) {
      setAddError(err);
      return;
    }
    setAddError("");
    setSaving(true);
    try {
      await createVenue({
        name: fName.trim(),
        address: fAddr.trim(),
        city: fCity,
        phone: fPhone.trim() || user.phone || "01-0000000",
        description:
          fDesc.trim() ||
          "A welcoming futsal arena. Great turf, friendly staff, good vibes! ⚽",
        imageUrl: fImage,
        rating: 4.5,
        openingHour: fOpen,
        closingHour: fClose,
        amenities: fAmen.join(","),
        acceptedPayments: fPay.join(","),
        depositPercent: fDeposit,
        defaultExtraFee: fExtraFee,
        defaultExtraFeeNote: fExtraNote,
        ownerId: user.id,
        courts: [
          {
            name: "Court 1",
            format: "5v5",
            pricePerHour: fPrice,
            priceMorning: Math.round(fPrice * 0.75),
          },
        ],
      });
      setShowAdd(false);
      resetAddForm();
      setAddError("");
      await load();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Couldn't list venue 🙏");
    } finally {
      setSaving(false);
    }
  }

  function openEditVenue(v: Venue) {
    setEVenue(v);
    setEName(v.name);
    setEAddr(v.address);
    setECity(v.city);
    setEPhone(v.phone);
    setEDesc(v.description);
    setEImage(v.imageUrl ?? "");
    setEOpen(v.openingHour);
    setEClose(v.closingHour);
    setEAmen(
      String(v.amenities ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const pays = String(v.acceptedPayments ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => PAYMENT_OPTIONS.includes(s));
    setEPay(pays.length > 0 ? pays : [...PAYMENT_OPTIONS]);
    setEDeposit(Number.isFinite(Number(v.depositPercent)) ? Number(v.depositPercent) : 30);
    setEExtraFee(Number.isFinite(Number(v.defaultExtraFee)) ? Number(v.defaultExtraFee) : 0);
    setEExtraNote(String(v.defaultExtraFeeNote ?? ""));
    setEditError("");
    setShowEditVenue(true);
  }

  async function saveVenue() {
    if (!eVenue || !user) return;
    const err = firstError(
      validateVenueName(eName),
      validateAddress(eAddr),
      ePhone.trim() ? validatePhone(ePhone, { required: false }) : null,
      eDesc.trim() ? validateDescription(eDesc, { required: false, max: 1000 }) : null,
      validateHoursRange(eOpen, eClose),
      validatePaymentMethods(ePay),
      validateDepositPercent(eDeposit),
    );
    if (err) {
      setEditError(err);
      return;
    }
    setEditError("");
    setSavingVenue(true);
    try {
      await updateVenue(eVenue.id, {
        ownerId: user.id,
        name: eName.trim(),
        address: eAddr.trim(),
        city: eCity,
        phone: ePhone.trim(),
        description: eDesc.trim(),
        imageUrl: eImage,
        openingHour: eOpen,
        closingHour: eClose,
        amenities: eAmen.join(","),
        acceptedPayments: ePay.join(","),
        depositPercent: eDeposit,
        defaultExtraFee: eExtraFee,
        defaultExtraFeeNote: eExtraNote,
      });
      setShowEditVenue(false);
      setEditError("");
      await load();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Couldn't save — try again 🙏");
    } finally {
      setSavingVenue(false);
    }
  }

  function openAddCourt() {
    setEditingCourt(null);
    setCName("");
    setCFormat("5v5");
    setCSurface(SURFACES[0]);
    setCPrice(1500);
    setCMorning(1200);
    setCImage("");
    setCFeat(["Floodlights", "Nets Provided", "Match Balls"]);
    setShowCourt(true);
  }

  function openEditCourt(c: Court) {
    setEditingCourt(c);
    setCName(c.name);
    setCFormat(c.format ?? "5v5");
    setCSurface(c.surface ?? SURFACES[0]);
    setCPrice(c.pricePerHour);
    setCMorning(c.priceMorning ?? Math.round(c.pricePerHour * 0.75));
    setCImage(c.imageUrl ?? "");
    setCFeat(
      String(c.features ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    setShowCourt(true);
  }

  async function saveCourt() {
    if (!active || !user) return;
    const err = firstError(
      validateCourtName(cName),
      validateMoney(cPrice, { min: 100, max: 20000, label: "Price per hour" }),
      validateMoney(cMorning, { min: 100, max: 20000, label: "Morning price" }),
    );
    if (err) {
      setCourtError(err);
      return;
    }
    setCourtError("");
    setSavingCourt(true);
    try {
      const payload = {
        name: cName.trim(),
        format: cFormat,
        surface: cSurface,
        pricePerHour: cPrice,
        priceMorning: cMorning,
        imageUrl: cImage,
        features: cFeat.join(","),
      };
      if (editingCourt) {
        await updateCourt(editingCourt.id, payload);
      } else {
        await createCourt({ venueId: active.id, ownerId: user.id, ...payload });
      }
      setShowCourt(false);
      setCourtError("");
      await load();
    } catch (e) {
      setCourtError(e instanceof Error ? e.message : "Could not save court 🙏");
    } finally {
      setSavingCourt(false);
    }
  }

  async function savePrice(court: Court) {
    const draft = priceDrafts[court.id];
    const price = draft ? Number(draft) : court.pricePerHour;
    const err = validateMoney(price, { min: 100, max: 20000, label: "Price per hour" });
    if (err) {
      Alert.alert("Price", err);
      return;
    }
    await updateCourt(court.id, {
      pricePerHour: price,
      priceMorning: Math.round(price * 0.75),
    });
    setPriceDrafts((p) => {
      const n = { ...p };
      delete n[court.id];
      return n;
    });
    await load();
  }

  async function toggleCourt(court: Court) {
    await updateCourt(court.id, { isActive: !court.isActive });
    await load();
  }

  const inputStyle = [
    styles.input,
    { backgroundColor: isDark ? "#0F172A" : "#FFFFFF", borderColor: c.border, color: c.text },
  ];

  if (loading) {
    return (
      <ScrollView contentContainerStyle={styles.scroll}>
        <ActivityIndicator size="large" color={c.textFaint} />
      </ScrollView>
    );
  }

  if (myVenues.length === 0) {
    return (
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.emptyCard, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Building2 size={40} color={c.textFaint} />
          <Text style={[styles.emptyTitle, { color: c.text }]}>No venues yet</Text>
          <Text style={[styles.emptyBody, { color: c.textMuted }]}>
            List your first arena — photos, facilities, prices, everything!
          </Text>
          <Pressable
            onPress={() => {
              resetAddForm();
              setShowAdd(true);
            }}
            style={[styles.primaryBtn, { alignSelf: "center" }]}
          >
            <Text style={styles.primaryBtnText}>+ List venue</Text>
          </Pressable>
        </View>
        <AddVenueModal
          visible={showAdd}
          onClose={() => {
            setShowAdd(false);
            setAddError("");
          }}
          onSave={() => void addVenue()}
          saving={saving}
          error={addError}
          fName={fName}
          setFName={(t) => {
            setFName(t);
            setAddError("");
          }}
          fAddr={fAddr}
          setFAddr={(t) => {
            setFAddr(t);
            setAddError("");
          }}
          fCity={fCity}
          setFCity={setFCity}
          fPhone={fPhone}
          setFPhone={(t) => {
            setFPhone(t);
            setAddError("");
          }}
          fDesc={fDesc}
          setFDesc={(t) => {
            setFDesc(t);
            setAddError("");
          }}
          fImage={fImage}
          setFImage={setFImage}
          fOpen={fOpen}
          setFOpen={setFOpen}
          fClose={fClose}
          setFClose={setFClose}
          fAmen={fAmen}
          setFAmen={setFAmen}
          fPrice={fPrice}
          setFPrice={setFPrice}
          fPay={fPay}
          setFPay={setFPay}
          fDeposit={fDeposit}
          setFDeposit={setFDeposit}
          fExtraFee={fExtraFee}
          setFExtraFee={setFExtraFee}
          fExtraNote={fExtraNote}
          setFExtraNote={setFExtraNote}
          toggle={toggle}
          inputStyle={inputStyle}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.headRow}>
        <View style={styles.grow}>
          <View style={styles.titleRow}>
            <Building2 size={22} color={c.text} />
            <Text style={[styles.h1, { color: c.text }]}>My venues</Text>
          </View>
          <Text style={[styles.sub, { color: c.textMuted }]}>
            Photos, facilities, prices, hours — change anything, anytime. ✨
          </Text>
        </View>
        <Pressable
          onPress={() => {
            resetAddForm();
            setShowAdd(true);
          }}
          style={[styles.primaryBtn, styles.inlineBtn]}
        >
          <Plus size={16} color="#FFFFFF" strokeWidth={3} />
          <Text style={styles.primaryBtnText}>List new venue</Text>
        </Pressable>
      </View>

      <View style={[styles.venueLayout, xl && styles.venueLayoutWide]}>
        {/* Venue picker rail */}
        <View style={[styles.rail, xl && styles.railWide, { backgroundColor: c.surface, borderColor: c.border }]}>
        {myVenues.map((v) => {
          const isActive = active?.id === v.id;
          return (
            <Pressable
              key={v.id}
              onPress={() => {
                setSelected(v.id);
                setTab("courts");
              }}
              style={[
                styles.railItem,
                isActive
                  ? { backgroundColor: isDark ? "#FFFFFF" : "#0F172A", borderColor: c.text }
                  : { backgroundColor: "transparent", borderColor: c.border },
              ]}
            >
              {v.imageUrl ? (
                <Image source={{ uri: v.imageUrl }} style={styles.railImg} />
              ) : (
                <View style={[styles.railImg, { backgroundColor: c.border }]} />
              )}
              <View style={styles.grow}>
                <Text
                  style={[
                    styles.railName,
                    { color: isActive ? (isDark ? "#0F172A" : "#FFFFFF") : c.text },
                  ]}
                >
                  {v.name}
                </Text>
                <Text
                  style={[
                    styles.railMeta,
                    { color: isActive ? (isDark ? "#64748B" : "#CBD5E1") : c.textFaint },
                  ]}
                >
                  {v.courtCount} courts • from {formatNPR(v.minPrice)}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {active ? (
        <View style={styles.detail}>
          {/* Hero */}
          <View style={[styles.hero, { backgroundColor: c.surface, borderColor: c.border }]}>
            {active.imageUrl ? (
              <Image source={{ uri: active.imageUrl }} style={styles.heroImg} />
            ) : (
              <View style={[styles.heroImg, { backgroundColor: c.border }]} />
            )}
            <View style={styles.heroOverlay} pointerEvents="none" />
            <View style={styles.heroBottom}>
              <View style={styles.grow}>
                <Text style={styles.heroTitle}>{active.name}</Text>
                <View style={styles.heroMetaRow}>
                  <MapPin size={12} color="#E2E8F0" />
                  <Text style={styles.heroMeta}>
                    {active.address} •
                  </Text>
                  <Star size={12} color={colors.amber400} fill={colors.amber400} />
                  <Text style={styles.heroMeta}>
                    {active.rating.toFixed(1)} ({active.totalReviews})
                  </Text>
                </View>
              </View>
              <View style={styles.heroActions}>
                <Pressable onPress={() => openEditVenue(active)} style={styles.editHeroBtn}>
                  <Pencil size={12} color="#78350F" />
                  <Text style={styles.editHeroText}>Edit profile</Text>
                </Pressable>
                <Pressable
                  onPress={openAddCourt}
                  style={[
                    styles.addCourtBtn,
                    { backgroundColor: isDark ? "#1E293B" : "rgba(255,255,255,0.9)" },
                  ]}
                >
                  <Plus size={12} color={c.text} strokeWidth={3} />
                  <Text style={[styles.addCourtText, { color: c.text }]}>Add court</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setDeleteTarget(active);
                    setDeleteConfirm("");
                    setDeleteError("");
                  }}
                  style={[
                    styles.retireBtn,
                    {
                      backgroundColor: isDark ? "rgba(239,68,68,0.15)" : "rgba(254,242,242,0.9)",
                      borderColor: isDark ? "rgba(248,113,113,0.35)" : "#FCA5A5",
                    },
                  ]}
                  accessibilityLabel="Retire this venue"
                >
                  <Trash2 size={12} color="#DC2626" />
                  <Text style={styles.retireText}>Delete</Text>
                </Pressable>
              </View>
            </View>
          </View>

          {/* Tabs */}
          <View style={[styles.tabBar, { backgroundColor: c.surface, borderColor: c.border }]}>
            {(["courts", "reviews", "promos"] as const).map((t) => (
              <Pressable
                key={t}
                onPress={() => setTab(t)}
                style={[
                  styles.tabBtn,
                  tab === t
                    ? { backgroundColor: isDark ? "#FFFFFF" : "#0F172A" }
                    : { backgroundColor: "transparent" },
                ]}
              >
                <Text
                  style={[
                    styles.tabText,
                    tab === t
                      ? { color: isDark ? "#0F172A" : "#FFFFFF" }
                      : { color: c.textMuted },
                  ]}
                >
                  {t === "courts"
                    ? `Courts (${active.courts?.length ?? 0})`
                    : t === "reviews"
                      ? `Reviews 💬 (${reviews.length})`
                      : "Promos 🎟️"}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={[styles.tabBody, { backgroundColor: c.surface, borderColor: c.border }]}>
            {tab === "courts" ? (
              (active.courts ?? []).length === 0 ? (
                <View style={[styles.inlineEmpty, { backgroundColor: isDark ? "#1E293B" : "#F8FAFC" }]}>
                  <Text style={{ color: c.textMuted, fontSize: fontSize.sm, fontWeight: "700", textAlign: "center" }}>
                    No courts are live right now.
                  </Text>
                  <Text style={{ color: c.textFaint, fontSize: fontSize.xs, textAlign: "center", marginTop: 4 }}>
                    Retired courts drop off this list — their past bookings are untouched. Add a
                    court to start taking bookings again. ⚽
                  </Text>
                </View>
              ) : (
                (active.courts ?? []).map((ct) => {
                  const features = String(ct.features ?? "");
                  return (
                    <View
                      key={ct.id}
                      style={[
                        styles.courtRow,
                        {
                          borderColor: c.border,
                          opacity: ct.isActive ? 1 : 0.6,
                          backgroundColor: isDark ? "rgba(30,41,59,0.4)" : "#F8FAFC",
                        },
                      ]}
                    >
                      <View style={styles.courtMain}>
                        {ct.imageUrl ? (
                          <Image source={{ uri: ct.imageUrl }} style={styles.courtImg} />
                        ) : null}
                        <View style={styles.grow}>
                          <Text style={[styles.courtName, { color: c.text }]}>
                            {ct.name}
                          </Text>
                          <Text style={[styles.courtMeta, { color: c.textMuted }]}>
                            {ct.format ?? "5v5"} • {ct.surface ?? "Turf"} • ☀️ morning{" "}
                            {formatNPR(ct.priceMorning ?? Math.round(ct.pricePerHour * 0.75))}
                          </Text>
                          <Text style={[styles.courtFeat, { color: c.textFaint }]}>
                            ✨ {features || "No facilities listed"}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.courtActions}>
                        <View style={styles.priceEdit}>
                          <Text style={[styles.priceUnit, { color: c.textFaint }]}>Rs.</Text>
                          <TextInput
                            value={priceDrafts[ct.id] ?? String(ct.pricePerHour)}
                            onChangeText={(t) =>
                              setPriceDrafts((p) => ({ ...p, [ct.id]: t.replace(/[^0-9]/g, "") }))
                            }
                            keyboardType="numeric"
                            style={[styles.priceInput, { borderColor: c.border, color: c.text, backgroundColor: isDark ? "#0F172A" : "#FFFFFF" }]}
                          />
                          <Text style={[styles.priceUnit, { color: c.textFaint }]}>/hr</Text>
                        </View>
                        {priceDrafts[ct.id] !== undefined &&
                        Number(priceDrafts[ct.id]) !== ct.pricePerHour ? (
                          <Pressable onPress={() => void savePrice(ct)} style={styles.savePriceBtn}>
                            <Text style={styles.savePriceText}>Save</Text>
                          </Pressable>
                        ) : null}
                        <View style={styles.courtActionGroup}>
                          <Pressable
                            onPress={() => openEditCourt(ct)}
                            style={[styles.smallBtn, { backgroundColor: isDark ? "#FFFFFF" : "#0F172A" }]}
                          >
                            <Pencil size={12} color={isDark ? "#0F172A" : "#FFFFFF"} />
                            <Text style={[styles.smallBtnText, { color: isDark ? "#0F172A" : "#FFFFFF" }]}>
                              Edit
                            </Text>
                          </Pressable>
                          <Pressable
                            onPress={() => void toggleCourt(ct)}
                            style={[
                              styles.smallBtn,
                              {
                                backgroundColor: ct.isActive
                                  ? "rgba(16,185,129,0.15)"
                                  : isDark
                                    ? "#1E293B"
                                    : "#E2E8F0",
                              },
                            ]}
                          >
                            <Power
                              size={12}
                              color={ct.isActive ? "#047857" : c.textMuted}
                            />
                            <Text
                              style={[
                                styles.smallBtnText,
                                { color: ct.isActive ? "#047857" : c.textMuted },
                              ]}
                            >
                              {ct.isActive ? "Live" : "Off"}
                            </Text>
                          </Pressable>
                          <Pressable
                            onPress={() => {
                              setCourtDeleteTarget(ct);
                              setCourtDeleteConfirm("");
                              setCourtDeleteError("");
                            }}
                            style={[
                              styles.smallBtn,
                              styles.dangerSmall,
                              {
                                backgroundColor: isDark ? "rgba(239,68,68,0.15)" : "#FEF2F2",
                                borderColor: isDark ? "rgba(248,113,113,0.35)" : "#FCA5A5",
                              },
                            ]}
                          >
                            <Trash2 size={12} color="#DC2626" />
                            <Text style={[styles.smallBtnText, { color: "#DC2626" }]}>Delete</Text>
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  );
                })
              )
            ) : tab === "reviews" ? (
              reviews.length === 0 ? (
                <View style={[styles.inlineEmpty, { backgroundColor: isDark ? "#1E293B" : "#F8FAFC" }]}>
                  <Text style={{ color: c.textMuted, fontSize: fontSize.sm, textAlign: "center" }}>
                    No reviews yet — after players play here, their stars + messages land here! ⭐
                  </Text>
                </View>
              ) : (
                reviews.map((r) => (
                  <View
                    key={r.id}
                    style={[
                      styles.reviewRow,
                      { borderColor: c.border, backgroundColor: isDark ? "#0F172A" : "#F8FAFC" },
                    ]}
                  >
                    <View style={styles.reviewHead}>
                      <Avatar
                        user={{
                          name: r.userName,
                          avatarColor: r.avatarColor,
                          avatarUrl: r.avatarUrl,
                        }}
                      />
                      <View style={styles.grow}>
                        <Text style={[styles.reviewName, { color: c.text }]} numberOfLines={1}>
                          {r.userName}
                        </Text>
                        <Text style={[styles.reviewDate, { color: c.textFaint }]}>
                          {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : ""}
                        </Text>
                      </View>
                      <Stars value={r.rating} size={14} />
                    </View>
                    <Text style={[styles.reviewMsg, { color: c.textMuted }]}>“{r.message}”</Text>
                  </View>
                ))
              )
            ) : (
              <PromoManager
                venue={{ id: active.id, name: active.name }}
                ownerId={user?.id ?? 0}
                samplePrice={active.minPrice || 1500}
              />
            )}
          </View>

          {/* Venue profile facts */}
          <View style={[styles.factsCard, { backgroundColor: c.surface, borderColor: c.border }]}>
            <View style={styles.factsHead}>
              <Text style={[styles.factsTitle, { color: c.textFaint }]}>Venue profile</Text>
              <Pressable onPress={() => openEditVenue(active)} style={styles.editAll}>
                <Pencil size={12} color={colors.orange500} />
                <Text style={styles.editAllText}>Edit all</Text>
              </Pressable>
            </View>
            <Text style={[styles.factsDesc, { color: c.text }]}>
              {active.description || "No description yet."}
            </Text>
            <Text style={[styles.factsMeta, { color: c.textMuted }]}>
              📞 {active.phone || "—"} • 🕐 {active.openingHour}:00 – {active.closingHour}:00 • 📍{" "}
              {active.city}
            </Text>
            <View style={styles.payRow}>
              <View style={styles.payLabel}>
                <Wallet size={14} color={c.textFaint} />
                <Text style={[styles.payLabelText, { color: c.textFaint }]}>You accept:</Text>
              </View>
              {(String(active.acceptedPayments ?? "")
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean).length > 0
                ? String(active.acceptedPayments ?? "")
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                : [...PAYMENT_OPTIONS]
              ).map((m) => (
                <View key={m} style={[styles.payChip, { backgroundColor: "rgba(16,185,129,0.15)" }]}>
                  <Text style={[styles.payChipText, { color: "#047857" }]}>💳 {m}</Text>
                </View>
              ))}
            </View>
            <View style={styles.depositRow}>
              <ShieldCheck size={14} color={colors.amber400} />
              <Text style={[styles.depositText, { color: c.textMuted }]}>
                {Number(active.depositPercent ?? 30) <= 0
                  ? "Fair-play deposit OFF — risky players book like everyone else"
                  : `Fair-play deposit ${active.depositPercent}% upfront (non-refundable) for low-trust players`}
              </Text>
            </View>
            <View style={styles.amenityRow}>
              {String(active.amenities ?? "")
                .split(",")
                .map((a) => a.trim())
                .filter(Boolean)
                .map((a) => (
                  <View key={a} style={[styles.amenityChip, { backgroundColor: isDark ? "#1E293B" : "#F1F5F9" }]}>
                    <Text style={[styles.amenityText, { color: c.textMuted }]}>✓ {a}</Text>
                  </View>
                ))}
            </View>
          </View>
        </View>
      ) : null}
      </View>

      <AddVenueModal
        visible={showAdd}
        onClose={() => {
          setShowAdd(false);
          setAddError("");
        }}
        onSave={() => void addVenue()}
        saving={saving}
        error={addError}
        fName={fName}
        setFName={(t) => {
          setFName(t);
          setAddError("");
        }}
        fAddr={fAddr}
        setFAddr={(t) => {
          setFAddr(t);
          setAddError("");
        }}
        fCity={fCity}
        setFCity={setFCity}
        fPhone={fPhone}
        setFPhone={(t) => {
          setFPhone(t);
          setAddError("");
        }}
        fDesc={fDesc}
        setFDesc={(t) => {
          setFDesc(t);
          setAddError("");
        }}
        fImage={fImage}
        setFImage={setFImage}
        fOpen={fOpen}
        setFOpen={setFOpen}
        fClose={fClose}
        setFClose={setFClose}
        fAmen={fAmen}
        setFAmen={setFAmen}
        fPrice={fPrice}
        setFPrice={setFPrice}
        fPay={fPay}
        setFPay={setFPay}
        fDeposit={fDeposit}
        setFDeposit={setFDeposit}
        fExtraFee={fExtraFee}
        setFExtraFee={setFExtraFee}
        fExtraNote={fExtraNote}
        setFExtraNote={setFExtraNote}
        toggle={toggle}
        inputStyle={inputStyle}
      />

      {/* EDIT VENUE */}
      <Modal
        visible={showEditVenue && !!eVenue}
        transparent
        animationType="fade"
        onRequestClose={() => setShowEditVenue(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: c.surface }]}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={[styles.modalTitle, { color: c.text }]}>
                Edit {eVenue?.name} ✏️
              </Text>
              <Text style={[styles.modalSub, { color: c.textMuted }]}>
                Change anything — players see updates instantly.
              </Text>

              <FieldLabel>Venue name</FieldLabel>
              <TextInput value={eName} onChangeText={setEName} maxLength={80} style={inputStyle} />

              <FieldLabel>Address</FieldLabel>
              <TextInput value={eAddr} onChangeText={setEAddr} maxLength={200} style={inputStyle} />

              <FieldLabel>City</FieldLabel>
              <View style={[styles.pickerWrap, { borderColor: c.border, backgroundColor: isDark ? "#0F172A" : "#FFFFFF" }]}>
                <Picker
                  selectedValue={eCity}
                  onValueChange={(v) => setECity(String(v))}
                  style={{ color: c.text, height: 44 }}
                  dropdownIconColor={c.textMuted}
                >
                  {CITY_LIST.map((city) => (
                    <Picker.Item key={city} label={city} value={city} />
                  ))}
                </Picker>
              </View>

              <FieldLabel>Phone</FieldLabel>
              <TextInput value={ePhone} onChangeText={setEPhone} maxLength={20} style={inputStyle} />

              <FieldLabel>About</FieldLabel>
              <TextInput
                value={eDesc}
                onChangeText={setEDesc}
                multiline
                maxLength={1000}
                style={[inputStyle, styles.textArea]}
              />

              <FieldLabel>Cover photo 📸</FieldLabel>
              <ImagePicker value={eImage} onChange={setEImage} label="Cover photo 📸" />

              <View style={styles.twoCol}>
                <View style={styles.grow}>
                  <FieldLabel>Opens at</FieldLabel>
                  <TextInput
                    value={String(eOpen)}
                    onChangeText={(t) => setEOpen(Number(t.replace(/[^0-9]/g, "") || 0))}
                    keyboardType="numeric"
                    style={inputStyle}
                  />
                </View>
                <View style={styles.grow}>
                  <FieldLabel>Closes at</FieldLabel>
                  <TextInput
                    value={String(eClose)}
                    onChangeText={(t) => setEClose(Number(t.replace(/[^0-9]/g, "") || 1))}
                    keyboardType="numeric"
                    style={inputStyle}
                  />
                </View>
              </View>

              <FieldLabel>Facilities ✨</FieldLabel>
              <ChipPicker
                options={AMENITY_OPTIONS}
                selected={eAmen}
                onToggle={(v) => toggle(eAmen, v, setEAmen)}
                allowCustom
                customLabel="Add custom feature"
              />

              <FieldLabel>Accepted payments 💳 (players only see these)</FieldLabel>
              <ChipPicker
                options={PAYMENT_OPTIONS}
                selected={ePay}
                onToggle={(v) => toggle(ePay, v, setEPay)}
              />
              <Text style={[styles.hint, { color: c.textFaint }]}>
                Cash-only? eSewa-only? Your call — pick at least one.
              </Text>

              <FieldLabel>
                Fair-play deposit for risky players 🛡️ — {eDeposit}% {eDeposit <= 0 ? "(OFF)" : ""}
              </FieldLabel>
              <Slider
                minimumValue={0}
                maximumValue={100}
                step={5}
                value={eDeposit}
                onValueChange={(v) => setEDeposit(Math.round(v))}
                minimumTrackTintColor={isDark ? "#FFFFFF" : "#0F172A"}
                maximumTrackTintColor={isDark ? "#334155" : "#CBD5E1"}
              />
              <Text style={[styles.hint, { color: c.textFaint }]}>
                {eDeposit <= 0
                  ? "Deposits off — everyone books the same way."
                  : `Low-trust players pay ${eDeposit}% upfront, non-refundable if they cancel. Honest players earn trust back fast! 💪`}
              </Text>

              <View style={styles.twoCol}>
                <View style={styles.grow}>
                  <FieldLabel>Usual extra fee 🧾</FieldLabel>
                  <TextInput
                    value={String(eExtraFee)}
                    onChangeText={(t) => setEExtraFee(Number(t.replace(/[^0-9]/g, "") || 0))}
                    keyboardType="numeric"
                    style={inputStyle}
                  />
                </View>
                <View style={styles.grow}>
                  <FieldLabel>What it&apos;s for</FieldLabel>
                  <TextInput
                    value={eExtraNote}
                    onChangeText={setEExtraNote}
                    placeholder="Water and refreshments"
                    placeholderTextColor={c.textFaint}
                    maxLength={120}
                    style={inputStyle}
                  />
                </View>
              </View>
              <Text style={[styles.hint, { color: c.textFaint }]}>
                {eExtraFee > 0
                  ? `The payment desk prefills ${formatNPR(eExtraFee)}${eExtraNote ? ` for "${eExtraNote}"` : ""} — still editable per booking.`
                  : "No default add-on — the payment desk starts the extra-charge line blank."}
              </Text>

              {editError ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{editError}</Text>
                </View>
              ) : null}

              <View style={styles.modalActions}>
                <Pressable
                  onPress={() => {
                    setShowEditVenue(false);
                    setEditError("");
                  }}
                  style={[styles.modalBtn, { borderColor: c.border }]}
                >
                  <Text style={[styles.modalBtnText, { color: c.textMuted }]}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => void saveVenue()}
                  disabled={savingVenue}
                  style={[styles.modalBtn, styles.modalBtnPrimary, { opacity: savingVenue ? 0.4 : 1 }]}
                >
                  <Text style={[styles.modalBtnText, { color: "#FFFFFF" }]}>
                    {savingVenue ? "Saving…" : "Save changes ✨"}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ADD / EDIT COURT */}
      <Modal
        visible={showCourt && !!active}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCourt(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: c.surface }]}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={[styles.modalTitle, { color: c.text }]}>
                {editingCourt ? `Edit ${editingCourt.name} ✏️` : "Add a court ⚽"}
              </Text>
              <Text style={[styles.modalSub, { color: c.textMuted }]}>at {active?.name}</Text>

              <FieldLabel>Court name *</FieldLabel>
              <TextInput
                value={cName}
                onChangeText={setCName}
                placeholder="e.g. Arena A — Pro Turf"
                placeholderTextColor={c.textFaint}
                maxLength={60}
                style={inputStyle}
              />

              <View style={styles.twoCol}>
                <View style={styles.grow}>
                  <FieldLabel>Format</FieldLabel>
                  <View style={[styles.pickerWrap, { borderColor: c.border, backgroundColor: isDark ? "#0F172A" : "#FFFFFF" }]}>
                    <Picker
                      selectedValue={cFormat}
                      onValueChange={(v) => setCFormat(String(v))}
                      style={{ color: c.text, height: 44 }}
                      dropdownIconColor={c.textMuted}
                    >
                      {FORMATS.map((f) => (
                        <Picker.Item key={f} label={f} value={f} />
                      ))}
                    </Picker>
                  </View>
                </View>
                <View style={styles.grow}>
                  <FieldLabel>Surface</FieldLabel>
                  <View style={[styles.pickerWrap, { borderColor: c.border, backgroundColor: isDark ? "#0F172A" : "#FFFFFF" }]}>
                    <Picker
                      selectedValue={cSurface}
                      onValueChange={(v) => setCSurface(String(v))}
                      style={{ color: c.text, height: 44 }}
                      dropdownIconColor={c.textMuted}
                    >
                      {SURFACES.map((s) => (
                        <Picker.Item key={s} label={s} value={s} />
                      ))}
                    </Picker>
                  </View>
                </View>
              </View>

              <View style={styles.twoCol}>
                <View style={styles.grow}>
                  <FieldLabel>Price / hour (Rs.) 💰</FieldLabel>
                  <TextInput
                    value={String(cPrice)}
                    onChangeText={(t) => setCPrice(Number(t.replace(/[^0-9]/g, "") || 0))}
                    keyboardType="numeric"
                    style={inputStyle}
                  />
                </View>
                <View style={styles.grow}>
                  <FieldLabel>☀️ Morning price</FieldLabel>
                  <TextInput
                    value={String(cMorning)}
                    onChangeText={(t) => setCMorning(Number(t.replace(/[^0-9]/g, "") || 0))}
                    keyboardType="numeric"
                    style={inputStyle}
                  />
                </View>
              </View>

              <FieldLabel>Court photo 📸</FieldLabel>
              <ImagePicker value={cImage} onChange={setCImage} label="Court photo 📸" />

              <FieldLabel>Included facilities ✨</FieldLabel>
              <ChipPicker
                options={FEATURE_OPTIONS}
                selected={cFeat}
                onToggle={(v) => toggle(cFeat, v, setCFeat)}
                allowCustom
                customLabel="Add custom feature"
              />

              {courtError ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{courtError}</Text>
                </View>
              ) : null}

              <View style={styles.modalActions}>
                <Pressable
                  onPress={() => {
                    setShowCourt(false);
                    setCourtError("");
                  }}
                  style={[styles.modalBtn, { borderColor: c.border }]}
                >
                  <Text style={[styles.modalBtnText, { color: c.textMuted }]}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => void saveCourt()}
                  disabled={savingCourt}
                  style={[styles.modalBtn, styles.modalBtnPrimary, { opacity: savingCourt ? 0.4 : 1 }]}
                >
                  <Text style={[styles.modalBtnText, { color: "#FFFFFF" }]}>
                    {savingCourt ? "Saving…" : editingCourt ? "Save court ✨" : "Add court ⚽"}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Retire venue */}
      <Modal visible={!!deleteTarget} transparent animationType="fade" onRequestClose={() => setDeleteTarget(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: c.surface, maxWidth: 400 }]}>
            <View style={styles.titleRow}>
              <Trash2 size={18} color="#DC2626" />
              <Text style={[styles.modalTitle, { color: "#DC2626", flex: 0 }]}>
                Retire {deleteTarget?.name}?
              </Text>
            </View>
            <Text style={[styles.modalSub, { color: c.textMuted }]}>
              The venue leaves every listing and its courts stop taking bookings. Past bookings,
              payments and reviews stay exactly where they are — nothing is erased.
            </Text>
            <View style={styles.warnBox}>
              <Text style={styles.warnText}>
                This can&apos;t be undone from the studio. If any player still has a game to come,
                you&apos;ll be asked to cancel or play those first.
              </Text>
            </View>
            <FieldLabel>
              Type <Text style={{ color: c.text }}>{deleteTarget?.name}</Text> to confirm
            </FieldLabel>
            <TextInput
              value={deleteConfirm}
              onChangeText={setDeleteConfirm}
              placeholder={deleteTarget?.name}
              placeholderTextColor={c.textFaint}
              style={inputStyle}
            />
            {deleteError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{deleteError}</Text>
              </View>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => {
                  setDeleteTarget(null);
                  setDeleteConfirm("");
                  setDeleteError("");
                }}
                disabled={deleting}
                style={[styles.modalBtn, { borderColor: c.border }]}
              >
                <Text style={[styles.modalBtnText, { color: c.textMuted }]}>Keep it</Text>
              </Pressable>
              <Pressable
                onPress={() => void confirmDeleteVenue()}
                disabled={deleting || deleteConfirm.trim() !== deleteTarget?.name}
                style={[
                  styles.modalBtn,
                  styles.dangerBtn,
                  { opacity: deleting || deleteConfirm.trim() !== deleteTarget?.name ? 0.4 : 1 },
                ]}
              >
                {deleting ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
                <Text style={[styles.modalBtnText, { color: "#FFFFFF" }]}>
                  {deleting ? "Retiring…" : "Delete venue"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Retire court */}
      <Modal
        visible={!!courtDeleteTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setCourtDeleteTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: c.surface, maxWidth: 400 }]}>
            <View style={styles.titleRow}>
              <Trash2 size={18} color="#DC2626" />
              <Text style={[styles.modalTitle, { color: "#DC2626", flex: 0 }]}>
                Retire {courtDeleteTarget?.name}?
              </Text>
            </View>
            <Text style={[styles.modalSub, { color: c.textMuted }]}>
              The court comes off the booking page and stops counting towards this venue. Past
              bookings, payments and reviews against it stay exactly where they are — nothing is
              erased.
            </Text>
            <View style={styles.warnBox}>
              <Text style={styles.warnText}>
                This can&apos;t be undone from the studio. If a player still has a game booked on
                this pitch, you&apos;ll be asked to cancel or play it first.
              </Text>
            </View>
            <FieldLabel>
              Type <Text style={{ color: c.text }}>{courtDeleteTarget?.name}</Text> to confirm
            </FieldLabel>
            <TextInput
              value={courtDeleteConfirm}
              onChangeText={setCourtDeleteConfirm}
              placeholder={courtDeleteTarget?.name}
              placeholderTextColor={c.textFaint}
              style={inputStyle}
            />
            {courtDeleteError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{courtDeleteError}</Text>
              </View>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => {
                  setCourtDeleteTarget(null);
                  setCourtDeleteConfirm("");
                  setCourtDeleteError("");
                }}
                disabled={deletingCourt}
                style={[styles.modalBtn, { borderColor: c.border }]}
              >
                <Text style={[styles.modalBtnText, { color: c.textMuted }]}>Keep it</Text>
              </Pressable>
              <Pressable
                onPress={() => void confirmDeleteCourt()}
                disabled={deletingCourt || courtDeleteConfirm.trim() !== courtDeleteTarget?.name}
                style={[
                  styles.modalBtn,
                  styles.dangerBtn,
                  {
                    opacity:
                      deletingCourt || courtDeleteConfirm.trim() !== courtDeleteTarget?.name
                        ? 0.4
                        : 1,
                  },
                ]}
              >
                {deletingCourt ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
                <Text style={[styles.modalBtnText, { color: "#FFFFFF" }]}>
                  {deletingCourt ? "Retiring…" : "Delete court"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

/** Shared Modal form for listing a new venue (all fields from the start). */
function AddVenueModal(props: {
  visible: boolean;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  error: string;
  fName: string;
  setFName: (t: string) => void;
  fAddr: string;
  setFAddr: (t: string) => void;
  fCity: string;
  setFCity: (t: string) => void;
  fPhone: string;
  setFPhone: (t: string) => void;
  fDesc: string;
  setFDesc: (t: string) => void;
  fImage: string;
  setFImage: (t: string) => void;
  fOpen: number;
  setFOpen: (n: number) => void;
  fClose: number;
  setFClose: (n: number) => void;
  fAmen: string[];
  setFAmen: (x: string[]) => void;
  fPrice: number;
  setFPrice: (n: number) => void;
  fPay: string[];
  setFPay: (x: string[]) => void;
  fDeposit: number;
  setFDeposit: (n: number) => void;
  fExtraFee: number;
  setFExtraFee: (n: number) => void;
  fExtraNote: string;
  setFExtraNote: (t: string) => void;
  toggle: (list: string[], v: string, set: (x: string[]) => void) => void;
  inputStyle: ReturnType<typeof StyleSheet.create>[string] | Array<
    ReturnType<typeof StyleSheet.create>[string] | object
  >;
}) {
  const { colors: c, isDark } = useTheme();
  const {
    visible,
    onClose,
    onSave,
    saving,
    error,
    fName,
    setFName,
    fAddr,
    setFAddr,
    fCity,
    setFCity,
    fPhone,
    setFPhone,
    fDesc,
    setFDesc,
    fImage,
    setFImage,
    fOpen,
    setFOpen,
    fClose,
    setFClose,
    fAmen,
    setFAmen,
    fPrice,
    setFPrice,
    fPay,
    setFPay,
    fDeposit,
    setFDeposit,
    fExtraFee,
    setFExtraFee,
    fExtraNote,
    setFExtraNote,
    toggle,
    inputStyle,
  } = props;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { backgroundColor: c.surface }]}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={[styles.modalTitle, { color: c.text }]}>List your futsal 🏟️</Text>
            <Text style={[styles.modalSub, { color: c.textMuted }]}>
              Photos, facilities, hours, prices — set it all up now, tweak anytime later.
            </Text>

            <FieldLabel>Venue name *</FieldLabel>
            <TextInput
              value={fName}
              onChangeText={setFName}
              placeholder="e.g. Sunshine Futsal"
              placeholderTextColor={c.textFaint}
              maxLength={80}
              style={inputStyle as never}
            />

            <FieldLabel>Address *</FieldLabel>
            <TextInput
              value={fAddr}
              onChangeText={setFAddr}
              placeholder="e.g. Baneshwor, Kathmandu"
              placeholderTextColor={c.textFaint}
              maxLength={200}
              style={inputStyle as never}
            />

            <FieldLabel>City</FieldLabel>
            <View style={[styles.pickerWrap, { borderColor: c.border, backgroundColor: isDark ? "#0F172A" : "#FFFFFF" }]}>
              <Picker
                selectedValue={fCity}
                onValueChange={(v) => setFCity(String(v))}
                style={{ color: c.text, height: 44 }}
                dropdownIconColor={c.textMuted}
              >
                {CITY_LIST.map((city) => (
                  <Picker.Item key={city} label={city} value={city} />
                ))}
              </Picker>
            </View>

            <FieldLabel>Phone</FieldLabel>
            <TextInput
              value={fPhone}
              onChangeText={setFPhone}
              placeholder="01-XXXXXXX"
              placeholderTextColor={c.textFaint}
              maxLength={20}
              style={inputStyle as never}
            />

            <FieldLabel>About your place 💛</FieldLabel>
            <TextInput
              value={fDesc}
              onChangeText={setFDesc}
              placeholder="Great turf, friendly staff, momos nearby…"
              placeholderTextColor={c.textFaint}
              multiline
              maxLength={1000}
              style={[inputStyle as never, styles.textArea]}
            />

            <FieldLabel>Cover photo 📸</FieldLabel>
            <ImagePicker value={fImage} onChange={setFImage} label="Cover photo 📸" />

            <View style={styles.twoCol}>
              <View style={styles.grow}>
                <FieldLabel>Opens at</FieldLabel>
                <TextInput
                  value={String(fOpen)}
                  onChangeText={(t) => setFOpen(Number(t.replace(/[^0-9]/g, "") || 0))}
                  keyboardType="numeric"
                  style={inputStyle as never}
                />
              </View>
              <View style={styles.grow}>
                <FieldLabel>Closes at</FieldLabel>
                <TextInput
                  value={String(fClose)}
                  onChangeText={(t) => setFClose(Number(t.replace(/[^0-9]/g, "") || 1))}
                  keyboardType="numeric"
                  style={inputStyle as never}
                />
              </View>
            </View>

            <FieldLabel>Facilities ✨</FieldLabel>
            <ChipPicker
              options={AMENITY_OPTIONS}
              selected={fAmen}
              onToggle={(v) => toggle(fAmen, v, setFAmen)}
              allowCustom
              customLabel="Add custom feature"
            />

            <FieldLabel>Accepted payments 💳 (players only see these)</FieldLabel>
            <ChipPicker
              options={PAYMENT_OPTIONS}
              selected={fPay}
              onToggle={(v) => toggle(fPay, v, setFPay)}
            />
            <Text style={[styles.hint, { color: c.textFaint }]}>
              Cash-only? eSewa-only? Your call — pick at least one. Low-trust deposits need an
              online option to be enforceable.
            </Text>

            <FieldLabel>
              Fair-play deposit for risky players 🛡️ — {fDeposit}% {fDeposit <= 0 ? "(OFF)" : ""}
            </FieldLabel>
            <Slider
              minimumValue={0}
              maximumValue={100}
              step={5}
              value={fDeposit}
              onValueChange={(v) => setFDeposit(Math.round(v))}
              minimumTrackTintColor={isDark ? "#FFFFFF" : "#0F172A"}
              maximumTrackTintColor={isDark ? "#334155" : "#CBD5E1"}
            />
            <Text style={[styles.hint, { color: c.textFaint }]}>
              {fDeposit <= 0
                ? "Deposits off — everyone books the same way."
                : `Players with low stars / repeat cancels pay ${fDeposit}% upfront (non-refundable). They get it back in trust when they show up! 💪`}
            </Text>

            <View style={styles.twoCol}>
              <View style={styles.grow}>
                <FieldLabel>Usual extra fee 🧾 (Rs.)</FieldLabel>
                <TextInput
                  value={String(fExtraFee)}
                  onChangeText={(t) => setFExtraFee(Number(t.replace(/[^0-9]/g, "") || 0))}
                  keyboardType="numeric"
                  style={inputStyle as never}
                />
              </View>
              <View style={styles.grow}>
                <FieldLabel>What it&apos;s for</FieldLabel>
                <TextInput
                  value={fExtraNote}
                  onChangeText={setFExtraNote}
                  placeholder="Water and refreshments"
                  placeholderTextColor={c.textFaint}
                  maxLength={120}
                  style={inputStyle as never}
                />
              </View>
            </View>
            <Text style={[styles.hint, { color: c.textFaint }]}>
              Prefills the extra-charge line on the payment desk — the water and spare balls bought
              during a match, added on top of the court fee. Leave it at 0 if you don&apos;t
              usually add anything.
            </Text>

            <FieldLabel>Starting price per hour (Rs.)</FieldLabel>
            <TextInput
              value={String(fPrice)}
              onChangeText={(t) => setFPrice(Number(t.replace(/[^0-9]/g, "") || 0))}
              keyboardType="numeric"
              style={inputStyle as never}
            />

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.modalActions}>
              <Pressable onPress={onClose} style={[styles.modalBtn, { borderColor: c.border }]}>
                <Text style={[styles.modalBtnText, { color: c.textMuted }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={onSave}
                disabled={saving}
                style={[styles.modalBtn, styles.modalBtnPrimary, { opacity: saving ? 0.4 : 1 }]}
              >
                <Text style={[styles.modalBtnText, { color: "#FFFFFF" }]}>
                  {saving ? "Listing…" : "List my futsal 🎉"}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: space[4], paddingBottom: space[16], gap: space[3] },
  headRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: space[3],
  },
  grow: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  h1: { fontSize: fontSize["2xl"], fontWeight: "900" },
  sub: { fontSize: fontSize.sm, marginTop: space[1] },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    borderRadius: radius.xl,
    backgroundColor: "#0F172A",
    paddingHorizontal: space[5],
    paddingVertical: space[2.5],
    minHeight: 44,
  },
  inlineBtn: { alignSelf: "flex-start" },
  primaryBtnText: { color: "#FFFFFF", fontSize: fontSize.sm, fontWeight: "900" },
  emptyCard: {
    borderRadius: radius["3xl"],
    borderWidth: 1,
    borderStyle: "dashed",
    padding: space[10],
    alignItems: "center",
    marginTop: space[4],
    gap: space[2],
  },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: "800" },
  emptyBody: { fontSize: fontSize.sm, textAlign: "center" },
  venueLayout: { gap: space[4] },
  venueLayoutWide: { flexDirection: "row", alignItems: "flex-start" },
  rail: { borderRadius: radius["2xl"], borderWidth: 1, padding: space[3], gap: space[2] },
  railWide: { width: 300, flexShrink: 0 },
  railItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: space[2.5],
  },
  railImg: { width: 48, height: 48, borderRadius: radius.lg },
  railName: { fontSize: fontSize.sm, fontWeight: "800" },
  railMeta: { fontSize: 11, fontWeight: "600", marginTop: 1 },
  detail: { flexGrow: 1, minWidth: 0, gap: space[4] },
  hero: {
    borderRadius: radius["2xl"],
    borderWidth: 1,
    overflow: "hidden",
    minHeight: 176,
    justifyContent: "flex-end",
  },
  heroImg: { ...StyleSheet.absoluteFill, width: "100%", height: "100%" },
  heroOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(15,23,42,0.55)",
  },
  heroBottom: {
    padding: space[4],
    gap: space[3],
    backgroundColor: "rgba(15,23,42,0.35)",
  },
  heroTitle: { fontSize: fontSize.xl, fontWeight: "900", color: "#FFFFFF" },
  heroMetaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4, marginTop: 2 },
  heroMeta: { fontSize: fontSize.xs, fontWeight: "600", color: "#E2E8F0" },
  heroActions: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  editHeroBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.xl,
    backgroundColor: colors.amber400,
    paddingHorizontal: space[3.5],
    paddingVertical: space[2],
    minHeight: 36,
  },
  editHeroText: { fontSize: fontSize.xs, fontWeight: "900", color: "#78350F" },
  addCourtBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.xl,
    backgroundColor: "rgba(255,255,255,0.9)",
    paddingHorizontal: space[3.5],
    paddingVertical: space[2],
    minHeight: 36,
  },
  addCourtText: { fontSize: fontSize.xs, fontWeight: "900" },
  retireBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: "#FCA5A5",
    backgroundColor: "rgba(254,242,242,0.9)",
    paddingHorizontal: space[3.5],
    paddingVertical: space[2],
    minHeight: 36,
  },
  retireText: { fontSize: fontSize.xs, fontWeight: "900", color: "#DC2626" },
  tabBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[1.5],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    padding: space[2],
  },
  tabBtn: { borderRadius: radius.lg, paddingHorizontal: space[3.5], paddingVertical: space[2] },
  tabText: { fontSize: fontSize.xs, fontWeight: "900", textTransform: "uppercase" },
  tabBody: {
    borderRadius: radius["2xl"],
    borderWidth: 1,
    padding: space[4],
    gap: space[2.5],
  },
  inlineEmpty: { borderRadius: radius.xl, padding: space[6], gap: 4 },
  courtRow: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: space[3],
    gap: space[2.5],
  },
  courtMain: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[3] },
  courtImg: { width: 80, height: 56, borderRadius: radius.lg },
  courtName: { fontSize: fontSize.sm, fontWeight: "800" },
  courtMeta: { fontSize: 11, fontWeight: "600", marginTop: 1 },
  courtFeat: { fontSize: 11, marginTop: 2 },
  courtActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[1.5] },
  courtActionGroup: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[1.5] },
  priceEdit: { flexDirection: "row", alignItems: "center", gap: 4 },
  priceUnit: { fontSize: 11, fontWeight: "700" },
  priceInput: {
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: space[2.5],
    paddingVertical: space[1.5],
    fontSize: fontSize.sm,
    fontWeight: "900",
    minWidth: 88,
    minHeight: 36,
  },
  savePriceBtn: {
    borderRadius: radius.lg,
    backgroundColor: colors.emerald600,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    minHeight: 36,
    justifyContent: "center",
  },
  savePriceText: { color: "#FFFFFF", fontSize: fontSize.xs, fontWeight: "900" },
  smallBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.lg,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    minHeight: 36,
  },
  smallBtnText: { fontSize: fontSize.xs, fontWeight: "900" },
  dangerSmall: {
    borderWidth: 1,
    borderColor: "#FCA5A5",
    backgroundColor: "#FEF2F2",
  },
  reviewRow: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: space[3.5],
    gap: space[2],
  },
  reviewHead: { flexDirection: "row", alignItems: "center", gap: space[2.5] },
  reviewName: { fontSize: fontSize.sm, fontWeight: "800" },
  reviewDate: { fontSize: 11 },
  reviewMsg: { fontSize: 13, lineHeight: 19 },
  factsCard: {
    borderRadius: radius["2xl"],
    borderWidth: 1,
    padding: space[4],
    gap: space[2],
  },
  factsHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  factsTitle: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },
  editAll: { flexDirection: "row", alignItems: "center", gap: 4 },
  editAllText: { fontSize: fontSize.xs, fontWeight: "900", color: colors.orange500 },
  factsDesc: { fontSize: fontSize.sm, lineHeight: 20 },
  factsMeta: { fontSize: fontSize.xs, fontWeight: "600" },
  payRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[1.5] },
  payLabel: { flexDirection: "row", alignItems: "center", gap: 4 },
  payLabelText: { fontSize: 11, fontWeight: "900" },
  payChip: {
    borderRadius: radius.full,
    paddingHorizontal: space[2.5],
    paddingVertical: space[1],
  },
  payChipText: { fontSize: 11, fontWeight: "700" },
  depositRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  depositText: { flex: 1, fontSize: 11, fontWeight: "700", lineHeight: 16 },
  amenityRow: { flexDirection: "row", flexWrap: "wrap", gap: space[1.5] },
  amenityChip: {
    borderRadius: radius.full,
    paddingHorizontal: space[2.5],
    paddingVertical: space[1],
  },
  amenityText: { fontSize: 11, fontWeight: "700" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.55)",
    alignItems: "center",
    padding: space[4],
  },
  modalCard: {
    width: "100%",
    maxWidth: 520,
    maxHeight: "86%",
    borderRadius: radius["3xl"],
    padding: space[6],
    marginVertical: space[6],
    gap: space[2],
  },
  modalTitle: { fontSize: fontSize.lg, fontWeight: "900" },
  modalSub: { fontSize: fontSize.xs, lineHeight: 17 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: "#64748B",
    marginTop: space[2],
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: space[3.5],
    paddingVertical: space[2.5],
    fontSize: fontSize.sm,
    fontWeight: "600",
    minHeight: 44,
  },
  textArea: { minHeight: 72, textAlignVertical: "top" },
  twoCol: { flexDirection: "row", gap: space[3] },
  pickerWrap: { borderWidth: 1, borderRadius: radius.xl, overflow: "hidden", marginTop: 2 },
  chipPicker: { flexDirection: "row", flexWrap: "wrap", gap: space[1.5] },
  customChipRow: { width: "100%", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2], marginTop: space[1] },
  customChipInput: { flexGrow: 1, flexBasis: 150, minHeight: 40, borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: space[3], paddingVertical: space[2], fontSize: 12, fontWeight: "600" },
  customChipButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, minHeight: 40, borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: space[3], paddingVertical: space[2] },
  customChipButtonText: { fontSize: 11, fontWeight: "900" },
  pickChip: {
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: space[3],
    paddingVertical: space[1.5],
    minHeight: 32,
    justifyContent: "center",
  },
  pickChipText: { fontSize: 11, fontWeight: "900" },
  hint: { fontSize: 11, lineHeight: 16, marginTop: space[1] },
  errorBox: {
    borderRadius: radius.xl,
    backgroundColor: "rgba(239,68,68,0.1)",
    padding: space[3],
    marginTop: space[2],
  },
  errorText: { fontSize: 12, fontWeight: "700", color: "#DC2626" },
  warnBox: {
    borderRadius: radius.xl,
    backgroundColor: "rgba(239,68,68,0.1)",
    padding: space[3],
    marginTop: space[2],
  },
  warnText: { fontSize: 11, fontWeight: "700", color: "#DC2626", lineHeight: 16 },
  modalActions: { flexDirection: "row", gap: space[2], marginTop: space[4] },
  modalBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingVertical: space[3],
    minHeight: 44,
  },
  modalBtnPrimary: { backgroundColor: "#0F172A", borderColor: "#0F172A" },
  dangerBtn: { backgroundColor: "#DC2626", borderColor: "#DC2626" },
  modalBtnText: { fontSize: fontSize.sm, fontWeight: "900" },
});
