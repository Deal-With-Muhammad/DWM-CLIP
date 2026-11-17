import Link from "next/link";

/** The mark: a C with a play button in its mouth, on the violet tile. The same drawing as public/icon.svg. */
export function Mark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden>
      <rect width="512" height="512" rx="112" fill="#6d3df0" />
      <path d="M326.4 180.2A118 118 0 1 0 326.4 331.8" fill="none" stroke="#fff" strokeWidth="58" />
      <path d="M204 198v116l98-58z" fill="#ff4fa3" />
      <g fill="none" strokeWidth="22" strokeLinecap="round">
        <path d="M362 204l36-22M362 308l36 22" stroke="#5cc8f2" />
        <path d="M372 256h44" stroke="#ff4fa3" />
      </g>
    </svg>
  );
}

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2.5 rounded-lg text-[17px] font-semibold tracking-[-0.01em] text-ink">
      <Mark />
      DWM Clip
    </Link>
  );
}
