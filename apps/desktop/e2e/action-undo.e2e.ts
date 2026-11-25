import { test } from "@playwright/test";

// The hook for the action-and-undo smoke (#93): archive or delete a reviewed email, then undo it from Activity. It joins the
// first-run path of smoke.e2e.ts (launchApp, walkToSetup, startSorting) once actions exist in the app.
// Guards: an action that cannot be undone, or an undo that does not restore the mailbox (#93).
test.fixme("a user approves an action and undoes it from Activity", () => {});
