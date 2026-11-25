# Screen HTML

Static HTML/CSS of every designed screen, with mock data filled in. Open any file in a browser (fonts load from `docs/design/fonts/ttf/`).
Use these for exact spacing, sizes, colors and copy when building the React components. They are references, not code to ship.

File names: `Main` = Welcome, `Connect`, `Mode` = Setup, `Scan` = Overview, `Overview` = plain Summary sheet, `Settings`, `States` (empty and error states), `Mascot` (sheet).
`ConnectPromise` and `ModePromise` (Setup) = the same screens with the deletion promise from `docs/product.md` in place of the old "never delete" lines. `Main` (Welcome) has no caption slot for the sentence, so it is unchanged.
`Activity` = Activity & undo, one list that shows every state: applied with Undo and Undo all (Trash batch), undone, failed with Try again, unsubscribe that can't be undone, deletion no longer in the Trash (undo unavailable); `ActivityEmpty` = empty.
`Delete*` = delete confirmation outcomes: `DeleteSuccess` (undo toast), `DeleteFailure` (nothing moved), `DeletePartial` (some emails stayed). The confirm itself is `ReviewDeleteConfirm`.
`ScanDelete` = Overview with Clean up first and the GB you can free by deleting; `ScanDeleteUnknown` = the same when Outlook sizes are not known yet (no GB figure); `SummaryDelete` = Summary sheet with that figure.
`Review*` = Review list: `ReviewDelete` (list, preview, a protected email left unticked), `ReviewDeleteConfirm` (one confirm, to the Trash), `ReviewUnsubscribe` (senders, Keep), `ReviewUnsubscribeConfirm` (one confirm, cannot be undone), `ReviewStates` (empty, loading, no account).
`SidebarTopics*` = sidebar with the five types and automatic topics (ADR 0016): `SidebarTopics` (empty ones hidden by absence), `SidebarTopicsSelection` (one account: Promotions and a topic absent because empty), `SidebarTopicMenu` (Rename, Merge into…, Hide), `SidebarTopicRename`, `SidebarTopicMerge`, `SidebarTopicHide` (undo toast), `SidebarTopicsFr` and `SidebarTopicsJa` (user's language, light only), `SettingsHiddenTopics` (Show again, light only). On phone the sidebar rows are the "Email" screen.
`Storage*` = the Linux storage-protection prompt over Welcome: `StoragePassphrase` (passphrase first, "store without protection" second), `StoragePassphraseError`, `StorageUnprotected` (second explicit step), `StorageUnlock` (later launches).
`Dark*` and `Phone*` are the dark and phone versions.

Motion is not here: see `../source/Motion.dc.html` (keyframes, easing and timing in its `<style>` and `<script>`) and the motion catalog in `docs/design.md`.
`../source/` holds the original canvas files for every board. They need the design canvas runtime to run, so read them; don't expect them to open standalone.
