# Releases

Direct download only: GitHub Releases, no app store. **v1 ships unsigned on every OS.** The workflow already carries the signing steps; they run only when an OS's secrets exist, so turning signing on later means adding secrets, not code.

## Cut a release
1. On `main`, tag `vX.Y.Z` (plain version, no suffix) and push the tag. Workflow `release.yml` builds on macOS, Windows and Linux, runs the packaging smoke, installs and launches each installer, and drafts a GitHub Release.
2. The draft holds five installers, `SHA256SUMS` and `latest.json` (`{"version":"X.Y.Z"}`, nothing else). Read the notes, then publish. The app's update notice reads `latest.json` from the latest published Release and only opens the download page (nothing installs itself, [security.md](security.md)).
3. Dry run: start the workflow by hand from `main`. Same build and checks, no Release; the files stay as a workflow artifact for 7 days.

Asset names carry no version, so `releases/latest/download/<name>` works: `Pochimail-mac-universal.dmg`, `Pochimail-win-x64.exe`, `Pochimail-linux-x86_64.AppImage`, `Pochimail-linux-amd64.deb`, `Pochimail-linux-x86_64.rpm`. The list lives in `apps/desktop/packaging/release-assets.ts`.

## Signing mode
`apps/desktop/packaging/signing-mode.ts` decides per OS from the environment: `signed` (all secrets set), `unsigned` (none) or `invalid` (some: the release fails and names the missing secrets). The workflow log prints one line per OS, the verification step skips signature checks for an unsigned OS, and the Release notes name the unsigned installers. Pull request and merge-queue builds are unsigned whatever the environment holds.

## Secrets
Names only, in the protected `release` environment of the repository. Never put a value in the repository, an artifact or a log.
- **macOS** (Developer ID, hardened runtime, notarization): `CSC_LINK` (base64 `.p12`), `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
- **Windows** (Azure Trusted Signing through electron-builder): `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TS_ENDPOINT`, `AZURE_TS_ACCOUNT`, `AZURE_TS_PROFILE`, `AZURE_TS_PUBLISHER`.
- Linux is never signed.

The signed path is not proven until the first run with real secrets: the hardened-runtime entitlements (`apps/desktop/build/entitlements.mac.plist`) only bite on a signed build. The package smoke and the install check then run on the signed build.
