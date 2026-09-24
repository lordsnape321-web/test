import { LeagueDetailScreen } from "../../leagues/[id]";

/** Owner Studio's league control room keeps the detail view inside /admin. */
export default function OwnerLeagueDetailScreen() {
  return <LeagueDetailScreen ownerMode />;
}
