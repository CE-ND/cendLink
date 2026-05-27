import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// 本地数据根目录：按你的要求放在用户目录的 .cendLink 文件夹中。
export const dataDir = path.join(os.homedir(), '.cendLink')
// SQLite 数据库文件，保存服务器配置、命令记录、部署记录和设置。
export const dbPath = path.join(dataDir, 'cendlink.db')
// 所有日志的根目录。
export const logsDir = path.join(dataDir, 'logs')
// 远程命令执行日志目录。
export const commandLogsDir = path.join(logsDir, 'commands')
// 后续部署流水日志目录。
export const deploymentLogsDir = path.join(logsDir, 'deployments')
// 本地生成的 Docker 镜像压缩包目录。
export const imagePackagesDir = path.join(dataDir, 'image-packages')
// 上传包、临时脚本等中间文件目录。
export const tempDir = path.join(dataDir, 'temp')

/**
 * 确保应用启动前需要的本地目录都已经存在。
 */
export async function ensureStorageDirectories() {
  await Promise.all([
    fs.mkdir(dataDir, { recursive: true }),
    fs.mkdir(commandLogsDir, { recursive: true }),
    fs.mkdir(deploymentLogsDir, { recursive: true }),
    fs.mkdir(imagePackagesDir, { recursive: true }),
    fs.mkdir(tempDir, { recursive: true }),
  ])
}

/**
 * 返回本地存储路径信息，供设置页或日志提示展示。
 */
export async function getStorageInfo() {
  await ensureStorageDirectories()

  return {
    dataDir,
    dbPath,
    logsDir,
    commandLogsDir,
    deploymentLogsDir,
    imagePackagesDir,
    tempDir,
  }
}
