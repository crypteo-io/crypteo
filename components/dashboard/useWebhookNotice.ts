"use client";

import { useIsClient } from "@/components/ui/useIsClient";
import { WEBHOOK_NOTICE_KEY, dismissalValue, isDismissed } from "@/lib/payment/webhook-notice";
import { useCallback, useMemo, useState } from "react";

/** Storage can be blocked or empty; a notice that can't remember just shows again. */
function readDismissal(): string | null {
  try {
    return localStorage.getItem(WEBHOOK_NOTICE_KEY);
  } catch {
    return null;
  }
}

/** Whether to show the failing-webhook notice for these URLs, and how to dismiss it. */
export function useWebhookNotice(urls: readonly string[]) {
  const isClient = useIsClient();
  const [closed, setClosed] = useState(false);
  const key = urls.join("\n");
  const remembered = useMemo(
    () => isClient && isDismissed(readDismissal(), key.split("\n"), new Date().getTime()),
    [isClient, key],
  );

  const dismiss = useCallback(() => {
    setClosed(true);
    try {
      localStorage.setItem(WEBHOOK_NOTICE_KEY, dismissalValue(key.split("\n"), new Date().getTime()));
    } catch {
      // Hidden until the next visit.
    }
  }, [key]);

  return { show: isClient && urls.length > 0 && !closed && !remembered, dismiss };
}
