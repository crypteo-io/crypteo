import { describe, expect, it } from "vitest";
import { classifySnapshotError, snapshotErrorHeaders } from "./errors";
import { AllEndpointsFailedError } from "./rpc";

describe("classifySnapshotError", () => {
  it("returns a retryable 503 when no endpoint could be reached", () => {
    const res = classifySnapshotError(
      new AllEndpointsFailedError("sol getTokenAccountsByOwner", [
        { url: "https://solana.publicnode.com", message: "403 Forbidden" },
      ]),
    );
    expect(res.status).toBe(503);
    expect(snapshotErrorHeaders(res)["Retry-After"]).toBe("30");
  });

  it("returns 400 for a wallet address the caller must fix", () => {
    expect(classifySnapshotError(new Error("Account malformed")).status).toBe(
      400,
    );
    expect(classifySnapshotError(new Error("Invalid public key")).status).toBe(
      400,
    );
    // Permanent faults carry no Retry-After: retrying cannot help.
    expect(
      snapshotErrorHeaders(classifySnapshotError(new Error("actMalformed"))),
    ).toEqual({});
  });

  it("defaults an unrecognised failure to retryable, not to the caller's fault", () => {
    expect(classifySnapshotError(new Error("socket hang up")).status).toBe(503);
  });

  it("does not misread a chain outage as a bad address", () => {
    // The exact production failure. A 400 here tells an integrator their
    // request was invalid and stops their client retrying.
    const res = classifySnapshotError(
      new Error("Indexed requests require a personal token"),
    );
    expect(res.status).toBe(503);
  });
});
