/** `signed`: all of an OS's secrets are set. `unsigned`: none are. `invalid`: only some, which fails the release instead of falling back. */
export type SigningMode = "signed" | "unsigned" | "invalid";
export type SigningOs = "mac" | "windows";

export type SigningStatus = { readonly mode: SigningMode; readonly missing: readonly string[] };

/** The names of the GitHub Actions secrets per OS (docs/release.md). Windows uses Azure Trusted Signing. */
export const SIGNING_SECRETS: Readonly<Record<SigningOs, readonly string[]>> = {
  mac: ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"],
  windows: [
    "AZURE_TENANT_ID",
    "AZURE_CLIENT_ID",
    "AZURE_CLIENT_SECRET",
    "AZURE_TS_ENDPOINT",
    "AZURE_TS_ACCOUNT",
    "AZURE_TS_PROFILE",
    "AZURE_TS_PUBLISHER",
  ],
};

type Env = Readonly<Record<string, string | undefined>>;

/** Only the release workflow sets this; PR, merge-queue, smoke and dev builds never sign or check for updates. */
export const isReleaseBuild = (env: Env): boolean => env["POCHIMAIL_RELEASE_BUILD"] === "1";

/** An empty value counts as missing: Actions maps an absent secret to an empty string. */
export const signingStatus = (os: SigningOs, env: Env): SigningStatus => {
  const names = SIGNING_SECRETS[os];
  const missing = names.filter((name) => (env[name] ?? "") === "");
  if (missing.length === 0) return { mode: "signed", missing };
  return { mode: missing.length === names.length ? "unsigned" : "invalid", missing };
};

/** What the build does for an OS: outside a release build it is always unsigned, whatever the environment holds. */
export const signingFor = (os: SigningOs, env: Env): SigningStatus =>
  isReleaseBuild(env) ? signingStatus(os, env) : { mode: "unsigned", missing: [] };

const OS_LABEL: Record<SigningOs, string> = { mac: "macOS", windows: "Windows" };

/** The one log line per OS. Never prints a value, only secret names. */
export const signingLine = (os: SigningOs, status: SigningStatus): string => {
  const label = OS_LABEL[os];
  if (status.mode === "signed") return `${label} signing enabled: all secrets are set`;
  if (status.mode === "unsigned")
    return `${label} signing skipped: secrets not set, building an unsigned app`;
  return `${label} signing misconfigured: missing ${status.missing.join(", ")}`;
};
