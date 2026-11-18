/**
 * Browser-side JSON request to this app's API. Throws an Error carrying the
 * API's own `error` text on any non-2xx (so toast.promise can show it), and a
 * distinct message when the request never reached the server: a failure must
 * never look like an empty success.
 */
export async function apiRequest<T = Record<string, unknown>>(
  url: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "GET",
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new Error("Network error. Check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== "undefined") {
    // The session is gone (suspended, deleted, signed out elsewhere): leave
    // now rather than at the next page load. session-ended clears the cookie
    // only when the session really is invalid. A full navigation, not a
    // router push: it is an API route that sets cookies.
    window.location.assign(new URL("/api/auth/session-ended", window.location.origin).href);
  }
  if (!res.ok) {
    throw new ApiError(
      (typeof data?.error === "string" && data.error) ||
        (typeof data?.message === "string" && data.message) ||
        `Request failed (${res.status})`,
      res.status,
      typeof data?.field === "string" ? data.field : undefined,
    );
  }
  return data as T;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The request field the API blamed, so a form can show the error there. */
    readonly field?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
