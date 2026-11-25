# 0007 — OAuth, credentials and scopes

Status: Accepted (2026-11-17) · Amended by [0011](0011-v1-providers-google-and-microsoft.md) (v1 providers) and [0012](0012-delete-moves-to-trash-with-approval.md) (no full-access scope)

## Decision
- **Flow**: OAuth 2.0 authorization code with PKCE in the system browser, redirecting to a loopback `http://127.0.0.1:<random port>` listener that closes after one request. `state` is checked; cancel or timeout shows the "sign-in cancelled" state. No `id_token` is read: `openid` and `email` only identify the address.
- **Client ids** come from build-time config or env (`POCHIMAIL_GOOGLE_CLIENT_ID`…), never hard-coded. Official builds inject the verified ids; forks and dev builds register their own ([CONTRIBUTING.md](../../CONTRIBUTING.md)).
- **Tokens**: refresh tokens only in the OS keychain through the `SecretStore` port; access tokens in memory only; never logged.
- **Scopes** (least privilege, requested incrementally):

  | Provider | Just look | Suggest and Autopilot | Opt-in |
  |---|---|---|---|
  | Gmail | `gmail.readonly` | `gmail.modify` | `gmail.send` (`mailto:` unsubscribe) |
  | Microsoft (v1.1) | `Mail.Read`, `offline_access`, `User.Read` | `Mail.ReadWrite` | `Mail.Send` |

  Raising autonomy re-prompts for the extra scope. Never a delete scope and never `https://mail.google.com/`.
- **Remove account** revokes the token at the provider and deletes keychain entries and local data. **Reconnect** appears when a refresh fails; nothing else stops.
- **Verification** (long lead, starts in M2): Google OAuth verification for restricted scopes (`gmail.readonly` and `gmail.modify` are restricted, `gmail.send` is sensitive) and, for v1.1, Microsoft publisher verification (Partner Program account, an app registered in a work or school Entra tenant, DNS-verified `getpochimail.com`; register multitenant plus personal accounts). Unverified apps are limited to listed test users. Whether Google's CASA assessment applies to a local-only app is unconfirmed: ask Google in writing during verification; if it applies, fund it or offer Gmail through an IMAP app password (v1.1, [ADR 0011](0011-v1-providers-google-and-microsoft.md)); the maintainer decides.

## Consequences
"Pochimail never sees your password" is true for Gmail (v1) and Outlook (v1.1). IMAP and its app-password flow return in v1.1 ([ADR 0011](0011-v1-providers-google-and-microsoft.md)), with their own wording and verification.

## To verify
Google's CASA answer; loopback and PKCE rules and unverified token lifetime; consent behaviour of personal Outlook.com accounts for unverified apps.
