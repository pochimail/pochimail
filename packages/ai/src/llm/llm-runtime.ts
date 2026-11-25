export type JsonSchema = Readonly<Record<string, unknown>>;

export interface Generation {
  readonly system?: string;
  readonly prompt: string;
  readonly maxTokens: number;
  /** When set, decoding is constrained to this schema. */
  readonly jsonSchema?: JsonSchema;
}

export interface LoadedLlm {
  /** Throws when the runtime fails. Aborting stops decoding and frees the context sequence. */
  generate(generation: Generation, signal: AbortSignal): Promise<string>;
  dispose(): Promise<void>;
}

/** The native runtime behind the provider; swapped for a fake in tests. */
export interface LlmRuntime {
  /** `sequences` is the number of generations that may run at once on the single context. */
  load(modelPath: string, sequences: number): Promise<LoadedLlm>;
}
