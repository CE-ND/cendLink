import { contextBridge, ipcRenderer } from 'electron'

// 暴露给 Vue 渲染进程的安全 API。渲染层只能通过这些方法访问主进程能力。
const api = {
  windowControls: {
    minimize() {
      return ipcRenderer.invoke('window:minimize')
    },
    toggleMaximize() {
      return ipcRenderer.invoke('window:toggle-maximize')
    },
    close() {
      return ipcRenderer.invoke('window:close')
    },
    isMaximized() {
      return ipcRenderer.invoke('window:is-maximized')
    },
    onMaximizedChange(callback) {
      const listener = (_event, isMaximized) => {
        callback(Boolean(isMaximized))
      }

      ipcRenderer.on('window:maximized-changed', listener)

      return () => {
        ipcRenderer.removeListener('window:maximized-changed', listener)
      }
    },
  },
  // 本地数据目录、数据库路径、日志目录等运行时信息。
  data: {
    getStorageInfo() {
      return ipcRenderer.invoke('data:get-storage-info')
    },
  },
  // 本地 Docker 镜像包构建能力：选择 Jar、预览配置、执行打包。
  docker: {
    selectJarFile() {
      return ipcRenderer.invoke('docker:select-jar-file')
    },
    previewImagePackage(config) {
      return ipcRenderer.invoke('docker:preview-image-package', config)
    },
    buildImagePackage(config) {
      return ipcRenderer.invoke('docker:build-image-package', config)
    },
    openImagePackageDirectory(packagePath = '') {
      return ipcRenderer.invoke('docker:open-image-package-directory', packagePath)
    },
  },
  deployment: {
    selectPackageFile() {
      return ipcRenderer.invoke('deployment:select-package-file')
    },
    preview(config) {
      return ipcRenderer.invoke('deployment:preview', config)
    },
    run(connection, config) {
      return ipcRenderer.invoke('deployment:run', { connection, config })
    },
  },
  frontendUpload: {
    selectArchiveFile() {
      return ipcRenderer.invoke('frontend-upload:select-archive-file')
    },
    preview(config) {
      return ipcRenderer.invoke('frontend-upload:preview', config)
    },
    run(connection, config) {
      return ipcRenderer.invoke('frontend-upload:run', { connection, config })
    },
  },
  // SSH 相关能力：连接测试、执行命令、选择本地私钥文件。
  ssh: {
    testConnection(config) {
      return ipcRenderer.invoke('ssh:test-connection', config)
    },
    executeCommand(config, command) {
      return ipcRenderer.invoke('ssh:execute-command', { config, command })
    },
    startCommandStream(config, command) {
      return ipcRenderer.invoke('ssh:start-command-stream', { config, command })
    },
    stopCommandStream(id) {
      return ipcRenderer.invoke('ssh:stop-command-stream', id)
    },
    onCommandStreamEvent(callback) {
      const listener = (_event, payload) => {
        callback(payload)
      }

      ipcRenderer.on('ssh:command-stream-event', listener)

      return () => {
        ipcRenderer.removeListener('ssh:command-stream-event', listener)
      }
    },
    selectPrivateKeyFile() {
      return ipcRenderer.invoke('ssh:select-private-key-file')
    },
  },
  // 已保存服务器配置的增删改查。
  servers: {
    list() {
      return ipcRenderer.invoke('servers:list')
    },
    save(server) {
      return ipcRenderer.invoke('servers:save', server)
    },
    delete(id) {
      return ipcRenderer.invoke('servers:delete', id)
    },
  },
  // 命令执行历史记录，目前用于记录一次性远程命令。
  history: {
    listCommandRuns(limit) {
      return ipcRenderer.invoke('history:list-command-runs', limit)
    },
    recordCommandRun(commandRun) {
      return ipcRenderer.invoke('history:record-command-run', commandRun)
    },
    listDeployments(limit) {
      return ipcRenderer.invoke('history:list-deployments', limit)
    },
    recordImagePackage(imagePackage) {
      return ipcRenderer.invoke('history:record-image-package', imagePackage)
    },
    recordRemoteDeployment(deployment) {
      return ipcRenderer.invoke('history:record-remote-deployment', deployment)
    },
    recordFrontendUpload(upload) {
      return ipcRenderer.invoke('history:record-frontend-upload', upload)
    },
    deleteDeployment(id) {
      return ipcRenderer.invoke('history:delete-deployment', id)
    },
  },
  // Dockerfile 模板库：保存用户导入后的自定义模板。
  dockerfileTemplates: {
    list() {
      return ipcRenderer.invoke('dockerfile-templates:list')
    },
    save(template) {
      return ipcRenderer.invoke('dockerfile-templates:save', template)
    },
    delete(id) {
      return ipcRenderer.invoke('dockerfile-templates:delete', id)
    },
  },
  // 服务模板库：保存某个业务服务的打包配置与部署配置。
  serviceTemplates: {
    list() {
      return ipcRenderer.invoke('service-templates:list')
    },
    save(template) {
      return ipcRenderer.invoke('service-templates:save', template)
    },
    delete(id) {
      return ipcRenderer.invoke('service-templates:delete', id)
    },
  },
  // 前端项目库：保存静态站点的 Nginx 目录、上传策略和最近包。
  frontendProjects: {
    list() {
      return ipcRenderer.invoke('frontend-projects:list')
    },
    save(project) {
      return ipcRenderer.invoke('frontend-projects:save', project)
    },
    delete(id) {
      return ipcRenderer.invoke('frontend-projects:delete', id)
    },
  },
  // 应用设置键值存储，value 会以 JSON 形式写入数据库。
  settings: {
    get(key, fallbackValue = null) {
      return ipcRenderer.invoke('settings:get', key, fallbackValue)
    },
    set(key, value) {
      return ipcRenderer.invoke('settings:set', key, value)
    },
  },
}

// window.cendlink 是前端访问 Electron 能力的唯一入口。
contextBridge.exposeInMainWorld('cendlink', api)
