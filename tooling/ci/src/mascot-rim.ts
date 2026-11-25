import { decodeRgbaPng, encodeMaskPng, type RgbaImage } from "./png.ts";

/**
 * The rim is the pose's silhouette grown outward, as an alpha mask. Values are for the @2x art
 * (1024 px wide); the displayed rim is half of RIM_RADIUS css px. The mask is painted behind the
 * art in the `mascot-rim` color (packages/ui Mascot), so the art's fuzzy felt edge reads on dark.
 */
const RIM_RADIUS = 14;
/** The felt edge is dithered noise: blur it, then cut at half coverage, for a clean outline. */
const BLUR_RADIUS = 6;
const BLUR_PASSES = 2;
const SILHOUETTE_COVERAGE = 128 / 255;

function boxBlur(
  source: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const size = 2 * radius + 1;
  const pass = (
    from: Float32Array,
    step: number,
    lineLength: number,
    lines: number,
    lineStep: number,
  ) => {
    const to = new Float32Array(width * height);
    for (let line = 0; line < lines; line++) {
      for (let i = 0; i < lineLength; i++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) {
          const clamped = Math.min(lineLength - 1, Math.max(0, i + k));
          sum += from[line * lineStep + clamped * step] ?? 0;
        }
        to[line * lineStep + i * step] = sum / size;
      }
    }
    return to;
  };
  return pass(pass(source, 1, width, height, width), width, height, width, 1);
}

function silhouette({ width, height, rgba }: RgbaImage): Uint8Array {
  let coverage: Float32Array = Float32Array.from(
    { length: width * height },
    (_, i) => (rgba[i * 4 + 3] ?? 0) / 255,
  );
  for (let pass = 0; pass < BLUR_PASSES; pass++)
    coverage = boxBlur(coverage, width, height, BLUR_RADIUS);
  return Uint8Array.from(coverage, (value) => (value >= SILHOUETTE_COVERAGE ? 1 : 0));
}

/** Every offset within the rim's reach, with its distance. */
function discOffsets(): { dx: number; dy: number; distance: number }[] {
  const reach = Math.ceil(RIM_RADIUS + 1);
  const offsets: { dx: number; dy: number; distance: number }[] = [];
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const distance = Math.hypot(dx, dy);
      if (distance <= RIM_RADIUS + 1) offsets.push({ dx, dy, distance });
    }
  }
  return offsets;
}

function growMask(inside: Uint8Array, width: number, height: number): Uint8Array {
  const offsets = discOffsets();
  const nearest = new Float32Array(width * height).fill(Number.POSITIVE_INFINITY);
  const isInside = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && inside[y * width + x] === 1;
  const isBorder = (x: number, y: number) =>
    !(isInside(x - 1, y) && isInside(x + 1, y) && isInside(x, y - 1) && isInside(x, y + 1));
  const stamp = (x: number, y: number) => {
    for (const { dx, dy, distance } of offsets) {
      const [tx, ty] = [x + dx, y + dy];
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
      nearest[ty * width + tx] = Math.min(nearest[ty * width + tx] ?? distance, distance);
    }
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isInside(x, y)) continue;
      nearest[y * width + x] = 0;
      // Only the silhouette's border can be nearest to an outside pixel, so only it stamps a disc.
      if (isBorder(x, y)) stamp(x, y);
    }
  }
  return Uint8Array.from(nearest, (distance) =>
    Math.round(Math.min(1, Math.max(0, RIM_RADIUS + 0.5 - distance)) * 255),
  );
}

export type RimResult =
  | {
      readonly ok: true;
      readonly width: number;
      readonly height: number;
      readonly alpha: Uint8Array;
    }
  | { readonly ok: false; readonly reason: string };

/** Alpha of the rim mask for a pose's RGBA PNG (@2x art). */
export function rimAlpha(png: Buffer): RimResult {
  const decoded = decodeRgbaPng(png);
  if (!decoded.ok) return decoded;
  const { width, height } = decoded.image;
  return { ok: true, width, height, alpha: growMask(silhouette(decoded.image), width, height) };
}

export function rimPng(png: Buffer): { ok: true; png: Buffer } | { ok: false; reason: string } {
  const rim = rimAlpha(png);
  return rim.ok ? { ok: true, png: encodeMaskPng(rim.width, rim.height, rim.alpha) } : rim;
}
