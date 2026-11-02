"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/**
 * False during SSR and hydration, true once running in the browser. Anything
 * that depends on the viewer's clock or locale must branch on this, or the
 * server HTML and the first client render disagree and React discards the
 * whole tree with a hydration error.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
