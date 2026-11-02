"use client";

import { DEFAULT_FEE_SCHEDULE, feeCopy, type FeeCopy } from "@/lib/billing/fee-schedule";
import { createContext, useContext, type ReactNode } from "react";

// The fee figures the public pages print, from the admin's fee settings
// (lib/billing/settings.ts). Pages read them server-side and provide them
// here, so changing a rate in Revenue changes the site copy on the next load.
const FeeCopyContext = createContext<FeeCopy>(feeCopy(DEFAULT_FEE_SCHEDULE));

export function FeeCopyProvider({ value, children }: { value: FeeCopy; children: ReactNode }) {
  return <FeeCopyContext.Provider value={value}>{children}</FeeCopyContext.Provider>;
}

export function useFeeCopy(): FeeCopy {
  return useContext(FeeCopyContext);
}

/** "0.1% to 0.35% based on your monthly volume", or "a flat 0.3%". */
export function feeSentence(copy: FeeCopy): string {
  return copy.isTiered
    ? `${copy.lowest}% to ${copy.highest}% based on your monthly volume`
    : `a flat ${copy.lowest}% of your paid volume`;
}
