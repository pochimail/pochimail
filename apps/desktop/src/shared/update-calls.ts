import { z } from "zod";

/** The only page the Download button opens. A constant of the app: nothing fetched ever decides where the button goes (#300). */
export const RELEASES_URL = "https://github.com/pochimail/pochimail/releases/latest";
/** GitHub serves this only from the latest published Release. The file is `{"version":"x.y.z"}` and nothing else. */
export const VERSION_FILE_URL = `${RELEASES_URL}/download/latest.json`;

/** The update notice's calls to main (#300). Nothing here downloads or runs an installer. */
export const updateChannels = {
  state: "update:state",
  checkNow: "update:check-now",
  setAutoCheck: "update:set-auto-check",
  dismiss: "update:dismiss",
  download: "update:download",
  announcement: "update:announcement",
  changed: "update:changed",
} as const;

export const versionSchema = z.string().regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/);

export const updateStateSchema = z.object({
  /** False in dev, PR and smoke builds: they never contact GitHub, and Settings hides the Updates row. */
  enabled: z.boolean(),
  currentVersion: z.string().min(1).max(64),
  autoCheck: z.boolean(),
  /** The newest version found that is newer than this one, dismissed or not. */
  latest: versionSchema.nullable(),
});
export type UpdateState = z.infer<typeof updateStateSchema>;

export const checkResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("disabled") }),
  z.object({ status: z.literal("up-to-date") }),
  z.object({ status: z.literal("available"), version: versionSchema }),
  z.object({ status: z.literal("failed") }),
]);
export type CheckResult = z.infer<typeof checkResultSchema>;

export const autoCheckSchema = z.boolean();
/** The version to announce in a toast, handed out once per launch, or null. */
export const announcementSchema = versionSchema.nullable();
