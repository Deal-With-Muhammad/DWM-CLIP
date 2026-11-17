"use client";

import { FONTS, POSITIONS, SIZES, SWATCHES, type Look } from "@/lib/look";
import { STYLES } from "@/lib/plans";

/** The caption choice: a ready-made style, the member's own look ("Custom"), or no captions. */
export function CaptionChoice({
  style,
  captions,
  look,
  onStyle,
  onCaptions,
  onLook,
}: {
  style: string;
  captions: boolean;
  look: Look;
  onStyle: (s: string) => void;
  onCaptions: (on: boolean) => void;
  onLook: (l: Look) => void;
}) {
  const pick = (s: string) => {
    onStyle(s);
    onCaptions(true);
  };
  return (
    <div>
      <div className="seg">
        {STYLES.map((s) => (
          <button key={s.id} type="button" aria-pressed={captions && style === s.id} onClick={() => pick(s.id)}>
            {s.label}
          </button>
        ))}
        <button type="button" aria-pressed={captions && style === "custom"} onClick={() => pick("custom")}>
          Custom
        </button>
        <button type="button" aria-pressed={!captions} onClick={() => onCaptions(false)}>
          Off
        </button>
      </div>
      {captions && style === "custom" && <LookPicker look={look} onChange={onLook} />}
    </div>
  );
}

/** Colours, size, font and position for the member's own captions, with a small preview. */
function LookPicker({ look, onChange }: { look: Look; onChange: (l: Look) => void }) {
  const set = <K extends keyof Look>(k: K, v: Look[K]) => onChange({ ...look, [k]: v });
  const font = FONTS.find((f) => f.id === look.font)?.css;
  const words = look.upper ? ["NO", "WAY", "BRO"] : ["No", "way", "bro"];
  const px = look.size === "s" ? 17 : look.size === "l" ? 25 : 21;
  return (
    <div className="rise mt-3 space-y-3 rounded-xl bg-canvas p-3.5">
      <div
        aria-hidden
        className={`flex h-[92px] rounded-lg bg-[#241c3f] px-3 ${look.position === "top" ? "items-start pt-2.5" : look.position === "middle" ? "items-center" : "items-end pb-2.5"} justify-center`}
      >
        <span className="flex gap-2 font-extrabold" style={{ fontFamily: font, fontSize: px, textShadow: "0 0 3px #000, 0 2px 0 #000" }}>
          {words.map((w, i) => (
            <span key={w} style={{ color: `#${i === 1 ? look.highlight : look.text}` }}>
              {w}
            </span>
          ))}
        </span>
      </div>
      <Colour label="Text colour" value={look.text} onChange={(v) => set("text", v)} />
      <Colour label="Word being said" value={look.highlight} onChange={(v) => set("highlight", v)} />
      <Row label="Size">
        <div className="seg">
          {SIZES.map((s) => (
            <button key={s.id} type="button" aria-pressed={look.size === s.id} onClick={() => set("size", s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Font">
        <div className="seg">
          {FONTS.map((f) => (
            <button key={f.id} type="button" aria-pressed={look.font === f.id} onClick={() => set("font", f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Position">
        <div className="seg">
          {POSITIONS.map((p) => (
            <button key={p.id} type="button" aria-pressed={look.position === p.id} onClick={() => set("position", p.id)}>
              {p.label}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Letters">
        <div className="seg">
          <button type="button" aria-pressed={look.upper} onClick={() => set("upper", true)}>
            ALL CAPS
          </button>
          <button type="button" aria-pressed={!look.upper} onClick={() => set("upper", false)}>
            As spoken
          </button>
        </div>
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="w-[112px] text-[13px] text-ink-2">{label}</span>
      {children}
    </div>
  );
}

/** A row of ready colours, plus the browser's own colour picker for anything else. */
function Colour({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  return (
    <Row label={label}>
      <span className="flex flex-wrap items-center gap-1.5">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${label} #${c}`}
            aria-pressed={value === c}
            onClick={() => onChange(c)}
            className={`size-7 rounded-full shadow-[inset_0_0_0_1px_rgb(23_18_43/0.14)] ring-2 ring-offset-2 ring-offset-canvas transition-transform hover:scale-110 ${value === c ? "ring-brand" : "ring-transparent"}`}
            style={{ background: `#${c}` }}
          />
        ))}
        <label className="relative grid size-7 cursor-pointer place-items-center rounded-full bg-subtle text-[14px] text-ink-2" title="Any other colour">
          +
          <input type="color" value={`#${value}`} onChange={(e) => onChange(e.target.value.replace("#", "").toLowerCase())} className="absolute inset-0 cursor-pointer opacity-0" aria-label={`${label}: any other colour`} />
        </label>
      </span>
    </Row>
  );
}
