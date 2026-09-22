"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, Plus, Power, Star, MapPin, Pencil, MessageCircleHeart, Wallet, ShieldCheck, Trash2, Loader2 } from "lucide-react";
import { useUser } from "@/components/UserProvider";
import { OwnerGuard } from "@/components/OwnerGuard";
import { ImagePicker } from "@/components/ImagePicker";
import { PromoManager } from "@/components/PromoManager";
import { Stars } from "@/components/Reviews";
import { Avatar } from "@/components/Avatar";
import { formatNPR } from "@/lib/futsal";
import { PAYMENT_OPTIONS } from "@/lib/loyalty";
import { validateVenueName, validateAddress, validatePhone, validateDescription, validateHoursRange, validateCourtName, validateMoney, validatePaymentMethods, validateDepositPercent, firstError } from "@/lib/validation";

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
  rating: number;
  totalReviews: number;
  openingHour: number;
  closingHour: number;
  amenities: string;
  acceptedPayments: string;
  depositPercent: number;
  ownerId: number | null;
  imageUrl: string;
  courts: Court[];
  courtCount: number;
  minPrice: number;
};

type Review = {
  id: number;
  rating: number;
  message: string;
  createdAt: string | null;
  userName: string;
  avatarColor: string;
  avatarUrl?: string;
};

const AMENITY_OPTIONS = [
  "Parking", "Changing Room", "Shower", "WiFi", "Cafeteria", "First Aid",
  "Locker", "Live Scoreboard", "Music System", "Rooftop View", "Kids Zone",
  "Equipment Rental", "Gym", "Physio", "Night Lights",
];

const FEATURE_OPTIONS = [
  "Floodlights", "FIFA Turf", "Nets Provided", "Match Balls",
  "Drinking Water", "Referee Available", "Video Recording", "Heated Floor",
];

const SURFACES = ["Artificial Turf", "FIFA Artificial Turf", "Futsal Mat", "Grass Hybrid", "Indoor Court"];
const FORMATS = ["5v5", "6v6", "7v7", "8v8"];

function ChipPicker({
  options,
  selected,
  onToggle,
}: {
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o);
        return (
          <button
            key={o}
            type="button"
            onClick={() => onToggle(o)}
            className={`rounded-full px-3 py-1.5 text-[11px] font-black transition ${
              on
                ? "bg-emerald-600 text-white shadow"
                : "border border-slate-200 text-slate-500 hover:border-emerald-300 dark:border-slate-700 dark:text-slate-400"
            }`}
          >
            {on ? "✓ " : ""}{o}
          </button>
        );
      })}
    </div>
  );
}

export default function OwnerVenuesPage() {
  const { user } = useUser();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [tab, setTab] = useState<"courts" | "reviews" | "promos">("courts");
  const [reviews, setReviews] = useState<Review[]>([]);

  // Add venue (full details from the start)
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
  const [savingVenue, setSavingVenue] = useState(false);
  const [editError, setEditError] = useState("");

  // Retiring a venue is one-way from the studio, so it asks for the name back.
  const [deleteTarget, setDeleteTarget] = useState<Venue | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // Same treatment for a single court — a pitch is easier to retire by accident
  // than a whole venue, so it asks for the court name back too.
  const [courtDeleteTarget, setCourtDeleteTarget] = useState<Court | null>(null);
  const [courtDeleteConfirm, setCourtDeleteConfirm] = useState("");
  const [deletingCourt, setDeletingCourt] = useState(false);
  const [courtDeleteError, setCourtDeleteError] = useState("");

  // Add / edit court (full details)
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

  const load = async () => {
    const res = await fetch("/api/venues");
    const data = await res.json();
    setVenues(data.venues ?? []);
  };

  /** Retire the venue — soft delete, so the history stays. */
  async function confirmDeleteVenue() {
    if (!deleteTarget || !user) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await fetch(`/api/venues/${deleteTarget.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId: user.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data.error ?? "Couldn't retire the venue 🙏"));
      setDeleteTarget(null);
      setDeleteConfirm("");
      await load();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Couldn't retire the venue 🙏");
    } finally {
      setDeleting(false);
    }
  }

  /** Retire one court — soft delete, so the bookings against it stay readable. */
  async function confirmDeleteCourt() {
    if (!courtDeleteTarget || !user) return;
    setDeletingCourt(true);
    setCourtDeleteError("");
    try {
      const res = await fetch(`/api/courts/${courtDeleteTarget.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId: user.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data.error ?? "Couldn't retire that court 🙏"));
      setCourtDeleteTarget(null);
      setCourtDeleteConfirm("");
      await load();
    } catch (e) {
      setCourtDeleteError(e instanceof Error ? e.message : "Couldn't retire that court 🙏");
    } finally {
      setDeletingCourt(false);
    }
  }

  const loadReviews = async (venueId: number) => {
    try {
      const res = await fetch(`/api/reviews?venueId=${venueId}`);
      const data = await res.json();
      setReviews(data.reviews ?? []);
    } catch {}
  };

  useEffect(() => {
    (async () => {
      try {
        await fetch("/api/seed", { method: "POST" });
        await load();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const myVenues = useMemo(
    () => venues.filter((v) => user && v.ownerId === user.id),
    [venues, user]
  );

  useEffect(() => {
    if (selected === null && myVenues.length > 0) setSelected(myVenues[0].id);
  }, [myVenues, selected]);

  const active = myVenues.find((v) => v.id === selected) ?? myVenues[0] ?? null;

  useEffect(() => {
    if (active) loadReviews(active.id);
  }, [active?.id]);

  function toggle(list: string[], v: string, set: (x: string[]) => void) {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  }

  function resetAddForm() {
    setFName(""); setFAddr(""); setFCity("Kathmandu"); setFPhone(user?.phone || "");
    setFDesc(""); setFImage(""); setFOpen(6); setFClose(22);
    setFAmen(["Parking", "Changing Room", "Shower", "WiFi"]); setFPrice(1500);
    setFPay([...PAYMENT_OPTIONS]); setFDeposit(30);
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
      validateDepositPercent(fDeposit)
    );
    if (err) {
      setAddError(err);
      return;
    }
    setAddError("");
    setSaving(true);
    try {
      const res = await fetch("/api/venues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fName.trim(),
          address: fAddr.trim(),
          city: fCity,
          phone: fPhone.trim() || user.phone || "01-0000000",
          description: fDesc.trim() || "A welcoming futsal arena. Great turf, friendly staff, good vibes! ⚽",
          imageUrl: fImage,
          rating: 4.5,
          openingHour: fOpen,
          closingHour: fClose,
          amenities: fAmen.join(","),
          acceptedPayments: fPay.join(","),
          depositPercent: fDeposit,
          ownerId: user.id,
          courts: [
            { name: "Court 1", format: "5v5", pricePerHour: fPrice, priceMorning: Math.round(fPrice * 0.75) },
          ],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't list venue");
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
    setEImage(v.imageUrl);
    setEOpen(v.openingHour);
    setEClose(v.closingHour);
    setEAmen(v.amenities.split(",").map((s) => s.trim()).filter(Boolean));
    const pays = String(v.acceptedPayments ?? "").split(",").map((s) => s.trim()).filter((s) => PAYMENT_OPTIONS.includes(s));
    setEPay(pays.length > 0 ? pays : [...PAYMENT_OPTIONS]);
    setEDeposit(Number.isFinite(Number(v.depositPercent)) ? Number(v.depositPercent) : 30);
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
      validateDepositPercent(eDeposit)
    );
    if (err) {
      setEditError(err);
      return;
    }
    setEditError("");
    setSavingVenue(true);
    try {
      const res = await fetch(`/api/venues/${eVenue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't save");
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
    setCFormat(c.format);
    setCSurface(c.surface);
    setCPrice(c.pricePerHour);
    setCMorning(c.priceMorning);
    setCImage(c.imageUrl);
    setCFeat(c.features.split(",").map((s) => s.trim()).filter(Boolean));
    setShowCourt(true);
  }

  async function saveCourt() {
    if (!active || !user) return;
    const err = firstError(
      validateCourtName(cName),
      validateMoney(cPrice, { min: 100, max: 20000, label: "Price per hour" }),
      validateMoney(cMorning, { min: 100, max: 20000, label: "Morning price" })
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
      let res: Response;
      if (editingCourt) {
        res = await fetch(`/api/courts/${editingCourt.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch("/api/courts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ venueId: active.id, ownerId: user.id, ...payload }),
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save court");
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
      alert(err);
      return;
    }
    await fetch(`/api/courts/${court.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pricePerHour: price,
        priceMorning: Math.round(price * 0.75),
      }),
    });
    setPriceDrafts((p) => {
      const n = { ...p };
      delete n[court.id];
      return n;
    });
    load();
  }

  async function toggleCourt(court: Court) {
    await fetch(`/api/courts/${court.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !court.isActive }),
    });
    load();
  }

  const inputCls =
    "w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-semibold focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:focus:border-white [&>option]:bg-white [&>option]:text-slate-900 dark:[&>option]:bg-slate-900 dark:[&>option]:text-slate-100";
  const labelCls =
    "mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-400 dark:text-slate-500";

  return (
    <OwnerGuard>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
            <Building2 className="h-6 w-6" /> My venues
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Photos, facilities, prices, hours — change anything, anytime. ✨
          </p>
        </div>
        <button
          onClick={() => { resetAddForm(); setShowAdd(true); }}
          className="flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-black text-white transition hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
        >
          <Plus className="h-4 w-4" strokeWidth={3} /> List new venue
        </button>
      </div>

      {loading ? (
        <div className="mt-4 h-64 animate-pulse rounded-2xl bg-white dark:bg-slate-900" />
      ) : myVenues.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center dark:border-slate-700 dark:bg-slate-900">
          <Building2 className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
          <h3 className="mt-3 text-lg font-extrabold">No venues yet</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">List your first arena — photos, facilities, prices, everything!</p>
          <button
            onClick={() => { resetAddForm(); setShowAdd(true); }}
            className="mt-4 rounded-xl bg-slate-900 px-6 py-3 text-sm font-black text-white dark:bg-white dark:text-slate-900"
          >
            + List venue
          </button>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 xl:grid-cols-[300px_1fr]">
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="space-y-2">
              {myVenues.map((v) => (
                <button
                  key={v.id}
                  onClick={() => { setSelected(v.id); setTab("courts"); }}
                  className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition ${
                    active?.id === v.id
                      ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                      : "border-slate-100 bg-slate-50/60 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-800/40 dark:hover:border-slate-600"
                  }`}
                >
                  <img src={v.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-extrabold">{v.name}</span>
                    <span className={`block text-[11px] ${active?.id === v.id ? "text-slate-300 dark:text-slate-500" : "text-slate-500 dark:text-slate-400"}`}>
                      {v.courtCount} courts • from {formatNPR(v.minPrice)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {active && (
            <div className="space-y-4">
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="relative h-44">
                  <img src={active.imageUrl} alt="" className="h-full w-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 to-transparent" />
                  <div className="absolute bottom-3 left-4 right-4 flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <h2 className="text-xl font-black text-white">{active.name}</h2>
                      <p className="flex items-center gap-1 text-xs font-semibold text-slate-200">
                        <MapPin className="h-3 w-3" /> {active.address} •
                        <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> {active.rating.toFixed(1)} ({active.totalReviews})
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => openEditVenue(active)}
                        className="flex items-center gap-1.5 rounded-xl bg-amber-400 px-4 py-2.5 text-xs font-black text-slate-900 transition hover:bg-amber-300"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit profile
                      </button>
                      <button
                        onClick={openAddCourt}
                        className="flex items-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-xs font-black text-slate-900 transition hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                      >
                        <Plus className="h-3.5 w-3.5" strokeWidth={3} /> Add court
                      </button>
                      <button
                        onClick={() => {
                          setDeleteTarget(active);
                          setDeleteConfirm("");
                          setDeleteError("");
                        }}
                        title="Retire this venue"
                        className="flex items-center gap-1.5 rounded-xl border border-red-300 px-4 py-2.5 text-xs font-black text-red-600 transition hover:bg-red-50 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 border-b border-slate-100 px-4 pt-3 dark:border-slate-800">
                  <button
                    onClick={() => setTab("courts")}
                    className={`rounded-t-xl px-4 py-2.5 text-xs font-black uppercase tracking-wide transition ${
                      tab === "courts" ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-400 hover:text-slate-700"
                    }`}
                  >
                    Courts ({active.courts.length})
                  </button>
                  <button
                    onClick={() => setTab("reviews")}
                    className={`rounded-t-xl px-4 py-2.5 text-xs font-black uppercase tracking-wide transition ${
                      tab === "reviews" ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-400 hover:text-slate-700"
                    }`}
                  >
                    Reviews 💬 ({reviews.length})
                  </button>
                  <button
                    onClick={() => setTab("promos")}
                    className={`rounded-t-xl px-4 py-2.5 text-xs font-black uppercase tracking-wide transition ${
                      tab === "promos" ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-400 hover:text-slate-700"
                    }`}
                  >
                    Promos 🎟️
                  </button>
                </div>

                {tab === "courts" ? (
                  <div className="space-y-2.5 p-4">
                    {active.courts.length === 0 && (
                      <div className="rounded-xl bg-slate-50 px-4 py-8 text-center dark:bg-slate-800/60">
                        <p className="text-sm font-bold text-slate-500 dark:text-slate-400">
                          No courts are live right now.
                        </p>
                        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                          Retired courts drop off this list — their past bookings are untouched.
                          Add a court to start taking bookings again. ⚽
                        </p>
                      </div>
                    )}
                    {active.courts.map((c) => (
                      <div
                        key={c.id}
                        className={`rounded-xl border p-3 ${
                          c.isActive
                            ? "border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-800/40"
                            : "border-slate-100 bg-slate-50 opacity-60 dark:border-slate-800 dark:bg-slate-800/60"
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-3">
                          {c.imageUrl && (
                            <img src={c.imageUrl} alt="" className="h-14 w-20 shrink-0 rounded-lg object-cover" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-extrabold">{c.name}</p>
                            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                              {c.format} • {c.surface} • ☀️ morning {formatNPR(c.priceMorning)}
                            </p>
                            <p className="mt-0.5 truncate text-[11px] text-slate-400">
                              ✨ {c.features || "No facilities listed"}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-slate-400">Rs.</span>
                            <input
                              type="number"
                              min={100}
                              step={50}
                              value={priceDrafts[c.id] ?? c.pricePerHour}
                              onChange={(e) => setPriceDrafts((p) => ({ ...p, [c.id]: e.target.value }))}
                              className="w-24 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-black focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                            />
                            <span className="text-[11px] font-bold text-slate-400">/hr</span>
                          </div>
                          {priceDrafts[c.id] !== undefined &&
                            Number(priceDrafts[c.id]) !== c.pricePerHour && (
                              <button
                                onClick={() => savePrice(c)}
                                className="rounded-lg bg-emerald-500 px-3.5 py-2 text-xs font-black text-white"
                              >
                                Save
                              </button>
                            )}
                          <button
                            onClick={() => openEditCourt(c)}
                            title="Edit everything"
                            className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-black text-white dark:bg-white dark:text-slate-900"
                          >
                            <Pencil className="h-3.5 w-3.5" /> Edit
                          </button>
                          <button
                            onClick={() => toggleCourt(c)}
                            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-black transition ${
                              c.isActive
                                ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300"
                                : "bg-slate-200 text-slate-500 hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-400"
                            }`}
                          >
                            <Power className="h-3.5 w-3.5" />
                            {c.isActive ? "Live" : "Off"}
                          </button>
                          <button
                            onClick={() => {
                              setCourtDeleteTarget(c);
                              setCourtDeleteConfirm("");
                              setCourtDeleteError("");
                            }}
                            title="Retire this court"
                            className="flex items-center gap-1.5 rounded-lg border border-red-300 px-3.5 py-2 text-xs font-black text-red-600 transition hover:bg-red-50 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : tab === "reviews" ? (
                  <div className="space-y-2.5 p-4">
                    {reviews.length === 0 ? (
                      <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-400 dark:bg-slate-800/60">
                        No reviews yet — after players play here, their stars + messages land here! ⭐
                      </p>
                    ) : (
                      reviews.map((r) => (
                        <div key={r.id} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
                          <div className="flex items-center gap-2.5">
                            <Avatar user={{ name: r.userName, avatarColor: r.avatarColor, avatarUrl: r.avatarUrl }} className="h-9 w-9 text-xs" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-extrabold">{r.userName}</p>
                              <p className="text-[11px] text-slate-400">
                                {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : ""}
                              </p>
                            </div>
                            <Stars value={r.rating} size="h-3.5 w-3.5" />
                          </div>
                          <p className="mt-2 text-[13px] leading-relaxed">“{r.message}”</p>
                        </div>
                      ))
                    )}
                  </div>
                ) : (
                  <div className="space-y-2.5 p-4">
                    <PromoManager
                      venue={{ id: active.id, name: active.name }}
                      ownerId={user?.id ?? 0}
                      samplePrice={active.minPrice || 1500}
                    />
                  </div>
                )}
              </div>

              {/* Venue facts card */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Venue profile</h3>
                  <button
                    onClick={() => openEditVenue(active)}
                    className="flex items-center gap-1 text-xs font-black text-orange-600 dark:text-orange-400"
                  >
                    <Pencil className="h-3 w-3" /> Edit all
                  </button>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{active.description || "No description yet."}</p>
                <p className="mt-2 text-xs font-semibold text-slate-500">
                  📞 {active.phone || "—"} • 🕐 {active.openingHour}:00 – {active.closingHour}:00 • 📍 {active.city}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="flex items-center gap-1 text-[11px] font-black text-slate-500"><Wallet className="h-3.5 w-3.5" /> You accept:</span>
                  {(String(active.acceptedPayments ?? "").split(",").map((s) => s.trim()).filter(Boolean).length > 0
                    ? String(active.acceptedPayments ?? "").split(",").map((s) => s.trim()).filter(Boolean)
                    : [...PAYMENT_OPTIONS]
                  ).map((m) => (
                    <span key={m} className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                      💳 {m}
                    </span>
                  ))}
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
                  <ShieldCheck className="h-3.5 w-3.5 text-amber-500" />
                  {Number(active.depositPercent ?? 30) <= 0
                    ? "Fair-play deposit OFF — risky players book like everyone else"
                    : `Fair-play deposit ${active.depositPercent}% upfront (non-refundable) for low-trust players`}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {active.amenities.split(",").map((a) => a.trim()).filter(Boolean).map((a) => (
                    <span key={a} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      ✓ {a}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ADD VENUE — full profile from the start */}
      {showAdd && (
        <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-slate-900/50 p-4">
          <div className="my-6 w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <h3 className="text-lg font-black">List your futsal 🏟️</h3>
            <p className="mt-1 text-xs text-slate-500">Photos, facilities, hours, prices — set it all up now, tweak anytime later.</p>
            <div className="mt-4 max-h-[65vh] space-y-3 overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <span className={labelCls}>Venue name *</span>
                  <input value={fName} onChange={(e) => { setFName(e.target.value); setAddError(""); }} placeholder="e.g. Sunshine Futsal" maxLength={80} className={inputCls} />
                </div>
                <div className="col-span-2">
                  <span className={labelCls}>Address *</span>
                  <input value={fAddr} onChange={(e) => { setFAddr(e.target.value); setAddError(""); }} placeholder="e.g. Baneshwor, Kathmandu" maxLength={200} className={inputCls} />
                </div>
                <div>
                  <span className={labelCls}>City</span>
                  <select value={fCity} onChange={(e) => setFCity(e.target.value)} className={inputCls}>
                    {["Kathmandu", "Lalitpur", "Bhaktapur", "Pokhara", "Chitwan"].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <span className={labelCls}>Phone</span>
                  <input value={fPhone} onChange={(e) => { setFPhone(e.target.value); setAddError(""); }} placeholder="01-XXXXXXX" maxLength={20} className={inputCls} />
                </div>
                <div className="col-span-2">
                  <span className={labelCls}>About your place 💛</span>
                  <textarea value={fDesc} onChange={(e) => { setFDesc(e.target.value); setAddError(""); }} rows={2} maxLength={1000} placeholder="Great turf, friendly staff, momos nearby…" className={`${inputCls} resize-none`} />
                </div>
                <div className="col-span-2">
                  <ImagePicker value={fImage} onChange={setFImage} label="Cover photo 📸" />
                </div>
                <div>
                  <span className={labelCls}>Opens at</span>
                  <input type="number" min={0} max={23} value={fOpen} onChange={(e) => setFOpen(Number(e.target.value))} className={inputCls} />
                </div>
                <div>
                  <span className={labelCls}>Closes at</span>
                  <input type="number" min={1} max={24} value={fClose} onChange={(e) => setFClose(Number(e.target.value))} className={inputCls} />
                </div>
                <div className="col-span-2">
                  <span className={labelCls}>Facilities ✨</span>
                  <ChipPicker options={AMENITY_OPTIONS} selected={fAmen} onToggle={(v) => toggle(fAmen, v, setFAmen)} />
                </div>
                <div className="col-span-2">
                  <span className={labelCls}>Accepted payments 💳 (players only see these)</span>
                  <ChipPicker options={PAYMENT_OPTIONS} selected={fPay} onToggle={(v) => toggle(fPay, v, setFPay)} />
                  <p className="mt-1.5 text-[11px] text-slate-400">Cash-only? eSewa-only? Your call — pick at least one. Low-trust deposits need an online option to be enforceable.</p>
                </div>
                <div className="col-span-2">
                  <span className={labelCls}>Fair-play deposit for risky players 🛡️ — {fDeposit}% {fDeposit <= 0 ? "(OFF)" : ""}</span>
                  <input type="range" min={0} max={100} step={5} value={fDeposit} onChange={(e) => setFDeposit(Number(e.target.value))} className="w-full accent-slate-900 dark:accent-white" />
                  <p className="mt-1 text-[11px] text-slate-400">
                    {fDeposit <= 0
                      ? "Deposits off — everyone books the same way."
                      : `Players with low stars / repeat cancels pay ${fDeposit}% upfront (non-refundable). They get it back in trust when they show up! 💪`}
                  </p>
                </div>
                <div className="col-span-2">
                  <span className={labelCls}>Starting price per hour (Rs.)</span>
                  <input type="number" min={100} max={20000} step={50} value={fPrice} onChange={(e) => setFPrice(Number(e.target.value))} className={inputCls} />
                </div>
              </div>
              {addError && (
                <p className="mt-3 rounded-xl bg-red-500/10 px-4 py-3 text-xs font-bold text-red-600 dark:text-red-400">
                  {addError}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button onClick={() => { setShowAdd(false); setAddError(""); }} className="rounded-xl border border-slate-200 py-3 text-sm font-black text-slate-600 dark:border-slate-700 dark:text-slate-300">
                  Cancel
                </button>
                <button
                  onClick={addVenue}
                  disabled={saving}
                  className="rounded-xl bg-slate-900 py-3 text-sm font-black text-white disabled:opacity-40 dark:bg-white dark:text-slate-900"
                >
                  {saving ? "Listing…" : "List my futsal 🎉"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EDIT VENUE — everything changeable */}
      {showEditVenue && eVenue && (
        <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-slate-900/50 p-4">
          <div className="my-6 w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <h3 className="text-lg font-black">Edit {eVenue.name} ✏️</h3>
            <p className="mt-1 text-xs text-slate-500">Change anything — players see updates instantly.</p>
            <div className="mt-4 max-h-[65vh] space-y-3 overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <span className={labelCls}>Venue name</span>
                  <input value={eName} onChange={(e) => setEName(e.target.value)} className={inputCls} />
                </div>
                <div className="col-span-2">
                  <span className={labelCls}>Address</span>
                  <input value={eAddr} onChange={(e) => setEAddr(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <span className={labelCls}>City</span>
                  <select value={eCity} onChange={(e) => setECity(e.target.value)} className={inputCls}>
                    {["Kathmandu", "Lalitpur", "Bhaktapur", "Pokhara", "Chitwan"].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <span className={labelCls}>Phone</span>
                  <input value={ePhone} onChange={(e) => setEPhone(e.target.value)} className={inputCls} />
                </div>
                <div className="col-span-2">
                  <span className={labelCls}>About</span>
                  <textarea value={eDesc} onChange={(e) => setEDesc(e.target.value)} rows={3} className={`${inputCls} resize-none`} />
                </div>
                <div className="col-span-2">
                  <ImagePicker value={eImage} onChange={setEImage} label="Cover photo 📸" />
                </div>
                <div>
                  <span className={labelCls}>Opens at</span>
                  <input type="number" min={0} max={23} value={eOpen} onChange={(e) => setEOpen(Number(e.target.value))} className={inputCls} />
                </div>
                <div>
                  <span className={labelCls}>Closes at</span>
                  <input type="number" min={1} max={24} value={eClose} onChange={(e) => setEClose(Number(e.target.value))} className={inputCls} />
                </div>
                <div className="col-span-2">
                  <span className={labelCls}>Facilities ✨</span>
                  <ChipPicker options={AMENITY_OPTIONS} selected={eAmen} onToggle={(v) => toggle(eAmen, v, setEAmen)} />
                </div>
                <div className="col-span-2">
                  <span className={labelCls}>Accepted payments 💳 (players only see these)</span>
                  <ChipPicker options={PAYMENT_OPTIONS} selected={ePay} onToggle={(v) => toggle(ePay, v, setEPay)} />
                  <p className="mt-1.5 text-[11px] text-slate-400">Cash-only? eSewa-only? Your call — pick at least one.</p>
                </div>
                <div className="col-span-2">
                  <span className={labelCls}>Fair-play deposit for risky players 🛡️ — {eDeposit}% {eDeposit <= 0 ? "(OFF)" : ""}</span>
                  <input type="range" min={0} max={100} step={5} value={eDeposit} onChange={(e) => setEDeposit(Number(e.target.value))} className="w-full accent-slate-900 dark:accent-white" />
                  <p className="mt-1 text-[11px] text-slate-400">
                    {eDeposit <= 0
                      ? "Deposits off — everyone books the same way."
                      : `Low-trust players pay ${eDeposit}% upfront, non-refundable if they cancel. Honest players earn trust back fast! 💪`}
                  </p>
                </div>
              </div>
              {editError && (
                <p className="mt-3 rounded-xl bg-red-500/10 px-4 py-3 text-xs font-bold text-red-600 dark:text-red-400">
                  {editError}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button onClick={() => { setShowEditVenue(false); setEditError(""); }} className="rounded-xl border border-slate-200 py-3 text-sm font-black text-slate-600 dark:border-slate-700 dark:text-slate-300">
                  Cancel
                </button>
                <button
                  onClick={saveVenue}
                  disabled={savingVenue}
                  className="rounded-xl bg-slate-900 py-3 text-sm font-black text-white disabled:opacity-40 dark:bg-white dark:text-slate-900"
                >
                  {savingVenue ? "Saving…" : "Save changes ✨"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ADD / EDIT COURT — full profile */}
      {showCourt && active && (
        <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-slate-900/50 p-4">
          <div className="my-6 w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <h3 className="text-lg font-black">{editingCourt ? `Edit ${editingCourt.name} ✏️` : "Add a court ⚽"}</h3>
            <p className="mt-1 text-xs text-slate-500">at {active.name}</p>
            <div className="mt-4 max-h-[65vh] space-y-3 overflow-y-auto pr-1">
              <div>
                <span className={labelCls}>Court name *</span>
                <input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="e.g. Arena A — Pro Turf" maxLength={60} className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className={labelCls}>Format</span>
                  <select value={cFormat} onChange={(e) => setCFormat(e.target.value)} className={inputCls}>
                    {FORMATS.map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <span className={labelCls}>Surface</span>
                  <select value={cSurface} onChange={(e) => setCSurface(e.target.value)} className={inputCls}>
                    {SURFACES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className={labelCls}>Price / hour (Rs.) 💰</span>
                  <input type="number" min={100} max={20000} step={50} value={cPrice} onChange={(e) => setCPrice(Number(e.target.value))} className={inputCls} />
                </div>
                <div>
                  <span className={labelCls}>☀️ Morning price</span>
                  <input type="number" min={100} max={20000} step={50} value={cMorning} onChange={(e) => setCMorning(Number(e.target.value))} className={inputCls} />
                </div>
              </div>
              <div>
                <ImagePicker value={cImage} onChange={setCImage} label="Court photo 📸" />
              </div>
              <div>
                <span className={labelCls}>Included facilities ✨</span>
                <ChipPicker options={FEATURE_OPTIONS} selected={cFeat} onToggle={(v) => toggle(cFeat, v, setCFeat)} />
              </div>
              {courtError && (
                <p className="rounded-xl bg-red-500/10 px-4 py-3 text-xs font-bold text-red-600 dark:text-red-400">
                  {courtError}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button onClick={() => { setShowCourt(false); setCourtError(""); }} className="rounded-xl border border-slate-200 py-3 text-sm font-black text-slate-600 dark:border-slate-700 dark:text-slate-300">
                  Cancel
                </button>
                <button
                  onClick={saveCourt}
                  disabled={savingCourt}
                  className="rounded-xl bg-slate-900 py-3 text-sm font-black text-white disabled:opacity-40 dark:bg-white dark:text-slate-900"
                >
                  {savingCourt ? "Saving…" : editingCourt ? "Save court ✨" : "Add court ⚽"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* -------------------------------------------------- retire a venue */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="my-6 w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <h3 className="flex items-center gap-2 text-lg font-black text-red-600 dark:text-red-400">
              <Trash2 className="h-5 w-5" /> Retire {deleteTarget.name}?
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              The venue leaves every listing and its courts stop taking bookings. Past bookings,
              payments and reviews stay exactly where they are — nothing is erased.
            </p>
            <p className="mt-3 rounded-2xl bg-red-50 px-3.5 py-2.5 text-[11px] font-bold leading-relaxed text-red-700 dark:bg-red-500/10 dark:text-red-300">
              This can&apos;t be undone from the studio. If any player still has a game to come,
              you&apos;ll be asked to cancel or play those first.
            </p>
            <div className="mt-4">
              <span className={labelCls}>
                Type <b className="text-slate-700 dark:text-slate-200">{deleteTarget.name}</b> to
                confirm
              </span>
              <input
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder={deleteTarget.name}
                className={inputCls}
              />
            </div>
            {deleteError && (
              <p className="mt-3 rounded-2xl bg-red-50 px-3.5 py-2.5 text-xs font-bold text-red-600 dark:bg-red-500/10 dark:text-red-400">
                {deleteError}
              </p>
            )}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteConfirm("");
                  setDeleteError("");
                }}
                disabled={deleting}
                className="rounded-xl border border-slate-200 py-3 text-sm font-black text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Keep it
              </button>
              <button
                onClick={() => void confirmDeleteVenue()}
                disabled={deleting || deleteConfirm.trim() !== deleteTarget.name}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-red-600 py-3 text-sm font-black text-white transition hover:bg-red-700 disabled:opacity-40"
              >
                {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                {deleting ? "Retiring…" : "Delete venue"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -------------------------------------------------- retire one court */}
      {courtDeleteTarget && (
        <div className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="my-6 w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <h3 className="flex items-center gap-2 text-lg font-black text-red-600 dark:text-red-400">
              <Trash2 className="h-5 w-5" /> Retire {courtDeleteTarget.name}?
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              The court comes off the booking page and stops counting towards this venue. Past
              bookings, payments and reviews against it stay exactly where they are — nothing is
              erased.
            </p>
            <p className="mt-3 rounded-2xl bg-red-50 px-3.5 py-2.5 text-[11px] font-bold leading-relaxed text-red-700 dark:bg-red-500/10 dark:text-red-300">
              This can&apos;t be undone from the studio. If a player still has a game booked on this
              pitch, you&apos;ll be asked to cancel or play it first.
            </p>
            <div className="mt-4">
              <span className={labelCls}>
                Type <b className="text-slate-700 dark:text-slate-200">{courtDeleteTarget.name}</b> to
                confirm
              </span>
              <input
                value={courtDeleteConfirm}
                onChange={(e) => setCourtDeleteConfirm(e.target.value)}
                placeholder={courtDeleteTarget.name}
                className={inputCls}
              />
            </div>
            {courtDeleteError && (
              <p className="mt-3 rounded-2xl bg-red-50 px-3.5 py-2.5 text-xs font-bold text-red-600 dark:bg-red-500/10 dark:text-red-400">
                {courtDeleteError}
              </p>
            )}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setCourtDeleteTarget(null);
                  setCourtDeleteConfirm("");
                  setCourtDeleteError("");
                }}
                disabled={deletingCourt}
                className="rounded-xl border border-slate-200 py-3 text-sm font-black text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Keep it
              </button>
              <button
                onClick={() => void confirmDeleteCourt()}
                disabled={deletingCourt || courtDeleteConfirm.trim() !== courtDeleteTarget.name}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-red-600 py-3 text-sm font-black text-white transition hover:bg-red-700 disabled:opacity-40"
              >
                {deletingCourt && <Loader2 className="h-4 w-4 animate-spin" />}
                {deletingCourt ? "Retiring…" : "Delete court"}
              </button>
            </div>
          </div>
        </div>
      )}
    </OwnerGuard>
  );
}
