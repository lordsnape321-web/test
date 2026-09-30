import { Platform } from "react-native";

/**
 * Browser-document styling, injected at runtime.
 *
 * `app/+html.tsx` would be the documented place for this, but it is only read
 * when Expo is rendering the document itself (`web.output: "static"`); this app
 * runs `web.output: "single"`, where Expo serves its own template and the file
 * is ignored entirely. So the styles are injected here instead, from the root
 * layout's module scope — which runs before the first render, so the canvas is
 * already the right colour on the first paint.
 *
 * Everything in this file is web-only; `Platform.OS !== "web"` returns
 * immediately, so the native app never touches it.
 */

const STYLE_ID = "futsal-web-document";

/**
 * The document itself: canvas colour, scrollbars, focus ring and the
 * desktop scale-up. React Native has no API for any of it — these live outside
 * the app's own view tree.
 */
const documentCss = `
:root {
  color-scheme: light;
  /* The player app's warm clubhouse canvas, and Owner Studio's slate. */
  --app-canvas: #FFF9F0;
  --app-scrollbar: rgba(120,113,108,0.35);
  --app-selection: #059669;
}

/* Before React has restored the saved mode there is no data-theme yet, so the
   OS preference is the best guess — and it keeps the first paint right. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
    color-scheme: dark;
    --app-canvas: #020617;
    --app-scrollbar: rgba(148,163,184,0.35);
  }
}

:root[data-theme="dark"],
:root.dark {
  color-scheme: dark;
  --app-canvas: #020617;
  --app-scrollbar: rgba(148,163,184,0.35);
}

:root[data-theme="light"] {
  color-scheme: light;
}

html,
body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  background-color: var(--app-canvas);
}

/* The React Native root must stretch to the window: without this it can lay out
   at its content height, which leaves a dead strip beside or under the app on a
   desktop browser. */
#root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
}

#root > div {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}

/* The app is a fixed canvas that scrolls internally; the document must not
   rubber-band behind it. */
body {
  overscroll-behavior-y: none;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}

::selection {
  background-color: var(--app-selection);
  color: #FFFFFF;
}

/* React Native draws its own focus states for inputs; a keyboard user still
   needs to see where they are when tabbing through links and buttons. */
:focus-visible {
  outline: 2px solid var(--app-selection);
  outline-offset: 2px;
}

/* Slim, theme-aware scrollbars — the default grey bar next to a peach canvas is
   the one piece of chrome the app cannot style itself. */
* {
  scrollbar-width: thin;
  scrollbar-color: var(--app-scrollbar) transparent;
}

*::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

*::-webkit-scrollbar-track {
  background: transparent;
}

*::-webkit-scrollbar-thumb {
  background-color: var(--app-scrollbar);
  border-radius: 999px;
  border: 3px solid transparent;
  background-clip: content-box;
}

/* Desktop windows get a scaled-up interface — the same effect as browser zoom,
   and it re-applies the moment the window crosses a breakpoint instead of being
   frozen at startup. The type scale in src/theme.ts is tuned for a phone held at
   arm's length, which is why 10-14px text reads as tiny on a monitor: scaling
   the whole window keeps type, padding, icons and radii in proportion. */
@media (min-width: 1024px) {
  body {
    zoom: 1.08;
  }
}

@media (min-width: 1440px) {
  body {
    zoom: 1.15;
  }
}

@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`;

function ensureThemeColorMeta(content: string, media: "light" | "dark") {
  const selector = `meta[name="theme-color"][media="(prefers-color-scheme: ${media})"]`;
  if (document.head.querySelector(selector)) return;
  const meta = document.createElement("meta");
  meta.name = "theme-color";
  meta.content = content;
  meta.media = `(prefers-color-scheme: ${media})`;
  document.head.appendChild(meta);
}

/** Idempotent — safe to call from anywhere that might run more than once. */
export function installWebDocument(): void {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = documentCss;
    document.head.appendChild(style);
  }
  // Tints the browser chrome on mobile (the address bar) to match the app.
  ensureThemeColorMeta("#FFF9F0", "light");
  ensureThemeColorMeta("#020617", "dark");
}
