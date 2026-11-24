-- ADR 0014: reports and actions only. Rebuild the v5 tables with the allow-listed columns and
-- wipe everything else: subjects, snippets, addresses, recipients, attachment names, unsubscribe
-- headers, embeddings, template hashes and free-text reasons. The clear-text sender is replaced by
-- a keyed hash supplied by the caller at write time; rows written before v6 have no usable hash.
-- The app's FTS5 index and its maintenance triggers are removed (the encrypted-driver proof in the
-- desktop app has its own, separate synthetic table).

DROP TRIGGER IF EXISTS message_search_insert;
DROP TRIGGER IF EXISTS message_search_update;
DROP TRIGGER IF EXISTS message_search_delete;
DROP TRIGGER IF EXISTS signal_search_insert;
DROP TRIGGER IF EXISTS signal_search_delete;
DROP TABLE IF EXISTS message_search;

-- Index names are schema-wide in SQLite: drop the v5 indexes before rebuilding their tables.
DROP INDEX IF EXISTS message_by_account_date;
DROP INDEX IF EXISTS message_by_category;
DROP INDEX IF EXISTS message_by_sender;
DROP INDEX IF EXISTS message_by_sender_hash;
DROP INDEX IF EXISTS message_by_ingest;
DROP INDEX IF EXISTS message_by_archived;
DROP INDEX IF EXISTS thread_by_account;
DROP INDEX IF EXISTS derived_by_account;
DROP INDEX IF EXISTS suggestion_by_state;

ALTER TABLE message RENAME TO message_v5;
CREATE TABLE message (
  workspace_id          TEXT NOT NULL,
  id                    TEXT NOT NULL,
  account_id            TEXT NOT NULL,
  thread_id             TEXT NOT NULL,
  sender_hash           TEXT NOT NULL,
  received_at           TEXT NOT NULL,
  has_list_unsubscribe  INTEGER NOT NULL,
  opened                INTEGER NOT NULL,
  size                  INTEGER,
  saved_count           INTEGER,
  saved_size            INTEGER,
  archived              INTEGER,
  topic_ids             TEXT NOT NULL,
  suspicious_reason_code TEXT,
  suspicious_confidence REAL,
  category              TEXT NOT NULL,
  ingest_seq            INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, id)
) STRICT;
INSERT INTO message (workspace_id, id, account_id, thread_id, sender_hash, received_at,
  has_list_unsubscribe, opened, size, saved_count, saved_size, archived, topic_ids,
  suspicious_reason_code, suspicious_confidence, category, ingest_seq)
SELECT workspace_id, id, account_id, thread_id, '', received_at,
  has_list_unsubscribe, opened, size, saved_count, saved_size, archived, topic_ids,
  NULL, NULL, category, ingest_seq FROM message_v5;
CREATE INDEX message_by_account_date ON message (workspace_id, account_id, received_at DESC, id);
CREATE INDEX message_by_category ON message (workspace_id, account_id, category, received_at DESC, id);
CREATE INDEX message_by_sender_hash ON message (workspace_id, account_id, sender_hash, received_at DESC, id);
CREATE INDEX message_by_ingest ON message (workspace_id, account_id, ingest_seq);
CREATE INDEX message_by_archived ON message (workspace_id, account_id, archived);
DROP TABLE message_v5;

ALTER TABLE thread RENAME TO thread_v5;
CREATE TABLE thread (
  workspace_id    TEXT NOT NULL,
  id              TEXT NOT NULL,
  account_id      TEXT NOT NULL,
  message_ids     TEXT NOT NULL,
  last_message_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, id)
) STRICT;
INSERT INTO thread (workspace_id, id, account_id, message_ids, last_message_at)
SELECT workspace_id, id, account_id, message_ids, last_message_at FROM thread_v5;
CREATE INDEX thread_by_account ON thread (workspace_id, account_id, last_message_at DESC);
DROP TABLE thread_v5;

ALTER TABLE derived RENAME TO derived_v5;
CREATE TABLE derived (
  workspace_id  TEXT NOT NULL,
  message_id    TEXT NOT NULL,
  account_id    TEXT NOT NULL,
  category      TEXT NOT NULL,
  reason_code   TEXT NOT NULL,
  confidence    REAL NOT NULL,
  model_version TEXT NOT NULL,
  derived_at    TEXT NOT NULL,
  PRIMARY KEY (workspace_id, message_id)
) STRICT;
INSERT INTO derived (workspace_id, message_id, account_id, category, reason_code, confidence,
  model_version, derived_at)
SELECT workspace_id, message_id, account_id, category, '', confidence, model_version, derived_at
FROM derived_v5;
CREATE INDEX derived_by_account ON derived (workspace_id, account_id, message_id);
DROP TABLE derived_v5;

ALTER TABLE signal RENAME TO signal_v5;
CREATE TABLE signal (
  workspace_id TEXT NOT NULL,
  message_id   TEXT NOT NULL,
  kind         TEXT NOT NULL,
  confidence   REAL NOT NULL,
  detected_at  TEXT NOT NULL,
  reason_code  TEXT NOT NULL,
  PRIMARY KEY (workspace_id, message_id, kind)
) STRICT;
INSERT INTO signal (workspace_id, message_id, kind, confidence, detected_at, reason_code)
SELECT workspace_id, message_id, kind, confidence, detected_at, '' FROM signal_v5;
DROP TABLE signal_v5;

ALTER TABLE sender_stats RENAME TO sender_stats_v5;
CREATE TABLE sender_stats (
  workspace_id    TEXT NOT NULL,
  account_id      TEXT NOT NULL,
  sender_hash     TEXT NOT NULL,
  message_count   INTEGER NOT NULL,
  opened_count    INTEGER NOT NULL,
  replied_count   INTEGER NOT NULL,
  last_message_at TEXT NOT NULL,
  vip             INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, account_id, sender_hash)
) STRICT;
DROP TABLE sender_stats_v5;

ALTER TABLE suggestion RENAME TO suggestion_v5;
CREATE TABLE suggestion (
  workspace_id TEXT NOT NULL,
  id           TEXT NOT NULL,
  account_id   TEXT NOT NULL,
  state        TEXT NOT NULL CHECK (state IN ('pending', 'approved', 'dismissed')),
  confidence   REAL NOT NULL,
  created_at   TEXT NOT NULL,
  command      TEXT NOT NULL,
  reason_codes TEXT NOT NULL,
  PRIMARY KEY (workspace_id, id)
) STRICT;
INSERT INTO suggestion (workspace_id, id, account_id, state, confidence, created_at, command, reason_codes)
SELECT workspace_id, id, account_id, state, confidence, created_at, command, '[]' FROM suggestion_v5;
CREATE INDEX suggestion_by_state ON suggestion (workspace_id, state, created_at, id);
DROP TABLE suggestion_v5;

CREATE TABLE keep_rule (
  workspace_id TEXT NOT NULL,
  account_id   TEXT NOT NULL,
  sender_hash  TEXT NOT NULL,
  rule_type    TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (workspace_id, account_id, sender_hash, rule_type)
) STRICT;
