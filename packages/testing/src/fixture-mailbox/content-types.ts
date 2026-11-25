export type Language = "en" | "fr" | "ja";

export interface Template {
  readonly subjects: readonly string[];
  readonly bodies: readonly string[];
}
