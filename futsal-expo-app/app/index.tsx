import { Redirect } from "expo-router";

/**
 * Home is public on the web app. `(app)` is a visual route group, not an
 * authentication gate; its screens render helpful signed-out states as needed.
 */
export default function Index() {
  return <Redirect href="/(app)" />;
}
