-- 已执行迁移记录：防止同一个 SQL 文件重复执行。
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- 服务器配置：保存 SSH 目标、认证方式、最近连接状态。
CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 22,
  username TEXT NOT NULL,
  auth_type TEXT NOT NULL CHECK (auth_type IN ('password', 'privateKey')),
  private_key_path TEXT NOT NULL DEFAULT '',
  timeout_ms INTEGER NOT NULL DEFAULT 10000,
  last_status TEXT NOT NULL DEFAULT 'idle',
  last_message TEXT NOT NULL DEFAULT '',
  last_connected_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_servers_updated_at ON servers(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_servers_host ON servers(host, port, username);

-- 命令执行记录：保存一次性远程命令的服务器快照、状态、输出预览和耗时。
CREATE TABLE IF NOT EXISTS command_runs (
  id TEXT PRIMARY KEY,
  server_id TEXT,
  server_name TEXT NOT NULL DEFAULT '',
  host TEXT NOT NULL DEFAULT '',
  port INTEGER NOT NULL DEFAULT 22,
  username TEXT NOT NULL DEFAULT '',
  command TEXT NOT NULL,
  status TEXT NOT NULL,
  exit_code INTEGER,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  stdout_preview TEXT NOT NULL DEFAULT '',
  stderr_preview TEXT NOT NULL DEFAULT '',
  log_file_path TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_command_runs_created_at ON command_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_command_runs_server_id ON command_runs(server_id);

-- 部署主记录：后续部署 Java 项目时记录一次部署流水的整体状态。
CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  server_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  artifact_name TEXT NOT NULL DEFAULT '',
  deploy_path TEXT NOT NULL DEFAULT '',
  started_at TEXT,
  finished_at TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT NOT NULL DEFAULT '',
  log_file_path TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_deployments_created_at ON deployments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deployments_server_id ON deployments(server_id);

-- 部署步骤记录：一条 deployment 下的构建、上传、备份、启动等步骤明细。
CREATE TABLE IF NOT EXISTS deployment_steps (
  id TEXT PRIMARY KEY,
  deployment_id TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  command TEXT NOT NULL DEFAULT '',
  exit_code INTEGER,
  started_at TEXT,
  finished_at TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (deployment_id) REFERENCES deployments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_deployment_steps_deployment_id
  ON deployment_steps(deployment_id, step_order);

-- 应用设置：通用 key/value_json 存储，用于偏好配置和默认值。
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
