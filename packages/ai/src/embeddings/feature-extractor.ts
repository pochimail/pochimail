/** The native runtime behind the embedder; swapped for a fake in tests. */
export interface FeatureExtractor {
  /** One unit-length vector per text, in order. Throws when the runtime fails. */
  extract(texts: readonly string[]): Promise<Float32Array[]>;
  dispose(): Promise<void>;
}

export type LoadExtractor = (modelDir: string) => Promise<FeatureExtractor>;
