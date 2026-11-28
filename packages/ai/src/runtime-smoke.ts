import { startLlama } from "./llm/llama-runtime.ts";

export type Proof = { ok: true; detail: string } | { ok: false; error: string };

export interface RuntimeProof {
  /** onnxruntime-node ran a one-node graph: the embeddings runtime works. */
  readonly onnx: Proof;
  /** Transformers.js imported with its native dependencies (onnxruntime-node, sharp). */
  readonly transformers: Proof;
  /** node-llama-cpp loaded its prebuilt binding (the app's own start-up: Metal when usable on macOS, CPU elsewhere) and shut down again. */
  readonly llama: Proof;
}

// Protobuf fields: tag, length, bytes. Every message here is under 128 bytes, so a length is one byte.
const field = (tag: number, payload: readonly number[]): number[] => [
  tag,
  payload.length,
  ...payload,
];
const text = (tag: number, value: string): number[] =>
  field(tag, [...new TextEncoder().encode(value)]);

/** `y = Identity(x)` over float[4], as an ONNX file: the smallest graph that exercises the native runtime. */
const identityModel = (): Uint8Array => {
  const dims = field(0x12, field(0x0a, [0x08, 4]));
  const tensor = field(0x0a, [0x08, 1, ...dims]);
  const info = (name: string): number[] => [...text(0x0a, name), ...field(0x12, tensor)];
  const node = [...text(0x0a, "x"), ...text(0x12, "y"), ...text(0x22, "Identity")];
  const graph = [
    ...field(0x0a, node),
    ...text(0x12, "g"),
    ...field(0x5a, info("x")),
    ...field(0x62, info("y")),
  ];
  return Uint8Array.from([0x08, 8, ...field(0x3a, graph), ...field(0x42, [0x10, 13])]);
};

const prove = async (run: () => Promise<string>): Promise<Proof> => {
  try {
    return { ok: true, detail: await run() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

/** Loads each native runtime once. The packaging smoke runs this inside the packaged app, in a utility process. */
export const proveRuntimes = async (): Promise<RuntimeProof> => ({
  onnx: await prove(async () => {
    const { InferenceSession, Tensor } = await import("onnxruntime-node");
    const session = await InferenceSession.create(identityModel());
    const input = Float32Array.from([1, 2, 3, 4]);
    const out = await session.run({ x: new Tensor("float32", input, [4]) });
    const got = Array.from(out.y?.data as Float32Array);
    if (got.join() !== input.join()) throw new Error(`identity returned ${got.join()}`);
    await session.release();
    return "identity graph ran";
  }),
  transformers: await prove(async () => {
    await import("@huggingface/transformers");
    return "imported";
  }),
  llama: await prove(async () => {
    const llama = await startLlama(await import("node-llama-cpp"));
    await llama.dispose();
    return "binding loaded";
  }),
});
