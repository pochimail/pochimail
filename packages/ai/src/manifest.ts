import { z } from "zod";
import { type Tier, tierSchema } from "./tiers.ts";

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

/** A pinned Hugging Face file: `https://huggingface.co/<owner>/<repo>/resolve/<40-hex commit>/<path>`. */
const sourceUrlSchema = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.host === "huggingface.co" &&
      url.username === "" &&
      url.search === "" &&
      url.hash === "" &&
      /^\/[\w.-]+\/[\w.-]+\/resolve\/[0-9a-f]{40}\/[\w./-]+$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}, "Source must be an https huggingface.co URL pinned to a commit");

const fileSchema = z.object({
  /** Relative path inside the model's folder. */
  name: z.string().regex(/^[\w-][\w.-]*(\/[\w-][\w.-]*)*$/),
  url: sourceUrlSchema,
  bytes: z.number().int().positive(),
  sha256: sha256Schema,
});
export type ModelFile = z.infer<typeof fileSchema>;

const modelSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/),
    role: z.enum(["embedding", "generative"]),
    /** The tiers that load this model. */
    tiers: z.array(tierSchema).min(1),
    license: z.string().min(1),
    files: z.array(fileSchema).min(1),
  })
  .refine((model) => model.role === "embedding" || !model.tiers.includes("T0"), {
    message: "T0 runs no generative model (ADR 0006)",
  });
export type ModelEntry = z.infer<typeof modelSchema>;

export const manifestSchema = z
  .object({ models: z.array(modelSchema).min(1) })
  .refine((manifest) => new Set(manifest.models.map((m) => m.id)).size === manifest.models.length, {
    message: "Model ids must be unique",
  })
  .refine(
    (manifest) => {
      const hashes = manifest.models.flatMap((m) => m.files.map((file) => file.sha256));
      return new Set(hashes).size === hashes.length;
    },
    { message: "File hashes must be unique: downloads are one job per hash (partial file name)" },
  );
export type ModelManifest = z.infer<typeof manifestSchema>;

/** ADR 0006 models, verified on Hugging Face on 2026-11-25. Each URL is pinned to a commit. */
const bundled = {
  models: [
    {
      id: "multilingual-e5-small",
      role: "embedding",
      tiers: ["T0", "T1", "T2"],
      license: "MIT",
      files: [
        {
          name: "config.json",
          url: "https://huggingface.co/Xenova/multilingual-e5-small/resolve/761b726dd34fb83930e26aab4e9ac3899aa1fa78/config.json",
          bytes: 658,
          sha256: "cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1",
        },
        {
          name: "special_tokens_map.json",
          url: "https://huggingface.co/Xenova/multilingual-e5-small/resolve/761b726dd34fb83930e26aab4e9ac3899aa1fa78/special_tokens_map.json",
          bytes: 167,
          sha256: "d05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7",
        },
        {
          name: "tokenizer_config.json",
          url: "https://huggingface.co/Xenova/multilingual-e5-small/resolve/761b726dd34fb83930e26aab4e9ac3899aa1fa78/tokenizer_config.json",
          bytes: 443,
          sha256: "a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b",
        },
        {
          name: "tokenizer.json",
          url: "https://huggingface.co/Xenova/multilingual-e5-small/resolve/761b726dd34fb83930e26aab4e9ac3899aa1fa78/tokenizer.json",
          bytes: 17082730,
          sha256: "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39",
        },
        {
          name: "onnx/model_quantized.onnx",
          url: "https://huggingface.co/Xenova/multilingual-e5-small/resolve/761b726dd34fb83930e26aab4e9ac3899aa1fa78/onnx/model_quantized.onnx",
          bytes: 118308185,
          sha256: "f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193",
        },
      ],
    },
    {
      id: "qwen3.5-2b",
      role: "generative",
      tiers: ["T1"],
      license: "Apache-2.0",
      files: [
        {
          name: "Qwen3.5-2B-Q4_K_M.gguf",
          url: "https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/f6d5376be1edb4d416d56da11e5397a961aca8ae/Qwen3.5-2B-Q4_K_M.gguf",
          bytes: 1280835840,
          sha256: "aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223",
        },
      ],
    },
    {
      id: "gemma-4-e4b-it",
      role: "generative",
      tiers: ["T2"],
      license: "Apache-2.0",
      files: [
        {
          name: "gemma-4-E4B-it-Q4_K_M.gguf",
          url: "https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/bfc15c382204943c3a8fff0c750b94ae2364d7a3/gemma-4-E4B-it-Q4_K_M.gguf",
          bytes: 4977171584,
          sha256: "85a896a047553e842f25297ee5b031d64ff30147d9c4af17b1e4b394cd1fab87",
        },
      ],
    },
  ],
} satisfies z.input<typeof manifestSchema>;

/** The manifest shipped in the build; a remote, signed update belongs to #122. */
export const bundledManifest: ModelManifest = manifestSchema.parse(bundled);

export const modelsForTier = (manifest: ModelManifest, tier: Tier): readonly ModelEntry[] =>
  manifest.models.filter((model) => model.tiers.includes(tier));
