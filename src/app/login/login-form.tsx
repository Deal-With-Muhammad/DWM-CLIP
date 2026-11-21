"use client";

import { Button, Input, Label, TextField } from "@heroui/react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { FREE_CLOSED_ON, FREE_OPEN, LITE } from "@/lib/plans";
import { useRef, useState } from "react";

type Step = { kind: "email" } | { kind: "code"; email: string };

const CODE_LENGTH = 6;

// Mistyped email domains seen at sign-up ("gamil.com" most of all): the code goes nowhere and the member waits.
const TYPOS: Record<string, string> = {
  "gamil.com": "gmail.com",
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmil.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gnail.com": "gmail.com",
  "gmaill.com": "gmail.com",
  "gmail.con": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.cm": "gmail.com",
  "gmail.comm": "gmail.com",
  "hotmial.com": "hotmail.com",
  "hotmai.com": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "outlok.com": "outlook.com",
  "outlook.con": "outlook.com",
  "yaho.com": "yahoo.com",
  "yahooo.com": "yahoo.com",
  "yahoo.con": "yahoo.com",
  "icloud.con": "icloud.com",
};

/** The address with its domain corrected, when the domain is a known slip. */
function corrected(email: string) {
  const at = email.lastIndexOf("@");
  const fix = TYPOS[email.slice(at + 1).replace(/[^a-z0-9.-]+$/, "")];
  return at > 0 && fix ? `${email.slice(0, at + 1)}${fix}` : null;
}

/** Sign in or sign up with a code sent by email. No passwords. Either page works for a new or an existing address. */
export function LoginForm({ mode, next, reauth, linkFailed }: { mode: "signin" | "signup"; next: string; reauth: boolean; linkFailed: boolean }) {
  const signup = mode === "signup";
  const other = `${signup ? "/login" : "/signup"}${next && next !== "/app" ? `?next=${encodeURIComponent(next)}` : ""}`;
  const [step, setStep] = useState<Step>({ kind: "email" });
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(linkFailed ? "That sign-in link has expired or was already used. Ask for a new code." : null);
  const [resent, setResent] = useState(false);
  // The address the member was asked about ("did you mean...?"), so they are only asked once.
  const asked = useRef("");
  const codeInput = useRef<HTMLInputElement>(null);

  const post = async (path: string, body: object) => {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || "Something went wrong. Please try again.");
    return j;
  };

  const sendCode = async (to: string) => {
    setBusy(true);
    setError(null);
    try {
      await post("/api/auth/otp", { email: to, next });
      setStep({ kind: "code", email: to });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send the code.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value: string) => {
    if (step.kind !== "code" || busy) return;
    setBusy(true);
    setError(null);
    try {
      const j = await post("/api/auth/verify", { email: step.email, code: value, next });
      // A full load, so the header and every page pick up the new session.
      window.location.assign(j.next || next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't check the code.");
      setCode("");
      setBusy(false);
      codeInput.current?.focus();
    }
  };

  const errorNote = error && (
    <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-[14px] leading-snug text-danger">
      {error}
    </p>
  );

  if (step.kind === "email") {
    return (
      <>
        <h1 className="font-display text-[34px] leading-[1.1] tracking-[-0.01em]">{reauth ? "Confirm it's you" : signup ? "Create your account" : "Welcome back"}</h1>
        <p className="mt-3 text-[16px] leading-relaxed text-muted">
          {reauth
            ? "The admin area asks for a fresh code every 12 hours."
            : signup
              ? FREE_OPEN
                ? "Enter your email and we'll send a 6-digit code to confirm it. It's free with your own AI key, no card needed."
                : `Enter your email and we'll send a 6-digit code to confirm it. Plans start at $${LITE.price} a month; the free plan closed on ${FREE_CLOSED_ON}.`
              : "Enter your email and we'll send you a 6-digit code. There's no password to remember."}
        </p>
        <form
          className="mt-7 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const to = email.trim().toLowerCase();
            if (!to) return;
            const fix = corrected(to);
            if (fix && asked.current !== to) {
              asked.current = to;
              setEmail(fix);
              setError(`That looked like a typo, so we changed it to ${fix}. Press the button again if that's right.`);
              return;
            }
            sendCode(to);
          }}
        >
          <TextField value={email} onChange={setEmail} type="email" autoComplete="email" name="email">
            <Label>Email address</Label>
            <Input placeholder="you@example.com" autoCapitalize="none" spellCheck={false} required autoFocus />
          </TextField>
          {errorNote}
          <Button type="submit" size="lg" fullWidth isDisabled={busy}>
            {busy ? "Sending your code…" : signup ? "Create account" : "Sign in"}
          </Button>
        </form>
        {!reauth && (
          <p className="mt-5 text-[14.5px] text-ink-2">
            {signup ? "Already have an account?" : "New to DWM Clip?"}{" "}
            <Link href={other} className="font-medium text-brand-ink underline underline-offset-4">
              {signup ? "Sign in" : "Create an account"}
            </Link>
            {!signup && <span className="mt-1 block text-[13px] text-muted">Signing in with a new email creates your account too.</span>}
          </p>
        )}
        <p className="mt-5 text-[13px] leading-relaxed text-muted">
          By continuing, you agree to the{" "}
          <Link href="/terms" className="text-ink underline underline-offset-4">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="text-ink underline underline-offset-4">
            Privacy Policy
          </Link>
          .
        </p>
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        className="-ms-1 mb-6 inline-flex items-center gap-1.5 rounded-lg px-1 py-1 text-[14px] text-muted transition-colors hover:text-ink"
        onClick={() => {
          setStep({ kind: "email" });
          setCode("");
          setError(null);
          setResent(false);
        }}
      >
        <ArrowLeft className="size-4" aria-hidden /> Use a different email
      </button>
      <h1 className="font-display text-[34px] leading-[1.1] tracking-[-0.01em]">Check your email</h1>
      <p className="mt-3 text-[16px] leading-relaxed text-muted">
        Enter the code we sent to <strong className="font-medium break-words text-ink">{step.email}</strong>, or tap the link in the email on this device.
      </p>
      <form
        className="mt-7 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === CODE_LENGTH) verify(code);
        }}
      >
        <CodeBoxes
          ref={codeInput}
          value={code}
          disabled={busy}
          onChange={(v) => {
            setCode(v);
            if (v.length === CODE_LENGTH) verify(v);
          }}
        />
        {errorNote}
        <Button type="submit" size="lg" fullWidth isDisabled={busy || code.length < CODE_LENGTH}>
          {busy ? "Signing you in…" : "Sign in"}
        </Button>
      </form>
      <p className="mt-5 text-[14px] leading-relaxed text-muted">
        {resent ? (
          "New code sent. It can take a minute, and it may land in spam. The earlier code still works too."
        ) : (
          <>
            Nothing yet? Check your spam folder, or{" "}
            <button
              type="button"
              className="text-ink underline underline-offset-4 disabled:text-muted"
              disabled={busy}
              onClick={async () => {
                if (await sendCode(step.email)) {
                  setResent(true);
                  // The link comes back after a while, for an email that really never arrives.
                  setTimeout(() => setResent(false), 45_000);
                }
              }}
            >
              send a new code
            </button>
            .
          </>
        )}
      </p>
    </>
  );
}

/** One real input (so paste and the phone's code suggestion work), drawn as six boxes. */
function CodeBoxes({ ref, value, disabled, onChange }: { ref: React.Ref<HTMLInputElement>; value: string; disabled: boolean; onChange: (v: string) => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="relative">
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        readOnly={disabled}
        aria-label="6-digit code"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        className="absolute inset-0 z-10 w-full cursor-text bg-transparent text-transparent caret-transparent opacity-0 outline-none"
      />
      <div className="grid grid-cols-6 gap-2" aria-hidden>
        {Array.from({ length: CODE_LENGTH }, (_, i) => {
          const active = focused && i === Math.min(value.length, CODE_LENGTH - 1);
          return (
            <span
              key={i}
              className={`grid h-14 place-items-center rounded-xl bg-subtle font-display text-[24px] tabular-nums transition-shadow ${active ? "ring-2 ring-brand" : ""}`}
            >
              {value[i] ?? ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}
