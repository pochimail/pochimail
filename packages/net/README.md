# @pochimail/net

## Why this package exists
Adapter package.
The only way out to the network: allow-listed HTTP and OAuth PKCE sign-in, shared by the mail adapters.

## Owns
- HTTP client (allow-list, timeouts, `Retry-After`, `RateLimited`), the streaming model downloader (the Hugging Face hosts in `docs/security.md` only), the update version-file reader (the GitHub Releases hosts there), loopback OAuth PKCE, token refresh and revocation.

## May import
`kernel`, `logger`, `zod`, and `core` for error types and OAuth ports until the domains are split (#102 to #104); `pipeline`'s `retry.ts` only.

## Must not contain
- Provider-specific API code, hosts missing from `docs/security.md`.
