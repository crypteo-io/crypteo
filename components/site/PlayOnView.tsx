"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Plays the CSS entrance of its `[data-step]` children once, the first time
 * the block is a third in view (globals.css, "Illustration entrance"). The
 * observer disconnects after it fires; reduced motion shows everything still.
 */
export function PlayOnView({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.dataset.play = "";
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        el.dataset.play = "";
        observer.disconnect();
      },
      { threshold: 0.35 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} data-anim="" className={className}>
      {children}
    </div>
  );
}
