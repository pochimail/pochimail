-- Q-14/#114: the Overview figures (ADR 0012, ADR 0014). Numbers only: how many attachments a
-- message carries and their size, and whether an applied archive action left it out of the inbox.
-- Old rows stay NULL (unknown); a replay of this migration is skipped by user_version.
ALTER TABLE message ADD COLUMN saved_count INTEGER;
ALTER TABLE message ADD COLUMN saved_size INTEGER;
ALTER TABLE message ADD COLUMN archived INTEGER;
CREATE INDEX message_by_archived ON message (workspace_id, account_id, archived);
