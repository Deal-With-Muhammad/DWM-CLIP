"use client";

import { useEffect, useRef } from "react";

/**
 * The looping film behind the homepage's first screen: a long gameplay video being cut into three vertical
 * clips. Silent, and it plays by itself. People who ask their device for less motion get the still picture.
 */
export function HeroVideo({ className }: { className?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      const v = video.current;
      if (!v) return;
      if (still.matches) v.pause();
      else void v.play().catch(() => {});
    };
    apply();
    still.addEventListener("change", apply);
    return () => still.removeEventListener("change", apply);
  }, []);
  return (
    <video ref={video} className={className} poster="/hero.jpg" muted loop playsInline autoPlay preload="metadata" aria-hidden tabIndex={-1}>
      {/* /hero-film is public/hero.mp4 behind a route that can send part of the file, which iPhones insist on. */}
      <source src="/hero-film" type="video/mp4" />
    </video>
  );
}
