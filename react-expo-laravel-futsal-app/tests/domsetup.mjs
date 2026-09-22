// MUST be the first import in any DOM test: react-dom computes
// `isInputEventSupported` once at module init from the then-current `document`.
// If the jsdom globals are installed afterwards, React takes its IE
// attachEvent polyfill for text inputs and onChange never fires.
import { JSDOM } from "jsdom";

export const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
const w = dom.window;
const g = globalThis;
for (const key of ["self","window","document","navigator","HTMLElement","HTMLInputElement","Element","Node","Event","MouseEvent","KeyboardEvent","InputEvent","File","FileList","Blob","localStorage","sessionStorage","FormData","DOMParser","getComputedStyle","requestAnimationFrame","cancelAnimationFrame"]) {
  Object.defineProperty(g, key, { value: w[key], configurable: true, writable: true });
}
Object.defineProperty(g, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true, writable: true });
