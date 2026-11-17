// What each plan gives. One place, used by the pages and by the server checks.
// Prices are what Lemon Squeezy charges; change them there too.

export const MB = 1024 * 1024;
export const GB = 1024 * MB;

export const FREE = {
  name: "Free",
  storage: 200 * MB,
  /** Clips in total, ever. After that it's Pro. */
  clips: 2,
  clipsPerVideo: 2,
  maxHours: 1,
  jobsAtOnce: 1,
};

export const PRO = {
  name: "Pro",
  price: 9,
  storage: 5 * GB,
  /** Clips per calendar month. */
  clips: 100,
  clipsPerVideo: 10,
  maxHours: 3,
  jobsAtOnce: 2,
};

/** Extra storage, sold in blocks on top of Pro. */
export const STORAGE_PACK = { bytes: 10 * GB, price: 2 };

export const SITES = ["youtube.com", "youtu.be", "twitch.tv", "kick.com"];

export const STYLES = [
  { id: "bounce", label: "Bounce" },
  { id: "hype", label: "Hype" },
  { id: "clean", label: "Clean" },
] as const;

export const LAYOUTS = [
  { id: "gameplay", label: "Gameplay + facecam" },
  { id: "crop", label: "Fill the screen" },
  { id: "blur", label: "Full frame, blurred edges" },
] as const;

// The AI services a member can bring a key for. `model` is a sensible default they can change.
export const PROVIDERS = [
  { id: "gemini", label: "Google Gemini", model: "gemini-2.5-flash", keyUrl: "https://aistudio.google.com/apikey", free: true },
  { id: "openrouter", label: "OpenRouter", model: "google/gemini-2.5-flash", keyUrl: "https://openrouter.ai/keys", free: true },
  { id: "groq", label: "Groq", model: "llama-3.3-70b-versatile", keyUrl: "https://console.groq.com/keys", free: true },
  { id: "openai", label: "OpenAI", model: "gpt-4o-mini", keyUrl: "https://platform.openai.com/api-keys", free: false },
  { id: "xai", label: "Grok (xAI)", model: "grok-4", keyUrl: "https://console.x.ai", free: false },
  { id: "anthropic", label: "Claude", model: "claude-haiku-5-5", keyUrl: "https://console.anthropic.com", free: false },
] as const;

export function formatBytes(n: number) {
  if (n >= GB) return `${(n / GB).toFixed(n >= 10 * GB ? 0 : 1).replace(/\.0$/, "")} GB`;
  return `${Math.round(n / MB)} MB`;
}
