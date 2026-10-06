CREATE TABLE IF NOT EXISTS ip_question_windows (
  ip_hash TEXT PRIMARY KEY NOT NULL,
  question_count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ip_question_windows_reset_at
  ON ip_question_windows (reset_at);
