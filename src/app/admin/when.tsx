"use client";

import { useSyncExternalStore } from "react";

const never = () => () => {};

/** A date and time in the reader's own time zone ("18 Nov, 14:32"). The server can't know the zone, so it sends UTC and the browser swaps it. */
export function When({ iso }: { iso: string }) {
  const text = useSyncExternalStore(
    never,
    () => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
    () => `${iso.slice(0, 16).replace("T", " ")} UTC`,
  );
  return (
    <time dateTime={iso} className="whitespace-nowrap">
      {text}
    </time>
  );
}
