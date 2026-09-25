/**
 * Web-compatible alias for the native venue detail screen.
 *
 * The Next.js app links to /venues/:id. Expo's first booking slice used the
 * singular /venue/:id path, so keep that route working while exposing the same
 * plural URL that notification payloads and shared links use on the web.
 */
export { default } from "../venue/[id]";
