import { db } from "@/db";
import {
  users,
  venues,
  courts,
  bookings,
  teams,
  teamMembers,
  openMatches,
  matchJoins,
  reviews,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { VENUE_IMAGES } from "@/lib/futsal";
import { hashPassword, DEFAULT_PASSWORD } from "@/lib/auth";

export const dynamic = "force-dynamic";

function d(offset: number) {
  const dt = new Date();
  dt.setDate(dt.getDate() + offset);
  return dt.toISOString().slice(0, 10);
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
      return Response.json({ ok: true, message: "Already seeded", count: existing.length, seededReviews });
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
    }> = [
      { court: 0, user: 0, dateOff: 0, start: "17:00", end: "18:00", pay: "paid", method: "eSewa", pub: true, need: 10, title: "Evening Rush — Arena A ⚡" },
      { court: 0, user: 1, dateOff: 0, start: "18:00", end: "19:00", pay: "pending", method: "Khalti" },
      { court: 0, user: 2, dateOff: 1, start: "07:00", end: "08:00", pay: "paid", method: "Cash at Venue" },
      { court: 1, user: 3, dateOff: 0, start: "19:00", end: "20:00", pay: "paid", method: "Khalti" },
      { court: 3, user: 4, dateOff: 1, start: "18:00", end: "20:00", pay: "pending", method: "eSewa", pub: true, need: 12, title: "Rooftop Rumble 🌇" },
      { court: 8, user: 5, dateOff: 2, start: "16:00", end: "17:00", pay: "paid", method: "Khalti" },
      { court: 5, user: 0, dateOff: -1, start: "17:00", end: "18:00", pay: "paid", method: "Cash" },
      { court: 10, user: 1, dateOff: 3, start: "08:00", end: "09:00", pay: "pending", method: "eSewa" },
    ];
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
    const seedTeams = [
      { name: "Chabahil Chargers", motto: "Speed. Skill. Glory.", captain: 0, level: "Advanced", color: "#16a34a", home: "Dhanyentari Futsal Arena", w: 18, l: 4, d: 3 },
      { name: "Lalitpur Legends", motto: "Legacy in every goal", captain: 3, level: "Advanced", color: "#7c3aed", home: "KickOff Sports Hub", w: 15, l: 6, d: 2 },
      { name: "Pokhara Panthers", motto: "Hunt as one", captain: 5, level: "Intermediate", color: "#ea580c", home: "Lakeside Strikers Court", w: 11, l: 7, d: 4 },
      { name: "Bhaktapur Ballers", motto: "Play beautiful", captain: 1, level: "Intermediate", color: "#2563eb", home: "GoalZone Futsal Park", w: 9, l: 8, d: 3 },
      { name: "Thamel Night Owls", motto: "We own the night", captain: 4, level: "Beginner", color: "#be123c", home: "NightOwl Futsal", w: 5, l: 9, d: 2 },
    ];
    const insertedTeams = [];
    for (const t of seedTeams) {
      const rows = await db
        .insert(teams)
        .values({
          name: t.name,
          motto: t.motto,
          captainId: insertedUsers[t.captain].id,
          maxPlayers: 12,
          level: t.level,
          logoColor: t.color,
          wins: t.w,
          losses: t.l,
          draws: t.d,
          homeGround: t.home,
          lookingForPlayers: true,
        })
        .returning();
      insertedTeams.push(rows[0]);
    }
    const memberships: Array<[number, number, string]> = [
      [0, 0, "captain"], [0, 1, "player"], [0, 2, "player"], [0, 4, "player"], [0, 5, "player"],
      [1, 3, "captain"], [1, 0, "player"], [1, 6, "player"], [1, 7, "player"],
      [2, 5, "captain"], [2, 1, "player"], [2, 4, "player"],
      [3, 1, "captain"], [3, 2, "player"], [3, 7, "player"], [3, 0, "player"],
      [4, 4, "captain"], [4, 7, "player"],
    ];
    for (const [ti, ui, role] of memberships) {
      await db.insert(teamMembers).values({
        teamId: insertedTeams[ti].id,
        userId: insertedUsers[ui].id,
        role,
      });
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
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function GET() {
  return POST();
}
