import { SITES } from "@/lib/plans";

/** The link as it will be fetched, or null when it isn't a YouTube, Twitch or Kick address. */
export function videoUrl(raw: unknown) {
  if (typeof raw !== "string" || raw.length > 500) return null;
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return SITES.some((s) => host === s || host.endsWith(`.${s}`)) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** "11 h 36 min", "42 min" or "0:19": how long a video is, said the way people say it. */
export function howLong(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `0:${String(s).padStart(2, "0")}`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "1:05:00": a moment in a video. */
export function moment(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export const hoursWord = (hours: number) => (hours === 1 ? "hour" : `${hours} hours`);
