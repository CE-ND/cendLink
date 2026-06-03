-- 前端项目：保存静态站点上传时的 Nginx 目录、最近压缩包和发布策略。
CREATE TABLE IF NOT EXISTS frontend_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  project_dir TEXT NOT NULL DEFAULT '',
  remote_base_dir TEXT NOT NULL DEFAULT '/opt/app/nginx/html',
  remote_target_dir TEXT NOT NULL DEFAULT '',
  remote_upload_dir TEXT NOT NULL DEFAULT '/opt/cendlink/frontend-packages',
  extract_strategy TEXT NOT NULL DEFAULT 'clean',
  keep_remote_archive INTEGER NOT NULL DEFAULT 0,
  entry_file TEXT NOT NULL DEFAULT 'index.html',
  last_package_path TEXT NOT NULL DEFAULT '',
  last_uploaded_at TEXT,
  last_server_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (last_server_id) REFERENCES servers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_frontend_projects_updated_at
  ON frontend_projects(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_frontend_projects_project_dir
  ON frontend_projects(project_dir);
