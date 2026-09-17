import { redirect } from "next/navigation";

/**
 * Leagues moved 🏆
 *
 * The listing now lives inside Matches, as the "League matches" half of the
 * open-games / league-matches toggle. Leagues are matches with a table attached,
 * and giving them their own top-level tab was one destination too many — on a
 * phone the bottom rail had already run out of room for it.
 *
 * This route stays as a redirect rather than being deleted, so every existing
 * bookmark, seeded notification link and shared URL lands somewhere sensible
 * instead of 404ing. The league *detail* page (`/leagues/[id]`) is untouched —
 * that is still where a host runs the competition.
 */
export default function LeaguesIndexPage() {
  redirect("/matches?tab=leagues");
}
