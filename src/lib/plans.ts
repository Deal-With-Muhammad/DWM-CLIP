// What each plan gives. One place, used by the pages and by the server checks.
// Prices are what Lemon Squeezy and Paddle charge; change them there too.

export const MB = 1024 * 1024;
export const GB = 1024 * MB;

export type PlanId = "free" | "lite" | "pro";

export type Plan = {
  id: PlanId;
  name: string;
  /** US dollars a month. */
  price: number;
  storage: number;
  /** Clips per calendar month. On Free the member's storage is the real limit; this is only a ceiling
   *  nobody clipping by hand reaches, so one account can't run the engine all month at our cost. */
  clips: number;
  clipsPerVideo: number;
  maxHours: number;
  jobsAtOnce: number;
  /** The tallest picture fetched from the video. Clips are always 1080x1920. */
  quality: number;
  /** Uses our AI, so the member needs no key of their own. */
  ourAi: boolean;
};

export const FREE: Plan = { id: "free", name: "Free", price: 0, storage: 200 * MB, clips: 100, clipsPerVideo: 2, maxHours: 1, jobsAtOnce: 1, quality: 720, ourAi: false };
export const LITE: Plan = { id: "lite", name: "Lite", price: 2, storage: 1 * GB, clips: 20, clipsPerVideo: 5, maxHours: 2, jobsAtOnce: 1, quality: 1080, ourAi: true };
export const PRO: Plan = { id: "pro", name: "Pro", price: 9, storage: 5 * GB, clips: 150, clipsPerVideo: 10, maxHours: 3, jobsAtOnce: 2, quality: 1080, ourAi: true };

export const PLANS: Record<PlanId, Plan> = { free: FREE, lite: LITE, pro: PRO };

/** Extra storage, sold in blocks on top of a paid plan. */
export const STORAGE_PACK = { bytes: 10 * GB, price: 2 };

export const SITES = ["youtube.com", "youtu.be", "twitch.tv", "kick.com"];

export const STYLES = [
  { id: "bounce", label: "Bounce" },
  { id: "hype", label: "Hype" },
  { id: "clean", label: "Clean" },
] as const;

// How the wide video is fitted into the tall clip. "auto" keeps the streamer's webcam in the corner
// when the video has one, and simply fills the screen when it doesn't.
export const LAYOUTS = [
  { id: "auto", label: "Auto", hint: "Fills the screen, and keeps the streamer's webcam in the corner if the video has one." },
  { id: "crop", label: "Fill screen", hint: "The middle of the video fills the whole clip." },
  { id: "blur", label: "Whole frame", hint: "The whole wide picture, with soft blurred edges above and below." },
] as const;

/** The engine's own names for the layouts above. */
export const ENGINE_LAYOUT: Record<string, string> = { auto: "gameplay", crop: "crop", blur: "blur" };
export const fromEngineLayout = (l: string) => (l === "gameplay" ? "auto" : l === "blur" || l === "zoom" ? "blur" : "crop");

// The AI services a member can bring a key for. `model` is a sensible default they can change; `models` are a
// few to choose from until the service's own list has been fetched with their key (see api/keys/models).
export const PROVIDERS = [
  { id: "gemini", label: "Google Gemini", model: "gemini-3.5-flash-lite", models: ["gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.8-flash"], keyUrl: "https://aistudio.google.com/apikey", free: true },
  { id: "openrouter", label: "OpenRouter", model: "openrouter/free", models: ["openrouter/free", "google/gemini-3.5-flash-lite", "google/gemini-3.6-flash"], keyUrl: "https://openrouter.ai/keys", free: true },
  { id: "groq", label: "Groq", model: "llama-3.3-70b-versatile", models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"], keyUrl: "https://console.groq.com/keys", free: true },
  { id: "openai", label: "OpenAI", model: "gpt-4o-mini", models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1-nano"], keyUrl: "https://platform.openai.com/api-keys", free: false },
  { id: "xai", label: "Grok (xAI)", model: "grok-4", models: ["grok-4"], keyUrl: "https://console.x.ai", free: false },
  { id: "anthropic", label: "Claude", model: "claude-haiku-5-5", models: ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"], keyUrl: "https://console.anthropic.com", free: false },
] as const;

export function formatBytes(n: number) {
  if (n >= GB) return `${(n / GB).toFixed(n >= 10 * GB ? 0 : 1).replace(/\.0$/, "")} GB`;
  return `${Math.round(n / MB)} MB`;
}

// Gemini models Google has retired: a key made today can't use them, and from 1 December 2026 Google itself
// sends requests for them to the newer model named here. Members who saved one are moved the same way.
export const RETIRED_MODELS: Record<string, string> = {
  "gemini-2.5-flash": "gemini-3.5-flash-lite",
  "gemini-2.5-flash-lite": "gemini-3.5-flash-lite",
  "gemini-2.0-flash": "gemini-3.5-flash-lite",
  "gemini-2.5-pro": "gemini-3.8-flash",
};
