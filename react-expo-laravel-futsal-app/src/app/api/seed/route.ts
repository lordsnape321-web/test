import { db } from "@/db";
import {
  users,
  venues,
  courts,
  bookings,
  teams,
  teamInvites,
  teamMembers,
  teamRequests,
  openMatches,
  matchJoins,
  reviews,
  promos,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { VENUE_IMAGES } from "@/lib/futsal";
import { hashPassword, DEFAULT_PASSWORD } from "@/lib/auth";
import { normalizeTeamCode, suggestTeamCode } from "@/lib/teams";

export const dynamic = "force-dynamic";

function d(offset: number) {
  const dt = new Date();
  dt.setDate(dt.getDate() + offset);
  return dt.toISOString().slice(0, 10);
}

/**
 * Demo promo codes for the seeded venues. `venueId` resolves a venue name to an
 * id, so the same list works for a fresh seed and for backfilling an old one.
 */
function demoPromos(
  venueId: (name: string) => number | null
): Array<typeof promos.$inferInsert> {
  type PromoSeed = Omit<typeof promos.$inferInsert, "venueId">;
  const rows: Array<{ venue: string; values: PromoSeed }> = [
    {
      venue: "Dhanyentari Futsal Arena",
      values: {
        code: "EARLYBIRD15",
        title: "Early bird evenings",
        discountType: "percent",
        discountValue: 15,
        maxDiscount: 600,
        minBookingAmount: 2000,
        startsAt: null,
        expiresAt: d(21),
        usageLimit: 40,
        perUserLimit: 1,
        isPublic: true,
        isActive: true,
      },
    },
    {
      venue: "Dhanyentari Futsal Arena",
      values: {
        code: "WEEKDAY10",
        title: "Fill the weekday slots",
        discountType: "percent",
        discountValue: 10,
        maxDiscount: 0,
        minBookingAmount: 0,
        startsAt: null,
        expiresAt: d(7),
        usageLimit: 0,
        perUserLimit: 2,
        isPublic: true,
        isActive: true,
      },
    },
    {
      venue: "KickOff Sports Hub",
      values: {
        code: "ROOFTOP300",
        title: "Rooftop regulars",
        discountType: "flat",
        discountValue: 300,
        maxDiscount: 0,
        minBookingAmount: 1500,
        startsAt: null,
        expiresAt: d(14),
        usageLimit: 25,
        perUserLimit: 1,
        // Hidden: only players the owner shares it with can use it.
        isPublic: false,
        isActive: true,
      },
    },
    {
      venue: "KickOff Sports Hub",
      values: {
        code: "NEWYEAR25",
        title: "New year kickoff (finished)",
        discountType: "percent",
        discountValue: 25,
        maxDiscount: 500,
        minBookingAmount: 0,
        startsAt: null,
        expiresAt: d(-5),
        usageLimit: 20,
        perUserLimit: 1,
        isPublic: true,
        isActive: true,
      },
    },
    {
      venue: "Lakeside Strikers Court",
      values: {
        code: "LAKESIDE20",
        title: "Lake breeze special",
        discountType: "percent",
        discountValue: 20,
        maxDiscount: 500,
        minBookingAmount: 1600,
        startsAt: null,
        expiresAt: d(3),
        usageLimit: 15,
        perUserLimit: 1,
        isPublic: true,
        isActive: true,
      },
    },
    {
      venue: "NightOwl Futsal",
      values: {
        code: "MIDNIGHT50",
        title: "Midnight madness",
        discountType: "percent",
        discountValue: 50,
        maxDiscount: 950,
        minBookingAmount: 1900,
        startsAt: null,
        expiresAt: d(30),
        usageLimit: 10,
        perUserLimit: 1,
        isPublic: true,
        isActive: true,
      },
    },
  ];
  return rows
    .filter((r) => venueId(r.venue) !== null)
    .map((r) => ({ ...r.values, venueId: venueId(r.venue) as number }));
}

/**
 * Demo accounts in the order `seedUsers` inserts them. Team data below refers to
 * people by index, so it works both for a fresh seed (where the index maps
 * straight onto `insertedUsers`) and for rebuilding teams in a database that
 * already has users (where the index maps onto an email lookup).
 */
const DEMO_USER_EMAILS = [
  "aarav@futsal.np",
  "bikash@futsal.np",
  "chirag@futsal.np",
  "dipesh@futsal.np",
  "elish@futsal.np",
  "farhan@futsal.np",
  "ganesh@futsal.np",
  "himal@futsal.np",
  "priya@futsal.np",
];

/**
 * The demo squads 🛡️ — each with a unique searchable code and a home turf that
 * names a venue actually on the platform. `captain` is an index into
 * `DEMO_USER_EMAILS`.
 */
function demoTeams() {
  return [
    { name: "Chabahil Chargers", code: "CHARGERS-4X7K", motto: "Speed. Skill. Glory.", desc: "Tuesday and Friday nights at Dhanyentari, 7pm sharp. We play to win but nobody sits out — new faces get the first half. Court bill split four ways, boots and bibs on us 🥅", captain: 0, level: "Advanced", color: "#16a34a", home: "Dhanyentari Futsal Arena", w: 18, l: 4, d: 3 },
    { name: "Lalitpur Legends", code: "LEGENDS-9PM3", motto: "Legacy in every goal", desc: "Sunday mornings at KickOff, then chiya and momos. Seven-a-side, defenders must talk, and yes we keep a league table nobody asked for 🏆", captain: 3, level: "Advanced", color: "#7c3aed", home: "KickOff Sports Hub", w: 15, l: 6, d: 2 },
    { name: "Pokhara Panthers", code: "PANTHERS-7QRT", motto: "Hunt as one", desc: "Lakeside crowd, three times a week whenever the fog clears. Beginners welcome as long as you show up — we track attendance, not talent 🌄", captain: 5, level: "Intermediate", color: "#ea580c", home: "Lakeside Strikers Court", w: 11, l: 7, d: 4 },
    { name: "Bhaktapur Ballers", code: "BALLERS-K3YD", motto: "Play beautiful", desc: "We are the crew that passes too much. Saturday evenings at GoalZone, Rs. 150 each, and the goalkeeper never pays 😄", captain: 1, level: "Intermediate", color: "#2563eb", home: "GoalZone Futsal Park", w: 9, l: 8, d: 3 },
    { name: "Thamel Night Owls", code: "OWLS-MN4P", motto: "We own the night", desc: "Late shift only: midnight court at NightOwl after work. Learning group, laughs first, and we are genuinely terrible at defending set pieces 🦉", captain: 4, level: "Beginner", color: "#be123c", home: "NightOwl Futsal", w: 5, l: 9, d: 2 },
  ];
}

/** Rosters as [teamIndex, userIndex, role]. Exactly one "captain" per team. */
function demoTeamMemberships(): Array<[number, number, string]> {
  return [
    [0, 0, "captain"], [0, 1, "player"], [0, 2, "player"], [0, 4, "player"], [0, 5, "player"],
    // Every seeded member is a player account — a venue owner runs a court, they
    // do not turn out for a squad, and /api/teams/{id}/invites refuses them too.
    [1, 3, "captain"], [1, 0, "player"], [1, 4, "player"], [1, 7, "player"],
    [2, 5, "captain"], [2, 1, "player"], [2, 4, "player"],
    [3, 1, "captain"], [3, 2, "player"], [3, 7, "player"], [3, 0, "player"],
    [4, 4, "captain"], [4, 7, "player"],
  ];
}

/**
 * Pending invitations as [teamIndex, userIndex, note], so a *player* logging in
 * has something to answer. This is the captain's side of the consent rule: an
 * invite never adds anyone, the player's own yes does. Each invitee is
 * deliberately not on that roster, and is a `player` account.
 */
function demoTeamInvites(): Array<[number, number, string]> {
  return [
    [0, 3, "We lost our left-back to a knee injury — you played against us and I remember. Two nights a week, no trial game 🛡️"],
    [4, 2, "You are a keeper and we are short of one. Come Friday, and if you hate it, decline and no hard feelings 🧤"],
    [1, 5, "Champions need depth 😄 Sunday mornings only, and we split the court four ways."],
  ];
}

/**
 * Pending join requests as [teamIndex, userIndex, message], so a captain logging
 * in has something to decide. Every requester is deliberately NOT already a
 * member of the squad they are asking to join.
 */
function demoTeamJoinRequests(): Array<[number, number, string]> {
  return [
    [0, 7, "Sunday league defender, and I live two minutes from the arena. Would love to join the Chargers! 🛡️"],
    [0, 3, "Played against you last month and lost 4-1 😅 Let me try from the inside."],
    [4, 2, "Beginner goalkeeper. I can't promise saves but I promise enthusiasm 🧤"],
    [2, 3, "In Pokhara every weekend — happy to travel for the Panthers."],
  ];
}

export async function POST() {
  try {
    const existing = await db.select().from(venues);
    if (existing.length > 0) {
      // Backfill auth + ownership for databases seeded before login existed.
      const allUsers = await db.select().from(users);
      const defaultHash = hashPassword(DEFAULT_PASSWORD);
      for (const u of allUsers) {
        if (!u.passwordHash) {
          await db
            .update(users)
            .set({ passwordHash: defaultHash })
            .where(eq(users.id, u.id));
        }
      }
      const owner =
        allUsers.find((u) => u.role === "owner") ?? allUsers[0];
      if (owner) {
        for (const v of existing) {
          if (!v.ownerId) {
            await db
              .update(venues)
              .set({ ownerId: owner.id })
              .where(eq(venues.id, v.id));
          }
        }
      }
      // Backfill reviews for databases seeded before reviews existed.
      const existingReviews = await db.select().from(reviews);
      let seededReviews = 0;
      if (existingReviews.length === 0) {
        const byName = new Map(existing.map((v) => [v.name, v.id]));
        const idOf = (name: string, fallback: number) => byName.get(name) ?? fallback;
        const reviewBackfill: Array<{ venueId: number; userId: number; rating: number; message: string }> = [
          // Dhanyentari Futsal Arena (id 1)
          { venueId: idOf("Dhanyentari Futsal Arena", 1), userId: 2, rating: 5, message: "Best turf in town! The lights at night are amazing and the staff even helped us split teams. Felt like home 🏟️" },
          { venueId: idOf("Dhanyentari Futsal Arena", 1), userId: 5, rating: 5, message: "Booked for my birthday game — they surprised us with extra balls and music. 10/10 vibes! 🎉" },
          { venueId: idOf("Dhanyentari Futsal Arena", 1), userId: 4, rating: 4, message: "Great courts, gets busy on weekends so book early. Showers are clean! ⚽" },
          // KickOff Sports Hub (id 2)
          { venueId: idOf("KickOff Sports Hub", 2), userId: 1, rating: 5, message: "Rooftop views while playing = unreal! Coffee after the game hits different here ☕" },
          { venueId: idOf("KickOff Sports Hub", 2), userId: 6, rating: 4, message: "Cosy spot, friendly uncle at reception. Parking is a bit tight but worth it!" },
          { venueId: idOf("KickOff Sports Hub", 2), userId: 3, rating: 5, message: "Came as a beginner goalkeeper, left feeling like a pro. Everyone cheered my saves 🧤" },
          // GoalZone Futsal Park (id 3)
          { venueId: idOf("GoalZone Futsal Park", 3), userId: 8, rating: 5, message: "Brought my little brother to the kids zone while we played — perfect family evening! 👨‍👩‍👧" },
          { venueId: idOf("GoalZone Futsal Park", 3), userId: 2, rating: 4, message: "Juice bar after a sweaty game is genius 🧃 Turf is soft on the knees too." },
          { venueId: idOf("GoalZone Futsal Park", 3), userId: 5, rating: 5, message: "Coach gave us free tips for 10 minutes. My weak foot finally works! 😄" },
          // Lakeside Strikers Court (id 4)
          { venueId: idOf("Lakeside Strikers Court", 4), userId: 3, rating: 5, message: "Played with the lake breeze — magical evening! Beginners were so welcome 🌱" },
          { venueId: idOf("Lakeside Strikers Court", 4), userId: 1, rating: 5, message: "Mountain view + futsal = my happy place. Booked again for next week already! 🏔️" },
          { venueId: idOf("Lakeside Strikers Court", 4), userId: 6, rating: 4, message: "Beautiful court, slightly slippery after rain — but staff dried it fast. Great care! 🌧️" },
          // Rhino Sports Complex (id 5)
          { venueId: idOf("Rhino Sports Complex", 5), userId: 4, rating: 5, message: "7v7 with the full squad was epic! Physio stretched my cramp for free. Legends 🦏" },
          { venueId: idOf("Rhino Sports Complex", 5), userId: 8, rating: 4, message: "Biggest courts I've played on. Gym warmup before the game is a game-changer 💪" },
          { venueId: idOf("Rhino Sports Complex", 5), userId: 2, rating: 5, message: "Drove 2 hours for this and it was worth every minute. Proper football temple! 🙏" },
          // NightOwl Futsal (id 6)
          { venueId: idOf("NightOwl Futsal", 6), userId: 5, rating: 5, message: "Midnight futsal under neon lights hits different 🌙 Music, friends, goals — perfect night!" },
          { venueId: idOf("NightOwl Futsal", 6), userId: 1, rating: 4, message: "DJ Friday was wild! Court gets a bit crowded late night but the energy is unmatched 🎧" },
          { venueId: idOf("NightOwl Futsal", 6), userId: 6, rating: 5, message: "Night shift worker here — finally a place open when I'm free! Staff treats us like family 💜" },
        ];
        const validUserIds = new Set(allUsers.map((u) => u.id));
        for (const r of reviewBackfill) {
          if (!validUserIds.has(r.userId)) continue;
          await db.insert(reviews).values({
            venueId: r.venueId,
            userId: r.userId,
            bookingId: null,
            rating: r.rating,
            message: r.message,
          });
          seededReviews++;
        }
      }
      // Backfill promo codes for databases seeded before promos existed.
      const existingPromos = await db.select().from(promos);
      let seededPromos = 0;
      if (existingPromos.length === 0) {
        const byName = new Map(existing.map((v) => [v.name, v.id]));
        for (const pr of demoPromos((name: string) => byName.get(name) ?? null)) {
          await db.insert(promos).values(pr);
          seededPromos++;
        }
      }
      // Teams 🛡️ — rebuild the demo squads if the table is empty. Without this,
      // a truncated or hand-cleared `teams` table leaves the app with no squads
      // and no way to get them back, because this branch reports "Already seeded"
      // as soon as venues exist.
      let existingTeams = await db.select().from(teams);
      const venueByName = new Map(existing.map((v) => [v.name, v.id]));
      const userByEmail = new Map(allUsers.map((u) => [u.email, u]));
      const userAt = (i: number) => userByEmail.get(DEMO_USER_EMAILS[i]) ?? null;
      let seededTeams = 0;
      if (existingTeams.length === 0) {
        const rebuilt: Array<typeof teams.$inferSelect> = [];
        for (const t of demoTeams()) {
          const captain = userAt(t.captain);
          if (!captain) continue;
          const rows = await db
            .insert(teams)
            .values({
              name: t.name,
              motto: t.motto,
              description: t.desc,
              teamCode: t.code,
              captainId: captain.id,
              maxPlayers: 12,
              level: t.level,
              logoColor: t.color,
              wins: t.w,
              losses: t.l,
              draws: t.d,
              homeVenueId: venueByName.get(t.home) ?? null,
              homeGround: t.home,
              lookingForPlayers: true,
            })
            .returning();
          rebuilt.push(rows[0]);
          seededTeams++;
        }
        for (const [ti, ui, role] of demoTeamMemberships()) {
          const team = rebuilt[ti];
          const u = userAt(ui);
          if (!team || !u) continue;
          await db.insert(teamMembers).values({ teamId: team.id, userId: u.id, role });
        }
        for (const [ti, ui, message] of demoTeamJoinRequests()) {
          const team = rebuilt[ti];
          const u = userAt(ui);
          if (!team || !u) continue;
          await db
            .insert(teamRequests)
            .values({ teamId: team.id, userId: u.id, message, status: "pending" });
        }
        for (const [ti, ui, message] of demoTeamInvites()) {
          const team = rebuilt[ti];
          const u = userAt(ui);
          if (!team || !u) continue;
          await db
            .insert(teamInvites)
            .values({
              teamId: team.id,
              userId: u.id,
              invitedBy: team.captainId,
              message,
              status: "pending",
            });
        }
        existingTeams = await db.select().from(teams);
      }

      // Backfill unique team codes + real home venues for databases seeded
      // before teams had either.
      const takenCodes = new Set(
        existingTeams.map((t) => normalizeTeamCode(t.teamCode ?? "")).filter(Boolean)
      );
      let seededTeamCodes = 0;
      let seededTeamDescriptions = 0;
      for (const t of existingTeams) {
        const patch: Partial<typeof teams.$inferInsert> = {};
        // Databases seeded before teams had an "about us" box: give each one a
        // sentence built from what it already knows, so the card is never empty.
        if (!t.description) {
          const demo = demoTeams().find((d) => d.name === t.name);
          patch.description =
            demo?.desc ??
            `${t.level} squad${t.homeGround ? ` playing at ${t.homeGround}` : ""} — ${
              t.motto || "ask the captain about training nights and how we split the court."
            }`;
          seededTeamDescriptions++;
        }
        if (!t.teamCode) {
          let code = suggestTeamCode(t.name);
          // The tail is random, so retry rather than risk a unique violation.
          for (let i = 0; i < 8 && takenCodes.has(code); i++) code = suggestTeamCode(t.name);
          takenCodes.add(code);
          patch.teamCode = code;
          seededTeamCodes++;
        }
        if (!t.homeVenueId) {
          const vid = venueByName.get(t.homeGround);
          if (vid) patch.homeVenueId = vid;
        }
        if (Object.keys(patch).length > 0)
          await db.update(teams).set(patch).where(eq(teams.id, t.id));
      }
      // Backfill a few pending invitations so the player side of the flow has
      // something to answer in a database that predates `team_invites`.
      const existingInvites = await db.select().from(teamInvites);
      let seededTeamInvites = 0;
      if (existingInvites.length === 0 && existingTeams.length > 0) {
        const allMembers = await db.select().from(teamMembers);
        for (const t of existingTeams.slice(0, 3)) {
          const memberIds = new Set(
            allMembers.filter((m) => m.teamId === t.id).map((m) => m.userId)
          );
          const invited = new Set(
            (await db.select().from(teamInvites).where(eq(teamInvites.teamId, t.id))).map(
              (i) => i.userId
            )
          );
          const outsider = allUsers.find(
            (u) =>
              u.role === "player" && !memberIds.has(u.id) && !invited.has(u.id) && u.id !== t.captainId
          );
          if (!outsider) continue;
          await db.insert(teamInvites).values({
            teamId: t.id,
            userId: outsider.id,
            invitedBy: t.captainId,
            message: `${t.name}${t.homeGround ? ` at ${t.homeGround}` : ""} could use one more player — want in? 📨`,
            status: "pending",
          });
          seededTeamInvites++;
        }
      }

      // Backfill a few join requests so the captain panel has something to decide.
      const existingRequests = await db.select().from(teamRequests);
      let seededTeamRequests = 0;
      if (existingRequests.length === 0 && existingTeams.length > 0) {
        const allMembers = await db.select().from(teamMembers);
        for (const t of existingTeams.slice(0, 3)) {
          const memberIds = new Set(
            allMembers.filter((m) => m.teamId === t.id).map((m) => m.userId)
          );
          const asked = new Set(
            (await db.select().from(teamRequests).where(eq(teamRequests.teamId, t.id))).map(
              (r) => r.userId
            )
          );
          const outsider = allUsers.find(
            (u) => u.role === "player" && !memberIds.has(u.id) && !asked.has(u.id)
          );
          if (!outsider) continue;
          await db.insert(teamRequests).values({
            teamId: t.id,
            userId: outsider.id,
            message: `Heard about ${t.name} from a friend${t.homeGround ? ` at ${t.homeGround}` : ""} — any room? 🛡️`,
            status: "pending",
          });
          seededTeamRequests++;
        }
      }
      return Response.json({
        ok: true,
        message: "Already seeded",
        count: existing.length,
        seededReviews,
        seededPromos,
        seededTeams,
        seededTeamCodes,
        seededTeamDescriptions,
        seededTeamInvites,
        seededTeamRequests,
      });
    }

    const pw = hashPassword(DEFAULT_PASSWORD);

    // Users
    const seedUsers = [
      { name: "Aarav Sharma", email: "aarav@futsal.np", phone: "9841000001", passwordHash: pw, role: "player", avatarColor: "#16a34a", avatarUrl: "", defaultCity: "Kathmandu", level: "Advanced", position: "Striker", matchesPlayed: 48 },
      { name: "Bikash Thapa", email: "bikash@futsal.np", phone: "9841000002", passwordHash: pw, role: "player", avatarColor: "#2563eb", avatarUrl: "", defaultCity: "Lalitpur", level: "Intermediate", position: "Midfielder", matchesPlayed: 32 },
      { name: "Chirag Gurung", email: "chirag@futsal.np", phone: "9841000003", passwordHash: pw, role: "player", avatarColor: "#dc2626", avatarUrl: "", defaultCity: "Pokhara", level: "Beginner", position: "Goalkeeper", matchesPlayed: 12 },
      { name: "Dipesh Karki", email: "dipesh@futsal.np", phone: "9841000004", passwordHash: pw, role: "player", avatarColor: "#9333ea", avatarUrl: "", defaultCity: "Kathmandu", level: "Advanced", position: "Defender", matchesPlayed: 61 },
      { name: "Elish Shrestha", email: "elish@futsal.np", phone: "9841000005", passwordHash: pw, role: "player", avatarColor: "#ea580c", avatarUrl: "", defaultCity: "Bhaktapur", level: "Intermediate", position: "Winger", matchesPlayed: 27 },
      { name: "Farhan Ali", email: "farhan@futsal.np", phone: "9841000006", passwordHash: pw, role: "player", avatarColor: "#0891b2", avatarUrl: "", defaultCity: "Chitwan", level: "Advanced", position: "Pivot", matchesPlayed: 55 },
      { name: "Ganesh Rai", email: "ganesh@futsal.np", phone: "9841000007", passwordHash: pw, role: "owner", avatarColor: "#4d7c0f", avatarUrl: "", defaultCity: "Kathmandu", level: "—", position: "Owner", matchesPlayed: 20 },
      { name: "Himal Basnet", email: "himal@futsal.np", phone: "9841000008", passwordHash: pw, role: "player", avatarColor: "#be123c", avatarUrl: "", defaultCity: "Kathmandu", level: "Beginner", position: "Defender", matchesPlayed: 8 },
      { name: "Priya Maharjan", email: "priya@futsal.np", phone: "9841000009", passwordHash: pw, role: "owner", avatarColor: "#7c3aed", avatarUrl: "", defaultCity: "Pokhara", level: "—", position: "Owner", matchesPlayed: 5 },
    ];
    const insertedUsers = await db.insert(users).values(seedUsers).returning();
    const ganesh = insertedUsers[6];
    const priya = insertedUsers[8];

    // Venues
    const seedVenues = [
      {
        name: "Dhanyentari Futsal Arena",
        address: "Chabahil, Kathmandu",
        city: "Kathmandu",
        phone: "01-4567890",
        description: "Premium FIFA-standard turf with floodlights, pro changing rooms and live scoreboard. Kathmandu's most booked arena.",
        imageUrl: VENUE_IMAGES[0],
        rating: 4.9,
        totalReviews: 412,
        openingHour: 5,
        closingHour: 23,
        amenities: "Parking,Changing Room,Shower,WiFi,Cafeteria,First Aid,Live Scoreboard,Locker",
        isFeatured: true,
        acceptedPayments: "eSewa,Khalti,Cash at Venue",
        depositPercent: 30,
        ownerId: ganesh.id,
      },
      {
        name: "KickOff Sports Hub",
        address: "Jhamsikhel, Lalitpur",
        city: "Lalitpur",
        phone: "01-5532123",
        description: "Two rooftop courts with city views, cafe and weekend leagues. Perfect for corporate games.",
        imageUrl: VENUE_IMAGES[1],
        rating: 4.7,
        totalReviews: 268,
        openingHour: 6,
        closingHour: 22,
        amenities: "Parking,Cafeteria,WiFi,Rooftop View,Music System,First Aid",
        isFeatured: true,
        acceptedPayments: "eSewa,Cash at Venue",
        depositPercent: 25,
        ownerId: ganesh.id,
      },
      {
        name: "GoalZone Futsal Park",
        address: "Suryabinayak, Bhaktapur",
        city: "Bhaktapur",
        phone: "01-6614455",
        description: "Family-friendly futsal park with 3 courts, kids coaching academy and healthy juice bar.",
        imageUrl: VENUE_IMAGES[2],
        rating: 4.6,
        totalReviews: 189,
        openingHour: 6,
        closingHour: 21,
        amenities: "Parking,Academy,Kids Zone,Juice Bar,Changing Room,Shower",
        isFeatured: false,
        acceptedPayments: "Cash at Venue",
        depositPercent: 0,
        ownerId: ganesh.id,
      },
      {
        name: "Lakeside Strikers Court",
        address: "Lakeside, Pokhara",
        city: "Pokhara",
        phone: "061-463322",
        description: "Scenic court near Phewa lake with mountain views. Tourist favourite with equipment rental.",
        imageUrl: VENUE_IMAGES[3],
        rating: 4.8,
        totalReviews: 324,
        openingHour: 6,
        closingHour: 22,
        amenities: "Parking,Equipment Rental,Cafeteria,Mountain View,Shower,WiFi",
        isFeatured: true,
        acceptedPayments: "eSewa,Khalti",
        depositPercent: 40,
        ownerId: priya.id,
      },
      {
        name: "Rhino Sports Complex",
        address: "Bharatpur, Chitwan",
        city: "Chitwan",
        phone: "056-522110",
        description: "Biggest complex in Chitwan with 7v7 and 5v5 courts, gym and physio support.",
        imageUrl: VENUE_IMAGES[4],
        rating: 4.5,
        totalReviews: 156,
        openingHour: 5,
        closingHour: 22,
        amenities: "Parking,Gym,Physio,Cafeteria,Changing Room,First Aid",
        isFeatured: false,
        acceptedPayments: "eSewa,Khalti,Cash at Venue",
        depositPercent: 30,
        ownerId: priya.id,
      },
      {
        name: "NightOwl Futsal",
        address: "Thamel, Kathmandu",
        city: "Kathmandu",
        phone: "01-4445566",
        description: "Open till late with neon night vibes, DJ Fridays and midnight tournaments.",
        imageUrl: VENUE_IMAGES[5],
        rating: 4.4,
        totalReviews: 231,
        openingHour: 8,
        closingHour: 23,
        amenities: "Parking,Music System,Night Lights,Cafeteria,WiFi,Locker",
        isFeatured: false,
        acceptedPayments: "Khalti,Cash at Venue",
        depositPercent: 20,
        ownerId: priya.id,
      },
    ];
    const insertedVenues = await db.insert(venues).values(seedVenues).returning();

    // Courts (2-3 per venue)
    const courtDefs: Array<{ venueIdx: number; name: string; format: string; surface: string; price: number; morning: number }> = [
      { venueIdx: 0, name: "Arena A — Pro Turf", format: "5v5", surface: "FIFA Artificial Turf", price: 2000, morning: 1500 },
      { venueIdx: 0, name: "Arena B — Speed Court", format: "5v5", surface: "Futsal Mat", price: 1800, morning: 1300 },
      { venueIdx: 0, name: "Arena C — Big Game", format: "7v7", surface: "Artificial Turf", price: 2800, morning: 2200 },
      { venueIdx: 1, name: "Rooftop 1", format: "5v5", surface: "Artificial Turf", price: 1700, morning: 1300 },
      { venueIdx: 1, name: "Rooftop 2", format: "6v6", surface: "Artificial Turf", price: 1900, morning: 1400 },
      { venueIdx: 2, name: "Green Court", format: "5v5", surface: "Grass Hybrid", price: 1400, morning: 1000 },
      { venueIdx: 2, name: "Blue Court", format: "5v5", surface: "Futsal Mat", price: 1500, morning: 1100 },
      { venueIdx: 2, name: "Academy Court", format: "7v7", surface: "Artificial Turf", price: 2200, morning: 1700 },
      { venueIdx: 3, name: "Lake View Court", format: "5v5", surface: "Artificial Turf", price: 1600, morning: 1200 },
      { venueIdx: 3, name: "Mountain Court", format: "6v6", surface: "FIFA Artificial Turf", price: 1800, morning: 1300 },
      { venueIdx: 4, name: "Rhino Grand", format: "7v7", surface: "Grass Hybrid", price: 2500, morning: 1900 },
      { venueIdx: 4, name: "Rhino Mini", format: "5v5", surface: "Artificial Turf", price: 1500, morning: 1100 },
      { venueIdx: 5, name: "Neon Court 1", format: "5v5", surface: "Futsal Mat", price: 1900, morning: 1400 },
      { venueIdx: 5, name: "Neon Court 2", format: "5v5", surface: "Futsal Mat", price: 1900, morning: 1400 },
    ];
    const insertedCourts = [];
    for (let i = 0; i < courtDefs.length; i++) {
      const cd = courtDefs[i];
      const rows = await db
        .insert(courts)
        .values({
          venueId: insertedVenues[cd.venueIdx].id,
          name: cd.name,
          format: cd.format,
          surface: cd.surface,
          pricePerHour: cd.price,
          priceMorning: cd.morning,
          imageUrl: VENUE_IMAGES[i % VENUE_IMAGES.length],
          features: "Floodlights,Nets Provided,Match Balls,Drinking Water",
        })
        .returning();
      insertedCourts.push(rows[0]);
    }

    // Promo codes — owner-created discounts with expiry dates.
    const venueIdOf = (idx: number) => insertedVenues[idx]?.id ?? null;
    for (const pr of demoPromos((name: string) => {
      const idx = ["Dhanyentari Futsal Arena", "KickOff Sports Hub", "GoalZone Futsal Park", "Lakeside Strikers Court", "Rhino Sports Complex", "NightOwl Futsal"].indexOf(name);
      return idx >= 0 ? venueIdOf(idx) : null;
    })) {
      await db.insert(promos).values(pr);
    }

    // Bookings
    const bookingSeeds: Array<{
      court: number;
      user: number;
      dateOff: number;
      start: string;
      end: string;
      pay: string;
      method: string;
      pub?: boolean;
      need?: number;
      title?: string;
      /**
       * Index into `seedTeams` — the squad this booking was made for. Teams are
       * inserted after bookings, so this is applied as a follow-up update below.
       * Bookings without it stay individual bookings, which is a state worth
       * having in the demo data too.
       */
      team?: number;
    }> = [
      { court: 0, user: 0, dateOff: 0, start: "17:00", end: "18:00", pay: "paid", method: "eSewa", pub: true, need: 10, title: "Evening Rush — Arena A ⚡", team: 0 },
      { court: 0, user: 1, dateOff: 0, start: "18:00", end: "19:00", pay: "pending", method: "Khalti", team: 0 },
      { court: 0, user: 2, dateOff: 1, start: "07:00", end: "08:00", pay: "paid", method: "Cash at Venue", team: 3 },
      { court: 1, user: 3, dateOff: 0, start: "19:00", end: "20:00", pay: "paid", method: "Khalti", team: 1 },
      { court: 3, user: 4, dateOff: 1, start: "18:00", end: "20:00", pay: "pending", method: "eSewa", pub: true, need: 12, title: "Rooftop Rumble 🌇" },
      { court: 8, user: 5, dateOff: 2, start: "16:00", end: "17:00", pay: "paid", method: "Khalti" },
      { court: 5, user: 0, dateOff: -1, start: "17:00", end: "18:00", pay: "paid", method: "Cash", team: 3 },
      { court: 10, user: 1, dateOff: 3, start: "08:00", end: "09:00", pay: "pending", method: "eSewa" },
    ];
    const insertedBookings: Array<{ id: number }> = [];
    for (const b of bookingSeeds) {
      const court = insertedCourts[b.court];
      const hourNum = parseInt(b.start.split(":")[0], 10);
      const rate = hourNum < 12 ? court.priceMorning : court.pricePerHour;
      const dur = parseInt(b.end.split(":")[0], 10) - hourNum;
      const isPublic = b.pub === true;
      const need = b.need ?? 10;
      const crew = Math.max(1, Math.ceil(need / 2));
      const open = need - crew;
      const inserted = await db
        .insert(bookings)
        .values({
          courtId: court.id,
          userId: insertedUsers[b.user].id,
          date: d(b.dateOff),
          startTime: b.start,
          endTime: b.end,
          durationHours: dur,
          totalPrice: rate * dur,
          status: b.dateOff < 0 ? "completed" : "confirmed",
          paymentStatus: b.pay,
          paymentMethod: b.method,
          bookerName: insertedUsers[b.user].name,
          bookerPhone: insertedUsers[b.user].phone,
          visibility: isPublic ? "public" : "private",
          playersNeeded: isPublic ? need : 0,
          ourCrew: isPublic ? crew : 1,
          openSpots: isPublic ? open : 0,
        })
        .returning();
      insertedBookings.push(inserted[0]);
      // Public bookings get a linked open-match listing.
      if (isPublic) {
        const bookingRow = inserted[0];
        const perPlayer = Math.max(50, Math.round(bookingRow.totalPrice / need));
        const mRows = await db
          .insert(openMatches)
          .values({
            title: b.title ?? `Open game at ${court.name} ⚡`,
            venueId: court.venueId,
            courtId: court.id,
            organizerId: insertedUsers[b.user].id,
            bookingId: bookingRow.id,
            date: d(b.dateOff),
            startTime: b.start,
            endTime: b.end,
            pricePerPlayer: perPlayer,
            maxPlayers: need,
            crewSize: crew,
            level: "All Levels",
            status: "open",
            description:
              `👥 ${crew} from our crew • 🙋 ${open} open for you! Court already booked — just join and split the cost! 🤝`,
          })
          .returning();
        await db.insert(matchJoins).values({
          matchId: mRows[0].id,
          userId: insertedUsers[b.user].id,
        });
        const others = [0, 1, 2, 3, 4, 5].filter((i) => i !== b.user).slice(0, 3);
        for (const oi of others) {
          await db.insert(matchJoins).values({
            matchId: mRows[0].id,
            userId: insertedUsers[oi].id,
          });
        }
      }
    }

    // Teams
    const seedTeams = demoTeams();
    // Home turf points at a venue that really exists on the platform.
    const venueIdByName = new Map(insertedVenues.map((v) => [v.name, v.id]));
    const insertedTeams = [];
    for (const t of seedTeams) {
      const rows = await db
        .insert(teams)
        .values({
          name: t.name,
          motto: t.motto,
          description: t.desc,
          teamCode: t.code,
          captainId: insertedUsers[t.captain].id,
          maxPlayers: 12,
          level: t.level,
          logoColor: t.color,
          wins: t.w,
          losses: t.l,
          draws: t.d,
          homeVenueId: venueIdByName.get(t.home) ?? null,
          homeGround: t.home,
          lookingForPlayers: true,
        })
        .returning();
      insertedTeams.push(rows[0]);
    }
    const memberships = demoTeamMemberships();
    for (const [ti, ui, role] of memberships) {
      await db.insert(teamMembers).values({
        teamId: insertedTeams[ti].id,
        userId: insertedUsers[ui].id,
        role,
      });
    }

    // Pending join requests 👑 — so a captain logging in has something to decide.
    const joinRequests = demoTeamJoinRequests();
    for (const [ti, ui, message] of joinRequests) {
      await db.insert(teamRequests).values({
        teamId: insertedTeams[ti].id,
        userId: insertedUsers[ui].id,
        message,
        status: "pending",
      });
    }

    // …and pending invitations 📨 — the same queue from the player's side, so the
    // accept/decline flow is testable the moment you log in as aarav's mate.
    for (const [ti, ui, message] of demoTeamInvites()) {
      const team = insertedTeams[ti];
      const player = insertedUsers[ui];
      if (!team || !player) continue;
      await db.insert(teamInvites).values({
        teamId: team.id,
        userId: player.id,
        invitedBy: team.captainId,
        message,
        status: "pending",
      });
    }

    // Attach squads to the bookings that asked for one (`bookingSeeds[].team`).
    // Teams only exist at this point, hence the follow-up update. Every team used
    // here is one the booker genuinely belongs to, matching what POST
    // /api/bookings enforces; the bookings left untagged stay individual.
    for (let bi = 0; bi < bookingSeeds.length; bi++) {
      const ti = bookingSeeds[bi].team;
      const row = insertedBookings[bi];
      if (ti === undefined || !row || !insertedTeams[ti]) continue;
      const t = insertedTeams[ti];
      await db
        .update(bookings)
        .set({ teamId: t.id, teamName: t.name })
        .where(eq(bookings.id, row.id));
    }

    // Open matches
    const matchSeeds = [
      { title: "Friday Night Showdown ⚡", venue: 0, court: 0, org: 0, off: 1, start: "19:00", end: "20:00", price: 200, max: 10, level: "Intermediate", desc: "Competitive but friendly. Bibs provided. Come 15 min early for warmup!" },
      { title: "Morning Kickabout ☀️", venue: 1, court: 3, org: 3, off: 0, start: "07:00", end: "08:00", price: 150, max: 12, level: "All Levels", desc: "Chill morning game, all levels welcome. Great for beginners!" },
      { title: "Weekend Warriors Cup 🏆", venue: 3, court: 8, org: 5, off: 3, start: "16:00", end: "18:00", price: 300, max: 14, level: "Advanced", desc: "Mini tournament style — 4 teams, knockout. Winners get free momos!" },
      { title: "Beginners Only — Learn & Play 🌱", venue: 2, court: 5, org: 1, off: 2, start: "10:00", end: "11:00", price: 120, max: 10, level: "Beginner", desc: "New to futsal? Join us! Coach on-site for first 20 minutes." },
      { title: "Midnight Madness 🌙", venue: 5, court: 12, org: 4, off: 1, start: "21:00", end: "22:00", price: 250, max: 10, level: "Intermediate", desc: "Neon lights, music, late night football. Unmatched vibes." },
    ];
    const insertedMatches = [];
    for (const m of matchSeeds) {
      const rows = await db
        .insert(openMatches)
        .values({
          title: m.title,
          venueId: insertedVenues[m.venue].id,
          courtId: insertedCourts[m.court].id,
          organizerId: insertedUsers[m.org].id,
          date: d(m.off),
          startTime: m.start,
          endTime: m.end,
          pricePerPlayer: m.price,
          maxPlayers: m.max,
          level: m.level,
          status: "open",
          description: m.desc,
        })
        .returning();
      insertedMatches.push(rows[0]);
    }
    const joinSeeds: Array<[number, number]> = [
      [0, 0], [0, 1], [0, 3], [0, 5], [0, 4],
      [1, 3], [1, 7], [1, 2],
      [2, 5], [2, 0], [2, 1], [2, 3], [2, 4], [2, 6],
      [3, 1], [3, 2], [3, 7],
      [4, 4], [4, 0],
    ];
    for (const [mi, ui] of joinSeeds) {
      await db.insert(matchJoins).values({
        matchId: insertedMatches[mi].id,
        userId: insertedUsers[ui].id,
      });
    }

    // Sample reviews from happy players.
    const reviewSeeds: Array<{ venue: number; user: number; rating: number; message: string }> = [
      { venue: 0, user: 1, rating: 5, message: "Best turf in town! The lights at night are amazing and the staff even helped us split teams. Felt like home 🏟️" },
      { venue: 0, user: 4, rating: 5, message: "Booked for my birthday game — they surprised us with extra balls and music. 10/10 vibes! 🎉" },
      { venue: 0, user: 3, rating: 4, message: "Great courts, gets busy on weekends so book early. Showers are clean! ⚽" },
      { venue: 1, user: 0, rating: 5, message: "Rooftop views while playing = unreal! Coffee after the game hits different here ☕" },
      { venue: 1, user: 5, rating: 4, message: "Cosy spot, friendly uncle at reception. Parking is a bit tight but worth it!" },
      { venue: 3, user: 2, rating: 5, message: "Played with the lake breeze — magical evening! Beginners were so welcome 🌱" },
    ];
    for (const r of reviewSeeds) {
      await db.insert(reviews).values({
        venueId: insertedVenues[r.venue].id,
        userId: insertedUsers[r.user].id,
        bookingId: null,
        rating: r.rating,
        message: r.message,
      });
    }
    // Refresh venue averages from seeded reviews.
    for (let vi = 0; vi < insertedVenues.length; vi++) {
      const mine = reviewSeeds.filter((r) => r.venue === vi);
      if (mine.length > 0) {
        const avg = mine.reduce((s, r) => s + r.rating, 0) / mine.length;
        await db
          .update(venues)
          .set({ rating: Math.round(avg * 10) / 10, totalReviews: 120 + mine.length * 37 })
          .where(eq(venues.id, insertedVenues[vi].id));
      }
    }

    return Response.json({ ok: true, message: "Seeded successfully" });
  } catch (e) {
    console.error(`[/api/seed POST] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function GET() {
  return POST();
}
