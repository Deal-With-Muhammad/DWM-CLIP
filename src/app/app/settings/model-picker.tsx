"use client";

import { Check } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

/**
 * The model field: type to search the list, scroll it, pick one. Whatever is typed is kept as it is, so a model
 * that isn't in the list can still be used.
 */
export function ModelPicker({ value, onChange, options }: { value: string; onChange: (model: string) => void; options: readonly string[] }) {
  const [open, setOpen] = useState(false);
  // Until something is typed the whole list shows; the model already in the field is not a search.
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();

  const words = value.toLowerCase().split(/\s+/).filter(Boolean);
  const all = searching && words.length ? options.filter((m) => words.every((w) => m.toLowerCase().includes(w))) : options;
  const shown = all.slice(0, 200);
  const at = Math.min(active, Math.max(0, shown.length - 1));

  // Keep the highlighted model in view while moving through the list with the arrow keys.
  useEffect(() => {
    if (open) list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [open, at]);

  const pick = (model: string) => {
    onChange(model);
    setOpen(false);
    setSearching(false);
  };

  return (
    <div className="relative">
      <input
        value={value}
        role="combobox"
        aria-expanded={open}
        aria-controls={id}
        aria-autocomplete="list"
        spellCheck={false}
        autoCapitalize="none"
        autoComplete="off"
        placeholder="Search or type a model"
        className="field-native font-mono text-[14px]"
        onFocus={(e) => {
          setOpen(true);
          setSearching(false);
          setActive(Math.max(0, options.indexOf(value)));
          e.target.select();
        }}
        onBlur={() => {
          setOpen(false);
          // A search with spaces in it isn't a model's name: take the first match, or close the gaps.
          if (searching && /\s/.test(value)) onChange(shown[0] ?? value.replace(/\s+/g, ""));
        }}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setSearching(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) return setOpen(true);
            setActive(Math.max(0, Math.min(shown.length - 1, at + (e.key === "ArrowDown" ? 1 : -1))));
          } else if (e.key === "Enter" && open) {
            e.preventDefault(); // choosing a model must not save the form
            if (shown[at]) pick(shown[at]);
            else setOpen(false);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && (
        <ul ref={list} id={id} role="listbox" className="absolute inset-x-0 top-full z-20 mt-1.5 max-h-60 overflow-y-auto overscroll-contain rounded-xl bg-canvas p-1 shadow-[0_16px_36px_-14px_rgb(23_18_43/0.45)]">
          {shown.map((m, i) => (
            <li
              key={m}
              role="option"
              aria-selected={m === value}
              data-active={i === at}
              // Keeps the field focused, so the list doesn't close before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(m)}
              onMouseEnter={() => setActive(i)}
              className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 font-mono text-[13.5px] break-all data-[active=true]:bg-surface"
            >
              {m}
              {m === value && <Check className="size-4 shrink-0 text-brand-ink" aria-hidden />}
            </li>
          ))}
          {shown.length === 0 && <li className="px-3 py-2 text-[13.5px] text-muted">Nothing in the list matches. What you typed will be used as it is.</li>}
          {all.length > shown.length && <li className="px-3 py-2 text-[13px] text-muted">{all.length - shown.length} more. Type to narrow the list.</li>}
        </ul>
      )}
    </div>
  );
}
