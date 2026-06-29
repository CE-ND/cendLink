<script setup>
import ConnectionForm from '../components/ConnectionForm.vue'
import ConnectionStatus from '../components/ConnectionStatus.vue'
import { useWorkspaceSession } from '../../workspace/composables/useWorkspaceSession.js'

// 服务器页只负责 SSH 配置编辑和连接测试。
const {
  form,
  result,
  isTesting,
  isExecutingCommand,
  isSavingServer,
  isCreatingServer,
  needsRetest,
  serverMetrics,
  isLoadingMetrics,
  metricsError,
  updateForm,
  saveCurrentServer,
  createNewServer,
  testConnection,
  selectPrivateKeyFile,
  refreshServerMetrics,
} = useWorkspaceSession()
</script>

<template>
  <div class="connection-board">
    <ConnectionForm
      :model-value="form"
      :busy="isTesting || isExecutingCommand"
      :saving="isSavingServer"
      :mode="isCreatingServer ? 'create' : 'edit'"
      @update:model-value="updateForm"
      @create="createNewServer"
      @select-key="selectPrivateKeyFile"
      @save="saveCurrentServer"
      @test="testConnection"
    />

    <ConnectionStatus
      :result="result"
      :target="{ username: form.username, host: form.host, port: form.port }"
      :busy="isTesting"
      :stale="needsRetest"
      :metrics="serverMetrics"
      :metrics-loading="isLoadingMetrics"
      :metrics-error="metricsError"
      @refresh-metrics="refreshServerMetrics"
    />
  </div>
</template>
