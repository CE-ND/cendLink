import { contextBridge, ipcRenderer } from 'electron'

const api = {
  ssh: {
    testConnection(config) {
      return ipcRenderer.invoke('ssh:test-connection', config)
    },
    executeCommand(config, command) {
      return ipcRenderer.invoke('ssh:execute-command', { config, command })
    },
    selectPrivateKeyFile() {
      return ipcRenderer.invoke('ssh:select-private-key-file')
    },
  },
}

contextBridge.exposeInMainWorld('cendlink', api)
