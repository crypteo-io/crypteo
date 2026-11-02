"use client";

import type { ReactNode } from "react";
import { sileo, type SileoOptions } from "sileo";

/**
 * The app's one way to show feedback. Wraps sileo so call sites can't hit its
 * sharp edge: every toast without an `id` shares the id "sileo-default", so a
 * second toast silently REPLACES the first, and a promise toast's outcome is
 * written onto whatever toast holds that id when it settles (a "Saved" can land
 * on an unrelated error). Each toast here gets its own id. `id` is read by
 * sileo but missing from its public types, hence the cast in `withId`.
 */

let sequence = 0;

export const TOAST_ERROR_DURATION_MS = 8_000;

type ToastOptions = Omit<SileoOptions, "title" | "description" | "type">;

function withId(options: SileoOptions): SileoOptions {
  return { ...options, id: `toast-${++sequence}` } as SileoOptions;
}

/** The message to show for a failure: the server's own words when it sent some. */
export function errorMessage(error: unknown, fallback = "Something went wrong."): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

export const toast = {
  success(title: string, description?: ReactNode, options?: ToastOptions) {
    return sileo.success(withId({ ...options, title, description }));
  },
  info(title: string, description?: ReactNode, options?: ToastOptions) {
    return sileo.info(withId({ ...options, title, description }));
  },
  warning(title: string, description?: ReactNode, options?: ToastOptions) {
    return sileo.warning(withId({ ...options, title, description }));
  },
  /** Errors stay up longer: they usually need reading, not just noticing. */
  error(title: string, description?: ReactNode, options?: ToastOptions) {
    return sileo.error(
      withId({ duration: TOAST_ERROR_DURATION_MS, ...options, title, description }),
    );
  },
  /** A toast with one button, e.g. "Undo" or "Copy". */
  action(
    title: string,
    button: { title: string; onClick: () => void },
    description?: ReactNode,
    options?: ToastOptions,
  ) {
    return sileo.action(withId({ ...options, title, description, button }));
  },
  /**
   * Loading → success/error for one operation. Resolves or rejects exactly as
   * `promise` does, so callers keep their own control flow. The error toast
   * shows the thrown message (the API's `error` text via apiRequest).
   */
  promise<T>(
    promise: Promise<T> | (() => Promise<T>),
    messages: {
      loading: string;
      success: string | ((data: T) => string);
      error?: string;
      description?: (data: T) => ReactNode;
    },
  ): Promise<T> {
    const { id } = withId({}) as SileoOptions & { id: string };
    return sileo.promise(promise, {
      loading: { title: messages.loading, id } as SileoOptions,
      success: (data) => ({
        title: typeof messages.success === "function" ? messages.success(data) : messages.success,
        description: messages.description?.(data),
      }),
      error: (err) => ({
        title: messages.error ?? "That didn't work",
        description: errorMessage(err),
        duration: TOAST_ERROR_DURATION_MS,
      }),
    });
  },
  dismiss(id: string) {
    sileo.dismiss(id);
  },
};

/** Copy to the clipboard and say so; a refused clipboard says that instead. */
export async function copyWithToast(text: string, what = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(what, undefined, { duration: 2_000 });
    return true;
  } catch {
    toast.error("Couldn't copy", "Your browser blocked clipboard access. Select and copy it manually.");
    return false;
  }
}
