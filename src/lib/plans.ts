// What each plan gives. One place, used by the pages and by the server checks.
// Prices are what Lemon Squeezy and Paddle charge; change them there too.
//
// Every plan picks the moments with the member's own AI key (since 2026-11-19 there is no AI of ours).
// A plan pays for storage, more clips from one video, more of a long video at a time and a sharper picture.

export const MB = 1024 * 1024;
export const GB = 1024 * MB;

export type PlanId = "free" | "lite" | "pro";

export type Plan = {
  id: PlanId;
  name: string;
  /** US dollars a month. */
  price: number;
  storage: number;
  /** Clips per calendar month. The member's storage is the real limit on every plan; this is only a
   *  ceiling nobody clipping by hand reaches, so one account can't run the engine all month at our cost
   *  (a clip costs us about a cent to make). */
  clips: number;
  /** Videos a member may start in a calendar month (errored ones don't count). Each video runs a container
   *  that costs us about 5 cents an hour of video (measured 2026-11-20), so this is what keeps the bill down. */
  videos: number;
  clipsPerVideo: number;
  /** The longest stretch of one video that is clipped at once. 0.5 is 30 minutes. */
  maxHours: number;
  jobsAtOnce: number;
  /** The tallest picture fetched from the video. Clips are always 1080x1920. */
  quality: number;
  /** Days a clip is kept before it is deleted for the member (0: kept until they delete it). Only Free has a
   *  limit: Free clips pile up by the gigabyte each day and almost none are opened again after a week. */
  keepDays: number;
};

export const FREE: Plan = { id: "free", name: "Free", price: 0, storage: 200 * MB, clips: 100, videos: 1, clipsPerVideo: 2, maxHours: 0.5, jobsAtOnce: 1, quality: 720, keepDays: 7 };
export const LITE: Plan = { id: "lite", name: "Lite", price: 2, storage: 1 * GB, clips: 150, videos: 25, clipsPerVideo: 5, maxHours: 1, jobsAtOnce: 1, quality: 1080, keepDays: 0 };
export const PRO: Plan = { id: "pro", name: "Pro", price: 9, storage: 5 * GB, clips: 600, videos: 80, clipsPerVideo: 10, maxHours: 3, jobsAtOnce: 2, quality: 1080, keepDays: 0 };

/**
 * Whether the Free plan takes new videos. Closed on 21 November 2026 (the owner's decision): in its first four
 * days Free clipping cost about $18 a day in containers, against $8 a month coming in. While it is closed a Free
 * member can still sign in, watch and download the clips they made, and buy a plan or video hours; they can't
 * start a video or change a clip. Set this to true to open it again: the daily and monthly ceilings in
 * lib/server/budget.ts then apply.
 */
export const FREE_OPEN: boolean = false;
/** The day the Free plan closed, as members read it. */
export const FREE_CLOSED_ON = "21 November 2026";
/** What a Free member is told while the plan is closed. The way to carry on (a plan, or hours) follows it. */
export const FREE_CLOSED = `Sorry, the free plan closed on ${FREE_CLOSED_ON}. So many people joined that free clipping cost more than we could cover, and we apologise for the inconvenience.`;

export const PLANS: Record<PlanId, Plan> = { free: FREE, lite: LITE, pro: PRO };

/**
 * Video hours, bought once and never expiring, on any plan (Free too). They clip a video longer than the plan
 * takes, up to HOURS_PER_VIDEO at a time, or any video once the plan's videos for the month are used. Only the
 * length actually clipped is taken. Our cost is about 5.5 cents an hour of video (2026-11-20), so even the
 * biggest pack leaves most of the price after Lemon Squeezy's 5% + 50 cents.
 */
export const HOUR_PACKS = [
  { hours: 10, price: 3 },
  { hours: 30, price: 7 },
  { hours: 100, price: 19 },
] as const;
export const HOURS_PER_VIDEO = 4;
/** Clips from one video made with bought hours, when the plan gives fewer. */
export const HOURS_CLIPS_PER_VIDEO = 5;

/** "1 video", "25 videos". */
export const videosWord = (n: number) => `${n} video${n === 1 ? "" : "s"}`;

/** "2.5 hours", "45 minutes": a balance of hours the way people say it. */
export const hoursLeftWord = (h: number) => (h <= 0 ? "no hours" : h < 1 ? `${Math.max(1, Math.round(h * 60))} minutes` : `${Math.round(h * 10) / 10} hour${Math.round(h * 10) / 10 === 1 ? "" : "s"}`);

/** Extra storage, sold in blocks on top of a paid plan. */
export const STORAGE_PACK = { bytes: 10 * GB, price: 2 };

export const SITES = ["youtube.com", "youtu.be", "twitch.tv", "kick.com"];

export const STYLES = [
  { id: "bounce", label: "Bounce" },
  { id: "hype", label: "Hype" },
  { id: "clean", label: "Clean" },
] as const;

// How the wide video is fitted into the tall clip. "auto" keeps the streamer's webcam in the corner
// when the video has one, and simply fills the screen when it doesn't. "follow" finds the streamer's face,
// cuts them out and shows them above the game, moving with their head; a clip they aren't in fills the screen.
export const LAYOUTS = [
  { id: "auto", label: "Auto", hint: "Fills the screen, and keeps the streamer's webcam in the corner if the video has one." },
  { id: "follow", label: "Follow streamer", hint: "The streamer is cut out and shown above the game, and the picture moves with their head. A clip with no face in it fills the screen instead." },
  { id: "crop", label: "Fill screen", hint: "The middle of the video fills the whole clip." },
  { id: "blur", label: "Whole frame", hint: "The whole wide picture, with soft blurred edges above and below." },
] as const;

/** The engine's own names for the layouts above. */
export const ENGINE_LAYOUT: Record<string, string> = { auto: "gameplay", follow: "follow", crop: "crop", blur: "blur" };
export const fromEngineLayout = (l: string) => (l === "gameplay" ? "auto" : l === "follow" ? "follow" : l === "blur" || l === "zoom" ? "blur" : "crop");

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

/** Roughly what one finished clip takes up. */
export const CLIP_BYTES = 25 * MB;

/** "about 8 clips": how many clips a plan's storage holds, rounded the way people say it. */
export function roomFor(bytes: number) {
  const n = bytes / CLIP_BYTES;
  return `about ${n >= 100 ? Math.round(n / 50) * 50 : n >= 20 ? Math.round(n / 10) * 10 : Math.round(n)} clips`;
}

/** What a plan gives, one line each, for the plan cards. */
export function planRows(p: Plan) {
  if (p.id === "free" && !FREE_OPEN) return [`Closed to new videos since ${FREE_CLOSED_ON}`, `Clips already made are kept for ${p.keepDays} days`, "Watch and download them any time"];
  return [
    `${videosWord(p.videos)} a month`,
    `Up to ${lengthWord(p.maxHours)} of each video`,
    `${p.clipsPerVideo} clips from one video`,
    `${formatBytes(p.storage)} of storage, ${roomFor(p.storage)}`,
    p.keepDays ? `Clips kept for ${p.keepDays} days` : "Clips kept until you delete them",
    ...(p.quality >= 1080 ? ["Sharper 1080p source"] : []),
    ...(p.jobsAtOnce > 1 ? ["Two videos at once"] : []),
    ...(p.id === "free" ? [] : ["Add 10 GB more whenever you need it"]),
  ];
}

/** 0.5 -> "30 minutes", 1 -> "1 hour", 3 -> "3 hours". */
export const lengthWord = (hours: number) => (hours < 1 ? `${Math.round(hours * 60)} minutes` : hours === 1 ? "1 hour" : `${hours} hours`);

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
