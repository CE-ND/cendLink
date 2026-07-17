-- 前端发布后的 Nginx 重启配置。旧项目保持关闭，避免升级后意外重启线上服务。
ALTER TABLE frontend_projects
  ADD COLUMN restart_nginx INTEGER NOT NULL DEFAULT 0;

ALTER TABLE frontend_projects
  ADD COLUMN nginx_restart_command TEXT NOT NULL DEFAULT 'systemctl restart nginx';
