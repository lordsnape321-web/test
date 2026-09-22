// `domsetup.mjs` is deliberately plain JavaScript: it has to install the DOM
// globals *before* react-dom initialises, and the suites import it first for
// that reason. jsdom ships no type definitions, so this sibling declaration
// exists purely so `tsc --noEmit` — whose `include` covers `**/*.tsx` — can
// type-check the DOM suites instead of failing on an implicit `any`.
//
// Only `dom.window` is used by the suites, and it is the ordinary DOM window.
export declare const dom: {
  window: Window & typeof globalThis;
};
