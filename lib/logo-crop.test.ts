import { describe, expect, it } from "vitest";
import { outputSize, padBox, sourceFileRefusal, trimBounds } from "./logo-crop";

function image(width: number, height: number, fill: (x: number, y: number) => number[]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(fill(x, y), (y * width + x) * 4);
  }
  return data;
}

const inside = (x: number, y: number) => x >= 3 && x <= 6 && y >= 2 && y <= 4;

describe("sourceFileRefusal", () => {
  it("accepts PNG, JPEG and WebP originals well above the upload cap", () => {
    expect(sourceFileRefusal({ type: "image/png", size: 9 * 1024 * 1024 })).toBeNull();
    expect(sourceFileRefusal({ type: "image/jpeg", size: 100 })).toBeNull();
  });

  it("refuses SVG, other types and huge files", () => {
    expect(sourceFileRefusal({ type: "image/svg+xml", size: 100 })).toMatch(/SVG/);
    expect(sourceFileRefusal({ type: "image/gif", size: 100 })).toMatch(/PNG, JPEG or WebP/);
    expect(sourceFileRefusal({ type: "image/png", size: 16 * 1024 * 1024 })).toMatch(/over 15 MB/);
  });
});

describe("outputSize", () => {
  it("fits inside 960x320 and keeps the aspect ratio", () => {
    expect(outputSize(3000, 1000)).toEqual({ width: 960, height: 320 });
    expect(outputSize(1000, 1000)).toEqual({ width: 320, height: 320 });
  });

  it("never enlarges", () => {
    expect(outputSize(200, 50)).toEqual({ width: 200, height: 50 });
  });
});

describe("trimBounds", () => {
  it("finds the logo inside a transparent margin", () => {
    const data = image(10, 8, (x, y) => (inside(x, y) ? [10, 20, 30, 255] : [0, 0, 0, 0]));
    expect(trimBounds(data, 10, 8)).toEqual({ x: 3, y: 2, width: 4, height: 3 });
  });

  it("finds the logo on a solid white canvas, tolerating JPEG noise", () => {
    const data = image(10, 8, (x, y) =>
      inside(x, y) ? [10, 20, 30, 255] : [255 - ((x + y) % 3) * 5, 250, 252, 255],
    );
    expect(trimBounds(data, 10, 8)).toEqual({ x: 3, y: 2, width: 4, height: 3 });
  });

  it("returns null when there is no margin, the corners disagree, or it's blank", () => {
    expect(trimBounds(image(4, 4, () => [10, 20, 30, 255]), 4, 4)).toBeNull();
    expect(
      trimBounds(image(4, 4, (x) => (x === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255])), 4, 4),
    ).toBeNull();
    expect(trimBounds(image(4, 4, () => [0, 0, 0, 0]), 4, 4)).toBeNull();
  });
});

describe("padBox", () => {
  it("adds breathing room but stays inside the image", () => {
    expect(padBox({ x: 1, y: 1, width: 100, height: 20 }, 102, 30)).toEqual({
      x: 0,
      y: 0,
      width: 102,
      height: 25,
    });
  });
});
