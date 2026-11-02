import { describe, expect, it, vi } from "vitest";
import { cachedRead, newReadCache } from "./reads";

describe("cachedRead", () => {
  it("runs a read once per key per cycle and shares the result", async () => {
    const reads = newReadCache();
    const read = vi.fn(async () => 42);
    const [a, b] = await Promise.all([
      cachedRead(reads, "k", read),
      cachedRead(reads, "k", read),
    ]);
    expect([a, b]).toEqual([42, 42]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads fresh when there is no cycle cache (one-off calls, snapshots)", async () => {
    const read = vi.fn(async () => 1);
    await cachedRead(undefined, "k", read);
    await cachedRead(undefined, "k", read);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("shares a failure within the cycle instead of retrying per session", async () => {
    const reads = newReadCache();
    const read = vi.fn(async () => {
      throw new Error("down");
    });
    await expect(cachedRead(reads, "k", read)).rejects.toThrow("down");
    await expect(cachedRead(reads, "k", read)).rejects.toThrow("down");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("keeps different keys apart", async () => {
    const reads = newReadCache();
    expect(await cachedRead(reads, "a", async () => "A")).toBe("A");
    expect(await cachedRead(reads, "b", async () => "B")).toBe("B");
  });
});
