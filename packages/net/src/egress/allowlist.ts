/** Lowercase and drop one trailing dot so DNS spellings cannot evade an exact match. */
export const canonicalHost = (host: string): string => {
  const lower = host.toLowerCase();
  return lower.length > 1 && lower.endsWith(".") ? lower.slice(0, -1) : lower;
};

/**
 * Always-on hosts from `docs/security/network.md` rows H1–H5. Exact names only: no wildcards,
 * no suffix matching. X1 (one-click unsubscribe) is a separate, dedicated path (M5).
 */
export const STATIC_EGRESS_HOSTS: readonly string[] = [
  "gmail.googleapis.com", // H1: Gmail API
  "oauth2.googleapis.com", // H2, H3: Google token and revocation endpoints
  "graph.microsoft.com", // H4: Graph mail API
  "login.microsoftonline.com", // H5: Microsoft token endpoint
];

/**
 * Model downloads only (`docs/security.md`, ADR 0006): kept apart from the static hosts, so the
 * session filter and mail clients never reach them. Exact names, no wildcard.
 */
const MODEL_DOWNLOAD_HOSTS: readonly string[] = [
  "huggingface.co", // the pinned `resolve` URL
  // CDN edges that `huggingface.co` redirects file downloads to: HF-documented, may change.
  "us.aws.cdn.hf.co",
  "us.gcp.cdn.hf.co",
  "cdn-lfs-us-1.hf.co",
  "cdn-lfs-eu-1.hf.co",
  "transfer.xethub.hf.co",
  "transfer.xethub-eu.hf.co",
];

/**
 * The update notice reads one small file from the latest GitHub Release (#300): `github.com` answers with a redirect
 * to `release-assets.githubusercontent.com`. Kept apart from the static hosts, like the model hosts. Exact names, no wildcard.
 */
const UPDATE_CHECK_HOSTS: readonly string[] = [
  "github.com",
  "release-assets.githubusercontent.com",
];

/**
 * One egress policy, used by the worker's HTTP client and the Electron session filter.
 */
export interface HostAllowlist {
  /** Fresh `host[:port]` snapshot; safe to hand to the session request filter. */
  hosts(): readonly string[];
  /** Exact host and, where recorded, port match. Never a suffix or wildcard match. */
  allows(rawUrl: string | URL): boolean;
}

const normaliseHost = (raw: string): string => {
  const host = canonicalHost(raw.trim());
  if (host === "" || host.includes("*") || /\s/.test(host))
    throw new Error("Invalid egress host: expected one exact host name");
  let parsed: URL;
  try {
    parsed = new URL(`https://${host}`);
  } catch {
    throw new Error("Invalid egress host: expected one exact host name");
  }
  // Rejects credentials, paths, embedded ports and anything else that is not just a host.
  if (canonicalHost(parsed.hostname) !== host)
    throw new Error("Invalid egress host: expected one exact host name");
  return host;
};

const splitEntry = (entry: string): { host: string; port: string | undefined } => {
  if (entry.startsWith("[")) {
    const close = entry.indexOf("]");
    if (close === -1) return { host: entry, port: undefined };
    const tail = entry.slice(close + 1);
    return {
      host: entry.slice(0, close + 1),
      port: tail.startsWith(":") ? tail.slice(1) : undefined,
    };
  }
  const colon = entry.indexOf(":");
  return colon === -1
    ? { host: entry, port: undefined }
    : { host: entry.slice(0, colon), port: entry.slice(colon + 1) };
};

const defaultPort = (protocol: string): string => {
  if (protocol === "http:") return "80";
  if (protocol === "https:") return "443";
  return "";
};

/** Shared matcher: the session filter and the worker client cannot drift apart. */
export const matchesAllowlistEntry = (entry: string, url: URL): boolean => {
  const { host, port } = splitEntry(entry);
  if (canonicalHost(url.hostname) !== host) return false;
  if (port === undefined) return url.port === "";
  const effectivePort = url.port === "" ? defaultPort(url.protocol) : url.port;
  return effectivePort === port;
};

const NETWORK_PROTOCOLS = new Set(["http:", "https:"]);

export const createHostAllowlist = (
  staticHosts: readonly string[] = STATIC_EGRESS_HOSTS,
): HostAllowlist => {
  const staticEntries = staticHosts.map(normaliseHost);

  return {
    hosts: () => [...staticEntries],
    allows: (rawUrl) => {
      let url: URL;
      try {
        url = rawUrl instanceof URL ? rawUrl : new URL(rawUrl);
      } catch {
        return false;
      }
      if (url.hostname === "" || !NETWORK_PROTOCOLS.has(url.protocol)) return false;
      return staticEntries.some((entry) => matchesAllowlistEntry(entry, url));
    },
  };
};

/**
 * The one policy source for every process: the same static hosts and normalisation. Main's session
 * filter and each worker client create their own instance here.
 */
export const egressPolicy = {
  staticHosts: STATIC_EGRESS_HOSTS,
  create: (): HostAllowlist => createHostAllowlist(STATIC_EGRESS_HOSTS),
  createForModelDownloads: (): HostAllowlist => createHostAllowlist(MODEL_DOWNLOAD_HOSTS),
  createForUpdateCheck: (): HostAllowlist => createHostAllowlist(UPDATE_CHECK_HOSTS),
} as const;
