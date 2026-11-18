"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface CheckoutTooltipProps {
  content: ReactNode;
  children: ReactNode;
}

const TOOLTIP_WIDTH_PX = 224;
const VIEWPORT_MARGIN_PX = 8;

interface Placement {
  /** Viewport coordinates: the tooltip's left edge and its trigger's top. */
  left: number;
  top: number;
  arrow: number;
  width: number;
}

/**
 * Centred over its trigger, kept inside the viewport, and rendered on
 * document.body: inside the checkout column it was clipped by the column's
 * overflow at the QR code's right edge (2026-11-18). Opens on hover, focus
 * and tap (phones have no hover); scrolling closes it, since a fixed tooltip
 * would otherwise stay where the trigger was.
 */
export function CheckoutTooltip({ content, children }: CheckoutTooltipProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  const show = () => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(TOOLTIP_WIDTH_PX, window.innerWidth - 2 * VIEWPORT_MARGIN_PX);
    const centre = rect.left + rect.width / 2;
    const left = Math.min(
      Math.max(centre - width / 2, VIEWPORT_MARGIN_PX),
      window.innerWidth - VIEWPORT_MARGIN_PX - width,
    );
    setPlacement({ left, top: rect.top, arrow: centre - left, width });
  };
  const hide = () => setPlacement(null);

  useEffect(() => {
    if (!placement) return;
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("resize", hide);
    };
  }, [placement]);

  return (
    <div
      ref={anchorRef}
      className="relative flex items-center"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      // A tap fires mouseenter then click: toggling here closed it at once.
      onClick={show}
      tabIndex={0}
    >
      {children}
      {placement &&
        createPortal(
          <AnimatePresence>
            <motion.div
              role="tooltip"
              initial={{ opacity: 0, scale: 0.95, y: "calc(-100% + 4px)" }}
              animate={{ opacity: 1, scale: 1, y: "calc(-100% - 12px)" }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              style={{ left: placement.left, top: placement.top, width: placement.width }}
              className="pointer-events-none fixed z-300 rounded-xl bg-primary p-3 text-[12px] leading-relaxed font-medium text-white shadow-[0_12px_32px_rgba(6,15,22,0.18)]"
            >
              {content}
              <div
                style={{ left: placement.arrow }}
                className="absolute top-full -translate-x-1/2 -mt-px border-8 border-transparent border-t-primary"
              />
            </motion.div>
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
