-- 服务模板：保存某个业务服务的打包配置、部署配置和最近一次构建/部署状态。
-- 与 dockerfile_templates 分离；这里只可引用 Dockerfile 模板，不保存为 Dockerfile 模板。
CREATE TABLE IF NOT EXISTS service_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  service_name TEXT NOT NULL DEFAULT '',
  package_config_json TEXT NOT NULL DEFAULT '{}',
  deploy_config_json TEXT NOT NULL DEFAULT '{}',
  last_package_version TEXT NOT NULL DEFAULT '',
  last_image_tag TEXT NOT NULL DEFAULT '',
  last_package_path TEXT NOT NULL DEFAULT '',
  last_packaged_at TEXT,
  last_deployed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_service_templates_updated_at
  ON service_templates(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_service_templates_service_name
  ON service_templates(service_name);
