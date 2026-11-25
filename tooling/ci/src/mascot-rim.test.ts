import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { expect, it } from "vitest";
import { rimAlpha } from "./mascot-rim.ts";

const assets = new URL("../../../packages/ui/src/assets/mascot/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, assets));

/** Alpha channel of the grayscale+alpha mask PNG this tool writes (filter 0 on every row). */
function maskAlpha(png: Buffer, width: number, height: number): Uint8Array {
  const idat: Buffer[] = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    if (png.toString("latin1", at + 4, at + 8) === "IDAT")
      idat.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++)
      alpha[y * width + x] = raw[y * (width * 2 + 1) + 2 + x * 2] ?? 0;
  }
  return alpha;
}

// Guards: the night art changing while the committed rim mask goes stale (the rim then misses the new silhouette on dark surfaces).
it("the committed night rim is what the generator makes from the night art", () => {
  const rim = rimAlpha(read("pochi-night@2x.png"));
  expect(rim.ok).toBe(true);
  if (!rim.ok) return;
  expect(maskAlpha(read("pochi-night-rim@2x.png"), rim.width, rim.height)).toEqual(rim.alpha);
});

// Guards: a rim that is empty or only inside the art, which would draw nothing on a dark background.
it("the rim is opaque over the body and reaches past the felt edge", () => {
  const night = read("pochi-night@2x.png");
  const rim = rimAlpha(night);
  if (!rim.ok) throw new Error(rim.reason);
  const center = (rim.height >> 1) * rim.width + (rim.width >> 1);
  expect(rim.alpha[center]).toBe(255);
  expect(rim.alpha.filter((a) => a > 0).length).toBeGreaterThan(rim.width * rim.height * 0.4);
});

it("reports an input that is not an RGBA PNG instead of guessing", () => {
  expect(rimAlpha(Buffer.from("not a png"))).toEqual({ ok: false, reason: "not a PNG" });
});
