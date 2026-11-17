"use client";

export function SignOut({ email }: { email: string }) {
  return (
    <button
      type="button"
      title={email}
      className="rounded-lg px-2.5 py-1.5 text-muted hover:bg-subtle hover:text-ink"
      onClick={async () => {
        await fetch("/api/auth/signout", { method: "POST" });
        window.location.assign("/");
      }}
    >
      Sign out
    </button>
  );
}
