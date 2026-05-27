-- remote_package_path：远程上传后的镜像包路径。
ALTER TABLE deployments ADD COLUMN remote_package_path TEXT NOT NULL DEFAULT '';
-- run_command：本次部署最终执行的 docker run 命令。
ALTER TABLE deployments ADD COLUMN run_command TEXT NOT NULL DEFAULT '';
-- metadata_json：镜像打包/远程部署的补充结构化信息。
ALTER TABLE deployments ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '';
