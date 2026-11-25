import { z } from "zod";

/**
 * The OS calls that go through main (ADR 0002): three integrations, none of them mail related (the storage prompt's calls are in storage-calls.ts). Each is validated in
 * the preload before it leaves the page and again in main before it touches the OS.
 */
export const osChannels = {
  openMailAppLink: "os:open-mail-app-link",
  showInFinder: "os:show-in-finder",
  chooseFolder: "os:choose-folder",
} as const;

// Opens the user's own mail app only: `mailto:` and Apple Mail's `message:` links. Never an arbitrary or web URL (threat model R3).
const mailAppSchemes = new Set(["mailto:", "message:"]);
export const mailAppLinkSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      return mailAppSchemes.has(new URL(value).protocol);
    } catch {
      return false;
    }
  }, "not a mail-app link");

export const folderPathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !value.includes("\0"), "invalid path");

export const chosenFolderSchema = z.string().min(1).nullable();
