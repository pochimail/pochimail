import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const RGBA_BYTES = 4;

export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

export type DecodeResult =
  | { readonly ok: true; readonly image: RgbaImage }
  | { readonly ok: false; readonly reason: string };

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const dLeft = Math.abs(estimate - left);
  const dUp = Math.abs(estimate - up);
  const dUpLeft = Math.abs(estimate - upLeft);
  if (dLeft <= dUp && dLeft <= dUpLeft) return left;
  return dUp <= dUpLeft ? up : upLeft;
}

function predict(filter: number, left: number, up: number, upLeft: number): number {
  if (filter === 1) return left;
  if (filter === 2) return up;
  if (filter === 3) return (left + up) >> 1;
  return filter === 4 ? paeth(left, up, upLeft) : 0;
}

function unfilter(raw: Buffer, width: number, height: number): Uint8Array {
  const stride = width * RGBA_BYTES;
  const out = new Uint8Array(height * stride);
  const at = (x: number, y: number) => out[y * stride + x] ?? 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    for (let x = 0; x < stride; x++) {
      const hasLeft = x >= RGBA_BYTES;
      const left = hasLeft ? at(x - RGBA_BYTES, y) : 0;
      const up = y > 0 ? at(x, y - 1) : 0;
      const upLeft = hasLeft && y > 0 ? at(x - RGBA_BYTES, y - 1) : 0;
      const value = raw[y * (stride + 1) + 1 + x] ?? 0;
      out[y * stride + x] = (value + predict(filter, left, up, upLeft)) & 255;
    }
  }
  return out;
}

/** Reads the 8-bit, non-interlaced RGBA PNGs the mascot art ships as; anything else is reported, not guessed. */
export function decodeRgbaPng(file: Buffer): DecodeResult {
  if (!file.subarray(0, 8).equals(SIGNATURE)) return { ok: false, reason: "not a PNG" };
  let width = 0;
  let height = 0;
  let supported = false;
  const data: Buffer[] = [];
  for (let at = 8; at < file.length; ) {
    const length = file.readUInt32BE(at);
    const type = file.toString("latin1", at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      supported = body[8] === 8 && body[9] === 6 && body[12] === 0;
    } else if (type === "IDAT") data.push(body);
    at += 12 + length;
  }
  if (!supported) return { ok: false, reason: "only 8-bit non-interlaced RGBA PNGs are supported" };
  const raw = inflateSync(Buffer.concat(data));
  return { ok: true, image: { width, height, rgba: unfilter(raw, width, height) } };
}

/** Writes an alpha-only mask as an 8-bit grayscale+alpha PNG (black, so only the alpha channel carries data). */
export function encodeMaskPng(width: number, height: number, alpha: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 4;
  const rowBytes = width * 2;
  const raw = Buffer.alloc(height * (rowBytes + 1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) raw[y * (rowBytes + 1) + 2 + x * 2] = alpha[y * width + x] ?? 0;
  }
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
