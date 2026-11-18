"use client";

import { useState } from "react";

import { deleteClip } from "./actions";

/** Removes a member's clip. It can't be brought back, so the first press only asks. */
export function DeleteClip({ id }: { id: string }) {
  const [sure, setSure] = useState(false);
  if (!sure) {
    return (
      <button type="button" onClick={() => setSure(true)} className="rounded-lg bg-subtle px-2.5 py-1 whitespace-nowrap hover:bg-line">
        Delete
      </button>
    );
  }
  return (
    <form action={deleteClip} className="flex gap-1.5">
      <input type="hidden" name="id" value={id} />
      <button className="rounded-lg bg-danger-soft px-2.5 py-1 font-medium whitespace-nowrap text-danger">Yes, delete</button>
      <button type="button" onClick={() => setSure(false)} className="rounded-lg bg-subtle px-2.5 py-1 hover:bg-line">
        Keep
      </button>
    </form>
  );
}
