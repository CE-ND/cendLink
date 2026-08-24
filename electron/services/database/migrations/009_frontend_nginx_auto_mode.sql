-- 将历史内置命令迁移为自动适配模式；用户填写的其他自定义命令保持不变。
UPDATE frontend_projects
SET nginx_restart_command = 'auto'
WHERE TRIM(nginx_restart_command) IN (
  'systemctl restart nginx',
  'systemctl restart nginx.service',
  'sudo systemctl restart nginx',
  'sudo systemctl restart nginx.service',
  'docker exec nginx nginx -t && docker exec nginx nginx -s reload',
  'docker exec ''nginx'' nginx -t && docker exec ''nginx'' nginx -s reload'
);
