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
  needsRetest,
  updateForm,
  saveCurrentServer,
  testConnection,
  selectPrivateKeyFile,
} = useWorkspaceSession()
</script>

<template>
  <div class="content-grid">
    <ConnectionForm
      :model-value="form"
      :busy="isTesting || isExecutingCommand"
      :saving="isSavingServer"
      @update:model-value="updateForm"
      @select-key="selectPrivateKeyFile"
      @save="saveCurrentServer"
      @test="testConnection"
    />

    <ConnectionStatus :result="result" :busy="isTesting" :stale="needsRetest" />
  </div>
</template>
