import { decodeRgbaPng, encodeMaskPng, type RgbaImage } from "./png.ts";

/**
 * The rim is the pose's silhouette grown outward, as an alpha mask. Values are for the @2x art
 * (1024 px wide); the rim shows at RIM_RADIUS / 2 css px when the art is 512 px wide. The mask is painted behind the
 * art in the `mascot-rim` color (packages/ui Mascot), so the art's fuzzy felt edge reads on dark.
 */
const RIM_RADIUS = 10;
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
      const base = line * lineStep;
      const at = (i: number) => from[base + Math.min(lineLength - 1, Math.max(0, i)) * step] ?? 0;
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += at(k);
      for (let i = 0; i < lineLength; i++) {
        to[base + i * step] = sum / size;
        sum += at(i + radius + 1) - at(i - radius);
      }
    }
    return to;
  };
  return pass(pass(source, 1, width, height, width), width, height, width, 1);
}

function silhouette({ width, height, rgba }: RgbaImage): Uint8Array {
  let coverage: Float32Array = new Float32Array(width * height);
  for (let i = 0; i < coverage.length; i++) coverage[i] = (rgba[i * 4 + 3] ?? 0) / 255;
  for (let pass = 0; pass < BLUR_PASSES; pass++)
    coverage = boxBlur(coverage, width, height, BLUR_RADIUS);
  const inside = new Uint8Array(coverage.length);
  for (let i = 0; i < inside.length; i++)
    inside[i] = (coverage[i] ?? 0) >= SILHOUETTE_COVERAGE ? 1 : 0;
  return inside;
}

/** Distance of every cell of a span x span square centered on a pixel; Infinity beyond the rim's reach. */
function discDistances(span: number): Float32Array {
  const reach = (span - 1) / 2;
  return Float32Array.from({ length: span * span }, (_, i) => {
    const distance = Math.hypot((i % span) - reach, Math.floor(i / span) - reach);
    return distance <= RIM_RADIUS + 1 ? distance : Number.POSITIVE_INFINITY;
  });
}

function growMask(inside: Uint8Array, width: number, height: number): Uint8Array {
  const reach = Math.ceil(RIM_RADIUS + 1);
  const span = 2 * reach + 1;
  const distances = discDistances(span);
  const nearest = new Float32Array(width * height).fill(Number.POSITIVE_INFINITY);
  const isInside = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && inside[y * width + x] === 1;
  const isBorder = (x: number, y: number) =>
    !(isInside(x - 1, y) && isInside(x + 1, y) && isInside(x, y - 1) && isInside(x, y + 1));
  const stamp = (x: number, y: number) => {
    const [x0, x1] = [Math.max(0, x - reach), Math.min(width - 1, x + reach)];
    const [y0, y1] = [Math.max(0, y - reach), Math.min(height - 1, y + reach)];
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const distance = distances[(ty - y + reach) * span + (tx - x + reach)] ?? Infinity;
        if (distance < (nearest[ty * width + tx] ?? 0)) nearest[ty * width + tx] = distance;
      }
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
  const alpha = new Uint8Array(nearest.length);
  for (let i = 0; i < alpha.length; i++)
    alpha[i] = Math.round(Math.min(1, Math.max(0, RIM_RADIUS + 0.5 - (nearest[i] ?? 0))) * 255);
  return alpha;
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
