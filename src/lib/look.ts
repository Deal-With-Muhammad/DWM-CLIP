// A member's own caption look: what "Custom" means in the caption choices.
// Used by the pages (the picker), the server (checking what the browser sent) and the engine (engine/runner.py).

export type Look = {
  /** Colour of the words, "rrggbb". */
  text: string;
  /** Colour of the word being said. */
  highlight: string;
  size: "s" | "m" | "l";
  font: "poppins" | "anton" | "archivo";
  /** ALL CAPS. */
  upper: boolean;
  position: "bottom" | "middle" | "top";
};

export const DEFAULT_LOOK: Look = { text: "ffffff", highlight: "fff000", size: "m", font: "poppins", upper: true, position: "bottom" };

export const SWATCHES = ["ffffff", "fff000", "ff4fa3", "5cc8f2", "a48bff", "ff9f1c", "ff4d4d", "7dff8a"];

export const SIZES = [
  { id: "s", label: "Small" },
  { id: "m", label: "Medium" },
  { id: "l", label: "Large" },
] as const;

export const FONTS = [
  { id: "poppins", label: "Poppins", css: "var(--font-sans)" },
  { id: "anton", label: "Anton", css: "Impact, 'Arial Narrow', sans-serif" },
  { id: "archivo", label: "Archivo Black", css: "'Arial Black', var(--font-sans)" },
] as const;

export const POSITIONS = [
  { id: "bottom", label: "Bottom" },
  { id: "middle", label: "Middle" },
  { id: "top", label: "Top" },
] as const;

const HEX = /^[0-9a-f]{6}$/;

/** A look as stored or as sent by a browser, made safe: unknown values fall back to the defaults. Null if there is none. */
export function cleanLook(v: unknown): Look | null {
  let o = v;
  if (typeof v === "string") {
    try {
      o = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const hex = (x: unknown, fallback: string) => {
    const s = typeof x === "string" ? x.replace(/^#/, "").toLowerCase() : "";
    return HEX.test(s) ? s : fallback;
  };
  const one = <T extends string>(x: unknown, list: readonly { id: T }[], fallback: T) => (list.some((i) => i.id === x) ? (x as T) : fallback);
  return {
    text: hex(r.text, DEFAULT_LOOK.text),
    highlight: hex(r.highlight, DEFAULT_LOOK.highlight),
    size: one(r.size, SIZES, DEFAULT_LOOK.size),
    font: one(r.font, FONTS, DEFAULT_LOOK.font),
    upper: r.upper !== false,
    position: one(r.position, POSITIONS, DEFAULT_LOOK.position),
  };
}
