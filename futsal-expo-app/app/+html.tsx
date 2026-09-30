import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

/**
 * The web document itself.
 *
 * Expo serves every route from this one HTML file, so this is where the
 * browser-level design lives: the canvas colour behind the app (so a dark-mode
 * user never sees a white flash, and light mode is the warm clubhouse peach
 * rather than browser white), the text rendering hints, and the scrollbars and
 * focus ring that React Native has no API for.
 *
 * `data-theme` is written by ThemeProvider as soon as the saved mode is known,
 * so these rules follow the in-app toggle instead of drifting from it; until
 * then `prefers-color-scheme` is the best guess, which keeps the first paint
 * right too.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        <meta name="theme-color" content="#FFF9F0" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#020617" media="(prefers-color-scheme: dark)" />
        <meta
          name="description"
          content="Book futsal courts across Nepal — live availability, team splits and venue payments."
        />
        {/* Gives RN-web's scroll views the whole document, as Expo expects. */}
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: globalCss }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const globalCss = `
:root {
  color-scheme: light;
  /* The player app's warm clubhouse canvas, and Owner Studio's slate. */
  --app-canvas: #FFF9F0;
  --app-scrollbar: rgba(120,113,108,0.35);
  --app-selection: #059669;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
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
  height: 100%;
  background-color: var(--app-canvas);
}

/* The app is a fixed canvas that scrolls internally; the document must not
   rubber-band behind it. */
body {
  overscroll-behavior-y: none;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  /* Stop mobile browsers from re-scaling our carefully sized type. */
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

/* Slim, theme-aware scrollbars — the default grey bar next to a peach canvas
   is the one piece of chrome the app cannot style itself. */
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

@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`;
