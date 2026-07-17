-- Local annotations for remote files and directories. The remote filesystem is never modified.
CREATE TABLE IF NOT EXISTS remote_file_annotations (
  server_key TEXT NOT NULL,
  remote_path TEXT NOT NULL,
  annotation TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (server_key, remote_path)
);

CREATE INDEX IF NOT EXISTS idx_remote_file_annotations_updated_at
  ON remote_file_annotations(server_key, updated_at DESC);
