import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./api-client";

afterEach(() => vi.unstubAllGlobals());

const respond = (status: number, body: unknown) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));

describe("apiRequest", () => {
  it("leaves the dashboard at once when the session is gone (suspended, user 2026-11-16)", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign, origin: "https://crypteo.io" } });
    respond(401, { error: "Unauthorized" });
    await expect(apiRequest("/api/notifications")).rejects.toThrow("Unauthorized");
    expect(assign).toHaveBeenCalledWith("https://crypteo.io/api/auth/session-ended");
  });

  it("stays put on any other error", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign, origin: "https://crypteo.io" } });
    respond(400, { error: "Name is required", field: "name" });
    await expect(apiRequest("/api/merchants", { method: "PUT", body: {} })).rejects.toMatchObject({ field: "name" });
    expect(assign).not.toHaveBeenCalled();
  });
});
