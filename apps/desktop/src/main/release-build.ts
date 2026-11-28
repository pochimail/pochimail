/** Replaced at build time (electron.vite.config.ts): true only in a build made by the release workflow. */
declare const __POCHIMAIL_RELEASE__: boolean | undefined;

/** Dev, PR, merge-queue and smoke builds are not release builds: they never sign and never check for updates. */
export const isReleaseBuild = (): boolean =>
  typeof __POCHIMAIL_RELEASE__ !== "undefined" && __POCHIMAIL_RELEASE__;
