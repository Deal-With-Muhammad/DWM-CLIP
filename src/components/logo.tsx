import Link from "next/link";

/** The mark: a vertical frame with a play button, on the brand tile. A placeholder until a real logo is chosen. */
export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2.5 rounded-lg text-[17px] font-semibold tracking-[-0.01em] text-ink">
      <span className="grid size-8 place-items-center rounded-[9px] bg-brand">
        <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden>
          <rect x="7" y="3" width="10" height="18" rx="2.6" fill="none" stroke="#fff" strokeWidth="2" />
          <path d="M10.6 9.3v5.4l4.4-2.7z" fill="#fff" />
        </svg>
      </span>
      DWM Clip
    </Link>
  );
}
