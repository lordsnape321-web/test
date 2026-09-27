/**
 * Web-compatible alias for the native venue detail screen.
 *
 * Notifications and shared links use /venues/:id. Expo's first booking slice
 * used the singular /venue/:id path, so keep that route working while exposing
 * the plural URL as the canonical route.
 */
export { default } from "../venue/[id]";
