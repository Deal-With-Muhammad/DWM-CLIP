"use client";

import { Button } from "@heroui/react";
import { Link2 } from "lucide-react";
import { useState } from "react";

/** The link field on the homepage. It carries the link into the app (through sign-in, the first time). */
export function TryBox() {
  const [url, setUrl] = useState("");
  return (
    <form
      className="flex flex-col gap-2.5 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault();
        window.location.assign(url.trim() ? `/app?url=${encodeURIComponent(url.trim())}` : "/app");
      }}
    >
      <label className="relative flex-1">
        <span className="sr-only">Video link</span>
        <Link2 className="pointer-events-none absolute start-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" aria-hidden />
        <input value={url} onChange={(e) => setUrl(e.target.value)} type="url" inputMode="url" placeholder="Paste a YouTube, Twitch or Kick link" autoCapitalize="none" spellCheck={false} className="field-native h-12 ps-10" />
      </label>
      <Button type="submit" size="lg">
        Make clips
      </Button>
    </form>
  );
}
