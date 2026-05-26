import { contextBridge, ipcRenderer } from 'electron'

const api = {
  ssh: {
    testConnection(config) {
      return ipcRenderer.invoke('ssh:test-connection', config)
    },
    selectPrivateKeyFile() {
      return ipcRenderer.invoke('ssh:select-private-key-file')
    },
  },
}

contextBridge.exposeInMainWorld('cendlink', api)
