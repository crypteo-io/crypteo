"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ReactNode, useRef, useState } from "react";

interface CheckoutTooltipProps {
  content: ReactNode;
  children: ReactNode;
}

const TOOLTIP_WIDTH_PX = 224;
const VIEWPORT_MARGIN_PX = 8;

/**
 * Centred over its trigger, but kept inside the viewport: an icon at the
 * card's left edge put half a centred tooltip off a phone's screen. Opens on
 * hover, focus and tap (phones have no hover).
 */
export function CheckoutTooltip({ content, children }: CheckoutTooltipProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{ left: number; arrow: number; width: number } | null>(null);

  const show = () => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(TOOLTIP_WIDTH_PX, window.innerWidth - 2 * VIEWPORT_MARGIN_PX);
    const centre = rect.left + rect.width / 2;
    const viewportLeft = Math.min(
      Math.max(centre - width / 2, VIEWPORT_MARGIN_PX),
      window.innerWidth - VIEWPORT_MARGIN_PX - width,
    );
    // Positioned relative to the trigger; the arrow stays over its centre.
    setPlacement({ left: viewportLeft - rect.left, arrow: centre - viewportLeft, width });
  };
  const hide = () => setPlacement(null);

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
      <AnimatePresence>
        {placement && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: -12 }}
            exit={{ opacity: 0, scale: 0.95, y: -8 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            style={{ left: placement.left, width: placement.width }}
            className="pointer-events-none absolute bottom-full z-50 rounded-xl bg-primary p-3 text-[12px] leading-relaxed font-medium text-white shadow-[0_12px_32px_rgba(6,15,22,0.18)]"
          >
            {content}
            <div
              style={{ left: placement.arrow }}
              className="absolute top-full -translate-x-1/2 -mt-px border-8 border-transparent border-t-primary"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
