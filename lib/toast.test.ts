import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sileo", () => ({
  sileo: {
    success: vi.fn(() => "id"),
    error: vi.fn(() => "id"),
    info: vi.fn(() => "id"),
    warning: vi.fn(() => "id"),
    action: vi.fn(() => "id"),
    promise: vi.fn((p: Promise<unknown>) => p),
    dismiss: vi.fn(),
  },
}));

import { sileo } from "sileo";
import { copyWithToast, errorMessage, toast, TOAST_ERROR_DURATION_MS } from "./toast";

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const idOf = (call: unknown[]) => (call[0] as { id: string }).id;

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

/**
 * sileo gives every toast without an id the same id ("sileo-default"): a second
 * toast replaces the first, and a promise toast's result lands on whichever
 * toast holds that id when it settles. The wrapper must give each its own.
 */
describe("toast never lets two toasts share an id", () => {
  it("gives every toast a distinct id", () => {
    toast.success("a");
    toast.success("b");
    toast.error("c");
    const ids = [...mock(sileo.success).mock.calls, ...mock(sileo.error).mock.calls].map(idOf);
    expect(new Set(ids).size).toBe(3);
    expect(ids).not.toContain("sileo-default");
  });

  it("gives a promise toast its own id through the loading state it updates", () => {
    toast.promise(Promise.resolve(1), { loading: "Saving…", success: "Saved" });
    toast.promise(Promise.resolve(2), { loading: "Saving…", success: "Saved" });
    const ids = mock(sileo.promise).mock.calls.map((c) => (c[1] as { loading: { id: string } }).loading.id);
    expect(ids[0]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe("toast.promise", () => {
  it("resolves and rejects exactly as the wrapped promise", async () => {
    await expect(toast.promise(Promise.resolve(7), { loading: "l", success: "s" })).resolves.toBe(7);
    await expect(
      toast.promise(Promise.reject(new Error("boom")), { loading: "l", success: "s" }),
    ).rejects.toThrow("boom");
  });

  it("shows the server's message on failure, and keeps it up longer", () => {
    toast.promise(Promise.resolve(), { loading: "l", success: "s", error: "Not saved" });
    const opts = mock(sileo.promise).mock.calls[0][1] as {
      error: (e: unknown) => { title: string; description: string; duration: number };
    };
    expect(opts.error(new Error("Email already in use"))).toEqual({
      title: "Not saved",
      description: "Email already in use",
      duration: TOAST_ERROR_DURATION_MS,
    });
  });
});

describe("errorMessage", () => {
  it("prefers the error's own text and falls back otherwise", () => {
    expect(errorMessage(new Error("Nope"))).toBe("Nope");
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage({}, "fallback")).toBe("fallback");
  });
});

describe("copyWithToast", () => {
  it("confirms a copy", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => {}) } });
    expect(await copyWithToast("0xabc", "Address copied")).toBe(true);
    expect(mock(sileo.success).mock.calls[0][0]).toMatchObject({ title: "Address copied" });
  });

  it("says so when the browser refuses the clipboard, instead of failing silently", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) } });
    expect(await copyWithToast("0xabc")).toBe(false);
    expect(mock(sileo.error).mock.calls[0][0]).toMatchObject({ title: "Couldn't copy" });
  });
});
