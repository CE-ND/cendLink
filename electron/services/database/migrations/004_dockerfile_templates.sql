-- Dockerfile 模板：保存用户从自定义 Dockerfile 导入后沉淀下来的模板。
CREATE TABLE IF NOT EXISTS dockerfile_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT 'custom',
  template_text TEXT NOT NULL,
  base_image_family TEXT NOT NULL DEFAULT '',
  java_version TEXT NOT NULL DEFAULT '',
  java_opts TEXT NOT NULL DEFAULT '',
  use_non_root_user INTEGER NOT NULL DEFAULT 1,
  app_user TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dockerfile_templates_updated_at
  ON dockerfile_templates(updated_at DESC);
