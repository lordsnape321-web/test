import { Linking } from "react-native";
import { notify } from "@/lib/confirm";
import { mapsUrl } from "@/lib/location";

/**
 * Open a location in whatever maps app the phone has.
 *
 * Returns false when nothing is configured or no app can take the link, so the
 * caller can leave its row looking untappable instead of failing silently.
 */
export async function openLocation(
  locationUrl?: string | null,
  address?: string | null,
  city?: string | null,
): Promise<boolean> {
  const url = mapsUrl(locationUrl, address, city);

  if (!url) return false;

  try {
    await Linking.openURL(url);
    return true;
  } catch {
    // A desktop browser preview, or a phone with no maps app and no browser.
    notify("Couldn't open Maps", "Copy the address and search for it in your maps app.");

    return false;
  }
}
