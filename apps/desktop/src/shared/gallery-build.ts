/**
 * Build-time switch for the dev gallery route (M4-18). The renderer reads it as the `__POCHIMAIL_GALLERY__` global, which Vite
 * replaces with a literal, so a packaged build drops the route and its whole module graph. On for `electron-vite dev` and for
 * E2E builds (`POCHIMAIL_E2E=1`), off otherwise.
 */
export const galleryEnabled = (
  command: "serve" | "build",
  env: { POCHIMAIL_E2E?: string | undefined },
): boolean => command === "serve" || env.POCHIMAIL_E2E === "1";

/** Where an E2E build goes, so a `pnpm build` or a package never ships or caches it (M4-19). */
export const E2E_OUT_DIR = "out-e2e";

export const galleryDefine = (enabled: boolean): Record<string, string> => ({
  __POCHIMAIL_GALLERY__: JSON.stringify(enabled),
});
