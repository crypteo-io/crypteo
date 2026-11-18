import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Node 20 ran in production for months past its end of life (2026-04-30).
// The image and the engines floor move together, never below a supported LTS.
const SUPPORTED_MAJOR = 22;

describe("Node runtime floor", () => {
  const dockerfile = readFileSync("Dockerfile", "utf8");
  const engines: string = JSON.parse(readFileSync("package.json", "utf8")).engines?.node ?? "";
  const imageMajor = Number(/^FROM node:(\d+)/m.exec(dockerfile)?.[1]);
  const floorMajor = Number(/^>=(\d+)/.exec(engines)?.[1]);

  it("builds on a supported Node LTS", () => {
    expect(imageMajor).toBeGreaterThanOrEqual(SUPPORTED_MAJOR);
  });

  it("declares an engines floor of the same major as the image", () => {
    expect(floorMajor).toBe(imageMajor);
  });
});
