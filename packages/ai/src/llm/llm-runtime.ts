export type JsonSchema = Readonly<Record<string, unknown>>;

export interface Generation {
  readonly system?: string;
  readonly prompt: string;
  readonly maxTokens: number;
  /** When set, decoding is constrained to this schema. */
  readonly jsonSchema?: JsonSchema;
}

/** Thrown by `generate` for a request the runtime cannot serve (a schema it cannot decode): the loaded model is fine. */
export class RequestRejected extends Error {}

export interface LoadedLlm {
  /** Throws when the runtime fails (`RequestRejected` when the request itself is at fault). Aborting stops decoding and frees the context sequence. */
  generate(generation: Generation, signal: AbortSignal): Promise<string>;
  dispose(): Promise<void>;
}

/** The native runtime behind the provider; swapped for a fake in tests. */
export interface LlmRuntime {
  /** `sequences` is the number of generations that may run at once on the single context. */
  load(modelPath: string, sequences: number): Promise<LoadedLlm>;
}
