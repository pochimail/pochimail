-- Workspace preferences (theme, language, autonomy…) as one JSON document per workspace, so they
-- survive a restart. Preferences only: no mail content (ADR 0014).
CREATE TABLE settings (
  workspace_id TEXT NOT NULL PRIMARY KEY,
  data         TEXT NOT NULL
) STRICT;
